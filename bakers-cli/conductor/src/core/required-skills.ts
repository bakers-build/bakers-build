/**
 * The skills a run must be able to load: every skill named in the worktree's
 * `WORKFLOW.md` › `## bb-phase-work`, the ticket's recipe skill
 * `bb-recipe-<recipe>`, and the recipe's `metadata.requires` for the ticket's
 * type. Available are the worktree's own skills and the plugins installed in
 * the run's agent home; the user's own agent home never counts.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

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
  return entries.flatMap((entry) => skillAt(join(dir, entry), entry));
}

/** A skill directory's SKILL.md by its frontmatter name, if it holds one. */
function skillAt(dir: string, fallback: string): Array<[string, string]> {
  const path = join(dir, 'SKILL.md');
  if (!existsSync(path)) return [];
  const name = /^name:\s*(\S+)\s*$/m.exec(frontmatter(read(path)))?.[1];
  return [[name ?? fallback, path]];
}

/** Every SKILL.md at or below `dir`, by its frontmatter name. */
function skillsBelow(dir: string): Array<[string, string]> {
  let files: string[];
  try {
    files = readdirSync(dir, { recursive: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  return files
    .filter((file) => basename(file) === 'SKILL.md')
    .filter((file) => !file.includes('node_modules/'))
    .flatMap((file) => {
      const skillDir = join(dir, dirname(file));
      return skillAt(skillDir, basename(skillDir));
    });
}

/**
 * `<plugin>:<skill>` for each skill of the plugin rooted at `root`. The
 * manifest names the plugin and its `skills` paths (one or a list); without
 * one, the plugin is `fallback` with `skills/`. Like the harnesses, every
 * SKILL.md below a skills path counts.
 */
function pluginSkills(root: string, fallback: string): Array<[string, string]> {
  let manifest: { name?: unknown; skills?: unknown } = {};
  for (const kind of ['.claude-plugin', '.codex-plugin']) {
    try {
      manifest = JSON.parse(read(join(root, kind, 'plugin.json')));
      break;
    } catch {}
  }
  const plugin = typeof manifest.name === 'string' ? manifest.name : fallback;
  const paths = (
    Array.isArray(manifest.skills) ? manifest.skills : [manifest.skills ?? 'skills']
  ).filter((path): path is string => typeof path === 'string');
  return paths
    .flatMap((path) => skillsBelow(join(root, path)))
    .map(([name, path]) => [`${plugin}:${name}`, path]);
}

const dirs = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

function availableSkills(worktree: string, home: string): Map<string, string> {
  const found = new Map<string, string>();
  const add = (pairs: Array<[string, string]>) => {
    for (const [name, path] of pairs) if (!found.has(name)) found.set(name, path);
  };
  for (const root of ['.claude/skills', '.agents/skills']) {
    const dir = join(worktree, root);
    add(skillsIn(dir));
    // A skills-directory plugin, such as the `bakers` skills of this repository.
    for (const entry of dirs(dir))
      if (
        existsSync(join(dir, entry, '.claude-plugin', 'plugin.json')) ||
        existsSync(join(dir, entry, '.codex-plugin', 'plugin.json'))
      )
        add(pluginSkills(join(dir, entry), entry));
  }
  // Both harnesses install to plugins/cache/<marketplace>/<plugin>/<version>.
  const cache = join(home, 'plugins', 'cache');
  for (const marketplace of dirs(cache))
    for (const plugin of dirs(join(cache, marketplace)))
      for (const version of dirs(join(cache, marketplace, plugin)))
        add(pluginSkills(join(cache, marketplace, plugin, version), plugin));
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
