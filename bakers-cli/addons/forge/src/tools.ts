// The forge tools. Every call takes the ticket, branch_name and base_branch
// from the calling run; the token stays with the backend and is redacted
// from every result and error.

import type {
  ToolHandler,
  ToolRequest,
  ToolResult,
} from '@bakers-build/conductor/contract';
import { homeBbDir } from '@bakers-build/core';
import type { ForgeBackend, ForgeCheck } from './backend.js';
import {
  FORGE_NEEDS_BACKEND,
  loadForgeBackend,
  mergeRule,
  namedMergeRule,
} from './config.js';
import { fetchBranches, fetchedSecondParent, pushBranch } from './git.js';
import {
  derivedBase,
  isConventionalTitle,
  isOwned,
  ownershipRefusal,
  promotionRefusal,
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

export const PROMOTION_ARGS =
  'promote_to needs expected_sha (40 hex, the frozen release candidate) and takes no branch or ref: a promotion always merges base_branch';

interface Run {
  identifier: string;
  branchName: string;
  baseBranch: string;
  type: string | undefined;
}

/** base_branch into `target`, pinned to the frozen `expectedSha`. */
interface Promotion {
  target: string;
  expectedSha: string;
}

function runOf(req: ToolRequest): Run {
  const t = req.ticket;
  if (!t?.branchName || !t.baseBranch) throw new Error(FORGE_NEEDS_RUN);
  return {
    identifier: t.identifier,
    branchName: t.branchName,
    baseBranch: t.baseBranch,
    type: t.type,
  };
}

function ownedBranch(req: ToolRequest, run: Run): string {
  const branch = (req.args.branch as string | undefined) ?? run.branchName;
  if (!isOwned(branch, run.branchName))
    throw new Error(ownershipRefusal(branch, run.branchName));
  return branch;
}

const json = (value: unknown): ToolResult => ({
  text: JSON.stringify(value, null, 2),
});

/** Failure first, then pending, over the required checks. */
export function overall(checks: readonly ForgeCheck[]): ForgeCheck['status'] {
  const required = checks.filter((c) => c.required);
  if (required.some((c) => c.status === 'failure')) return 'failure';
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

  /**
   * The call's promotion, if `promote_to` is set. Every rule holds before it
   * returns, and before any forge write: a deployment ticket, a merge-method
   * rule for the target, and origin/<base_branch> still at expected_sha.
   */
  const promotion = async (
    req: ToolRequest,
    run: Run,
  ): Promise<Promotion | undefined> => {
    const { promote_to: target, expected_sha: expectedSha } = req.args;
    if (target === undefined) return undefined;
    if (
      typeof target !== 'string' ||
      typeof expectedSha !== 'string' ||
      !/^[0-9a-f]{40}$/.test(expectedSha) ||
      req.args.branch !== undefined ||
      req.args.ref !== undefined
    )
      throw new Error(PROMOTION_ARGS);
    const refusal = promotionRefusal({
      type: run.type,
      rule: namedMergeRule(deps.settings, target),
      target,
    });
    if (refusal) throw new Error(refusal);
    const b = await backend();
    const fetched = await fetchBranches(req.worktreePath, await b.gitAuth(), [
      run.baseBranch,
    ]);
    const at = fetched.find((r) => r.name === run.baseBranch)?.sha;
    if (at !== expectedSha)
      throw new Error(
        `origin/${run.baseBranch} is at ${at ?? 'nothing'}, not the expected_sha ${expectedSha}: ${run.baseBranch} moved since the freeze`,
      );
    return { target, expectedSha };
  };

  const tools: Record<string, ToolHandler> = {
    forge_fetch: async (req) => {
      const run = runOf(req);
      const extra = String(req.args.branches ?? '')
        .split(/\s+/)
        .filter(Boolean);
      const b = await backend();
      const refs = await fetchBranches(req.worktreePath, await b.gitAuth(), [
        run.baseBranch,
        run.branchName,
        ...extra,
      ]);
      return json({ fetched: refs });
    },

    forge_push: async (req) => {
      const run = runOf(req);
      const branch = ownedBranch(req, run);
      const b = await backend();
      const sha = await pushBranch(
        req.worktreePath,
        await b.gitAuth(),
        branch,
        {
          forceWithLease: req.args.force_with_lease === true,
          ...(typeof req.args.expected_sha === 'string'
            ? { expectedSha: req.args.expected_sha }
            : {}),
        },
      );
      return json({ branch, sha });
    },

    forge_pr_upsert: async (req) => {
      const title = String(req.args.title);
      // Refused before any request reaches the forge.
      if (!isConventionalTitle(title)) throw new Error(TITLE_REFUSAL);
      const run = runOf(req);
      const promo = await promotion(req, run);
      const branch = promo ? run.baseBranch : ownedBranch(req, run);
      const base = promo ? promo.target : derivedBase(branch, run);
      const body = (req.args.body as string | undefined) ?? '';
      const b = await backend();
      const open = await b.findOpenPr(branch);
      // Never retarget or rewrite another PR from base_branch.
      if (promo && open && open.base !== base)
        throw new Error(
          `PR/MR ${open.url} from '${branch}' targets '${open.base}', not '${base}'; close it first`,
        );
      const pr = open
        ? await b.updatePr(open, { title, body })
        : await b.createPr({ head: branch, base, title, body });
      return json({
        url: pr.url,
        number: pr.number,
        target: pr.base,
        created: !open,
      });
    },

    forge_checks: async (req) => {
      const run = runOf(req);
      const promo = await promotion(req, run);
      const b = await backend();
      let ref: string;
      let base = run.baseBranch;
      if (promo) {
        const pr = await b.findOpenPr(run.baseBranch);
        ref = pr?.headSha ?? promo.expectedSha;
        base = promo.target;
      } else if (
        typeof req.args.ref === 'string' &&
        req.args.branch === undefined
      ) {
        ref = req.args.ref;
      } else {
        const branch = ownedBranch(req, run);
        const pr = await b.findOpenPr(branch);
        ref = pr?.headSha ?? branch;
        base = pr?.base ?? derivedBase(branch, run);
      }
      const checks = await b.checks(ref, base);
      return json({ ref, base, overall: overall(checks), checks });
    },

    forge_merge: async (req) => {
      const run = runOf(req);
      const promo = await promotion(req, run);
      const branch = promo ? run.baseBranch : ownedBranch(req, run);
      const base = promo ? promo.target : derivedBase(branch, run);
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
      if (promo && pr.headSha !== promo.expectedSha)
        throw new Error(
          `PR/MR ${pr.url} head is ${pr.headSha}, not the expected_sha ${promo.expectedSha}`,
        );
      const blocker = await b.mergeBlocker(pr);
      if (blocker) throw new Error(`PR/MR ${pr.url} cannot merge: ${blocker}`);
      const checks = await b.checks(pr.headSha, pr.base);
      const notGreen = checks.filter(
        (c) => c.required && c.status !== 'success',
      );
      if (notGreen.length > 0)
        throw new Error(
          `PR/MR ${pr.url} has required checks that are not green: ${notGreen.map((c) => `${c.name} (${c.status})`).join(', ')}`,
        );
      const rule = mergeRule(deps.settings, base);
      // A promotion never deletes base_branch.
      const dependents = promo
        ? []
        : (await b.openPrsWithBase(branch)).filter(
            (p) => p.number !== pr.number,
          );
      const deleteSource =
        !promo && rule.delete_source && dependents.length === 0;
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
      let secondParent: string | undefined;
      if (promo) {
        await fetchBranches(req.worktreePath, await b.gitAuth(), [base]);
        secondParent = await fetchedSecondParent(req.worktreePath, base);
        if (secondParent !== promo.expectedSha)
          throw new Error(
            `PR/MR ${pr.url} merged, but ${base}^2 is ${secondParent ?? 'missing'}, not the expected_sha ${promo.expectedSha}; check ${base} by hand`,
          );
      }
      return json({
        url: pr.url,
        merged: true,
        into: base,
        method: rule.method,
        source_deleted: deleteSource,
        ...(dependents.length > 0
          ? { source_kept_for: dependents.map((p) => p.url) }
          : {}),
        ...(promo ? { promoted: true, second_parent: secondParent } : {}),
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
