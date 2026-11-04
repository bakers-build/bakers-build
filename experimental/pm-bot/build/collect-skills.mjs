// Collects the bakers.build bundle skills the PM bot ships, at image build time (Dockerfile).
//
//   node collect-skills.mjs <bundle root> <out> <skill>...
//
// For each named skill, copies <root>/skills/<skill>/ and every file its Markdown links reach,
// transitively, into <out>/<skill>/, and <root>/.claude-plugin/plugin.json (for the version) to
// <out>/.claude-plugin/plugin.json. Hermes' skill_view serves only files inside a skill's own
// folder, so a reached file outside it goes to <out>/<skill>/bundle/<its path below
// <root>/skills>, and every link is rewritten to the copied target: each link then resolves
// inside its skill. Fails when a link leaves <root>/skills, reaches a SKILL.md other than the
// named skills' (Hermes would discover that skill), or resolves to no file. Web and mail links
// are not followed. No dependencies.
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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

const isRelativeLink = (raw) => !/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith('#');
const inside = (dir, path) => {
  const rel = relative(dir, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

// The files one skill reaches: its own folder and the transitive Markdown link closure.
function closure(base, skill, named) {
  const seen = new Set();
  const queue = filesUnder(join(base, skill));
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!file.endsWith('.md')) continue;
    for (const [, raw] of readFileSync(file, 'utf8').matchAll(LINK)) {
      if (!isRelativeLink(raw)) continue;
      const target = resolve(dirname(file), decodeURI(raw.split('#')[0]));
      const from = relative(base, file);
      if (!inside(base, target)) throw new Error(`link leaves the bundle: ${from} -> ${raw}`);
      if (basename(target) === 'SKILL.md' && !named.has(target)) {
        throw new Error(`link reaches another skill: ${from} -> ${raw}`);
      }
      if (!isFile(target)) throw new Error(`broken link: ${from} -> ${raw}`);
      queue.push(target);
    }
  }
  return seen;
}

export function collectSkills({ root, skills, out }) {
  const base = resolve(root, 'skills');
  const named = new Set(skills.map((name) => join(base, name, 'SKILL.md')));
  const files = [];
  for (const skill of skills) {
    const own = join(base, skill);
    // Where each reached file lands, relative to <out>.
    const place = new Map(
      [...closure(base, skill, named)].map((file) => [
        file,
        inside(own, file) ? relative(base, file) : join(skill, 'bundle', relative(base, file)),
      ]),
    );
    for (const [file, path] of place) {
      mkdirSync(dirname(join(out, path)), { recursive: true });
      files.push(path);
      if (!file.endsWith('.md')) {
        copyFileSync(file, join(out, path));
        continue;
      }
      const text = readFileSync(file, 'utf8').replace(LINK, (link, raw) => {
        if (!isRelativeLink(raw)) return link;
        const [target, anchor] = raw.split(/(?=#)/);
        const moved = relative(dirname(path), place.get(resolve(dirname(file), decodeURI(target))));
        return link.replace(raw, `${encodeURI(moved.split(sep).join('/'))}${anchor ?? ''}`);
      });
      writeFileSync(join(out, path), text);
    }
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
