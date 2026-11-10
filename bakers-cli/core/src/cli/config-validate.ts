// One JSON Schema per configuration file kind, applied by the loaders to the
// imported value and by `config check` to the literal values parsed from the
// source without running it. Old names are answered from `config-renames.ts`.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  type Expression,
  type Node,
  type ObjectExpression,
  type Program,
  parse,
} from 'acorn';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { type ConfigKind, matchKeyPaths, OLD_NAMES } from './config-renames.js';
import { resolveModuleEslintStyle } from './resolve-module.js';
import { RETIRED_ENV_NAMES } from './retired-env.js';

const OLD_ENV = new RegExp(
  `\\$\\{?BB_(${[...RETIRED_ENV_NAMES].sort((a, b) => b.length - a.length).join('|')})(?![A-Z0-9_])`,
  'g',
);

/** Hook commands that still read a renamed `BB_*` variable. */
function hookEnvProblems(value: unknown): SchemaProblem[] {
  const hooks = (value as { hooks?: unknown } | undefined)?.hooks;
  if (!hooks || typeof hooks !== 'object') return [];
  const commands: [string, unknown][] = [];
  for (const [slot, command] of Object.entries(hooks))
    if (command && typeof command === 'object')
      for (const [profile, sub] of Object.entries(command))
        commands.push([`hooks.${slot}.${profile}`, sub]);
    else commands.push([`hooks.${slot}`, command]);
  return commands.flatMap(([key, command]) => {
    if (typeof command !== 'string') return [];
    const names = [...new Set([...command.matchAll(OLD_ENV)].map((m) => m[1]))];
    return names.length
      ? [
          {
            key,
            code: 'renamed_key' as const,
            severity: 'error' as const,
            message: names
              .map((name) => `BB_${name} was renamed: use BAKERS_${name}`)
              .join('; '),
          },
        ]
      : [];
  });
}

export type { ConfigKind } from './config-renames.js';

export interface SchemaProblem {
  /** Key path such as `hooks.after_create` or `addons[0].use`; `''` is the whole file. */
  key: string;
  code:
    | 'unknown_key'
    | 'invalid_value'
    | 'missing_required_key'
    | 'renamed_key'
    | 'retired_key'
    | 'not_checked'
    | 'options_not_checked';
  severity: 'error' | 'warning';
  message: string;
  /** The exact replacement key of a renamed key. */
  replacement?: string;
  line?: number;
  column?: number;
}

const require = createRequire(import.meta.url);

/** A schema file shipped in `@bakers-build/core/schema/`. */
export function coreSchemaPath(name: string): string {
  return require.resolve(`@bakers-build/core/schema/${name}`);
}

function readSchema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(coreSchemaPath(name), 'utf8'));
}

let ajvInstance: Ajv2020 | undefined;
/** The shared ajv instance: core and harness schemas registered, `function` keyword added. */
export function configAjv(): Ajv2020 {
  if (ajvInstance) return ajvInstance;
  const ajv = new Ajv2020({ allErrors: true, strict: false, verbose: true });
  ajv.addKeyword({
    keyword: 'function',
    schemaType: 'boolean',
    validate: (schema: boolean, data: unknown) =>
      !schema || typeof data === 'function',
    errors: false,
  });
  for (const name of [
    'project.schema.json',
    'machine.schema.json',
    'connection.schema.json',
    'harness-options.schema.json',
  ])
    ajv.addSchema(readSchema(name));
  ajvInstance = ajv;
  return ajv;
}

const validators = new Map<string, ValidateFunction>();
function validatorFor(id: string): ValidateFunction {
  let validate = validators.get(id);
  if (!validate) {
    validate = configAjv().getSchema(id) as ValidateFunction;
    validators.set(id, validate);
  }
  return validate;
}

/** Drop `undefined` properties, as an absent key; leave non-plain objects untouched. */
function withoutUndefined(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value !== 'object' || value === null || seen.has(value))
    return value;
  seen.add(value);
  if (Array.isArray(value))
    return value.map((item) => withoutUndefined(item, seen));
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, withoutUndefined(v, seen)]),
  );
}

function keyOf(instancePath: string, child?: string): string {
  let key = '';
  for (const raw of instancePath.split('/').slice(1)) {
    const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    key = /^\d+$/.test(segment)
      ? `${key}[${segment}]`
      : key
        ? `${key}.${segment}`
        : segment;
  }
  if (child === undefined) return key;
  return key ? `${key}.${child}` : child;
}

