/**
 * The message contract v2: a MessageDefinition an addon registers under a
 * message type key, and the MessageResult its handler answers with. Owns
 * only the message shape — no addon, workspace or conductor concept lives
 * here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';

export const MESSAGE_CONTRACT_VERSION = 2;

export type FieldType = 'string' | 'integer' | 'number' | 'boolean';

export interface MessageField {
  type: FieldType;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: Array<string | number>;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: 'uri' | 'multiline';
}

export interface MessageInput {
  type: 'object';
  required?: string[];
  properties: Record<string, MessageField>;
}

/** What an addon registers for one message type. */
export interface MessageDefinition {
  label: string;
  /** Required access the sender must hold; defaults to the strictest, `update`. */
  access?: 'view' | 'update';
  /** Absent means a parameterless message: no form field, no payload. */
  input?: MessageInput;
}

/** What every handler returns: one Markdown answer, nothing else. */
export interface MessageResult {
  markdown: string;
}

export type Validation = { ok: true } | { ok: false; errors: string[] };

/** Walks up from this module to the `@bakers-build/message` package root (src or dist). */
function schemaDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg.name === '@bakers-build/message') return join(dir, 'schemas');
    } catch {}
    dir = dirname(dir);
  }
  throw new Error(
    'message/schema: @bakers-build/message package root not found',
  );
}

function loadSchema(file: string): object {
  return JSON.parse(readFileSync(join(schemaDir(), file), 'utf8'));
}

let compiled:
  | {
      ajv: Ajv;
      definition: ValidateFunction;
      result: ValidateFunction;
    }
  | undefined;

function validators() {
  if (compiled) return compiled;
  const ajv = new Ajv({ allErrors: true, strict: false });
  compiled = {
    ajv,
    definition: ajv.compile(loadSchema('message-definition.v2.schema.json')),
    result: ajv.compile(loadSchema('message-result.v2.schema.json')),
  };
  return compiled;
}

function ajvErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map(
    (e) =>
      `${e.instancePath.replace(/^\//, '').replaceAll('/', '.') || '(root)'}: ${e.message ?? 'invalid'}`,
  );
}

function matchesType(type: FieldType, value: unknown): boolean {
  switch (type) {
    case 'integer':
      return Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
  }
}

/** The checks JSON Schema cannot express: values and keywords fit the field type. */
function consistencyErrors(input: MessageInput | undefined): string[] {
  if (!input) return [];
  const errors: string[] = [];
  for (const [name, field] of Object.entries(input.properties)) {
    const at = `input.properties.${name}`;
    const numeric = field.type === 'integer' || field.type === 'number';
    if ('default' in field && !matchesType(field.type, field.default))
      errors.push(`${at}.default: does not match type ${field.type}`);
    if (field.enum?.some((v) => !matchesType(field.type, v)))
      errors.push(`${at}.enum: items must match type ${field.type}`);
    for (const kw of ['minimum', 'maximum'] as const)
      if (kw in field && !numeric)
        errors.push(`${at}.${kw}: only allowed on integer or number`);
    for (const kw of ['minLength', 'maxLength', 'pattern', 'format'] as const)
      if (kw in field && field.type !== 'string')
        errors.push(`${at}.${kw}: only allowed on string`);
    if (field.pattern !== undefined) {
      try {
        new RegExp(field.pattern, 'u');
      } catch {
        errors.push(`${at}.pattern: does not compile`);
      }
    }
  }
  for (const name of input.required ?? [])
    if (!(name in input.properties))
      errors.push(`input.required: ${name} is not a property`);
  return errors;
}

export function validateMessageDefinition(def: unknown): Validation {
  const { definition } = validators();
  if (!definition(def))
    return { ok: false, errors: ajvErrors(definition.errors) };
  const errors = consistencyErrors((def as MessageDefinition).input);
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** The message's input as a closed schema; no input means an empty object. */
export function payloadSchema(input: MessageInput | undefined): object {
  return {
    ...(input ?? { type: 'object', properties: {} }),
    additionalProperties: false,
  };
}

export function validateArgs(
  input: MessageInput | undefined,
  args: unknown,
): Validation {
  const { ajv } = validators();
  const validate = ajv.compile(payloadSchema(input));
  const candidate = args === undefined ? {} : args;
  return validate(candidate)
    ? { ok: true }
    : { ok: false, errors: ajvErrors(validate.errors) };
}

export function validateResult(result: unknown): Validation {
  const v = validators().result;
  return v(result) ? { ok: true } : { ok: false, errors: ajvErrors(v.errors) };
}
