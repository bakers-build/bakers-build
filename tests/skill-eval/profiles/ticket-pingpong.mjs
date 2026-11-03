import { arg, callRecovery, calls, check, commonChecks, succeeded, tool, uuid, validateTools, writes } from '../call-utils.mjs';
import { nonempty, requireValue } from '../validation.mjs';

// A ticket:pingpong run: where it stops (user question, technical problem, transition, hold or
// not at all), that a technical problem never reaches the user, and that nothing follows the stop.
const STOPS = ['none', 'question', 'technical-problem', 'transition', 'hold'];
// The user reads only this note; the cause and output go into the state's handoff.
const KEYTEC = '# Technical problem\n\nPlease contact keytec.';

export function validate(f) {
  validateTools(f, 'bb-ticket-pingpong');
  const e = f.expect;
  requireValue(uuid(f.input.ticket_uuid) && f.simulation.ticket?.id === f.input.ticket_uuid, 'Expected the simulated ticket');
  requireValue(STOPS.includes(e?.stop), `Expected expect.stop as one of ${STOPS.join(', ')}`);
  requireValue((e.stop === 'transition') === ['working', 'review'].includes(e.state) && (e.stop === 'transition' || e.state === undefined),
    'Expected expect.state working or review exactly for a transition');
  requireValue(e.stop !== 'none' || nonempty(e.decision), 'Expected expect.decision for a run that does not stop');
  requireValue(e.review_status === undefined || ['OK', 'Not OK'].includes(e.review_status), 'Expected review_status OK or Not OK');
}

function analyze(f, output, context) {
  const e = f.expect, trace = calls(context, f.simulation.files);
  const { recovered, diagnostics } = callRecovery(trace);
  const sent = writes(trace).filter(c => c.result?.exit_code !== 4);
  const of = id => sent.filter(c => c.name === tool(id));
  const comments = of('bakers_comment_publish'), updates = of('bakers_ticket_update');
  const states = of('bakers_ticket_transition').filter(c => arg(c, 'state'));
  const headed = heading => comments.filter(c => new RegExp(`^\\s*# ${heading}\\b`).test(arg(c, 'body') ?? ''));
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
    ...commonChecks(trace, () => false, recovered),
    check('pingpong-question', e.stop === 'question' ? raised('Question', 'Question') : absent('Question', 'Question'),
      e.stop === 'question' ? 'Ask one user question: a # Question comment, then the Question label and the freeze'
        : 'Ask the user nothing: no # Question comment and no Question label'),
    check('pingpong-technical-problem', e.stop === 'technical-problem'
      ? raised('Technical problem', 'technical problem') && arg(headed('Technical problem')[0], 'body').trim() === KEYTEC
      : absent('Technical problem', 'technical problem'),
    e.stop === 'technical-problem' ? 'Report one technical problem: exactly the keytec note, then the label and the freeze'
      : 'Report no technical problem'),
    check('pingpong-no-stop', ['question', 'technical-problem'].includes(e.stop) || !updates.some(c => arg(c, 'frozen') === true),
      'Freeze the ticket only for a user question or a technical problem'),
    check('pingpong-transition', JSON.stringify(states.map(c => arg(c, 'state'))) === JSON.stringify(e.stop === 'transition' ? [e.state] : []),
      e.stop === 'transition' ? `Transition once, to ${e.state}` : 'Transition nothing: no merge, no done'),
    check('pingpong-run-ends', !decisive || !sent.some(c => c.index > decisive.index),
      'End the run at the freeze or the transition: no write after it'),
  ];
  if (e.review_status) {
    const reviews = comments.filter(c => arg(c, 'type') === 'review');
    checks.push(check('pingpong-review-status', reviews.length === 1 &&
      String(arg(reviews[0], 'body')).split('\n').some(l => l.trim() === `Status: **${e.review_status}**`),
    `Publish one review verdict with Status: **${e.review_status}**`));
  }
  if (e.decision) {
    checks.push(check('pingpong-decision', output.includes('Decisions') && output.includes(e.decision),
      `Record the technical decision (${e.decision}) under Decisions in the handoff`));
  }
  return { checks, diagnostics };
}

export const checkOutput = (f, output, context) => analyze(f, output, context).checks;
export const diagnose = (f, output, context) => analyze(f, output, context).diagnostics;
