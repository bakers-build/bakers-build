import { calls, check, commonChecks, data, succeeded, uuid, validateTools, value, writes } from '../call-utils.mjs';
import { nonempty, requireValue } from '../validation.mjs';

export function validate(f) {
  requireValue(['bb-workflow/references/qualification.md', 'bb-workflow/references/merge.md'].includes(f.skill), 'Expected the qualification or merge reference');
  validateTools(f, f.skill);
  const s = f.simulation;
  requireValue(['negative', 'hit', 'error'].includes(s.outcome) && s.checkpoint === (f.skill === 'bb-workflow/references/qualification.md' ? 'qualify' : 'merge'), 'Expected prior-art checkpoint/outcome');
  requireValue(uuid(f.input.ticket_uuid) && nonempty(f.input.base_branch) && nonempty(f.input.created) &&
    Array.isArray(f.input.terms) && f.input.terms.length === 2 && new Set(f.input.terms).size === 2 && f.input.terms.every(nonempty) &&
    Array.isArray(f.input.paths) && f.input.paths.length && f.input.paths.every(nonempty) && nonempty(f.input.probe) &&
    /^[a-f0-9]{40}$/.test(s.checked_revision), 'Expected complete base-check inputs');
  requireValue(s.commands && Object.keys(s.commands).every(k => ['git', 'glab'].includes(k)) &&
    Array.isArray(s.commands.git) && s.commands.git.length >= 5 &&
    (s.checkpoint !== 'merge' || Array.isArray(s.commands.glab)), 'Expected declared Git/merge commands');
  if (s.outcome === 'hit' || s.candidate_kind) requireValue(/^[a-f0-9]{40}$/.test(s.candidate) && uuid(s.prior_art?.id), 'Expected candidate identity');
  for (const [tool, rows] of Object.entries(s.commands)) {
    requireValue(Array.isArray(rows) && rows.every(r => Array.isArray(r.argv) && r.argv[0] === tool && r.argv.every(nonempty) &&
      Number.isInteger(r.result?.exit_code) && typeof r.result.stdout === 'string' && typeof r.result.stderr === 'string') &&
      new Set(rows.map(r => JSON.stringify(r.argv))).size === rows.length, 'Malformed or duplicate command response');
  }
}

