import {
  defaultRootGitExec,
  deriveCheckoutRoot,
  type RootGitExec,
} from '@bakers-build/core';

export type { RootGitExec };
export { defaultRootGitExec };

/**
 * herdr's own name for the shared checkout-root anchor (BB-177), kept as a
 * thin alias so `index.ts` and `workspace.ts` need no rename. The behaviour —
 * including the injected git-exec seam — now lives in `@bakers-build/core` as
 * `deriveCheckoutRoot()` (BB-450 D2): two other call sites
 * (`@bakers-build/conductor`'s `checkoutRootOf()` and `addon-workspace-git`'s
 * `gitWorkspace` fallback) needed the same derivation and neither may import
 * this addon, so the helper moved to the kernel rather than staying herdr-owned.
 */
export const deriveHerdrRoot = deriveCheckoutRoot;
