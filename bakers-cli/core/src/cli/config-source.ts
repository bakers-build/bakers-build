// BB-230: the balanced-delimiter, comment-aware SOURCE scanner for a config
// module's `export default { … }` object — hoisted here from the conductor's
// `config.ts` (where BB-218 AC-7's `stripLegacyConnectionFromConfigSource`
// introduced it) so both users share one source of truth for "which top-level
// properties does this config source declare?":
//
//   - `@bakers-build/core` — `findBbConfig` gates the LEGACY `project.config.js`
//     connection read on CONTENT: a config declaring no `site` is not a
//     connection source (root cause 2). Core is layer 0 with zero `@bakers-build/*`
//     edges, so it cannot import the conductor's copy — hence the hoist.
//   - `@bakers-build/conductor` — the strip pass re-uses these primitives.
//
// Everything here is a PURE TEXT read. Nothing executes the config module: a
// config may import a secret-bearing machine context and have side effects, and
// both callers (a sync path resolver, an idempotent `--dry-run` migration) must
// stay safe to run on an untrusted tree.

import {
  type Comment,
  type Expression,
  type ObjectExpression,
  type Program,
  parse,
} from 'acorn';

const CLOSER: Record<string, string> = { '{': '}', '[': ']', '(': ')' };

/** Skip a `//`-line comment; return the index of the terminating newline (or EOF). */
export function skipLineComment(src: string, i: number): number {
  const nl = src.indexOf('\n', i);
  return nl === -1 ? src.length : nl;
}

/** Skip a block comment; return the index just past it. */
export function skipBlockComment(src: string, i: number): number {
  const end = src.indexOf('*/', i + 2);
  return end === -1 ? src.length : end + 2;
}

/** Skip a string/template literal (honouring `\` escapes and `${ … }`
 *  interpolations in backtick strings); return the index just past the close. */
export function skipString(src: string, i: number): number {
  const quote = src[i];
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (quote === '`' && c === '$' && src[i + 1] === '{') {
      i = matchDelimiter(src, i + 1) + 1;
      continue;
    }
    if (c === quote) return i + 1;
    i++;
  }
  return i;
}

/** Given the index of an opening `{`/`[`/`(`, return the index of its matching
 *  close, skipping nested delimiters, strings and comments. -1 if unbalanced. */
export function matchDelimiter(src: string, openIdx: number): number {
  const stack: string[] = [CLOSER[src[openIdx] as string] as string];
  let i = openIdx + 1;
  while (i < src.length && stack.length > 0) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      i = skipLineComment(src, i);
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i = skipBlockComment(src, i);
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i);
      continue;
    }
    if (c === '{' || c === '[' || c === '(') {
      stack.push(CLOSER[c] as string);
      i++;
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      if (c === stack[stack.length - 1]) stack.pop();
      i++;
      continue;
    }
    i++;
  }
  return stack.length === 0 ? i - 1 : -1;
}

/** Skip whitespace + comments starting at `i` (bounded by `limit`). */
export function skipTrivia(src: string, i: number, limit: number): number {
  while (i < limit) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      i = skipLineComment(src, i);
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i = skipBlockComment(src, i);
      continue;
    }
    break;
  }
  return i;
}

/** Read a property key (bare identifier or quoted string) at `i`. */
export function readKey(
  src: string,
  i: number,
): { name?: string; end: number } {
  const c = src[i];
  if (c === "'" || c === '"') {
    const end = skipString(src, i);
    return { name: src.slice(i + 1, end - 1), end };
  }
  const m = /^[A-Za-z0-9_$]+/.exec(src.slice(i));
  if (m) return { name: m[0], end: i + m[0].length };
  return { end: i };
}

/** From `from`, scan to just past the next top-level `,` (or to `limit` when the
 *  value runs to the object close), skipping nested delimiters/strings/comments. */
export function scanToTopLevelComma(
  src: string,
  from: number,
  limit: number,
): number {
  let i = from;
  while (i < limit) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      i = skipLineComment(src, i);
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i = skipBlockComment(src, i);
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i = skipString(src, i);
      continue;
    }
    if (c === '{' || c === '[' || c === '(') {
      i = matchDelimiter(src, i) + 1;
      continue;
    }
    if (c === ',') return i + 1;
    i++;
  }
  return limit;
}

/** One top-level property of a config's default-export object literal. */
export interface PropEntry {
  key: string | undefined;
  /** Start of the entry INCLUDING its leading trivia (comments/whitespace). */
  start: number;
  /** End of the entry (just past its trailing comma, or the object close). */
  end: number;
}

