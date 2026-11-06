import { DEFAULT_ENV_DENY, type RunEnvPolicy } from './agent.js';

/**
 * Shared validation and known-scalar override detection for harness `args`.
 * Quote only at final command assembly with `shellQuote`; this helper returns
 * a copied list of raw validated strings so override detection never has to
 * decode shell quoting, and later mutation of the caller's array cannot
 * introduce unvalidated switches.
 */

export type KnownScalarKind = 'model' | 'effort';

export interface KnownOptionSpec {
  kind: KnownScalarKind;
  /** Long and short flags, e.g. `['--model', '-m']`. */
  flags: readonly string[];
  /** Codex `-c`/`--config` assignment keys, matched before the first `=`. */
  configKeys?: readonly string[];
}

export interface KnownOverrides {
  model: boolean;
  effort: boolean;
}

const CONFIG_FLAGS = ['-c', '--config'] as const;

function isShortFlag(flag: string): boolean {
  return flag.startsWith('-') && !flag.startsWith('--');
}

function isReservedToken(token: string, reserved: string): boolean {
  if (token === reserved) {
    return true;
  }
  if (token.startsWith(`${reserved}=`)) {
    return true;
  }
  if (
    isShortFlag(reserved) &&
    token.startsWith(reserved) &&
    token.length > reserved.length &&
    !token.startsWith('--')
  ) {
    return true;
  }
  return false;
}

function rejectTilde(value: string, label: string): void {
  if (value.startsWith('~')) {
    throw new Error(`${label} starts with ~; use an absolute path`);
  }
  const eq = value.indexOf('=');
  if (
    value.startsWith('--') &&
    eq !== -1 &&
    value.slice(eq + 1).startsWith('~')
  ) {
    throw new Error(
      `${label} assigns a path starting with ~; use an absolute path`,
    );
  }
}

function rejectReserved(value: string, reserved: readonly string[]): void {
  for (const flag of reserved) {
    if (isReservedToken(value, flag)) {
      throw new Error(`args contains reserved flag ${flag}`);
    }
  }
}

function configAssignment(
  token: string,
): { key: string; value: string } | null {
  const eq = token.indexOf('=');
  if (eq <= 0) {
    return null;
  }
  return { key: token.slice(0, eq), value: token.slice(eq + 1) };
}

function matchFlag(
  token: string,
  flag: string,
): { flag: string; value?: string } | null {
  if (token === flag) {
    return { flag };
  }
  if (token.startsWith(`${flag}=`)) {
    return { flag, value: token.slice(flag.length + 1) };
  }
  if (
    isShortFlag(flag) &&
    token.startsWith(flag) &&
    token.length > flag.length &&
    !token.startsWith('--')
  ) {
    const rest = token.slice(flag.length);
    return {
      flag,
      value: rest.startsWith('=') ? rest.slice(1) : rest,
    };
  }
  return null;
}

/**
 * Validate `args` (omitted → `[]`) and return a shallow copy of the raw
 * strings. Rejects non-arrays, non-string members, NUL, tilde paths, and
 * reserved flag forms.
 */
export function validateAgentArgs(
  args: unknown,
  reserved: readonly string[],
): string[] {
  if (args === undefined) {
    return [];
  }
  if (!Array.isArray(args)) {
    throw new Error('args must be an array of strings');
  }
  const copy: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (typeof value !== 'string') {
      throw new Error(`args[${i}] must be a string`);
    }
    if (value.includes('\0')) {
      throw new Error(`args[${i}] contains a NUL byte`);
    }
    rejectReserved(value, reserved);
    rejectTilde(value, `args[${i}]`);
    copy.push(value);
  }
  return copy;
}

export function validateOptionalString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  if (value.includes('\0')) {
    throw new Error(`${field} contains a NUL byte`);
  }
  return value;
}

