export const CANCELLED_RUN_STATE = 'cancelled';

/**
 * Whether a run offers Cancel run: claimed or running, or failed as its
 * ticket's newest run. The site decides whether the cancel is allowed.
 */
export const offersCancelRun = (state: string, newest: boolean): boolean =>
  state === 'claimed' || state === 'running' || (state === 'failed' && newest);
