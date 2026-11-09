/**
 * The skills a run must be able to load: every skill named in the worktree's
 * `WORKFLOW.md` › `## bb-phase-work`, the ticket's recipe skill
 * `bb-recipe-<recipe>`, and the recipe's `metadata.requires` for the ticket's
 * type. Available are the worktree's own skills and the plugins installed in
 * the run's agent home; the user's own agent home never counts.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const read = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

const frontmatter = (text: string): string =>
  /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';

/** Skill directories (holding a SKILL.md) directly under `dir`, by their frontmatter name. */
function skillsIn(dir: string): Array<[string, string]> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry, 'SKILL.md');
    if (!existsSync(path)) return [];
    const name = /^name:\s*(\S+)\s*$/m.exec(frontmatter(read(path)))?.[1];
    return [[name ?? entry, path] as [string, string]];
  });
}

/** `<plugin name>:<skill>` for each skill of the plugin whose manifest is at `manifest`. */
function pluginSkills(manifest: string): Array<[string, string]> {
  let parsed: { name?: unknown; skills?: unknown };
  try {
    parsed = JSON.parse(read(manifest));
  } catch {
    return [];
  }
  if (typeof parsed.name !== 'string') return [];
  const root = dirname(dirname(manifest));
  const skills = typeof parsed.skills === 'string' ? parsed.skills : 'skills';
  return skillsIn(join(root, skills)).map(([name, path]) => [
    `${parsed.name}:${name}`,
    path,
  ]);
}

const MANIFEST = /(?:^|\/)\.(?:claude|codex)-plugin\/plugin\.json$/;

function availableSkills(worktree: string, home: string): Map<string, string> {
  const found = new Map<string, string>();
  const add = (pairs: Array<[string, string]>) => {
    for (const [name, path] of pairs) if (!found.has(name)) found.set(name, path);
  };
  for (const root of ['.claude/skills', '.agents/skills']) {
    const dir = join(worktree, root);
    add(skillsIn(dir));
    for (const entry of existsSync(dir) ? readdirSync(dir) : [])
      for (const kind of ['.claude-plugin', '.codex-plugin'])
        add(pluginSkills(join(dir, entry, kind, 'plugin.json')));
  }
  const cache = join(home, 'plugins', 'cache');
  const files = existsSync(cache)
    ? readdirSync(cache, { recursive: true, encoding: 'utf8' })
    : [];
  for (const file of files)
    if (MANIFEST.test(file)) add(pluginSkills(join(cache, file)));
  return found;
}

/** The backticked names in the last column of the `## bb-phase-work` table. */
function workflowSkills(worktree: string): string[] {
  const section =
    /^## bb-phase-work\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(
      read(join(worktree, 'WORKFLOW.md')),
    )?.[1] ?? '';
  return section
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .flatMap((line) => {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|');
      return [...(cells.at(-1) ?? '').matchAll(/`([^`]+)`/g)].map(
        (m) => m[1] as string,
      );
    });
}

/**
 * A recipe's `metadata.requires` (space-separated skill names), replaced by
 * `requires-<type>` when the recipe declares one for the ticket's type.
 */
function recipeRequires(skillFile: string, type: string | undefined): string[] {
  const lists = new Map<string, string>();
  for (const m of frontmatter(read(skillFile)).matchAll(
    /^\s+requires(?:-([\w-]+))?:\s*"?([^"\n]*)"?\s*$/gm,
  ))
    lists.set(m[1] ?? 'default', m[2] as string);
  const list = (type && lists.get(type)) ?? lists.get('default') ?? '';
  return list.split(/\s+/).filter(Boolean);
}

function lookup(found: Map<string, string>, name: string): string | undefined {
  if (name.includes(':')) return found.get(name);
  return (
    found.get(name) ??
    [...found].find(([key]) => key.endsWith(`:${name}`))?.[1]
  );
}

export function checkRequiredSkills(
  worktree: string,
  home: string,
  ticket: { type?: string; recipe?: string },
): { required: string[]; missing: string[] } {
  const found = availableSkills(worktree, home);
  const required = workflowSkills(worktree);
  if (ticket.recipe) {
    const recipe = `bb-recipe-${ticket.recipe}`;
    required.push(recipe);
    const path = lookup(found, recipe);
    if (path) required.push(...recipeRequires(path, ticket.type));
  }
  const unique = [...new Set(required)];
  return {
    required: unique,
    missing: unique.filter((name) => !lookup(found, name)),
  };
}
