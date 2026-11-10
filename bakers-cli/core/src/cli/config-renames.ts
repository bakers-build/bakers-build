// Every old configuration name and its exact replacement. `config check` and
// the loaders answer a met old name from here; `config upgrade` rewrites the
// `moves` it can apply to literal source. Patterns use `[*]` for any array item.

export type ConfigKind = 'connection' | 'machine' | 'project';

export interface OldName {
  /** Key path pattern, e.g. `addons[*].name`. */
  from: string;
  /** The replacement key path, when the value moves unchanged. */
  to?: string;
  /** Sub-moves applied by `config upgrade` after `from` → `to` (or instead of it). */
  moves?: [from: string, to: string][];
  message: string;
  code: 'renamed_key' | 'retired_key';
  severity?: 'error' | 'warning';
}

const renamed = (from: string, to: string, use = to): OldName => ({
  from,
  to,
  code: 'renamed_key',
  message: `${from.replace(/\[\*\]/g, '[]')} was renamed: use ${use}`,
});

const entryShape = (list: string): OldName[] => [
  renamed(`${list}[*].name`, `${list}[*].use`, 'use'),
  renamed(`${list}[*].options`, `${list}[*].with`, 'with'),
];

const slotShape = (slot: string): OldName[] => [
  renamed(`${slot}.plugin`, `${slot}.use`, 'use'),
  renamed(`${slot}.options`, `${slot}.with`, 'with'),
];

const retired = (
  from: string,
  message: string,
  severity: 'error' | 'warning' = 'error',
): OldName => ({ from, message, severity, code: 'retired_key' });

const MAX_PARALLEL = retired(
  'max_parallel',
  'max_parallel is ignored: the run budget is set on the machine in the backend',
  'warning',
);

export const OLD_NAMES: Record<ConfigKind, OldName[]> = {
  project: [
    {
      from: 'bakers',
      to: 'project',
      moves: [
        ['bakers.project', 'project.name'],
        ['bakers.workspace', 'project.workspace'],
      ],
      message: 'bakers was renamed: use project: { name, workspace }',
      code: 'renamed_key',
    },
    renamed('remote', 'server'),
    renamed('workspace', 'worktree'),
    renamed('selectAgent', 'select_agent'),
    renamed('security', 'permissions'),
    ...slotShape('server'),
    ...slotShape('executor'),
    ...slotShape('worktree'),
    ...entryShape('addons'),
    {
      from: 'bb_workspace',
      moves: [['bb_workspace', 'project.workspace']],
      message: 'bb_workspace was renamed: use project: { workspace }',
      code: 'renamed_key',
    },
    ...['agent', 'agents', 'default_agent', 'agent_routes'].map((key) =>
      retired(
        key,
        `${key} is retired in a project config: agents and their policy belong in ~/.bakers/machine.config.js (addons and agents.routes)`,
      ),
    ),
    ...['site', 'plugins'].map((key) =>
      retired(
        key,
        `${key} belongs in the connection file (~/.bakers/connections/default.js)`,
      ),
    ),
    ...['conductor_id', 'machine_id', 'label'].map((key) =>
      retired(
        key,
        `${key} no longer belongs in a project config: a conductor is machine + project + variant`,
      ),
    ),
    retired('tunnel', 'tunnel belongs in ~/.bakers/machine.config.js'),
    MAX_PARALLEL,
  ],
  machine: [
    {
      from: 'agents.default_agent',
      message:
        "agents.default_agent was renamed: use agents.routes.default: { '*': '<alias>' }",
      code: 'renamed_key',
    },
    retired(
      'agents.addons',
      'agents.addons is retired: list the harnesses in the top-level addons',
    ),
    retired(
      'user_id',
      'user_id is retired: the server takes the owner from sign-in',
    ),
    renamed('security', 'permissions'),
    retired(
      'ports',
      "ports is retired: configure it as addons: [{ use: '@bakers-build/addon-ports', with: … }]",
    ),
    ...['base_url', 'client_id', 'client_secret', 'workspace_id'].map((key) =>
      retired(
        key,
        `${key} belongs in the connection file (~/.bakers/connections/default.js)`,
      ),
    ),
    ...slotShape('executor'),
    ...entryShape('addons'),
    retired(
      'marketplaces',
      'marketplaces is declared per project, in .bakers/project.config.js',
    ),
    MAX_PARALLEL,
  ],
  connection: [...entryShape('addons'), MAX_PARALLEL],
};

/** Old file names (relative to their directory) and their replacements. */
export const OLD_FILES: {
  from: RegExp;
  to: (match: RegExpMatchArray) => string;
}[] = [
  { from: /^conductor\.config\.js$/, to: () => 'project.config.js' },
  {
    from: /^(.+)\.conductor\.config\.js$/,
    to: (m) => `project.${m[1]}.config.js`,
  },
  { from: /^bakers\.config\.js$/, to: () => 'connection.config.js' },
];

/** The concrete paths in `value` that `pattern` names. */
export function matchKeyPaths(value: unknown, pattern: string): string[] {
  const tokens = pattern.split('.');
  const out: string[] = [];
  const walk = (node: unknown, index: number, prefix: string) => {
    if (index === tokens.length) {
      out.push(prefix);
      return;
    }
    const token = tokens[index] as string;
    const each = token.endsWith('[*]');
    const name = each ? token.slice(0, -3) : token;
    if (!isObject(node) || !Object.hasOwn(node, name)) return;
    const path = prefix ? `${prefix}.${name}` : name;
    const child = node[name];
    if (!each) return walk(child, index + 1, path);
    if (Array.isArray(child))
      for (const [i, item] of child.entries())
        walk(item, index + 1, `${path}[${i}]`);
  };
  walk(value, 0, '');
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
