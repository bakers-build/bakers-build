// The forge tools. Every call takes the ticket, branch_name and base_branch
// from the calling run; the token stays with the backend and is redacted
// from every result and error.

import type {
  ToolHandler,
  ToolRequest,
  ToolResult,
} from '@bakers-build/conductor/contract';
import {
  changedProtectedPaths,
  homeBbDir,
  loadRunClone,
  type RunClone,
  refreshRunTarget,
  runCloneTip,
  saveRunClone,
  transferIsolatedCommit,
} from '@bakers-build/core';
import type {
  ForgeBackend,
  ForgeCheck,
  ForgePr,
  ReviewerResult,
} from './backend.js';
import { FORGE_NEEDS_BACKEND, loadForgeBackend, mergeRule } from './config.js';
import { fetchBranches, pushBranch, updateBranch } from './git.js';
import {
  derivedBase,
  isConventionalTitle,
  isOwned,
  ownershipRefusal,
  redact,
  TITLE_REFUSAL,
} from './rules.js';

export const FORGE_NEEDS_RUN =
  'forge tools act only for an agent run: the call carries no ticket branch_name and base_branch (an operator delivers by hand)';

export const FORGE_NEEDS_ORIGIN =
  "forge_issue_update acts only on the run ticket's origin issue, and this ticket has none";

export interface ForgeToolDeps {
  backend(): Promise<ForgeBackend>;
  /** The forge entry's `with` (merge rules). */
  settings: unknown;
}

interface Run {
  identifier: string;
  branchName: string;
  baseBranch: string;
  targetBranch?: string;
}

function runOf(req: ToolRequest): Run {
  const t = req.ticket;
  if (!t?.branchName || !t.baseBranch) throw new Error(FORGE_NEEDS_RUN);
  return {
    identifier: t.identifier,
    branchName: t.branchName,
    baseBranch: t.baseBranch,
    ...(t.targetBranch ? { targetBranch: t.targetBranch } : {}),
  };
}

/**
 * Where `branch` merges: a variant into the ticket branch, the ticket branch into
 * the ticket's current target as the server returns it now. A failed read refuses;
 * the run copy may predate an environment added during the run.
 */
async function currentBase(
  req: ToolRequest,
  branch: string,
  run: Run,
): Promise<string> {
  if (branch !== run.branchName) return derivedBase(branch, run);
  const refuse = (why: string) =>
    new Error(
      `forge: the ticket's current target_branch could not be read from the server (${why}); nothing was sent`,
    );
  if (!req.currentTicket) throw refuse('no server read for this call');
  const t = await req.currentTicket().catch((err: unknown) => {
    throw refuse(err instanceof Error ? err.message : String(err));
  });
  const target = t.targetBranch ?? t.baseBranch;
  if (!target) throw refuse('no target_branch or base_branch returned');
  return target;
}

/** The ticket's origin as the server returns it now, else the run's copy. */
async function originOf(req: ToolRequest): Promise<string> {
  const t = req.currentTicket ? await req.currentTicket() : req.ticket;
  if (!t?.issueUrl) throw new Error(FORGE_NEEDS_ORIGIN);
  return t.issueUrl;
}

/**
 * Requests the ticket's reviewers on `pr` by e-mail. Never throws: the PR is
 * already written, so every failure becomes a named skip.
 */
async function requestReviewers(
  req: ToolRequest,
  b: ForgeBackend,
  pr: ForgePr,
): Promise<{
  requested: string[];
  skipped: { reviewer: string; reason: string }[];
}> {
  const skipped: { reviewer: string; reason: string }[] = [];
  let reviewers: { name: string; mail?: string }[];
  try {
    reviewers =
      (req.currentTicket ? await req.currentTicket() : req.ticket)?.reviewers ??
      [];
  } catch (err) {
    return {
      requested: [],
      skipped: [{ reviewer: '*', reason: errorText(err) }],
    };
  }
  const byMail = new Map<string, string>();
  for (const r of reviewers)
    if (r.mail) byMail.set(r.mail, r.name);
    else skipped.push({ reviewer: r.name, reason: 'e-mail not readable' });
  if (byMail.size === 0) return { requested: [], skipped };
  let result: ReviewerResult;
  try {
    result = await b.addReviewers(pr, [...byMail.keys()]);
  } catch (err) {
    result = {
      requested: [],
      skipped: [...byMail.keys()].map((mail) => ({
        mail,
        reason: errorText(err),
      })),
    };
  }
  const name = (mail: string) => byMail.get(mail) ?? mail;
  return {
    requested: result.requested.map(name),
    skipped: [
      ...skipped,
      ...result.skipped.map((s) => ({
        reviewer: name(s.mail),
        reason: s.reason,
      })),
    ],
  };
}

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