export function checkOutput(f, output, context) {
  const trace = calls(context), s = f.simulation, input = f.input;
  const git = trace.filter(c => c.tool === 'git');
  const external = trace.filter(c => ['git', 'glab'].includes(c.tool));
  const bakers = trace.filter(c => !['git', 'glab'].includes(c.tool));
  const exact = (c, argv) => JSON.stringify(c.arguments?.argv) === JSON.stringify(argv);
  const find = argv => git.find(c => exact(c, argv));
  const base = `origin/${input.base_branch}`;
  const fetch = find(['git', 'fetch', 'origin', '--quiet']);
  const revision = find(['git', 'rev-parse', base]);
  const log = find(['git', 'log', '--oneline', base, `--since=${input.created}`]);
  const grep = find(['git', 'grep', '-nEi', input.terms.join('|'), base, '--', ...input.paths]);
  const probe = find(['git', 'grep', '-c', input.probe, base, '--', ...input.paths]);
  const allWrites = writes(bakers);
  const merges = external.filter(c => c.tool === 'glab' && c.arguments.argv.slice(1, 3).join(' ') === 'mr merge');
  const blocked = s.outcome !== 'negative';
  const evidence = [base, ...input.terms, ...input.paths];
  const checks = [
    ...commonChecks(bakers).filter(c => c.id !== 'actual-tool-calls'),
    check('declared-commands', external.every(c => s.commands[c.tool]?.some(r => exact(c, r.argv) &&
      JSON.stringify(c.result) === JSON.stringify((r.before_merge && !merges.some(m => m.index < c.index)) ? r.before_merge : r.result))),
      'Every modeled command and its result must match this fixture exactly'),
    check('base-sequence', fetch && (s.outcome === 'error' ? !succeeded(fetch) : succeeded(fetch) &&
      succeeded(revision) && revision.result.stdout.trim() === s.checked_revision && succeeded(log) && grep &&
      fetch.index < revision.index && fetch.index < log.index && log.index < grep.index && [0, 1].includes(grep.result.exit_code)),
      'Fresh remote fetch, revision, history and scoped two-spelling search must actually run'),
    check('base-probe', s.outcome !== 'negative' || (grep?.result.exit_code === 0 || succeeded(probe) &&
      probe.result.stdout.trim() && probe.index > grep?.index), 'An empty Git search needs an observed positive probe'),
    check('reported-evidence', evidence.every(t => output.includes(t)) &&
      (s.outcome === 'error' ? /error|failed/i.test(output) && !/^\s*(?:#+\s*)?(?:\*\*)?(?:remote base check )?(?:outcome|result)\s*[:=]\s*[*` ]*negative\b/im.test(output) : output.includes(s.checked_revision) &&
        output.includes(s.outcome === 'hit' ? 'prior_art_hit' : 'negative')),
      'Report remote, checked revision when available, exact terms, paths and honest outcome'),
    check('stop-on-blocker', !blocked || (allWrites.length === 0 && merges.length === 0), 'A hit or unresolved error permits no publication, transition or merge'),
  ];
  if (s.checkpoint === 'qualify') {
    const searches = bakers.filter(c => c.action === 'search' && c.target === 'bb_ticket' && value(c, 'bundle') === 'bb_ticket' && succeeded(c) && c.index < fetch?.index);
    const queries = searches.flatMap(c => c.flags.filter ?? []);
    checks.push(check('ticket-search', input.terms.every(t => ['title', 'description.value'].every(field => queries.includes(`${field}:CONTAINS:${t}`))) &&
      searches.some(c => c.flags.filter?.includes('title:CONTAINS:ticket') &&
        (data(c)?.length > 0 || typeof c.result.stdout === 'string' && c.result.stdout.includes('type: bb_ticket--bb_ticket'))),
      'Complete both spellings, both scalar fields and the known-present ticket probe before the base check'));
    if (!blocked) {
      const comments = allWrites.filter(c => c.target === 'bb_comment');
      const qualification = comments.find(c => value(c, 'bb_comment_type') === 'qualification');
      checks.push(check('qualification-handoff', comments.some(c => value(c, 'bb_comment_type') === 'summary') && qualification &&
        allWrites.every(c => c.target === 'bb_comment' && c.index > Math.max(grep.index, probe?.index ?? -1) && succeeded(c) && value(c, 'body.format') === 'bb_rich' && value(c, 'ticket_id') === input.ticket_uuid) &&
        [...evidence, s.checked_revision, 'negative'].every(t => value(qualification, 'body.value')?.includes(t)),
        'Publish qualification and summary with explicit negative evidence after the check, without transitioning'));
    }
  } else if (!blocked) {
    const merge = merges[0];
    checks.push(check('merge-order', merges.length === 1 && succeeded(merge) &&
      merge.index > Math.max(grep?.index ?? Infinity, probe?.index ?? -1, revision?.index ?? Infinity) &&
      external.some(c => c.tool === 'glab' && c.index > merge.index && succeeded(c) && c.result.stdout.includes('"merged"')),
      'Merge only after the fresh negative, then verify merged status'));
  }
  if (s.checkpoint === 'merge') checks.push(check('helper-no-writes', allWrites.length === 0, 'Merge helper never writes tracker data'));
  if (s.outcome === 'hit' || s.candidate_kind) {
    const trailer = find(['git', 'log', '-1', s.candidate, '--format=%h %s%n%b']);
    const diff = find(['git', 'diff', '--stat', `${s.candidate}^..${base}`]);
    const current = find(['git', 'show', `${base}:docs/invoices.md`]);
    checks.push(check('candidate-inspection', succeeded(trailer) && succeeded(diff) && succeeded(current) &&
      [trailer, diff, current].every(c => c.index > grep?.index), 'Inspect trailer, net diff and current behavior before declaring delivered prior art'));
    if (s.candidate_kind && s.outcome === 'negative') checks.push(check('candidate-reason', new RegExp(s.candidate_kind === 'self' ? 'self|own ticket' : 'reverted', 'i').test(output), 'Explain why the inspected candidate is not delivered sibling work'));
    if (s.outcome === 'hit') checks.push(check('candidate-read', bakers.some(c => ['read', 'search'].includes(c.action) && succeeded(c) && (
      (Array.isArray(data(c)) ? data(c) : [data(c)]).some(r => r?.id === s.prior_art.id &&
        (r.attributes ?? r).identifier === s.prior_art.identifier && (r.attributes ?? r).state === s.prior_art.state) ||
      typeof c.result.stdout === 'string' && [`id: ${s.prior_art.id}`, `identifier: ${s.prior_art.identifier}`, `title: ${s.prior_art.title}`, `state: ${s.prior_art.state}`].every(t => c.result.stdout.includes(t)))) &&
      [s.prior_art.identifier, s.prior_art.title, s.prior_art.state, s.prior_art.assignee].filter(Boolean).every(t => output.includes(t)), 'Resolve the candidate and report available metadata'));
    if (s.outcome === 'hit') checks.push(check('hit-decision', /decision|continue|combine|close|proceed|build anyway|stops? and asks?/i.test(output), 'Ask the operator to decide on the hit'));
  }
  return checks;
}
