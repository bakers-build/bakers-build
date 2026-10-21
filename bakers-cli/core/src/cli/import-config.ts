import { readFileSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Node, parse } from 'acorn';

// Mirrors homeBbDir()'s BB_HOME precedence (bakers-dir.ts) without importing
// it: this file is spawned directly as a `.ts` entry point by tests (no
// transpiler resolving `.js`-suffixed relative imports back to `.ts`
// sources), so a same-package import here would break that execution path.
export function homeBbDirInline(): string {
  const override = process.env.BB_HOME;
  return override ? resolve(override) : join(homedir(), '.bakers');
}

/**
 * Recognises the computed `import()` expression `configImportExpression()`
 * (`conductor/src/cli/config-templates.ts`) renders for the home-inherited
 * `bakers.config.js`/`machine.config.js` imports. Exported so a cross-package
 * test can pin the renderer against this recogniser directly, rather than
 * the two drifting independently. An alternation, not a replacement: every
 * config generated before the renderer moved to the `BB_HOME`-aware form
 * still carries the plain `${process.env.HOME}/.bakers/…` shape on disk, and
 * that shape must stay recognised alongside the new one.
 */
export const HOME_IMPORT_EXPRESSION_PATTERN =
  /^`\$\{process\.env\.BB_HOME \?\? `\$\{process\.env\.HOME\}\/\.bakers`\}\/(bakers\.config\.js|machine\.config\.js)`$|^`\$\{process\.env\.HOME\}\/\.bakers\/(bakers\.config\.js|machine\.config\.js)`$/;

/** Import configuration as a fresh module graph without writing transient secret files.
 * Local literal imports are refreshed recursively; package imports retain normal
 * Node resolution. Preserve import.meta.url so relative resource access still
 * refers to the original file. Computed imports retain their normal semantics.
 */
export async function importConfig(
  path: string,
): Promise<{ default?: unknown }> {
  const generation = `${Date.now()}-${Math.random()}`;
  const requireName = `__bakersRequire_${generation.replace(/[^a-z0-9]/gi, '')}`;
  const cache = new Map<string, string>();
  const visiting = new Set<string>();
  function moduleUrl(file: string): string {
    const cached = cache.get(file);
    if (cached) return cached;
    if (visiting.has(file))
      throw new Error(
        `Cannot reload cyclic local configuration imports at ${file}; make the workspace owner explicit.`,
      );
    visiting.add(file);
    const original = pathToFileURL(file).href;
    let source = readFileSync(file, 'utf8');
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const edits: Array<{ start: number; end: number; value: string }> = [];
    function specifier(raw: string): string {
      if (isBuiltin(raw)) return raw.startsWith('node:') ? raw : `node:${raw}`;
      if (raw.startsWith('data:')) return raw;
      const local =
        raw.startsWith('.') || raw.startsWith('file:') || isAbsolute(raw);
      const target = raw.startsWith('file:')
        ? fileURLToPath(raw)
        : local
          ? resolve(dirname(file), raw)
          : createRequire(original).resolve(raw);
      if (
        !local ||
        !/[.]m?js$/.test(target) ||
        target.includes('/node_modules/')
      )
        return pathToFileURL(target).href;
      // Keep optional imports optional: the runtime catch must still see MODULE_NOT_FOUND.
      try {
        return moduleUrl(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          return pathToFileURL(target).href;
        throw error;
      }
    }
    function visit(node: Node): void {
      const n = node as Node & Record<string, unknown>;
      if (n.type === 'MemberExpression') {
        const object = n.object as Record<string, unknown>;
        const property = n.property as Record<string, unknown>;
        if (object?.type === 'MetaProperty' && property?.name === 'url') {
          edits.push({
            start: n.start,
            end: n.end,
            value: JSON.stringify(original),
          });
          return;
        }
      }
      if (
        n.type === 'ImportDeclaration' ||
        n.type === 'ExportNamedDeclaration' ||
        n.type === 'ExportAllDeclaration' ||
        n.type === 'ImportExpression'
      ) {
        const s = n.source as
          | (Node & { value?: unknown; type: string })
          | undefined;
        if (s && typeof s.value === 'string')
          edits.push({
            start: s.start,
            end: s.end,
            value: JSON.stringify(specifier(s.value)),
          });
        else if (s && n.type === 'ImportExpression') {
          const expression = source.slice(s.start, s.end);
          // Current generated global inheritance is a known template, not arbitrary evaluation.
          const home = HOME_IMPORT_EXPRESSION_PATTERN.exec(expression);
          const file = home?.[1] ?? home?.[2];
          if (file)
            edits.push({
              start: s.start,
              end: s.end,
              value: JSON.stringify(specifier(join(homeBbDirInline(), file))),
            });
          else {
            // Computed imports keep Node's original file-relative/package semantics.
            // Their source ownership remains unknown to the persistence policy.
            edits.push({
              start: s.start,
              end: s.start,
              value: `((specifier) => /^(?:node:|data:|file:)/.test(specifier) ? specifier : specifier.startsWith('.') || specifier.startsWith('/') ? new URL(specifier, ${JSON.stringify(original)}).href : ${requireName}(${JSON.stringify(original)}).resolve(specifier))(`,
            });
            edits.push({ start: s.end, end: s.end, value: ')' });
          }
        }
      }
      for (const [key, value] of Object.entries(n)) {
        if (key === 'start' || key === 'end') continue;
        if (Array.isArray(value))
          for (const child of value) {
            if (child && typeof child === 'object' && 'type' in child)
              visit(child as Node);
          }
        else if (value && typeof value === 'object' && 'type' in value)
          visit(value as Node);
      }
    }
    visit(ast);
    for (const e of edits.sort((a, b) => b.start - a.start))
      source = source.slice(0, e.start) + e.value + source.slice(e.end);
    const url = `data:text/javascript;base64,${Buffer.from(`${source}\nimport { createRequire as ${requireName} } from 'node:module';\n// reload ${generation}\n`).toString('base64')}`;
    cache.set(file, url);
    visiting.delete(file);
    return url;
  }
  return import(/* @vite-ignore */ moduleUrl(resolve(path)));
}