export function validateOptionalBoolean(
  value: unknown,
  field: string,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function kindForConfigKey(
  key: string,
  specs: readonly KnownOptionSpec[],
): KnownScalarKind | undefined {
  for (const spec of specs) {
    if (spec.configKeys?.includes(key)) {
      return spec.kind;
    }
  }
  return undefined;
}

function consumeConfig(
  token: string,
  next: string | undefined,
  specs: readonly KnownOptionSpec[],
): { kind?: KnownScalarKind; consumed: number } | null {
  let assignment: string | undefined;
  let consumed = 0;
  for (const flag of CONFIG_FLAGS) {
    if (token === flag) {
      if (next === undefined) {
        throw new Error(`${flag} requires a value`);
      }
      assignment = next;
      consumed = 2;
      break;
    }
    if (token.startsWith(`${flag}=`)) {
      assignment = token.slice(flag.length + 1);
      consumed = 1;
      break;
    }
    if (
      isShortFlag(flag) &&
      token.startsWith(flag) &&
      token.length > flag.length &&
      !token.startsWith('--')
    ) {
      const rest = token.slice(flag.length);
      assignment = rest.startsWith('=') ? rest.slice(1) : rest;
      consumed = 1;
      break;
    }
  }
  if (assignment === undefined) {
    return null;
  }
  const parsed = configAssignment(assignment);
  if (!parsed) {
    return { consumed };
  }
  const kind = kindForConfigKey(parsed.key, specs);
  return kind ? { kind, consumed } : { consumed };
}

/**
 * Detect whether `args` already carries a known model or effort option.
 * Caller args are never removed, reordered, or normalized; this only
 * suppresses bakers.build-generated defaults. Unknown flags stay literal.
 */
export function detectKnownOverrides(
  args: readonly string[],
  specs: readonly KnownOptionSpec[],
): KnownOverrides {
  const overrides: KnownOverrides = { model: false, effort: false };
  const usesConfig = specs.some((spec) => (spec.configKeys?.length ?? 0) > 0);

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === undefined) {
      continue;
    }

    if (usesConfig) {
      const config = consumeConfig(token, args[i + 1], specs);
      if (config) {
        if (config.kind === 'model') {
          overrides.model = true;
        }
        if (config.kind === 'effort') {
          overrides.effort = true;
        }
        i += config.consumed - 1;
        continue;
      }
    }

    for (const spec of specs) {
      for (const flag of spec.flags) {
        const matched = matchFlag(token, flag);
        if (!matched) {
          continue;
        }
        if (matched.value === undefined) {
          if (args[i + 1] === undefined) {
            throw new Error(`${flag} requires a value`);
          }
          i += 1;
        }
        if (spec.kind === 'model') {
          overrides.model = true;
        }
        if (spec.kind === 'effort') {
          overrides.effort = true;
        }
      }
    }
  }

  return overrides;
}

export function resolveAgentCliOptions(
  input: { args?: unknown; model?: unknown; effort?: unknown },
  reserved: readonly string[],
  known: readonly KnownOptionSpec[],
): {
  args: string[];
  model: string | undefined;
  effort: string | undefined;
  overrides: KnownOverrides;
} {
  const args = validateAgentArgs(input.args, reserved);
  return {
    args,
    model: validateOptionalString(input.model, 'model'),
    effort: validateOptionalString(input.effort, 'effort'),
    overrides: detectKnownOverrides(args, known),
  };
}

export const SECURITY_MODES = ['sandbox', 'system', 'yolo', 'custom'] as const;
export type SecurityMode = (typeof SECURITY_MODES)[number];

/** The `sandbox` block of an agent addon's `with` (mode `sandbox` only). */
export interface SandboxOptions {
  trusted_commands?: string[];
  deny_read?: string[];
  allow_write?: string[];
  network?: string[];
  mcp_servers?: Record<string, unknown>;
}

export interface SecurityOptions {
  security?: SecurityMode;
  sandbox?: SandboxOptions;
  config?: Record<string, unknown>;
  env_deny?: string[];
}

/**
 * The `with` key the conductor fills with the top-level `security` blocks of
 * the project and machine config; every harness addon passes it on here.
 */