/** Locate the `export default { … }` object; return the body span (exclusive of
 *  the braces) or undefined when the default export is not an object literal. */
export function findDefaultExportObject(
  src: string,
): { bodyStart: number; bodyEnd: number } | undefined {
  const m = /export\s+default\s*/.exec(src);
  if (!m) return undefined;
  const braceIdx = m.index + m[0].length;
  if (src[braceIdx] !== '{') return undefined;
  const end = matchDelimiter(src, braceIdx);
  if (end === -1) return undefined;
  return { bodyStart: braceIdx + 1, bodyEnd: end };
}

/** Enumerate the top-level properties of the object body [bodyStart, bodyEnd). */
export function scanTopLevelProperties(
  src: string,
  bodyStart: number,
  bodyEnd: number,
): PropEntry[] {
  const entries: PropEntry[] = [];
  let i = bodyStart;
  while (i < bodyEnd) {
    const entryStart = i;
    const keyPos = skipTrivia(src, i, bodyEnd);
    if (keyPos >= bodyEnd) break;
    const key = readKey(src, keyPos);
    let j = skipTrivia(src, key.end, bodyEnd);
    if (src[j] !== ':') {
      // Not a `key: value` property (spread/computed/shorthand) — keep it.
      const term = scanToTopLevelComma(src, keyPos, bodyEnd);
      entries.push({ key: undefined, start: entryStart, end: term });
      i = term;
      continue;
    }
    j++;
    const term = scanToTopLevelComma(src, j, bodyEnd);
    entries.push({ key: key.name, start: entryStart, end: term });
    i = term;
  }
  return entries;
}

/**
 * Does this config SOURCE declare `key` as a real top-level property of its
 * `export default { … }` object?
 *
 * Deliberately stricter than a `/site\s*:/` regex, which would also fire on the
 * word in a comment, in a string, or on a NESTED `site:` inside some slot's
 * `with: { … }`. `false` when the default export is not an object literal at all
 * (a `defineConfig(…)` call, a re-export shim) — such a file cannot be read as a
 * connection source by inspection, and guessing is worse than falling through.
 */
export function declaresTopLevelKey(src: string, key: string): boolean {
  const obj = findDefaultExportObject(src);
  if (!obj) return false;
  return scanTopLevelProperties(src, obj.bodyStart, obj.bodyEnd).some(
    (e) => e.key === key,
  );
}

/** Internal source data for planners. Never serialize this into a public report. */
export interface ConfigSourceProperty {
  key: string;
  start: number;
  end: number;
  valueStart: number;
  valueEnd: number;
  line: number;
  column: number;
  nodeType: string;
  staticallyDetermined: boolean;
  value?: string | number | boolean | null;
  arrayLength?: number;
}

export interface ConfigSourceInspection {
  text: string;
  syntax: 'valid' | 'invalid';
  shape: 'object' | 'unsupported';
  /** Every syntactic property occurrence; effective values remain in properties. */
  propertyOccurrences: ConfigSourceProperty[];
  properties: Map<string, ConfigSourceProperty>;
  unknownKeys: boolean;
  moduleSpecifiers: Array<{ start: number; end: number; value: string }>;
  headerVersions: number[];
  object?: { start: number; end: number };
  syntaxError?: { line: number; column: number };
}

/** Parse ECMAScript modules without evaluating imports, getters or expressions.
 * Acorn supplies syntax validation and exact spans; the older delimiter scanner
 * remains available to existing callers but is not a JavaScript parser.
 */