function messageOf(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case 'enum':
      return `must be one of ${(params.allowedValues as unknown[]).join(', ')}`;
    case 'const':
      return `must be ${JSON.stringify(params.allowedValue)}`;
    case 'type':
      return `must be ${String(params.type).replace(',', ' or ')}`;
    case 'minimum':
      return `must be >= ${String(params.limit)}`;
    case 'minLength':
    case 'minProperties':
      return 'must not be empty';
    case 'pattern':
      return params.pattern === '\\S'
        ? 'must not be empty'
        : `must be ${(error.parentSchema as { description?: string })?.description ?? `match ${String(params.pattern)}`}`;
    case 'function':
      return 'must be a function';
    case 'anyOf':
      return `must be ${(error.schema as { type?: string }[])
        .map((branch) => branch.type ?? 'another shape')
        .join(' or ')}`;
    default:
      return error.message ?? 'is invalid';
  }
}

const under = (key: string, ancestor: string) =>
  ancestor === '' ||
  key.startsWith(`${ancestor}.`) ||
  key.startsWith(`${ancestor}[`);

/** Convert ajv errors into one problem per key and code. */
function problemsOf(errors: ErrorObject[]): SchemaProblem[] {
  const anyOfKeys = errors
    .filter((e) => e.keyword === 'anyOf')
    .map((e) => keyOf(e.instancePath));
  const problems = new Map<string, SchemaProblem>();
  for (const error of errors) {
    if (error.keyword === 'if') continue;
    const params = error.params as Record<string, string>;
    let problem: SchemaProblem;
    if (
      error.keyword === 'additionalProperties' ||
      error.keyword === 'unevaluatedProperties'
    ) {
      const key = keyOf(
        error.instancePath,
        params.additionalProperty ?? params.unevaluatedProperty,
      );
      problem = {
        key,
        code: 'unknown_key',
        severity: 'error',
        message: 'unknown key',
      };
    } else if (error.keyword === 'required') {
      problem = {
        key: keyOf(error.instancePath, params.missingProperty),
        code: 'missing_required_key',
        severity: 'error',
        message: 'is required',
      };
    } else {
      const key = keyOf(error.instancePath);
      if (
        error.keyword !== 'anyOf' &&
        anyOfKeys.some((k) => k === key || under(key, k))
      )
        continue;
      problem = {
        key,
        code: 'invalid_value',
        severity: 'error',
        message: messageOf(error),
      };
    }
    const id = `${problem.code}\0${problem.key}`;
    if (!problems.has(id)) problems.set(id, problem);
  }
  return [...problems.values()];
}

/** Old names met in `value`, each with its replacement. */
export function oldNameProblems(
  kind: ConfigKind,
  value: unknown,
): SchemaProblem[] {
  const problems: SchemaProblem[] = [];
  for (const rule of OLD_NAMES[kind])
    for (const key of matchKeyPaths(value, rule.from))
      problems.push({
        key,
        code: rule.code,
        severity: rule.severity ?? 'error',
        message: rule.message,
        ...(rule.to
          ? {
              replacement: rule.to.replace(
                /\[\*\]/g,
                key.match(/\[\d+\]/)?.[0] ?? '[]',
              ),
            }
          : {}),
      });
  return problems;
}

interface ValidateOptions {
  /** Key paths whose value is not statically known. */
  computed?: ReadonlySet<string>;
  /** Object key paths with a spread: their key set is not known. */
  partial?: ReadonlySet<string>;
}

