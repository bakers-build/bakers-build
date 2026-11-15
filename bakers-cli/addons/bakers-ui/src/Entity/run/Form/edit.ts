export const CANCELLED_RUN_STATE = 'cancelled';

/**
 * The run states `cancel` leaves, mirroring `bb_run.transitions.cancel.from`
 * in `bb_core.workflows.yml` by hand.
 *
 * No served fact carries workflow transition edges, so widen this set together
 * with the YAML transition whenever its source states change.
 */
export const CANCELLABLE_RUN_STATES: ReadonlySet<string> = new Set([
  'claimed',
  'running',
]);

export interface CancelRunPayload {
  attributes: { state: typeof CANCELLED_RUN_STATE };
}

export const cancelRunPayload = (): CancelRunPayload => ({
  attributes: { state: CANCELLED_RUN_STATE },
});

export const isRunCancellable = (state: string): boolean =>
  CANCELLABLE_RUN_STATES.has(state);
