// BB-201 / BB-219: `@bakers-build/ui` — the `bakers ui` command plugin. Its
// connection is resolved by core's `loadBbConfig` (explicit → project
// walk-up → home → shipped fallback), so running it inside a project uses that
// project's control plane; this package owns no precedence rule of its own.
// The default export is the `BbCommandPlugin` the host mounts; `cmdUi` + the
// bootstrap helpers are exported for tests.

// BB-223: the deep-link grammar (the pure CLI seam).
export {
  type HereContext,
  isTicketIdentifier,
  isUuid,
  normalizeRepoUrl,
  type ParsedTarget,
  parseTarget,
  parseTicketIdentifierFromBranch,
  resolveHere,
  type TargetInputs,
  UI_VIEW_MODES,
  type UiInitialRoute,
  type UiViewMode,
} from './route.js';
export { cmdUi, default, type RunBbUiOptions, type UiDeps } from './ui.js';
export {
  type HomeConnection,
  type ProjectRooting,
  resolveProjectRooting,
} from './ui-home.js';