/** Validate one file's value against its schema. Problems sorted by key. */
export function validateConfig(
  kind: ConfigKind,
  value: unknown,
  opts: ValidateOptions = {},
): SchemaProblem[] {
  const data = withoutUndefined(value);
  const prompt = (data as { prompt?: unknown } | undefined)?.prompt;
  const oldPlaceholders =
    kind === 'project' && typeof prompt === 'string'
      ? ['runUuid', 'ticketUuid'].filter((name) => prompt.includes(`{${name}}`))
      : [];
  const old = [
    ...oldNameProblems(kind, data),
    ...(kind === 'project' ? hookEnvProblems(data) : []),
    ...(oldPlaceholders.length
      ? [
          {
            key: 'prompt',
            code: 'renamed_key' as const,
            severity: 'error' as const,
            message: oldPlaceholders
              .map(
                (name) =>
                  `{${name}} was renamed: use {${name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}}`,
              )
              .join('; '),
          },
        ]
      : []),
  ];
  // A renamed variable or placeholder inside a value leaves the key itself valid.
  const oldKeys = old
    .filter((p) => !p.key.startsWith('hooks.') && p.key !== 'prompt')
    .map((p) => p.key);
  const replaced = new Set(old.flatMap((p) => p.replacement ?? []));
  const validate = validatorFor(
    `https://bakers.build/schema/${kind}.schema.json`,
  );
  validate(data);
  const computed = [...(opts.computed ?? [])];
  const partial = [...(opts.partial ?? [])];
  const schema = problemsOf(validate.errors ?? []).filter((problem) => {
    if (oldKeys.some((k) => k === problem.key || under(problem.key, k)))
      return false;
    // The value is there under its old name, answered above.
    if (problem.code === 'missing_required_key' && replaced.has(problem.key))
      return false;
    if (
      computed.some(
        (c) =>
          under(problem.key, c) ||
          (c === problem.key && problem.code !== 'unknown_key'),
      )
    )
      return false;
    if (
      problem.code === 'missing_required_key' &&
      partial.includes(problem.key.replace(/\.?[^.[\]]+$/, ''))
    )
      return false;
    return true;
  });
  // The loader reads `project` without running the file (BAKERS_PROJECT may
  // replace the name), so a computed or spread identity never loads.
  const identity =
    kind === 'project'
      ? [...computed, ...partial].filter(
          (key) => key === 'project' || under(key, 'project'),
        )
      : [];
  const identityProblems: SchemaProblem[] = identity.map((key) => ({
    key,
    code: 'invalid_value',
    severity: 'error',
    message:
      'must be a literal: the conductor reads project without running the file (BAKERS_PROJECT overrides the name)',
  }));
  const notChecked: SchemaProblem[] = [...computed, ...partial]
    .filter((key) => !identity.includes(key))
    .filter((key) => !oldKeys.some((k) => k === key || under(key, k)))
    .map((key) => ({
      key,
      code: 'not_checked' as const,
      severity: 'warning' as const,
      message: computed.includes(key)
        ? 'value is computed; it is checked when the conductor loads the file'
        : 'object has a spread; its keys are checked when the conductor loads the file',
    }));
  return [...old, ...schema, ...identityProblems, ...notChecked].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
}

/** Throw one error naming the file and every error-level problem; warn the rest. */
export function assertValidConfig(
  kind: ConfigKind,
  value: unknown,
  path: string,
  warn: (message: string) => void = (m) => console.warn(m),
): void {
  const problems = validateConfig(kind, value);
  for (const p of problems.filter((p) => p.severity === 'warning'))
    warn(`warning: ${path}: ${p.key ? `${p.key}: ` : ''}${p.message}`);
  const errors = problems.filter((p) => p.severity === 'error');
  if (errors.length)
    throw new Error(
      `${path}: ${errors
        .map((p) =>
          p.code === 'renamed_key' || p.code === 'retired_key'
            ? p.message
            : `${p.key || '(file)'} ${p.message}`,
        )
        .join('; ')}`,
    );
}

/** The literal value of a config source, with computed and partial key paths. */
export interface StaticConfig {
  value: Record<string, unknown>;
  computed: Set<string>;
  partial: Set<string>;
  locations: Map<string, { line: number; column: number }>;
}

const join = (prefix: string, name: string) =>
  prefix ? `${prefix}.${name}` : name;

/** Read the default-export object literal without evaluating anything. */
export function staticConfig(text: string): StaticConfig | undefined {
  let program: Program;
  try {
    program = parse(text, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    });
  } catch {
    return undefined;
  }
  const declaration = program.body.find(
    (node) => node.type === 'ExportDefaultDeclaration',
  );
  if (
    declaration?.type !== 'ExportDefaultDeclaration' ||
    declaration.declaration.type !== 'ObjectExpression'
  )
    return undefined;
  const result: StaticConfig = {
    value: {},
    computed: new Set(),
    partial: new Set(),
    locations: new Map(),
  };
  const locate = (key: string, node: Node) => {
    if (node.loc)
      result.locations.set(key, {
        line: node.loc.start.line,
        column: node.loc.start.column + 1,
      });
  };
  const COMPUTED = Symbol('computed');
  const read = (node: Expression, key: string): unknown => {
    switch (node.type) {
      case 'Literal':
        if (
          node.value === null ||
          ['string', 'number', 'boolean'].includes(typeof node.value)
        )
          return node.value;
        break;
      case 'UnaryExpression':
        if (
          (node.operator === '-' || node.operator === '+') &&
          node.argument.type === 'Literal' &&
          typeof node.argument.value === 'number'
        )
          return node.operator === '-'
            ? -node.argument.value
            : node.argument.value;
        break;
      case 'TemplateLiteral':
        if (node.expressions.length === 0)
          return node.quasis[0]?.value.cooked ?? '';
        break;
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        return () => undefined;
      case 'ObjectExpression':
        return readObject(node, key);
      case 'ArrayExpression': {
        const items: unknown[] = [];
        for (const [index, element] of node.elements.entries()) {
          if (!element || element.type === 'SpreadElement') return COMPUTED;
          locate(`${key}[${index}]`, element);
          const item = read(element, `${key}[${index}]`);
          if (item === COMPUTED) result.computed.add(`${key}[${index}]`);
          items.push(item === COMPUTED ? undefined : item);
        }
        return items;
      }
    }
    return COMPUTED;
  };
  const readObject = (node: ObjectExpression, prefix: string) => {
    const object: Record<string, unknown> = {};
    for (const entry of node.properties) {
      if (entry.type === 'SpreadElement' || entry.computed) {
        result.partial.add(prefix);
        continue;
      }
      const name =
        entry.key.type === 'Identifier'
          ? entry.key.name
          : entry.key.type === 'Literal'
            ? String(entry.key.value)
            : undefined;
      if (name === undefined) continue;
      const key = join(prefix, name);
      // A later duplicate key replaces the earlier value whole.
      for (const stale of [...result.computed])
        if (stale === key || under(stale, key)) result.computed.delete(stale);
      locate(key, entry);
      const value =
        entry.kind !== 'init' || entry.shorthand
          ? COMPUTED
          : entry.method
            ? () => undefined
            : read(entry.value as Expression, key);
      if (value === COMPUTED) {
        result.computed.add(key);
        object[name] = null;
      } else object[name] = value;
    }
    return object;
  };
  result.value = readObject(declaration.declaration, '');
  return result;
}