export const SHARED_SECURITY_KEY = 'shared_security';
/** A list element that inserts the value of the layer below. */
const INHERIT = '$inherit';
const SHARED_MODES = ['sandbox', 'system', 'yolo'] as const;
const SHARED_LIST_KEYS = [
  'deny_read',
  'allow_write',
  'trusted_commands',
] as const;
export type SharedListKey = (typeof SHARED_LIST_KEYS)[number];
export type SharedLayer = 'project' | 'machine';
export type SecuritySource = 'default' | SharedLayer | 'agent';

/** A top-level `security` block of the machine or project config. */
export interface SharedSecurity {
  mode?: (typeof SHARED_MODES)[number];
  sandbox?: Partial<Record<SharedListKey, string[]>>;
}

/** The effective settings with the layer each value came from (`bakers agents`). */
export interface SecurityReport {
  mode: { value: SecurityMode; source: SecuritySource };
  sandbox: Record<
    SharedListKey,
    { entries: { value: string; source: SecuritySource }[]; removed: string[] }
  >;
  /** Shared values this run does not apply: the harness cannot express the
   *  key, or the effective mode is not `sandbox`. */
  not_applied: {
    key: SharedListKey;
    source: SharedLayer;
    reason: 'unsupported' | 'mode';
  }[];
}

export interface ResolvedSecurity {
  mode: SecurityMode;
  /** Every key set: the harness default unless a layer replaced it. */
  sandbox: Required<SandboxOptions>;
  config: Record<string, unknown> | undefined;
  runEnvPolicy: RunEnvPolicy;
  report: SecurityReport;
}

/**
 * Validate one shared `security` block; `layer` names it in the error. Only
 * `mode` and the three sandbox lists may be shared, so any other key fails.
 */
export function validateSharedSecurity(
  value: unknown,
  layer: SharedLayer,
): SharedSecurity | undefined {
  if (value === undefined) return undefined;
  const block = validatePlainObject(value, `${layer} security`);
  for (const key of Object.keys(block))
    if (key !== 'mode' && key !== 'sandbox')
      throw new Error(`${layer} security: unknown key ${key}`);
  if (
    block.mode !== undefined &&
    !SHARED_MODES.includes(block.mode as SharedSecurity['mode'] & string)
  )
    throw new Error(
      `${layer} security.mode must be one of ${SHARED_MODES.join(', ')}`,
    );
  const sandbox: Partial<Record<SharedListKey, string[]>> = {};
  if (block.sandbox !== undefined)
    for (const [key, list] of Object.entries(
      validatePlainObject(block.sandbox, `${layer} security.sandbox`),
    )) {
      if (!SHARED_LIST_KEYS.includes(key as SharedListKey))
        throw new Error(`${layer} security.sandbox: unknown key ${key}`);
      sandbox[key as SharedListKey] = validateStringList(
        list,
        `${layer} security.sandbox.${key}`,
      );
    }
  return {
    ...(block.mode !== undefined
      ? { mode: block.mode as NonNullable<SharedSecurity['mode']> }
      : {}),
    ...(block.sandbox !== undefined ? { sandbox } : {}),
  };
}

function validateStringList(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== 'string' || v.includes('\0'))
  ) {
    throw new Error(`${field} must be an array of strings`);
  }
  return [...value];
}

