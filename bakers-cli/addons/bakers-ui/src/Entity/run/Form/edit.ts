import { declareForm } from '../../../Form/index.js';

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

export const CANCEL_RUN_ACTION_ID = 'cancelRun';
export type RunEditFieldId = typeof CANCEL_RUN_ACTION_ID;

export interface CancelRunPayload {
  attributes: { state: typeof CANCELLED_RUN_STATE };
}

export const cancelRunPayload = (): CancelRunPayload => ({
  attributes: { state: CANCELLED_RUN_STATE },
});

const EDIT_FORM = declareForm<
  Record<string, never>,
  Record<string, never>,
  CancelRunPayload
>({
  fields: (f) => [f.action('Cancel run', CANCEL_RUN_ACTION_ID)],
  toObject: () => cancelRunPayload(),
});

export type EditRunFormDeclaration = typeof EDIT_FORM;

export const isRunCancellable = (state: string): boolean =>
  CANCELLABLE_RUN_STATES.has(state);

export const editRunFormFor = (
  runState: string,
): EditRunFormDeclaration | undefined =>
  isRunCancellable(runState) ? EDIT_FORM : undefined;
