import type { BbRemote } from '@bakers-build/conductor/contract';
import { exec } from '@bakers-build/core';
import type { Command } from 'commander';

export interface GatherResult {
  range: string;
  resolved: Array<{ identifier: string; uuid: string; title: string }>;
  unresolved: string[];
}

/**
 * An identifier's shape: a project key plus its number. A key is validated as
 * `/^[A-Z][A-Z0-9]{1,9}$/` and never contains a hyphen (`BbProject`), so this
 * is the whole grammar — and it is also the shape of prose like `AC-1`,
 * `UTF-8` or `SHA-256`, which is why matching it alone is not enough.
 */
const IDENTIFIER = '[A-Z][A-Z0-9]{1,9}-\\d+';

/**
 * What may precede a subject: the `%x1e` record separator and the abbreviated
 * or full commit hash that `bakers deployment tickets` asks `git log` to print in
 * front of `%s`. Both optional, so a bare subject line anchors too.
 */
const SUBJECT_HEAD = '^\\x1e?(?:[0-9a-f]{2,40} )?';

/**
 * The three positions in which an identifier can only be a ticket reference,
 * and which therefore admit its project key:
 *
 * 1. the `ref:` trailer the commit convention prescribes — `ref:SHOP-42`;
 * 2. a conventional-commit scope — `feat(BB-134): …`;
 * 3. the head of a subject line — `BB-375: …`, the legacy form 298 of the
 *    last 300 commits on `develop` use.
 *
 * Positions 2 and 3 are deliberately anchored to the head of a line rather than
 * to "any token before a colon" or "any parenthesised token": a body bullet
 * `- AC-2: …` and a body line `(AC-5): parent = …` are exactly those two
 * shapes, and both occur in this repository's real history. Admitting `AC` from
 * them puts six phantom identifiers into a 300-commit release batch.
 */
const ANCHORED = new RegExp(
  [
    `ref:[ \\t]*(${IDENTIFIER})\\b`,
    `${SUBJECT_HEAD}[a-z]+!?\\((${IDENTIFIER})\\):`,
    `${SUBJECT_HEAD}(${IDENTIFIER}):`,
  ].join('|'),
  'gm',
);

/**
 * Deduped ticket identifiers from a git log, in first-seen order — for any
 * project key, not just `bakers.build` (BB-392 AC-2).
 *
 * The parse admits *keys*, not tokens, in two passes: a key is admitted where
 * it stands in one of the anchored positions above, and every identifier whose
 * key was admitted is then collected — anchored or bare.
 *
 * The second pass is not optional: of the last 300 commits on `develop` only
 * two carry a `ref:` trailer, the rest name the ticket in the subject, and a
 * bare `BB-135` in a body is a real reference. What the rule gives up is one
 * residual case — a delta in which a key appears *only* in bare mid-prose form,
 * anchored nowhere, yields nothing for that key. That is the deliberate trade:
 * such a token is indistinguishable from `AC-1` without hardcoding a project
 * key, which is the defect this replaces. The cheap direction is the other one,
 * a wrongly admitted key, because it surfaces in `unresolved` rather than as a
 * wrong ticket.
 */
export function parseIdentifiers(gitLog: string): string[] {
  const admitted = new Set<string>();
  for (const [, trailer, scope, subject] of gitLog.matchAll(ANCHORED)) {
    const identifier = trailer ?? scope ?? subject;
    if (identifier !== undefined) {
      admitted.add(keyOf(identifier));
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [identifier] of gitLog.matchAll(
    new RegExp(`\\b${IDENTIFIER}\\b`, 'g'),
  )) {
    if (admitted.has(keyOf(identifier)) && !seen.has(identifier)) {
      seen.add(identifier);
      out.push(identifier);
    }
  }
  return out;
}

/** An identifier's project key — everything left of its `-<number>`. */
function keyOf(identifier: string): string {
  return identifier.slice(0, identifier.indexOf('-'));
}

/**
 * Compute the release batch from a git-log delta: parse ticket identifiers and
 * resolve each to a ticket. Unresolved identifiers are reported, never fatal
 * (the resolver returning null is not an error) — BB-153 AC-2.
 */
export async function gatherBatch(opts: {
  sinceRef: string;
  toRef: string;
  gitLog: string;
  resolve: (id: string) => Promise<{ uuid: string; title: string } | null>;
}): Promise<GatherResult> {
  const resolved: GatherResult['resolved'] = [];
  const unresolved: string[] = [];
  for (const identifier of parseIdentifiers(opts.gitLog)) {
    const hit = await opts.resolve(identifier);
    if (hit) {
      resolved.push({ identifier, ...hit });
    } else {
      unresolved.push(identifier);
    }
  }
  return { range: `${opts.sinceRef}..${opts.toRef}`, resolved, unresolved };
}

/**
 * Register the `bakers deployment` command group. `tickets` computes the release's
 * tickets (git-log identifier parse + resolve over the given range) and prints
 * them as JSON — pure compute + report, it does not write `referenced_tickets`
 * (the prepare-deployment skill does, via the documented dropsh path).
 */
export function registerDeployment(
  program: Command,
  resolveRemote: () => Promise<BbRemote>,
  resolveProject: () => Promise<string>,
  cwd: () => string,
): void {
  const dep = program
    .command('deployment')
    .description('release / deployment helpers');
  dep
    .command('tickets')
    .description(
      "the release's tickets (git-log identifier parse + resolve over a range) as JSON",
    )
    .requiredOption(
      '--since <ref>',
      "the env's currently-deployed ref (git range start)",
    )
    .requiredOption(
      '--to <ref>',
      'the post-merge env branch tip (git range end)',
    )
    .action(async (opts: { since: string; to: string }) => {
      // Prefix each commit with a record separator (%x1e) so one commit's body
      // cannot run into the next commit's header line; the identifier parse is
      // separator-agnostic, but the boundary keeps the log unambiguous.
      const gitLog = await exec(
        'git',
        ['log', '--format=%x1e%H %s%n%b', `${opts.since}..${opts.to}`],
        { cwd: cwd() },
      );
      const remote = await resolveRemote();
      const project = await resolveProject();
      const result = await gatherBatch({
        sinceRef: opts.since,
        toRef: opts.to,
        gitLog,
        resolve: (id) => remote.resolveTicketByIdentifier(project, id),
      });
      console.log(JSON.stringify(result));
    });
}
