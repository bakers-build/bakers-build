import { readFileSync } from 'node:fs';
import { nonempty, requireValue } from './validation.mjs';
export const check = (id, met, reason) => ({ id, met: Boolean(met), reason });
export const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);

const schemas = Object.fromEntries(JSON.parse(readFileSync(new URL('./contract-fixture.json', import.meta.url), 'utf8'))
  .tools.map(t => [t.name, t.inputSchema]));
/** The MCP wire name of a bakers tool: mcp_server_tool_bridge serves tool `<id>` as `tool_api__<id>`. */
export const tool = id => `tool_api__${id}`;
export const WRITES = ['bakers_ticket_create', 'bakers_ticket_update', 'bakers_ticket_classify', 'bakers_ticket_transition', 'bakers_comment_publish', 'bakers_metric_write', 'bakers_time_propose', 'bakers_run_cancel'].map(tool);
const SELECTORS = new Set(['--config', '--connection', '--auth-profile', '--conductor']);

export function validateTools(fixture, skill) {
  requireValue(fixture.skill === skill && fixture.execution === 'simulated-tools' &&
    fixture.simulation && typeof fixture.simulation === 'object', `Expected simulated ${skill} fixture`);
  requireValue(nonempty(fixture.input.task), 'Expected caller task');
}

// `--param key=value` overrides --data keys, coerced by the input schema like the CLI.
function coerce(name, key, value) {
  const node = schemas[name]?.properties?.[key] ?? {};
  const type = [node.type, ...(node.oneOf ?? []).map(o => o.type)].flat().find(t => t && t !== 'null');
  if (['integer', 'number'].includes(type)) return value.trim() === '' || Number.isNaN(Number(value)) ? value : Number(value);
  if (type === 'boolean') return value === 'true' ? true : value === 'false' ? false : value;
  if (['object', 'array'].includes(type)) { try { return JSON.parse(value); } catch { return value; } }
  return value;
}

/**
 * The trace as tool calls: each `bakers tools` row gets `mode` (list, schema or call), the wire
 * `name` and its `args` (from --data inline JSON or @file, then --param). An @file resolves against
 * the fixture's files and the virtual files written earlier in the trace. Retired shell calls
 * remain unclassified so the skill contract rejects them.
 */
