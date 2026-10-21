import bakersUiPlugin from './plugin.js';

// The dropsh `tui` renderer plugin factory (default export) — the conductor's
// plugin resolver auto-picks the default.
export default bakersUiPlugin;
export type { BbUiOptions } from './plugin.js';

// Back-compat alias for the former package's named export.
export const ticketRendererPlugin = bakersUiPlugin;

// BB-194 AC-4/AC-5: the home-rooted launcher (dropsh-tui invocation moved out
// of the conductor `bakers ui` command). herdr-agnostic (agent impl injected) and
// dropsh-decoupled (buildProgram injected).
export {
  type DropshBuildProgram,
  type DropshProgram,
  type BbUiLauncherOptions,
  type HomeConnection,
  runBbUi,
} from './launcher.js';

// Re-export the intent-level agent contract so the conductor launcher can inject
// a herdr-backed agent host against it without importing herdr into this plugin.
export type { HostedAgent, TuiAgentService } from './types.js';
