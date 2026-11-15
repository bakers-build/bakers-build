import type { ConfirmRequest } from '../../../Screen/confirm-dialog.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import type { TicketDetailDocument } from '../../../types.js';
import { runResource } from '../Component/run-detail/index.js';
import { CANCELLED_RUN_STATE, cancelRunPayload } from '../Form/edit.js';

/** What a run cancellation hands back to the screen that asked for it. */
export interface RunCancelledResult {
  readonly type: 'run-cancelled';
  readonly runId: string;
  readonly document: TicketDetailDocument;
}

/** `#<number>` of a run in `document`, or `''` when it is not included. */
export const runNumber = (
  document: TicketDetailDocument,
  runId: string,
): string => {
  const run = runResource(document, runId);
  return run
    ? ` #${String(run.attributes?.drupal_internal__id ?? run.id)}`
    : '';
};

/**
 * PATCH the run to cancelled and return `document` with that run's state
 * patched, so the caller repaints without a refetch.
 */
export const cancelRun = async (
  context: ScreenContext,
  document: TicketDetailDocument,
  runId: string,
): Promise<RunCancelledResult> => {
  const client = context.services?.writeClient ?? context.services?.client;
  if (!client) throw new Error('No connection to cancel the run.');
  await client.update('bb_run--bb_run', runId, cancelRunPayload());
  return {
    type: 'run-cancelled',
    runId,
    document: {
      ...document,
      ...(document.included
        ? {
            included: document.included.map((resource) =>
              resource.id === runId
                ? {
                    ...resource,
                    attributes: {
                      ...resource.attributes,
                      state: CANCELLED_RUN_STATE,
                    },
                  }
                : resource,
            ),
          }
        : {}),
    },
  };
};

/** Cancel run, for the confirmation dialog. */
export const cancelRunRequest = (
  document: TicketDetailDocument,
  runId: string,
): ConfirmRequest => ({
  title: '✕ Cancel run',
  prepare: () =>
    Promise.resolve({
      message: `Cancel run${runNumber(document, runId)}?`,
      detail: 'This marks the run as cancelled.',
      confirm: (context) => cancelRun(context, document, runId),
    }),
});