function ownedBranch(req: ToolRequest, run: Run): string {
  const branch = (req.args.branch as string | undefined) ?? run.branchName;
  if (!isOwned(branch, run.branchName))
    throw new Error(ownershipRefusal(branch, run.branchName));
  return branch;
}

const restartRefusal = (sha: string) =>
  `forge: the branch was updated to ${sha} with protected changes this run cannot see; stop and cancel this run with bakers_run_cancel on its ticket, the next run starts there`;

/**
 * Bring the run's commits into the parent. A run behind its branch (an update
 * it has not synced) or awaiting a restart is refused: it would act on stale files.
 */
function transferRun(clone: RunClone): RunClone {
  if (clone.restartPending)
    throw new Error(restartRefusal(clone.restartPending));
  const tip = runCloneTip(clone);
  const expected = transferIsolatedCommit(clone, tip);
  if (expected !== tip)
    throw new Error(
      `forge: the run is behind its branch at ${expected}; run git merge --ff-only ${expected} and validate first`,
    );
  const saved = { ...clone, expected };
  saveRunClone(saved);
  return saved;
}

export const LOG_DEFAULT_BYTES = 16_384;
export const LOG_MAX_BYTES = 262_144;

const json = (value: unknown): ToolResult => ({
  text: JSON.stringify(value, null, 2),
});

export type Overall = 'success' | 'failure' | 'pending' | 'no_required_checks';

/** Required by the forge, or the aggregate check a workflow names `required`. */
export const isRequired = (c: ForgeCheck): boolean =>
  c.required || c.name === 'required';

const isRed = (c: ForgeCheck): boolean =>
  c.status === 'failure' || c.conclusion === 'skipped';

/** Failure first, then pending, over the required checks; none required is never green. */
export function overall(checks: readonly ForgeCheck[]): Overall {
  const required = checks.filter(isRequired);
  if (required.length === 0) return 'no_required_checks';
  if (required.some(isRed)) return 'failure';
  if (required.some((c) => c.status !== 'success')) return 'pending';
  return 'success';
}

