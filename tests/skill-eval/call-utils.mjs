import { nonempty, requireValue } from './validation.mjs';
export const check = (id, met, reason) => ({ id, met: Boolean(met), reason });
export const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);

export function validateTools(fixture, skill) {
  requireValue(fixture.skill === skill && fixture.execution === 'simulated-tools' &&
    fixture.simulation && typeof fixture.simulation === 'object', `Expected simulated ${skill} fixture`);
  requireValue(nonempty(fixture.input.task), 'Expected caller task');
}

export function calls(context = {}) {
  return (context.tool_trace ?? []).map((row, index) => {
    const base = { ...row, index, flags: {}, action: undefined, target: undefined };
    if (row.tool !== 'bakers') return base;
    const argv = row.arguments?.argv;
    if (Array.isArray(argv) && argv.length === 2 && argv[0] === 'bakers' && argv[1] === 'info') return { ...base, action: 'info', target: 'bakers' };
    if (!Array.isArray(argv) || argv[0] !== 'bakers' || argv[1] !== 'dropsh') return base;
    const at = argv.findIndex((v, i) => i >= 2 && ['read', 'search', 'create', 'update'].includes(v));
    if (argv.includes('--help')) return { ...base, action: 'help', target: 'bakers' };
    if (at < 0) return base;
    const tokens = [...argv.slice(2, at), ...argv.slice(at + 2)];
    const flags = {};
    let last;
    while (tokens.length) {
      const token = tokens.shift();
      // Variadic options (--include a b, --filter x y, --json a=1 b=2) keep taking bare values.
      if (typeof token === 'string' && !token.startsWith('--') && ['include', 'filter', 'json'].includes(last)) { flags[last].push(token); continue; }
      if (typeof token !== 'string' || !token.startsWith('--')) return base;
      const at = token.indexOf('=');
      const key = token.slice(2, at < 0 ? undefined : at);
      const value = at >= 0 ? token.slice(at + 1) : ['fields', 'no-validate'].includes(key) ? true : tokens.shift();
      (flags[key] ??= []).push(value);
      last = key;
    }
    return { ...base, flags, action: argv[at], target: argv[at + 1] };
  });
}
export const value = (call, name) => call?.flags[name]?.at(-1);
export const writes = trace => trace.filter(c => ['create', 'update'].includes(c.action) && !value(c, 'fields'));
/** The CLI prints JSON text; historical simulator traces stored the parsed object. Both read alike. */
export function payload(call) {
  const stdout = call?.result?.stdout;
  if (typeof stdout !== 'string') return stdout ?? undefined;
  try { return JSON.parse(stdout); } catch { return undefined; }
}
export const data = call => payload(call)?.data;
export function cliError(call) {
  try { return JSON.parse(call?.result?.stderr?.trim().split('\n').at(-1)).error; } catch { return undefined; }
}
/** A lost response: the write may or may not have applied. Legacy traces used synthetic exit 124. */
export const uncertain = call => call?.result?.exit_code === 124 ||
  (call?.result?.exit_code === 5 && cliError(call)?.code === 'E_HTTP' && cliError(call)?.details?.status === 0);
export const succeeded = call => call?.result?.exit_code === 0;
export const discoveryBefore = (trace, write) => Boolean(write && trace.some(c => c.index < write.index &&
  c.action === write.action && c.target === write.target && value(c, 'fields') && succeeded(c)));
export const readAfter = (trace, write, target) => trace.find(c => write && c.index > write.index && c.action === 'read' && c.target === target && succeeded(c));
export function commonChecks(trace, allowedError = () => false, recovered = new Set()) {
  return [
    check('actual-tool-calls', trace.some(c => c.tool === 'bakers'), 'A final success claim cannot replace an observed bakers.build tool call'),
    check('tool-results', trace.every(c => succeeded(c) || allowedError(c) || recovered.has(c.index)),
      'Every tool must succeed unless this fixture injects the specified error or the read recovery is certified'),
    check('validated-call-surface', trace.every(c => c.tool === 'read_file' || (c.tool === 'bakers' && (c.action || recovered.has(c.index)) && !('no-validate' in c.flags))),
      'Only literal bakers.build argument arrays and virtual file reads are allowed; never bypass validation'),
  ];
}

