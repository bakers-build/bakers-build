/**
 * Host stem for `bb_machine.host_key` — the one entity that carries the
 * field. `bb_conductor` has none, and reading one off it is precisely what
 * left the host gate with no input at all (BB-450 review B7). Prefer
 * `config.host_key` from MachineContext.machine_id; fall back to a
 * best-effort parse of the composed `conductor_id` only when the loader could
 * not supply the stem.
 *
 * Shared by the `Conductor` registration payload and the lifecycle commands
 * (`stop`/`start`), so both agree on "this machine's" host_key — the input
 * `signalVerifiedProcess()` compares a record's `host_key` against (BB-450
 * AC-4). Two callers computing this independently is exactly how a gate can
 * end up with no input on one side and a different answer on the other.
 */
export function hostKeyOf(config: {
  host_key?: string;
  conductor_id?: string;
  machine_id?: string;
}): string {
  const fromConfig = config.host_key?.trim();
  if (fromConfig) return fromConfig;
  const id = config.conductor_id ?? config.machine_id ?? '';
  const parts = id.split('-');
  if (parts.length >= 3 && parts[0] && parts[1]) {
    const middle = parts.slice(1, -1).join('-');
    if (middle) return middle;
  }
  return id;
}
