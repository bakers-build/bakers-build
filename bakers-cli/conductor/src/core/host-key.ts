/**
 * Host stem for `bb_machine.host_key` — the one entity that carries the
 * field. `bb_conductor` has none, and reading one off it is precisely what
 * left the host gate with no input at all (BB-450 review B7). It is the
 * machine UUID from `machine.config.js`; empty until `bakers init` wrote it.
 *
 * Shared by the `Conductor` registration payload and the lifecycle commands
 * (`stop`/`start`), so both agree on "this machine's" host_key — the input
 * `signalVerifiedProcess()` compares a record's `host_key` against (BB-450
 * AC-4). Two callers computing this independently is exactly how a gate can
 * end up with no input on one side and a different answer on the other.
 */
export function hostKeyOf(config: { host_key?: string }): string {
  return config.host_key?.trim() ?? '';
}
