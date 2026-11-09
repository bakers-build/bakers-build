import type { VNode } from '@opentui/core';
import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { actionItem } from '../../../Component/footer-actions/index.js';
import { defineContext } from '../../../Routing/context.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ScreenAction, ScreenContext } from '../../../Screen/screen.js';
import type { TicketDetailDocument } from '../../../types.js';
import {
  runDetailRows,
  runDetailTitle,
  runDetailTree,
  runResource,
} from '../Component/run-detail/index.js';
import { isRunCancellable } from '../Form/edit.js';

export interface RunDetailInput {
  readonly document: TicketDetailDocument;
}

export const runDetailInputContext = defineContext<RunDetailInput>(
  'run-detail-input',
  'input',
);

/**
 * Run detail — normal {@link AsyncScreen}. The document arrives via navigation
 * context (or empty); refresh is the shared R / ui-refresh path, which refetches
 * the ticket with its runs so a new run state shows.
 */
export class RunDetailScreen extends AsyncScreen<TicketDetailDocument> {
  readonly frameId = 'run';
  static readonly route = {
    id: 'run.detail',
    path: '/tickets/:ticketId/runs/:runId',
    parent: 'ticket.detail',
    fallback: { routeId: 'my.work' },
    context: (_params, state, base) =>
      state
        ? base.set(runDetailInputContext, {
            document: state as TicketDetailDocument,
          })
        : base,
  } satisfies RouteMetadata;
  readonly id = RunDetailScreen.route.id;
  private editable = false;
  /**
   * A `run-cancelled` result received here (BB-536) is re-armed as this
   * screen's own `back` result, so the ticket's Runs tab — the *next* screen
   * up, not the immediate parent `router.back()` delivers to — also repaints.
   * `router.back()` on a bare Esc carries no result on its own.
   */
  private forwardResult: ScreenAction | undefined;
  /** Set by {@link reload}: the next load asks the server, not the snapshot. */
  private refetch = false;

  reload(context: ScreenContext): void {
    this.refetch = true;
    this.retry(context);
  }

  protected load(context: ScreenContext): Promise<TicketDetailDocument> {
    const id = context.params?.ticketId;
    if (this.refetch && context.services && id) {
      this.refetch = false;
      // Fetched here, not through the ticket slice's store: ticket imports run.
      return context.services.client.get(
        `bb_ticket/bb_ticket/${id}`,
        new DrupalJsonApiParams().addInclude(['runs']),
      ) as Promise<TicketDetailDocument>;
    }
    if (context.contexts?.has(runDetailInputContext))
      return Promise.resolve(
        context.contexts.get(runDetailInputContext).document,
      );
    return Promise.resolve({});
  }

  protected renderLoading(): string[] {
    return ['Loading run…'];
  }

  protected renderReady(
    document: TicketDetailDocument,
    context: ScreenContext,
  ): VNode {
    return runDetailTree(
      document,
      context.params?.runId ?? '',
      context.services?.baseUrl,
    );
  }

  protected chrome(context: ScreenContext): FullScreenChrome {
    return {
      title: runDetailTitle(this.readyValue ?? {}, context.params?.runId ?? ''),
    };
  }

  protected override didLoad(
    document: TicketDetailDocument,
    context: ScreenContext,
  ): void {
    const run = runResource(document, context.params?.runId);
    this.editable =
      !!run && isRunCancellable(String(run.attributes?.state ?? ''));
  }

  protected actions() {
    return this.editable ? [actionItem('run-edit', 'e', 'edit')] : [];
  }

  commandForInput(input: string): string | undefined {
    return input === 'e' && this.editable ? 'edit-run' : undefined;
  }

  receiveResult(result: unknown, context: ScreenContext): void {
    if (
      result &&
      typeof result === 'object' &&
      (result as { type?: unknown }).type === 'run-cancelled'
    ) {
      const document = (result as { document?: TicketDetailDocument }).document;
      if (document) this.replaceReady(document);
      this.editable = false;
      this.forwardResult = { type: 'back', result };
      context.requestDraw();
    }
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (input === 'escape' && this.forwardResult) return true;
    return super.handleInput(input, context);
  }

  takeAction(): ScreenAction | undefined {
    const action = this.forwardResult;
    this.forwardResult = undefined;
    return action;
  }

  actionForInput(input: string, context: ScreenContext) {
    if (this.commandForInput(input) !== 'edit-run' || !context.navigate)
      return undefined;
    return {
      type: 'navigate' as const,
      routeId: 'run.edit',
      params: {
        ticketId: context.params?.ticketId ?? '',
        runId: context.params?.runId ?? '',
      },
      result: this.readyValue,
    };
  }

  /**
   * F5 — the pipe's own output, and it is `string[]`.
   *
   * The run is handled exactly like every other entity (the operator's ruling
   * after plan Task 10): `ticket.detail` and the project picker
   * have always printed their own plain text into a pipe, and this screen was
   * the only entity detail falling through to the tree→text path instead. That
   * path lays the body out on a cell grid of a fixed width, and a pipe has no
   * width — on run #4928 it clipped 420 transcript rows at 80 columns, losing
   * 97.7 % of a 1.34 MB captured agent transcript.
   */
  renderNonInteractive(context: ScreenContext): string[] {
    return runDetailRows(
      this.readyValue ?? {},
      context.params?.runId ?? '',
      context.services?.baseUrl,
    );
  }
}