export function calls(context = {}, files = {}) {
  const written = { ...files };
  return (context.tool_trace ?? []).map((row, index) => {
    const base = { ...row, index, mode: undefined, name: undefined, args: undefined };
    if (row.tool === 'write_file' && row.result?.exit_code === 0) written[row.arguments.path] = row.arguments.content;
    if (row.tool !== 'bakers') return base;
    const argv = row.arguments?.argv;
    if (!Array.isArray(argv) || argv[0] !== 'bakers') return base;
    let command = 1;
    while (SELECTORS.has(argv[command]?.split('=')[0])) command += argv[command].includes('=') ? 1 : 2;
    if (argv.length === command + 1 && argv[command] === 'info') return { ...base, mode: 'info' };
    if (argv[command] !== 'tools') return base;
    let name, data, schema = false;
    const params = [];
    for (let i = command + 1; i < argv.length; i++) {
      const [key, ...rest] = argv[i].split('=');
      const value = rest.length ? rest.join('=') : argv[i + 1];
      if (SELECTORS.has(key)) { if (!rest.length) i++; }
      else if (key === '--help' || key === '-h') return { ...base, mode: 'help' };
      else if (key === '--schema') schema = true;
      else if (key === '--data' || key === '--param') {
        if (!rest.length) i++;
        if (key === '--param') params.push(value); else data = value;
      } else if (argv[i].startsWith('-')) return base;
      else name ??= argv[i];
    }
    if (!name) return { ...base, mode: 'list' };
    // The CLI accepts a bare bakers tool by its wire name, as tool-server.py does.
    if (name.startsWith('bakers_')) name = tool(name);
    if (schema) return { ...base, mode: 'schema', name };
    let args = {};
    try { args = data === undefined ? {} : JSON.parse(data.startsWith('@') ? written[data.slice(1)] : data); } catch { args = undefined; }
    for (const p of params) if (args && p.includes('=')) args[p.slice(0, p.indexOf('='))] = coerce(name, p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1));
    return { ...base, mode: 'call', name, args };
  });
}
export const arg = (call, key) => call?.args?.[key];
/** Successful-or-not calls of one bakers tool, by its id (bakers_ticket_read). */
export const toolCalls = (trace, id) => trace.filter(c => c.mode === 'call' && c.name === tool(id));
export const writes = trace => trace.filter(c => c.mode === 'call' && WRITES.includes(c.name));
/** The tool's structured output: the CLI prints it as JSON text. */
export function payload(call) {
  const stdout = call?.result?.stdout;
  if (typeof stdout !== 'string') return stdout ?? undefined;
  try { return JSON.parse(stdout); } catch { return undefined; }
}
export function cliError(call) {
  try { return JSON.parse(call?.result?.stderr?.trim().split('\n').at(-1)).error; } catch { return undefined; }
}
/** A lost response (E_HTTP without status): the write may or may not have applied. */
export const uncertain = call => call?.result?.exit_code === 5 && cliError(call)?.code === 'E_HTTP' && cliError(call)?.details?.status === 0;
/** The tool ran and refused (exit 1, E_TOOL): a definite rejection. */
export const refused = call => call?.result?.exit_code === 1 && cliError(call)?.code === 'E_TOOL';
export const succeeded = call => call?.result?.exit_code === 0;
/** Does a call's `ticket` argument name this ticket (by UUID or identifier)? */
export const names = (call, ticket) => Boolean(ticket) && [ticket.id, ticket.identifier].filter(Boolean).includes(arg(call, 'ticket'));
export const readAfter = (trace, write, ticket) => trace.find(c => write && c.index > write.index &&
  c.name === tool('bakers_ticket_read') && names(c, ticket) && succeeded(c));
export function commonChecks(trace, allowedError = () => false, recovered = new Set()) {
  return [
    check('actual-tool-calls', trace.some(c => c.mode === 'call'), 'A final success claim cannot replace an observed bakers.build tool call'),
    check('tool-results', trace.every(c => succeeded(c) || allowedError(c) || recovered.has(c.index)),
      'Every tool must succeed unless this fixture injects the specified error or the call recovery is certified'),
    check('validated-call-surface', trace.every(c => ['read_file', 'write_file'].includes(c.tool) ||
      (c.tool === 'bakers' && ['call', 'schema', 'list', 'help', 'info'].includes(c.mode) && (c.mode !== 'call' || c.args))),
    'Only bakers tool calls (bakers tools), their lookups and virtual files; no JSON:API command or unreadable arguments'),
  ];
}

// A call rejected before sending (exit 4: invalid arguments or an unknown tool) is a recovered
// mistake when the next tool call succeeds, schema or list lookups in between. A repeated or
// unrecovered rejection stays a failure, and `tool-results` fails with it.
export function callRecovery(trace) {
  const recovered = new Set(), diagnostics = [];
  for (const rejected of trace.filter(c => c.mode === 'call' && c.result?.exit_code === 4)) {
    const next = trace.find(c => c.index > rejected.index && c.mode === 'call');
    const ok = Boolean(next && succeeded(next));
    if (ok) recovered.add(rejected.index);
    diagnostics.push({
      id: `call-recovery-${rejected.index}`, category: 'call-recovery', severity: ok ? 'warning' : 'failure',
      reason: ok ? 'One call rejected before sending; the next tool call succeeded'
        : 'Rejected call not recovered: rejected again or never followed by a successful call',
      calls: trace.filter(c => c.index >= rejected.index && c.index <= (next?.index ?? rejected.index)).map(c => c.index),
    });
  }
  return { recovered, diagnostics };
}