export function forgeTools(deps: ForgeToolDeps): Record<string, ToolHandler> {
  let loaded: ForgeBackend | undefined;
  const backend = async () => (loaded = await deps.backend());
  // Read at redaction time: a backend may mint or refresh its token mid-call.
  const secrets = () => loaded?.secrets() ?? [];
  // Every result and error leaves through the redactor.
  const guarded =
    (handler: ToolHandler): ToolHandler =>
    async (req) => {
      try {
        const result = await handler(req);
        return { text: redact(result.text, secrets()) };
      } catch (err) {
        throw new Error(
          redact(err instanceof Error ? err.message : String(err), secrets()),
        );
      }
    };

  const tools: Record<string, ToolHandler> = {
    forge_fetch: async (req) => {
      const run = runOf(req);
      const extra = String(req.args.branches ?? '')
        .split(/\s+/)
        .filter(Boolean);
      const b = await backend();
      // A run clone has no Git on the host: the parent repository is fetched.
      const clone = loadRunClone(req.worktreePath);
      const refs = await fetchBranches(
        clone?.parentGitDir ?? req.worktreePath,
        await b.gitAuth(),
        [run.baseBranch, run.branchName, ...extra],
      );
      // The run sees what the parent got, written without Git in its directory.
      if (clone)
        refreshRunTarget(
          clone,
          refs.map((ref) => ref.name),
        );
      return json({ fetched: refs });
    },

    forge_push: async (req) => {
      const run = runOf(req);
      const branch = ownedBranch(req, run);
      const b = await backend();
      const clone = loadRunClone(req.worktreePath);
      // Only checked commits leave the run: transfer first, push from the parent.
      if (clone && branch === clone.branch) transferRun(clone);
      const sha = await pushBranch(
        clone?.parentGitDir ?? req.worktreePath,
        await b.gitAuth(),
        branch,
        {
          forceWithLease: req.args.force_with_lease === true,
          ...(typeof req.args.expected_sha === 'string'
            ? { expectedSha: req.args.expected_sha }
            : {}),
        },
      );
      if (clone) refreshRunTarget(clone, [branch]);
      return json({ branch, sha });
    },

    forge_update_branch: async (req) => {
      const run = runOf(req);
      const loaded = loadRunClone(req.worktreePath);
      if (!loaded)
        throw new Error(
          'forge_update_branch serves isolated run clones; in this checkout run forge_fetch, then merge origin/<target> locally',
        );
      if (loaded.restartPending)
        throw new Error(restartRefusal(loaded.restartPending));
      const target = await currentBase(req, run.branchName, run);
      const auth = await (await backend()).gitAuth();
      const tip = runCloneTip(loaded);
      // Run commits first, so the merge keeps them; a run behind its branch keeps its tip.
      const clone = {
        ...loaded,
        expected: transferIsolatedCommit(loaded, tip),
      };
      saveRunClone(clone);
      await fetchBranches(clone.parentGitDir, auth, [target, run.branchName]);
      refreshRunTarget(clone, [target]);
      const u = await updateBranch(clone.parentGitDir, auth, {
        branch: run.branchName,
        target,
        expected: clone.expected,
        workspace: { path: clone.workspace, clean: tip },
      });
      const protectedPaths =
        u.resulting === tip
          ? []
          : changedProtectedPaths(clone, tip, u.resulting);
      const sync =
        u.resulting === tip
          ? 'none'
          : protectedPaths.length > 0
            ? 'restart'
            : 'in_place';
      if (sync === 'in_place') refreshRunTarget(clone, [target], [u.resulting]);
      saveRunClone({
        ...clone,
        expected: u.resulting,
        ...(sync === 'restart' ? { restartPending: u.resulting } : {}),
      });
      const next = {
        none: `nothing to do: '${run.branchName}' already contains ${u.target}`,
        in_place: `run git merge --ff-only ${u.resulting} before any further work, then validate and forge_push`,
        restart: `protected paths changed (${protectedPaths.join(', ')}): do no further work or publication; cancel this run with bakers_run_cancel on its ticket, the next run starts at ${u.resulting}`,
      }[sync];
      return json({
        branch: run.branchName,
        target_branch: target,
        previous: u.previous,
        target: u.target,
        resulting: u.resulting,
        noop: u.noop,
        sync,
        next,
      });
    },

    forge_pr_upsert: async (req) => {
      const title = String(req.args.title);
      // Refused before any request reaches the forge.
      if (!isConventionalTitle(title)) throw new Error(TITLE_REFUSAL);
      const run = runOf(req);
      const branch = ownedBranch(req, run);
      const body = (req.args.body as string | undefined) ?? '';
      // One server read serves the base and the reviewers.
      const read = req.currentTicket;
      if (read) {
        // Lazy: a suffixed branch without the flag never reads the ticket.
        let once: ReturnType<typeof read> | undefined;
        req = { ...req, currentTicket: () => (once ??= read()) };
      }
      const base = await currentBase(req, branch, run);
      const b = await backend();
      const open = await b.findOpenPr(branch);
      const pr = open
        ? await b.updatePr(open, { title, body, base })
        : await b.createPr({
            head: branch,
            base,
            title,
            body,
          });
      return json({
        url: pr.url,
        number: pr.number,
        target: pr.base,
        created: !open,
        ...(req.args.request_reviewers === true
          ? { reviewers: await requestReviewers(req, b, pr) }
          : {}),
      });
    },

    forge_checks: async (req) => {
      const run = runOf(req);
      const b = await backend();
      let ref: string;
      let base = run.targetBranch ?? run.baseBranch;
      if (typeof req.args.ref === 'string' && req.args.branch === undefined) {
        ref = req.args.ref;
      } else {
        const branch = ownedBranch(req, run);
        const pr = await b.findOpenPr(branch);
        ref = pr?.headSha ?? branch;
        base = pr?.base ?? derivedBase(branch, run);
      }
      const checks = await b.checks(ref, base, {
        allRuns: req.args.all_runs === true,
      });
      return json({ ref, base, overall: overall(checks), checks });
    },

    forge_merge: async (req) => {
      const run = runOf(req);
      const branch = ownedBranch(req, run);
      const base = await currentBase(req, branch, run);
      const b = await backend();
      const pr = await b.findOpenPr(branch);
      if (!pr)
        throw new Error(
          `no open PR/MR from '${branch}'; open it with forge_pr_upsert`,
        );
      if (pr.base !== base)
        throw new Error(
          `PR/MR ${pr.url} targets '${pr.base}', but '${branch}' merges into '${base}'; close it and open one into '${base}'`,
        );
      if (!isConventionalTitle(pr.title))
        throw new Error(
          `PR/MR ${pr.url}: ${TITLE_REFUSAL}; retitle it with forge_pr_upsert`,
        );
      const blocker = await b.mergeBlocker(pr);
      if (blocker) throw new Error(`PR/MR ${pr.url} cannot merge: ${blocker}`);
      const checks = await b.checks(pr.headSha, pr.base);
      if (overall(checks) === 'no_required_checks')
        throw new Error(
          `PR/MR ${pr.url} cannot merge: no required checks reported`,
        );
      const notGreen = checks.filter(
        (c) => isRequired(c) && (isRed(c) || c.status !== 'success'),
      );
      if (notGreen.length > 0)
        throw new Error(
          `PR/MR ${pr.url} has required checks that are not green: ${notGreen.map((c) => `${c.name} (${c.conclusion ?? c.status})`).join(', ')}`,
        );
      const rule = mergeRule(deps.settings, base);
      const dependents = (await b.openPrsWithBase(branch)).filter(
        (p) => p.number !== pr.number,
      );
      const deleteSource = rule.delete_source && dependents.length === 0;
      await b.merge(pr, {
        method: rule.method,
        deleteSource,
        subject: pr.title,
        body: `Merged-by: bakers.build\nref:${run.identifier}`,
      });
      if (!(await b.isMerged(pr)))
        throw new Error(
          `PR/MR ${pr.url} does not report merged after the merge call`,
        );
      return json({
        url: pr.url,
        merged: true,
        into: base,
        method: rule.method,
        source_deleted: deleteSource,
        ...(dependents.length > 0
          ? { source_kept_for: dependents.map((p) => p.url) }
          : {}),
      });
    },

    forge_job_log: async (req) => {
      runOf(req);
      const jobId = req.args.job_id;
      if (typeof jobId !== 'number' || !Number.isInteger(jobId) || jobId <= 0)
        throw new Error('job_id must be a job_id from forge_checks');
      const asked = req.args.max_bytes;
      const maxBytes =
        typeof asked === 'number' && asked >= 1
          ? Math.min(Math.floor(asked), LOG_MAX_BYTES)
          : LOG_DEFAULT_BYTES;
      const log = await (await backend()).jobLog(jobId, maxBytes);
      return json({
        job_id: jobId,
        bytes: log.bytes,
        truncated: log.truncated,
        max_bytes: maxBytes,
        log: log.text,
      });
    },

    forge_issue_update: async (req) => {
      runOf(req);
      const op = req.args.operation;
      if (op === 'comment') {
        const body = req.args.body;
        if (typeof body !== 'string' || body.trim() === '')
          throw new Error('comment needs a non-blank body');
        const issueUrl = await originOf(req);
        return json(await (await backend()).commentIssue(issueUrl, body));
      }
      if (op === 'list_labels') {
        const issueUrl = await originOf(req);
        const labels = await (await backend()).issueLabels(issueUrl);
        return json({ issue_url: issueUrl, labels });
      }
      if (op !== 'update_labels')
        throw new Error(
          'operation must be list_labels, update_labels or comment',
        );
      const add = typeof req.args.add === 'string' ? req.args.add : '';
      const remove = (req.args.remove as string[] | undefined) ?? [];
      if (!add && remove.length === 0)
        throw new Error('update_labels needs add or remove');
      const issueUrl = await originOf(req);
      const b = await backend();
      // GitLab creates an unknown label it is sent: only listed names pass.
      const known = new Set((await b.issueLabels(issueUrl)).map((l) => l.name));
      const unknown = [add, ...remove].filter((n) => n && !known.has(n));
      if (unknown.length > 0)
        throw new Error(
          `update_labels sends only existing labels, spelled exactly; not found: ${unknown.join(', ')}; nothing was sent`,
        );
      const labels = await b.updateIssueLabels(issueUrl, {
        ...(add ? { add } : {}),
        remove,
      });
      return json({ issue_url: issueUrl, labels });
    },
  };
  return Object.fromEntries(
    Object.entries(tools).map(([n, h]) => [n, guarded(h)]),
  );
}

/** The live tools for the conductor's effective forge entry `with`. */
export function toolsFor(options: unknown): Record<string, ToolHandler> {
  const backend = (options as { backend?: { use?: unknown } } | undefined)
    ?.backend;
  // Fail closed: a forge entry without a backend stops the conductor's start.
  if (typeof backend?.use !== 'string' || backend.use === '')
    throw new Error(FORGE_NEEDS_BACKEND);
  let loaded: Promise<ForgeBackend> | undefined;
  return forgeTools({
    settings: options,
    backend: () => {
      loaded ??= loadForgeBackend(options, homeBbDir()).catch((err) => {
        loaded = undefined;
        throw err;
      });
      return loaded;
    },
  });
}