/** The validator of an addon's shipped `options.schema.json`, read as JSON only. */
function addonOptionsValidator(
  spec: string,
  bases: string[],
): ValidateFunction | undefined {
  const path = resolveModuleEslintStyle(`${spec}/options.schema.json`, bases);
  if (!path) return undefined;
  const schema = JSON.parse(readFileSync(path, 'utf8')) as { $id?: string };
  const ajv = configAjv();
  const existing = schema.$id ? ajv.getSchema(schema.$id) : undefined;
  return existing ?? ajv.compile(schema);
}

/**
 * Check each literal `with` of the `addons[]` entries (and, on a machine, the
 * `agents.catalog[]` entries) against the addon's own options schema. Addon
 * code never runs; an addon without a schema leaves its options not checked.
 */
export function addonOptionProblems(
  kind: ConfigKind,
  parsed: Pick<StaticConfig, 'value' | 'computed'>,
  bases: string[],
): SchemaProblem[] {
  const entries: { key: string; spec: unknown; options: unknown }[] = [];
  const list = (key: string, specKey: string) => {
    const items = key
      .split('.')
      .reduce<unknown>(
        (node, name) =>
          node && typeof node === 'object'
            ? (node as Record<string, unknown>)[name]
            : undefined,
        parsed.value,
      );
    if (!Array.isArray(items) || parsed.computed.has(key)) return;
    items.forEach((item, index) => {
      if (item && typeof item === 'object' && 'with' in item)
        entries.push({
          key: `${key}[${index}]`,
          spec: (item as Record<string, unknown>)[specKey],
          options: (item as Record<string, unknown>).with,
        });
    });
  };
  if (kind !== 'connection') list('addons', 'use');
  if (kind === 'machine') list('agents.catalog', 'harness');
  const problems: SchemaProblem[] = [];
  for (const { key, spec, options } of entries) {
    const withKey = `${key}.with`;
    if (
      typeof spec !== 'string' ||
      [...parsed.computed].some((c) => c === withKey || under(withKey, c))
    )
      continue;
    let validate: ValidateFunction | undefined;
    try {
      validate = addonOptionsValidator(spec, bases);
    } catch {
      validate = undefined;
    }
    if (!validate) {
      problems.push({
        key: withKey,
        code: 'options_not_checked',
        severity: 'warning',
        message: `options not checked: ${spec} ships no options.schema.json resolvable from this file`,
      });
      continue;
    }
    validate(withoutUndefined(options));
    for (const problem of problemsOf(validate.errors ?? []))
      problems.push({
        ...problem,
        key: problem.key ? `${withKey}.${problem.key}` : withKey,
      });
  }
  return problems;
}

/** `config check`'s offline field check of one file's source text. */
export function checkConfigText(
  kind: ConfigKind,
  text: string,
  opts: { bases?: string[] } = {},
): SchemaProblem[] {
  const parsed = staticConfig(text);
  if (!parsed) return [];
  return [
    ...validateConfig(kind, parsed.value, parsed),
    ...(opts.bases ? addonOptionProblems(kind, parsed, opts.bases) : []),
  ].map((problem) => {
    let key = problem.key;
    let location = parsed.locations.get(key);
    while (!location && key) {
      key = key.replace(/(\.[^.[]+|\[\d+\])$/, '');
      if (key === problem.key) break;
      location = parsed.locations.get(key);
    }
    return location ? { ...problem, ...location } : problem;
  });
}
