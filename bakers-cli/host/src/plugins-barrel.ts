// BB-224 (Finding 6, decision 11): the `@bakers-build/bakers/plugins` BACK-COMPAT
// barrel. It used to be a single `export * from '@bakers-build/core/plugins'`; that
// core barrel is deleted, because core no longer ships plugin implementations.
// The barrel itself stays (published configs may still name
// `{ plugin: '@bakers-build/bakers/plugins', export: 'drupalRemote' }`), but it now
// aggregates the CONTRIBUTIONS from where they actually live: the impl addons +
// the conductor-surface selectors. "plugins" is the right word for a
// contribution barrel (decision 16) — only the *package* prefix became `addon-`.
//
// The fakes (`fakeRemote`/`fakeWorkspace`) are deliberately NOT re-exported:
// they moved into `@bakers-build/addon-fake`, a workspace-only test fixture that is
// never published, so the published meta package must not depend on it.
export { basicAuthProvider } from '@bakers-build/addon-auth-basic';
export { DrupalBbRemote, drupalRemote } from '@bakers-build/addon-remote-drupal';
export {
  GitWorkspace,
  gitWorkspace,
  loadInstructions,
} from '@bakers-build/addon-workspace-git';
export {
  type AgentCandidate,
  type ResolvedAgent,
  selectAgent,
  selectAgents,
  selectExecutor,
  selectRemote,
  selectWorkspace,
} from '@bakers-build/conductor/contract';
