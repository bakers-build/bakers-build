#!/usr/bin/env node
// Generate core/src/config-types.generated.ts from the configuration schemas,
// so editors mark a misspelled key. `--check` exits 1 when the file is stale.
// shortcut: covers the JSON Schema subset core/schema uses (object, array,
// enum, const, anyOf, if/then/else, $ref, `function`); extend it with the schemas.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaDir = join(root, 'schema');
const out = join(root, 'src', 'config-types.generated.ts');
const files = ['project', 'machine', 'connection'];
const schemas = Object.fromEntries(
  files.map((name) => [
    `${name}.schema.json`,
    JSON.parse(readFileSync(join(schemaDir, `${name}.schema.json`), 'utf8')),
  ]),
);

function resolveRef(ref, file) {
  const [target, pointer = ''] = ref.split('#');
  const name = target || file;
  let node = schemas[name];
  for (const part of pointer.split('/').filter(Boolean)) node = node[part];
  return { node, file: name };
}

const key = (name) =>
  /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
const doc = (text, pad) => (text ? `${pad}/** ${text} */\n` : '');

function type(node, file, depth) {
  if (node === true || !node || Object.keys(node).length === 0)
    return 'unknown';
  if (node.$ref) {
    const { node: target, file: next } = resolveRef(node.$ref, file);
    return type(target, next, depth);
  }
  if (node.function) return '(...args: never[]) => unknown';
  if (node.const !== undefined) return JSON.stringify(node.const);
  if (node.enum) return node.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (node.anyOf)
    return node.anyOf.map((b) => type(b, file, depth)).join(' | ');
  if (node.if && node.then && node.else) {
    // The `if` side narrows `then`: a string branch, or an object carrying `kind`.
    const then =
      node.if.type === 'string' ? 'string' : type(node.then, file, depth);
    const constructed =
      node.if.required?.includes('kind') && node.then.type === 'object'
        ? '{ kind: string; [key: string]: unknown }'
        : then;
    return `${constructed} | ${type(node.else, file, depth)}`;
  }
  switch (node.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'null':
      return 'null';
    case 'boolean':
      return 'boolean';
    case 'array':
      return `Array<${type(node.items, file, depth)}>`;
    case 'object':
      return objectType(node, file, depth);
    default:
      return 'unknown';
  }
}

function objectType(node, file, depth) {
  const pad = '  '.repeat(depth + 1);
  const required = new Set(node.required ?? []);
  const lines = Object.entries(node.properties ?? {}).map(
    ([name, child]) =>
      `${doc(child.description, pad)}${pad}${key(name)}${required.has(name) ? '' : '?'}: ${type(child, file, depth + 1)};`,
  );
  if (node.additionalProperties && node.additionalProperties !== false)
    lines.push(
      `${pad}[key: string]: ${type(node.additionalProperties, file, depth + 1)};`,
    );
  else if (node.additionalProperties === undefined && !node.properties)
    lines.push(`${pad}[key: string]: unknown;`);
  return `{\n${lines.join('\n')}\n${'  '.repeat(depth)}}`;
}

let text =
  '// Generated from core/schema/*.schema.json by core/scripts/schema-types.mjs.\n' +
  '// Do not edit: change the schema and run `node core/scripts/schema-types.mjs`.\n';
for (const name of files) {
  const file = `${name}.schema.json`;
  const schema = schemas[file];
  text += `\n${doc(schema.description, '')}export interface ${schema.title} ${objectType(schema, file, 0)}\n`;
}

if (process.argv.includes('--check')) {
  const current = readFileSync(out, 'utf8');
  if (current !== text) {
    console.error(`${out} is stale; run node core/scripts/schema-types.mjs`);
    process.exit(1);
  }
} else writeFileSync(out, text);