export function inspectConfigSource(text: string): ConfigSourceInspection {
  const result: ConfigSourceInspection = {
    text,
    syntax: 'valid',
    shape: 'unsupported',
    propertyOccurrences: [],
    properties: new Map(),
    unknownKeys: false,
    moduleSpecifiers: [],
    headerVersions: [],
  };
  const comments: Comment[] = [];
  let program: Program;
  try {
    program = parse(text, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      onComment: comments,
    });
  } catch (error) {
    result.syntax = 'invalid';
    // Parser messages can quote credential-bearing source. Only expose location.
    if (error instanceof SyntaxError && 'loc' in error) {
      const loc = error.loc as { line: number; column: number };
      result.syntaxError = { line: loc.line, column: loc.column + 1 };
    }
    return result;
  }
  for (const node of program.body) {
    if (
      (node.type === 'ImportDeclaration' ||
        node.type === 'ExportNamedDeclaration' ||
        node.type === 'ExportAllDeclaration') &&
      node.source &&
      typeof node.source.value === 'string'
    )
      result.moduleSpecifiers.push({
        start: node.source.start,
        end: node.source.end,
        value: node.source.value,
      });
  }
  for (const comment of comments) {
    const marker = /^\s*@bakers-schema-version\s+(\d+)\s*$/.exec(comment.value);
    if (marker) result.headerVersions.push(Number(marker[1]));
  }
  const declaration = program.body.find(
    (node) => node.type === 'ExportDefaultDeclaration',
  );
  if (
    declaration?.type !== 'ExportDefaultDeclaration' ||
    declaration.declaration.type !== 'ObjectExpression'
  )
    return result;
  result.shape = 'object';
  result.object = {
    start: declaration.declaration.start,
    end: declaration.declaration.end,
  };

  const invalidate = (prefix: string) => {
    for (const [key, property] of result.properties) {
      if (
        !prefix ||
        key.startsWith(`${prefix}.`) ||
        key.startsWith(`${prefix}[`)
      ) {
        property.staticallyDetermined = false;
        delete property.value;
      }
    }
  };
  const visitValue = (
    node: Expression,
    key: string,
    start: number,
    end: number,
    line: number,
    column: number,
  ) => {
    const property: ConfigSourceProperty = {
      key,
      start,
      end,
      valueStart: node.start,
      valueEnd: node.end,
      line,
      column,
      nodeType: node.type,
      staticallyDetermined: false,
    };
    if (
      node.type === 'Literal' &&
      (node.value === null ||
        ['string', 'number', 'boolean'].includes(typeof node.value))
    ) {
      property.value = node.value as string | number | boolean | null;
      property.staticallyDetermined = true;
    } else if (
      node.type === 'UnaryExpression' &&
      (node.operator === '-' || node.operator === '+') &&
      node.argument.type === 'Literal' &&
      typeof node.argument.value === 'number'
    ) {
      property.value =
        node.operator === '-' ? -node.argument.value : node.argument.value;
      property.staticallyDetermined = true;
    } else if (
      node.type === 'TemplateLiteral' &&
      node.expressions.length === 0
    ) {
      property.value = node.quasis[0]?.value.cooked ?? '';
      property.staticallyDetermined = true;
    } else if (
      node.type === 'ObjectExpression' ||
      node.type === 'ArrayExpression'
    ) {
      property.staticallyDetermined = true;
    }
    result.propertyOccurrences.push(property);
    result.properties.set(key, property);
    if (node.type === 'ObjectExpression') visitObject(node, key);
    if (node.type === 'ArrayExpression') {
      property.arrayLength = node.elements.length;
      let dynamicIndex = false;
      node.elements.forEach((element, index) => {
        if (element?.type === 'SpreadElement') dynamicIndex = true;
        if (!element || element.type === 'SpreadElement' || !element.loc) {
          property.staticallyDetermined = false;
          return;
        }
        visitValue(
          element,
          `${key}[${index}]`,
          element.start,
          element.end,
          element.loc.start.line,
          element.loc.start.column + 1,
        );
        if (dynamicIndex) {
          invalidate(`${key}[${index}]`);
          const entry = result.properties.get(`${key}[${index}]`);
          if (entry) {
            entry.staticallyDetermined = false;
            delete entry.value;
          }
        }
      });
    }
  };
  const visitObject = (node: ObjectExpression, prefix: string) => {
    for (const entry of node.properties) {
      if (entry.type === 'SpreadElement' || entry.computed) {
        result.unknownKeys = true;
        invalidate(prefix);
        continue;
      }
      const name =
        entry.key.type === 'Identifier'
          ? entry.key.name
          : entry.key.type === 'Literal'
            ? String(entry.key.value)
            : undefined;
      if (name === undefined || !entry.loc) continue;
      const key = prefix ? `${prefix}.${name}` : name;
      // Later duplicate properties replace earlier nested values too.
      for (const existing of result.properties.keys()) {
        if (existing.startsWith(`${key}.`) || existing.startsWith(`${key}[`))
          result.properties.delete(existing);
      }
      const value = entry.value as Expression;
      visitValue(
        value,
        key,
        skipTrivia(text, entry.start, entry.end),
        entry.end,
        entry.loc.start.line,
        entry.loc.start.column + 1,
      );
      if (entry.kind !== 'init' || entry.method || entry.shorthand) {
        const property = result.properties.get(key);
        if (property) {
          property.staticallyDetermined = false;
          delete property.value;
        }
      }
    }
  };
  visitObject(declaration.declaration, '');
  return result;
}
