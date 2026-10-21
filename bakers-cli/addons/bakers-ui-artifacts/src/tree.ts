import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Section } from '@bakers-build/addon-bakers-ui/ui';

type ArtifactSection = Section & { expandable?: boolean };

/**
 * The roots to probe, in order (spec D9).
 *
 * Pure path joins: `cwd` comes from `TuiOptions`, `identifier` and `branch` off
 * the open document, so there is no `git` call and nothing async. The second
 * root is not a nicety — an operator starts `bakers ui` in the main checkout while
 * a run writes its artifacts inside the worktree, so probing only the first
 * would show nothing, systematically.
 */
export function artifactRoots(
  cwd: string,
  identifier: string,
  branch: string,
): string[] {
  const own = join(cwd, 'assets-ai', identifier);
  return branch.trim() === ''
    ? [own]
    : [own, join(cwd, '.bakers-worktrees', branch, 'assets-ai', identifier)];
}

/**
 * Text file heads, memoised per `(path, mtime, size)` — spec D9.
 *
 * That key is what makes the cache CORRECT rather than merely fast: keying on
 * the directory's own mtime would go stale the moment a re-run overwrites a log
 * in place, because rewriting a file does not touch its directory. There is no
 * reliance on the `R` key either — it reloads the document and knows nothing
 * about this tree.
 */
const heads = new Map<string, readonly string[]>();

const head = (path: string, lines: number): readonly string[] => {
  const stat = statSync(path);
  const key = `${path}:${stat.mtimeMs}:${stat.size}`;
  const hit = heads.get(key);
  if (hit) return hit;
  const all = readFileSync(path, 'utf8').replace(/\n$/, '').split('\n');
  const kept = all.slice(0, lines);
  if (all.length > lines) kept.push(`… ${all.length - lines} more lines`);
  heads.set(key, kept);
  return kept;
};

/** Extensions never read: their bytes say nothing a terminal can show. */
const BINARY = /\.(png|jpe?g|gif|webp|zip|pdf|webm|mp4)$/i;

/**
 * One directory's entries, or none when it cannot be read.
 *
 * A directory that vanished between the walk and the read is not an error worth
 * a stack trace — this runs on the DRAW path, and a run writing into the tree is
 * exactly the situation the panel exists for.
 */
const entriesOf = (dir: string) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

/**
 * One FILE's section — and the same reasoning `entriesOf` states, applied to the
 * calls that actually touch bytes.
 *
 * The race that comment names is not hypothetical for a file: a run unlinks or
 * rewrites a capture between `readdirSync` and this read and the `stat`/`open`
 * comes back ENOENT; a log written by a container as root comes back EACCES. On
 * the DRAW path either one used to escape as a stack trace, and the host's guard
 * would then have degraded the WHOLE listing to a single failure row — so one
 * unreadable file would hide every artifact beside it. It costs its own row
 * instead: the file stays listed under its real heading, the row says plainly
 * that it could not be read, and it is NOT expandable, because there is nothing
 * behind the caret to show. The errno leads, since `ENOENT`/`EACCES` is the part
 * that tells the operator whether to re-run or to fix permissions.
 */
const fileSection = (
  heading: string,
  path: string,
  headLines: number,
): ArtifactSection => {
  try {
    return BINARY.test(heading)
      ? // Listed, never read — and NOT expandable, because there is nothing
        // behind the caret a terminal could show.
        { heading, lines: [`${statSync(path).size} bytes`] }
      : { heading, expandable: true, lines: [...head(path, headLines)] };
  } catch (caught) {
    const code = (caught as { code?: unknown } | null)?.code;
    return {
      heading,
      lines: [
        `could not be read: ${
          typeof code === 'string'
            ? code
            : caught instanceof Error
              ? caught.message
              : String(caught)
        }`,
      ],
    };
  }
};

/**
 * One section per ARTIFACT, headed by its path under the ticket's tree so the
 * producing tool leads every heading (`vitest/store-green.txt`,
 * `playwright/logs/walk.txt`) and one tool's artifacts stand together.
 *
 * Why per artifact and not per tool directory: the panel contract is
 * `ArtifactSection[]` with one collapsible entry per section (spec D4), and D9 asks
 * for each FILE to be the expandable entry — its collapsed row the producing
 * command, its expanded body the head of the capture. A section per tool could
 * carry only one of those two, so the grouping lives in the heading instead,
 * where it costs the narrow contract nothing.
 *
 * The first row of every text artifact is its own first line, which by BB-371
 * D3 is the command that produced it — so the collapsed panel reads as the list
 * of commands this ticket ran.
 */
export function artifactSections(
  roots: readonly string[],
  { headLines }: { headLines: number },
): readonly ArtifactSection[] {
  const root = roots.find((candidate) => {
    try {
      return statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
  if (root === undefined) return [];

  const sections: ArtifactSection[] = [];
  const walk = (dir: string, prefix: string): void => {
    // Sorted by name, so the listing is the same on every draw and on every
    // filesystem — `readdirSync` promises no order of its own.
    const sorted = [...entriesOf(dir)].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of sorted) {
      const path = join(dir, entry.name);
      const heading = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path, heading);
        continue;
      }
      if (!entry.isFile()) continue;
      sections.push(fileSection(heading, path, headLines));
    }
  };
  walk(root, '');
  return sections;
}
