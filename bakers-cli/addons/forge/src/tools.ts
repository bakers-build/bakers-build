// The forge tools. Every call takes the ticket, branch_name and base_branch
// from the calling run; the token stays with the backend and is redacted
// from every result and error.

import type {
  ToolHandler,
  ToolRequest,
  ToolResult,
} from '@bakers-build/conductor/contract';
import {
  homeBbDir,
  loadRunClone,
  refreshRunTarget,
  saveRunClone,
  transferIsolatedCommit,
} from '@bakers-build/core';
import type { ForgeBackend, ForgeCheck } from './backend.js';
import { FORGE_NEEDS_BACKEND, loadForgeBackend, mergeRule } from './config.js';
import { fetchBranches, pushBranch } from './git.js';
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

function ownedBranch(req: ToolRequest, run: Run): string {
  const branch = (req.args.branch as string | undefined) ?? run.branchName;
  if (!isOwned(branch, run.branchName))
    throw new Error(ownershipRefusal(branch, run.branchName));
  return branch;
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
      if (clone && branch === clone.branch)
        saveRunClone({ ...clone, expected: transferIsolatedCommit(clone) });
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

    forge_pr_upsert: async (req) => {
      const title = String(req.args.title);
      // Refused before any request reaches the forge.
      if (!isConventionalTitle(title)) throw new Error(TITLE_REFUSAL);
      const run = runOf(req);
      const branch = ownedBranch(req, run);
      const body = (req.args.body as string | undefined) ?? '';
      const b = await backend();
      const open = await b.findOpenPr(branch);
      const pr = open
        ? await b.updatePr(open, { title, body })
        : await b.createPr({
            head: branch,
            base: derivedBase(branch, run),
            title,
            body,
          });
      return json({
        url: pr.url,
        number: pr.number,
        target: pr.base,
        created: !open,
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
      const base = derivedBase(branch, run);
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