function validatePlainObject(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Validate the security options an agent addon takes in `with` and resolve
 * them over the harness defaults and the shared project and machine layers
 * (`with.shared_security`): default → project → machine → entry, a set key
 * replaces the layer below and `'$inherit'` inserts it. Any misconfiguration
 * of the entry is a load error, so a run never starts with rights the operator
 * did not choose; a shared key in `unsupported` is reported, not applied.
 */
export function resolveSecurityOptions(
  input: SecurityOptions & {
    skip_permissions?: unknown;
    [SHARED_SECURITY_KEY]?: unknown;
  },
  defaults: Required<SandboxOptions>,
  opts: { unsupported?: readonly SharedListKey[] } = {},
): ResolvedSecurity {
  if (input.skip_permissions !== undefined) {
    throw new Error(
      "skip_permissions was removed: use security: 'yolo' for a permission bypass",
    );
  }
  const shared =
    input[SHARED_SECURITY_KEY] === undefined
      ? {}
      : validatePlainObject(input[SHARED_SECURITY_KEY], SHARED_SECURITY_KEY);
  const layers = (['project', 'machine'] as const).flatMap((source) => {
    const block = validateSharedSecurity(shared[source], source);
    return block ? [{ source, block }] : [];
  });
  const modeLayer = [...layers].reverse().find((l) => l.block.mode);
  const mode: SecurityMode =
    input.security ?? modeLayer?.block.mode ?? 'sandbox';
  const modeSource: SecuritySource =
    input.security !== undefined ? 'agent' : (modeLayer?.source ?? 'default');
  if (!SECURITY_MODES.includes(mode)) {
    throw new Error(`security must be one of ${SECURITY_MODES.join(', ')}`);
  }
  if (mode !== 'custom' && input.config !== undefined) {
    throw new Error("config is only valid with security: 'custom'");
  }
  if (mode === 'custom' && input.config === undefined) {
    throw new Error("security: 'custom' requires config");
  }
  if (mode !== 'sandbox' && input.sandbox !== undefined) {
    throw new Error(
      `sandbox is only valid with security: 'sandbox' (the ${modeSource} layer sets '${mode}')`,
    );
  }
  const given =
    input.sandbox === undefined
      ? {}
      : validatePlainObject(input.sandbox, 'sandbox');
  const sandbox = { ...defaults };
  const report: SecurityReport = {
    mode: { value: mode, source: modeSource },
    sandbox: {} as SecurityReport['sandbox'],
    not_applied: [],
  };
  for (const key of SHARED_LIST_KEYS) {
    let entries: { value: string; source: SecuritySource }[] = defaults[
      key
    ].map((value) => ({ value, source: 'default' }));
    const stack: { source: SecuritySource; list: string[] }[] = [];
    for (const { source, block } of layers) {
      const list = block.sandbox?.[key];
      if (list === undefined) continue;
      const reason =
        mode !== 'sandbox'
          ? 'mode'
          : opts.unsupported?.includes(key)
            ? 'unsupported'
            : undefined;
      if (reason) report.not_applied.push({ key, source, reason });
      else stack.push({ source, list });
    }
    if (given[key] !== undefined)
      stack.push({
        source: 'agent',
        list: validateStringList(given[key], `sandbox.${key}`),
      });
    for (const { source, list } of stack) {
      const next = list.flatMap((value) =>
        value === INHERIT ? entries : [{ value, source }],
      );
      entries = next.filter(
        (e, i) => next.findIndex((o) => o.value === e.value) === i,
      );
    }
    sandbox[key] = entries.map((e) => e.value);
    report.sandbox[key] = {
      entries,
      removed: defaults[key].filter((d) => !sandbox[key].includes(d)),
    };
  }
  for (const [key, value] of Object.entries(given)) {
    if (key === 'mcp_servers') {
      sandbox.mcp_servers = validatePlainObject(value, 'sandbox.mcp_servers');
    } else if (key === 'network') {
      sandbox[key] = validateStringList(value, `sandbox.${key}`);
    } else if (!SHARED_LIST_KEYS.includes(key as SharedListKey)) {
      throw new Error(`unknown sandbox key ${key}`);
    }
  }
  return {
    mode,
    sandbox,
    report,
    config:
      input.config === undefined
        ? undefined
        : validatePlainObject(input.config, 'config'),
    runEnvPolicy: {
      drop: mode !== 'yolo',
      deny:
        input.env_deny === undefined
          ? DEFAULT_ENV_DENY
          : validateStringList(input.env_deny, 'env_deny'),
    },
  };
}
