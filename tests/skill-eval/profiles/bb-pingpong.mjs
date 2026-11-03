import { arg, callRecovery, calls, check, commonChecks, succeeded, tool, uuid, validateTools, writes } from '../call-utils.mjs';
import { nonempty, requireValue } from '../validation.mjs';

// A pingpong run: where it stops (user question, technical problem, transition or not at
// all), that a technical problem never reaches the user, that only done merges, and that nothing
// follows the stop.
const STOPS = ['none', 'question', 'technical-problem', 'transition'];
// The user reads only this note; the error and its output go into an earlier comment.
const NOTE = '# Technical problem\n\nPlease contact the developers.';

export function validate(f) {
  validateTools(f, 'bb-pingpong');
  const e = f.expect;
  requireValue(uuid(f.input.ticket_uuid) && f.simulation.ticket?.id === f.input.ticket_uuid, 'Expected the simulated ticket');
  requireValue(STOPS.includes(e?.stop), `Expected expect.stop as one of ${STOPS.join(', ')}`);
  requireValue((e.stop === 'transition') === ['working', 'review', 'done'].includes(e.state) && (e.stop === 'transition' || e.state === undefined),
    'Expected expect.state working, review or done exactly for a transition');
  requireValue((e.stop === 'technical-problem') === nonempty(e.cause), 'Expected expect.cause exactly for a technical problem');
  requireValue(e.link === undefined || (e.stop === 'question' && nonempty(e.link)), 'Expected expect.link only for a user question');
  requireValue(e.hidden === undefined || (e.link !== undefined && Array.isArray(e.hidden) && e.hidden.every(nonempty)),
    'Expected expect.hidden as technical terms of an acceptance question');
  requireValue(e.stop !== 'none' || nonempty(e.decision), 'Expected expect.decision for a run that does not stop');
  requireValue(e.review_status === undefined || ['OK', 'Not OK'].includes(e.review_status), 'Expected review_status OK or Not OK');
}

function analyze(f, output, context) {
  const e = f.expect, trace = calls(context, f.simulation.files);
  const declared = c => f.simulation.commands?.[c.tool]?.some(r => JSON.stringify(r.argv) === JSON.stringify(c.arguments?.argv));
  const merges = trace.filter(c => c.tool === 'glab' && c.arguments?.argv?.slice(1, 3).join(' ') === 'mr merge');
  const { recovered, diagnostics } = callRecovery(trace);
  const sent = writes(trace).filter(c => c.result?.exit_code !== 4);
  const of = id => sent.filter(c => c.name === tool(id));
  const comments = of('bakers_comment_publish'), updates = of('bakers_ticket_update');
  const states = of('bakers_ticket_transition').filter(c => arg(c, 'state'));
  // The heading is the comment's whole first line: `# Technical problem details` is an ordinary comment.
  const headed = heading => comments.filter(c => new RegExp(`^\\s*# ${heading}[ \\t]*(\\n|$)`).test(arg(c, 'body') ?? ''));
  const labelled = label => updates.filter(c => (arg(c, 'labels_add') ?? []).includes(label));
  // One comment under the heading, then one succeeded update adding the label and freezing the ticket.
  const raised = (heading, label) => {
    const [post, ...more] = headed(heading), [flag, ...others] = labelled(label);
    return post && flag && !more.length && !others.length && succeeded(post) && succeeded(flag) &&
      post.index < flag.index && arg(flag, 'frozen') === true;
  };
  const absent = (heading, label) => headed(heading).length === 0 && labelled(label).length === 0;
  const decisive = sent.find(c => (updates.includes(c) && arg(c, 'frozen') === true) || states.includes(c));
  const checks = [
    // The fixture's git/glab commands are on the call surface; anything else is not.
    ...commonChecks(trace.filter(c => !declared(c)), () => false, recovered),
    // The answer line tells whoever answers in the tracker to unfreeze the ticket, so the run resumes.
    check('pingpong-question', e.stop === 'question'
      ? raised('Question', 'Question') && /unfreeze/i.test(arg(headed('Question')[0], 'body'))
      : absent('Question', 'Question'),
      e.stop === 'question' ? 'Ask one user question: a # Question comment with the answer line, then the Question label and the freeze'
        : 'Ask the user nothing: no # Question comment and no Question label'),
    check('pingpong-technical-problem', e.stop === 'technical-problem'
      ? raised('Technical problem', 'technical problem') && arg(headed('Technical problem')[0], 'body').trim() === NOTE
      : absent('Technical problem', 'technical problem'),
    e.stop === 'technical-problem' ? 'Report one technical problem: exactly the contact note, then the label and the freeze'
      : 'Report no technical problem'),
    check('pingpong-no-stop', ['question', 'technical-problem'].includes(e.stop) || !updates.some(c => arg(c, 'frozen') === true),
      'Freeze the ticket only for a user question or a technical problem'),
    check('pingpong-transition', JSON.stringify(states.map(c => arg(c, 'state'))) === JSON.stringify(e.stop === 'transition' ? [e.state] : []),
      e.stop === 'transition' ? `Transition once, to ${e.state}` : 'Transition nothing: no merge, no done'),
    check('pingpong-merge', e.state === 'done'
      ? merges.length === 1 && succeeded(merges[0]) && states.every(c => c.index > merges[0].index)
      : merges.length === 0,
    e.state === 'done' ? 'Merge once, successfully, before the transition to done' : 'Merge nothing'),
    check('pingpong-run-ends', !decisive || !sent.some(c => c.index > decisive.index),
      'End the run at the freeze or the transition: no write after it'),
  ];
  if (e.review_status) {
    const reviews = comments.filter(c => arg(c, 'type') === 'review');
    // Merge's caller handoff may append its evidence as a further verdict; each keeps the status.
    checks.push(check('pingpong-review-status', reviews.length > 0 &&
      reviews.every(r => String(arg(r, 'body')).split('\n').some(l => l.trim() === `Status: **${e.review_status}**`)),
    `Publish the review verdict with Status: **${e.review_status}**`));
  }
  if (e.decision) {
    checks.push(check('pingpong-decision', output.includes('Decisions') && output.includes(e.decision),
      `Record the technical decision (${e.decision}) under Decisions in the handoff`));
  }
  if (e.stop === 'technical-problem') {
    const note = headed('Technical problem')[0];
    checks.push(check('pingpong-cause-recorded', note && comments.some(c => c.index < note.index && succeeded(c) &&
      String(arg(c, 'body')).includes(e.cause)),
    `Publish the error and its output (${e.cause}) in a comment before the contact note`));
  }
  if (e.link) {
    checks.push(check('pingpong-link', String(arg(headed('Question')[0], 'body')).includes(e.link),
      `Put the tunnel link (${e.link}) in the user question`));
  }
  if (e.hidden) {
    const body = String(arg(headed('Question')[0], 'body'));
    checks.push(check('pingpong-plain', e.hidden.every(t => !body.includes(t)),
      `Keep technical details (${e.hidden.join(', ')}) out of the acceptance question`));
  }
  return { checks, diagnostics };
}

export const checkOutput = (f, output, context) => analyze(f, output, context).checks;
export const diagnose = (f, output, context) => analyze(f, output, context).diagnostics;
