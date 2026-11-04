// Collects the bakers.build bundle skills the PM bot ships, at image build time (Dockerfile).
//
//   node collect-skills.mjs <bundle root> <out> <skill>...
//
// Copies <root>/skills/<skill>/ for each named skill, every file their Markdown links reach,
// transitively, and <root>/.claude-plugin/plugin.json (for the version) into <out>, at their
// paths relative to <root>/skills (plugin.json at .claude-plugin/plugin.json). Fails when a link
// leaves <root>/skills, reaches a SKILL.md other than the named skills' (Hermes would discover
// that skill), or resolves to no file. Web and mail links are not followed. No dependencies.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const LINK = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function collectSkills({ root, skills, out }) {
  const base = resolve(root, 'skills');
  const named = new Set(skills.map((name) => join(base, name, 'SKILL.md')));
  const seen = new Set();
  const queue = skills.flatMap((name) => filesUnder(join(base, name)));
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!file.endsWith('.md')) continue;
    for (const [, raw] of readFileSync(file, 'utf8').matchAll(LINK)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('#')) continue;
      const target = resolve(dirname(file), decodeURI(raw.split('#')[0]));
      const from = relative(base, file);
      const to = relative(base, target);
      if (to === '..' || to.startsWith(`..${sep}`) || isAbsolute(to)) {
        throw new Error(`link leaves the bundle: ${from} -> ${raw}`);
      }
      if (basename(target) === 'SKILL.md' && !named.has(target)) {
        throw new Error(`link reaches another skill: ${from} -> ${raw}`);
      }
      if (!isFile(target)) throw new Error(`broken link: ${from} -> ${raw}`);
      queue.push(target);
    }
  }
  const files = [...seen].map((file) => relative(base, file));
  for (const path of files) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    copyFileSync(join(base, path), join(out, path));
  }
  mkdirSync(join(out, '.claude-plugin'), { recursive: true });
  copyFileSync(join(root, '.claude-plugin', 'plugin.json'), join(out, '.claude-plugin', 'plugin.json'));
  return { files: [...files, '.claude-plugin/plugin.json'] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [root, out, ...skills] = process.argv.slice(2);
  try {
    if (!root || !out || !skills.length) throw new Error('usage: collect-skills.mjs <root> <out> <skill>...');
    const { files } = collectSkills({ root, skills, out });
    console.log(`collected ${files.length} files`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
