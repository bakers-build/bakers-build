/**
 * The skills a run must be able to load: the ticket's recipe skill
 * `bb-recipe-<recipe>` and the recipe's `metadata.requires` for the ticket's
 * type. `WORKFLOW.md` is never read here: only the agent reads it, as prose.
 * Available are the worktree's own skills and the plugins installed in the
 * run's agent home; the user's own agent home never counts.
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
    Array.isArray(manifest.skills)
      ? manifest.skills
      : [manifest.skills ?? 'skills']
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
    for (const [name, path] of pairs)
      if (!found.has(name)) found.set(name, path);
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

/**
 * A recipe's `metadata.requires` (space-separated skill names), replaced by
 * `requires-<type>` when the recipe declares one for the ticket's type.
 */
function recipeRequires(
  skillFile: string,
  type: string | undefined,
): { key: string; names: string[] } {
  const lists = new Map<string, string>();
  for (const m of frontmatter(read(skillFile)).matchAll(
    /^\s+requires(?:-([\w-]+))?:\s*"?([^"\n]*)"?\s*$/gm,
  ))
    lists.set(m[1] ? `requires-${m[1]}` : 'requires', m[2] as string);
  const key =
    type && lists.has(`requires-${type}`) ? `requires-${type}` : 'requires';
  return { key, names: (lists.get(key) ?? '').split(/\s+/).filter(Boolean) };
}

function lookup(found: Map<string, string>, name: string): string | undefined {
  if (name.includes(':')) return found.get(name);
  return (
    found.get(name) ?? [...found].find(([key]) => key.endsWith(`:${name}`))?.[1]
  );
}

export function checkRequiredSkills(
  worktree: string,
  home: string,
  ticket: { type?: string; recipe?: string },
): { required: string[]; missing: string[]; sources: Record<string, string> } {
  const found = availableSkills(worktree, home);
  // Where each name was required, for the failure message; the first source wins.
  const sources: Record<string, string> = {};
  if (ticket.recipe) {
    const recipe = `bb-recipe-${ticket.recipe}`;
    sources[recipe] = 'ticket recipe';
    const path = lookup(found, recipe);
    if (path) {
      const { key, names } = recipeRequires(path, ticket.type);
      for (const name of names) sources[name] ??= `${recipe} metadata.${key}`;
    }
  }
  const required = Object.keys(sources);
  return {
    required,
    missing: required.filter((name) => !lookup(found, name)),
    sources,
  };
}
