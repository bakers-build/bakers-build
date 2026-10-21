import { describe, expect, it } from 'vitest';
import {
  validateArgs,
  validateMessageDefinition,
  validateResult,
} from '../src/schema.js';

describe('MessageDefinition', () => {
  it('accepts a parameterless view message', () => {
    expect(
      validateMessageDefinition({
        label: 'Tunnel-Links bereitstellen',
        access: 'view',
      }).ok,
    ).toBe(true);
  });

  it('accepts a message with a flat scalar input', () => {
    expect(
      validateMessageDefinition({
        label: 'Stop',
        access: 'update',
        input: {
          type: 'object',
          required: ['port'],
          properties: { port: { type: 'integer', minimum: 1, maximum: 65535 } },
        },
      }).ok,
    ).toBe(true);
  });

  it('rejects confirm/icon/views/scope as unknown properties', () => {
    expect(validateMessageDefinition({ label: 'x', confirm: 'Sure?' }).ok).toBe(
      false,
    );
    expect(validateMessageDefinition({ label: 'x', icon: '<svg/>' }).ok).toBe(
      false,
    );
    expect(validateMessageDefinition({ label: 'x', scope: 'ticket' }).ok).toBe(
      false,
    );
  });

  it('rejects a default that does not match the field type', () => {
    expect(
      validateMessageDefinition({
        label: 'x',
        input: {
          type: 'object',
          properties: { port: { type: 'integer', default: 'not-a-number' } },
        },
      }).ok,
    ).toBe(false);
  });

  it('rejects minimum/maximum on a string field', () => {
    expect(
      validateMessageDefinition({
        label: 'x',
        input: {
          type: 'object',
          properties: { name: { type: 'string', minimum: 1 } },
        },
      }).ok,
    ).toBe(false);
  });
});

describe('validateArgs', () => {
  it('accepts undefined payload for a parameterless message', () => {
    expect(validateArgs(undefined, undefined).ok).toBe(true);
  });

  it('rejects unknown keys for a parameterless message', () => {
    expect(validateArgs(undefined, { unexpected: 1 }).ok).toBe(false);
  });

  it('rejects a missing required field', () => {
    expect(
      validateArgs(
        {
          type: 'object',
          required: ['port'],
          properties: { port: { type: 'integer' } },
        },
        {},
      ).ok,
    ).toBe(false);
  });
});

describe('MessageResult', () => {
  it('accepts a Markdown-only result, including empty string', () => {
    expect(
      validateResult({ markdown: '[Preview](https://example.test)' }).ok,
    ).toBe(true);
    expect(validateResult({ markdown: '' }).ok).toBe(true);
  });

  it('rejects extra fields like rows/columns from the retired contract', () => {
    expect(validateResult({ markdown: '', rows: [] }).ok).toBe(false);
  });

  it('rejects markdown over the 1,048,576 character limit', () => {
    expect(validateResult({ markdown: 'x'.repeat(1_048_577) }).ok).toBe(false);
  });

  it('rejects a missing markdown field', () => {
    expect(validateResult({}).ok).toBe(false);
  });
});
