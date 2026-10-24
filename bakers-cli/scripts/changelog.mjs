// Generate the next release entry of the repository's CHANGELOG.md from the merge requests
// merged since the last version tag (v<semver>), and prepend it. One version covers CLI and
// server.
//
//   GITLAB_TOKEN=$(glab config get token --host <gitlab host>) node scripts/changelog.mjs <version>
//
// Each squash commit since the tag is resolved to its merge request through the GitLab API
// of the `origin` remote. The MR title is the entry; its label picks the group: `breaking`,
// `feature`, `bug`, `maintenance` (first match in that order). An MR without one of these
// labels, or a commit without an MR, is left out and reported, so it can be labelled and
// the script re-run. The entry goes under CLI when the commit touches bakers-cli/, under
// Server when it touches anything else, under both when it touches both. It lands in
// develop through a normal MR, so a human reads and corrects it before the release.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const GROUPS = [
  ['breaking', 'Breaking changes'],
  ['feature', 'Features'],
  ['bug', 'Fixes'],
  ['maintenance', 'Maintenance'],
];

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

// The newest tag, not `git describe`: release tags sit on main's merge commits, which are
// not ancestors of develop. Same rule as the `publish:npm:next` job.
function lastVersionTag(cwd) {
  return (
    git(cwd, 'tag', '--list', 'v*', '--sort=-v:refname')
      .split('\n')
      .find((tag) => /^v\d+\.\d+\.\d+$/.test(tag)) ?? null // none: the whole history
  );
}

function commitsSince(cwd, tag) {
  // Records: \x1e<sha> <subject>\n<file>\n<file>…, newest first.
  const range = tag ? [`${tag}..HEAD`] : [];
  const out = git(
    cwd,
    'log',
    '--no-merges',
    '--name-only',
    '--format=%x1e%H %s',
    ...range,
  );
  return out
    .split('\x1e')
    .filter(Boolean)
    .map((record) => {
      const [head, ...files] = record.split('\n').filter(Boolean);
      const space = head.indexOf(' ');
      return {
        sha: head.slice(0, space),
        subject: head.slice(space + 1),
        files,
      };
    });
}

/** Resolves a commit to its merge request through the GitLab API of the `origin` remote. */
export function gitlabMergeRequestOf(cwd, token) {
  const remote = git(cwd, 'remote', 'get-url', 'origin').trim();
  // git@host:group/project.git or https://host/group/project.git
  const match =
    /^(?:[^@]+@([^:]+):|https?:\/\/(?:[^@/]+@)?([^/]+)\/)(.+?)(?:\.git)?$/.exec(
      remote,
    );
  if (!match)
    throw new Error(
      `changelog: cannot read a GitLab project from origin ${remote}`,
    );
  const api = `https://${match[1] ?? match[2]}/api/v4/projects/${encodeURIComponent(match[3])}`;
  return async ({ sha }) => {
    const res = await fetch(`${api}/repository/commits/${sha}/merge_requests`, {
      headers: { 'PRIVATE-TOKEN': token },
    });
    if (!res.ok)
      throw new Error(
        `changelog: GitLab answered HTTP ${res.status} for commit ${sha}`,
      );
    const merged = (await res.json()).filter((mr) => mr.state === 'merged');
    // A release MR into main contains the commit too; prefer the MR that produced it.
    return (
      merged.find(
        (mr) => mr.squash_commit_sha === sha || mr.merge_commit_sha === sha,
      ) ??
      merged[0] ??
      null
    );
  };
}

function renderSide(title, items) {
  const lines = [`### ${title}`, ''];
  const present = GROUPS.filter(([key]) => items[key].length);
  if (!present.length) return [...lines, 'No changes.', ''];
  for (const [key, heading] of present) {
    lines.push(
      `#### ${heading}`,
      '',
      ...items[key].map((text) => `- ${text}`),
      '',
    );
  }
  return lines;
}

/**
 * The Markdown entry for `version` from the merge requests since the last version tag, plus
 * the commits left out (`skipped`) because they have no MR or no release label.
 */
export async function changelogEntry({
  cwd,
  version,
  date = new Date().toISOString().slice(0, 10),
  mergeRequestOf,
}) {
  const empty = () => Object.fromEntries(GROUPS.map(([key]) => [key, []]));
  const sides = { cli: empty(), server: empty() };
  const skipped = [];
  for (const commit of commitsSince(cwd, lastVersionTag(cwd))) {
    const mr = await mergeRequestOf(commit);
    if (!mr) {
      skipped.push(`no merge request: ${commit.subject}`);
      continue;
    }
    const group = GROUPS.find(([key]) => mr.labels.includes(key))?.[0];
    if (!group) {
      skipped.push(`no release label: !${mr.iid} ${mr.title}`);
      continue;
    }
    const text = `${mr.title} (!${mr.iid})`;
    if (commit.files.some((f) => f.startsWith('bakers-cli/')))
      sides.cli[group].push(text);
    if (commit.files.some((f) => !f.startsWith('bakers-cli/')))
      sides.server[group].push(text);
  }
  const entry = [
    `## ${version} — ${date}`,
    '',
    ...renderSide('CLI', sides.cli),
    ...renderSide('Server', sides.server),
  ].join('\n');
  return { entry, skipped };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const version = String(process.argv[2] ?? '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version) || !process.env.GITLAB_TOKEN) {
    console.error(
      'usage: GITLAB_TOKEN=<token> node scripts/changelog.mjs <version>, e.g. 0.2.0',
    );
    process.exit(2);
  }
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel').trim();
  const { entry, skipped } = await changelogEntry({
    cwd: root,
    version,
    mergeRequestOf: gitlabMergeRequestOf(root, process.env.GITLAB_TOKEN),
  });
  const file = join(root, 'CHANGELOG.md');
  const header =
    '# Changelog\n\nOne version covers the CLI (`@bakers-build/bakers`) and the server.\n';
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : header;
  const body = existing.startsWith(header)
    ? existing.slice(header.length)
    : `\n${existing}`;
  writeFileSync(file, `${header}\n${entry}${body}`);
  console.log(`changelog: prepended ${version} to ${file}`);
  for (const line of skipped) console.warn(`changelog: left out, ${line}`);
}