// Records returned by successful reads and searches after `after` and before `before`.
// A create response is never among them: it is not independent verification.
export const evidence = (trace, after, before = Infinity) => trace.filter(c => c.index > after && c.index < before &&
  ['read', 'search'].includes(c.action) && succeeded(c)).flatMap(c => {
  const document = payload(c);
  return [...(Array.isArray(document?.data) ? document.data : [document?.data]), ...(document?.included ?? [])]
    .filter(Boolean).map(record => ({ record, index: c.index }));
});
export const firstEvidence = (trace, id, after, before) => evidence(trace, after, before).find(e => e.record.id === id);
export const commentMatches = (record, { id, ticket, type, body }) => uuid(id) && record?.id === id &&
  record.type === 'bb_comment--bb_comment' && record.relationships?.ticket_id?.data?.id === ticket &&
  record.attributes?.bb_comment_type === type && record.attributes?.body?.format === 'bb_rich' &&
  record.attributes?.body?.value === body;

// Simulator rejections raised while parsing, before any record lookup or mutation.
// Every other error shape (404, backend, timeout, unknown) fails closed.
// Historical simulator texts, then the CLI's own: commander errors and the read-target guard.
const SYNTAX_REJECTION = /^(?:E_VALIDATION: unknown options|Unexpected positional argument|Expected action and entity target|Missing value for --|Unsupported fixture entity|error: (?:unknown option|unknown command|missing required argument|option '[^']*' argument missing))/;
const syntaxRejected = call => SYNTAX_REJECTION.test(call.result?.stderr ?? '') ||
  (cliError(call)?.code === 'E_VALIDATION' && /^target must be /.test(cliError(call)?.message ?? ''));
const READ_VERBS = ['read', 'get', 'show'];
export function rejectedReadId(call) {
  const argv = call.arguments?.argv;
  if (call.tool !== 'bakers' || succeeded(call) || !Array.isArray(argv) || argv[0] !== 'bakers' || argv[1] !== 'dropsh' ||
      !syntaxRejected(call) || !argv.some(a => READ_VERBS.includes(a)) ||
      argv.some(a => ['--no-validate', '--help', 'create', 'update', 'search'].includes(a))) return undefined;
  const ids = new Set(argv.join(' ').match(/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}/g) ?? []);
  return ids.size === 1 ? [...ids][0] : undefined;
}

// A rejected read is a call-quality warning only when it is the single rejected read for one
// record-verification obligation and a later exact verification precedes the dependent-write
// barrier. Each obligation: { id, after, before, verified } with `verified` the index of the
// exactly matching independent evidence, or undefined. Everything else stays a hard failure.
export function readRecovery(trace, obligations) {
  const recovered = new Set(), diagnostics = [];
  for (const o of obligations) {
    const rejected = trace.filter(c => c.index > o.after && rejectedReadId(c) === o.id);
    if (!rejected.length) continue;
    const ok = rejected.length === 1 && o.verified !== undefined && rejected[0].index < o.verified && o.verified < o.before;
    if (ok) recovered.add(rejected[0].index);
    const help = trace.filter(c => c.action === 'help' && c.index > rejected[0].index && c.index < (o.verified ?? Infinity));
    diagnostics.push({
      id: `read-recovery-${o.id}`, category: 'read-recovery', severity: ok ? 'warning' : 'failure',
      reason: ok ? 'One rejected read syntax attempt; a later independent read verified the exact record before the next dependent write'
        : 'Rejected read not recovered: repeated, unverified, mismatched or verified only after the next dependent write',
      calls: [...rejected, ...help].map(c => c.index).concat(o.verified ?? []).sort((a, b) => a - b),
    });
  }
  return { recovered, diagnostics };
}

export function linkArray(call) {
  const item = call?.flags.json?.find(v => typeof v === 'string' && v.startsWith('links='));
  if (!item) return undefined;
  try { const parsed = JSON.parse(item.slice(6)); return Array.isArray(parsed) ? parsed : undefined; }
  catch { return undefined; }
}
