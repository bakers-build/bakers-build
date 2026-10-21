// The ticket's addon messages (BB-661): one entry per addon of the
// ticket's conductor in an addon bar (←/→), the selected addon's permitted
// messages as one list, Enter to send through the conductor inbox, and a
// modal form for a message with input. Definitions and states come from the
// server, so this tab needs no addon installed locally. Contract 1
// (views/actions/rows) is retired; only contract-2 messages render here.

import type { VNode } from '@opentui/core';
import {
  type ActionItem,
  actionItem,
} from '../../../Component/footer-actions/index.js';
import { Markdown, markdownLines } from '../../../Component/markdown/index.js';
import { flattenSections } from '../../../Component/section-list/index.js';
import { copyThrough } from '../../../lib/clipboard.js';
import { ListCursor } from '../../../lib/cursor.js';
import { columnNode, messageTree } from '../../../lib/vnode.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncModalScreen } from '../../../Screen/async-modal-screen.js';
import { AsyncScreen } from '../../../Screen/async-screen.js';
import type { FullScreenChrome } from '../../../Screen/full-screen.js';
import type { ModalChrome } from '../../../Screen/modal-screen.js';
import { runRowAction } from '../../../Screen/row-action.js';
import type { ScreenAction, ScreenContext } from '../../../Screen/screen.js';
import type { TicketDetailDocument } from '../../../types.js';
import {
  FIELDS_REGION,
  renderDeclaredFieldsTree,
} from '../../../Widget/render.js';
import {
  type ListColumn,
  type ListTable,
  listRowIds,
  listTableRows,
  listTableTree,
} from '../../collection.js';
import {
  ticketEditAction,
  ticketHeaderTree,
  ticketTitleOf,
} from '../Component/ticket-detail/index.js';
import {
  type AddonEntry,
  addonEntries,
  isOpen,
  readTicketAddons,
  sendAddonAction,
  type TicketAddon,
  type TicketAddons,
} from '../Data/addons.js';
import { ticketInputContext } from '../Data/input.js';
import { readTicket } from '../Data/store.js';
import {
  type AddonForm,
  type AddonFormValues,
  addonForm,
  formFields,
  payloadFrom,
} from '../Form/addon-action.js';
import { keyToIntent } from '../Form/keys.js';

/** Re-read cadence while a message of the shown addon is pending/running. */
const OPEN_POLL_MS = 3_000;

interface AddonsData {
  ticket: TicketDetailDocument;
  model: TicketAddons;
}

/** What the message form needs; passed as navigation state. */
export interface AddonFormState {
  ticketUuid: string;
  addon: string;
  key: string;
  label: string;
  input: NonNullable<TicketAddon['messages'][number]['input']>;
}

type Line = { id: string; cells: string[] };

function ticketUuidOf(context: ScreenContext, ticket?: TicketDetailDocument) {
  return ticket?.data?.id ?? context.params?.ticketId ?? '';
}

/** The table of one addon: label and an Enter-to-run hint per message. */
function tableFor(): ListTable<Line> {
  const columns: ListColumn<Line>[] = [
    {
      fields: [],
      key: 'c0',
      label: 'LABEL',
      width: 28,
      get: (l) => l.cells[0] ?? '',
    },
    {
      fields: [],
      key: 'actions',
      label: 'ACTIONS',
      width: 0,
      get: (l) => l.cells[1] ?? '',
    },
  ];
  return {
    noun: 'addon',
    columns,
    emptyMessage: 'No data yet.',
  };
}

function linesFor(entries: AddonEntry[]): Line[] {
  return entries.map((entry) => ({
    id: entry.id,
    cells: [
      `▶ ${entry.message.label}`,
      entry.message.input ? 'Enter: form' : 'Enter: send',
    ],
  }));
}

/** The addon bar: every addon, the selected one in brackets. */
function addonBar(model: TicketAddons, selected: number): string {
  return model.addons
    .map((a, i) => (i === selected ? `[${a.label}]` : a.label))
    .join('  ');
}

/** The newest message of the addon, as one status line. */
function latestLine(addon: TicketAddon): string | undefined {
  const latest = addon.latest;
  if (!latest) return undefined;
  return `${latest.label}: ${latest.status}`;
}

/** The latest answer's Markdown body. */
function latestMarkdown(addon: TicketAddon): string | undefined {
  return addon.latest?.result?.markdown;
}

/** The first safe http(s) link a Markdown answer carries, if any (`l` key). */
function firstHttpLink(markdown: string): string | undefined {
  // Prefer the URL inside markdown link syntax `[text](url)` first: a bare
  // `\S+` scan greedily swallows the closing `)` and any wrapping brackets
  // of a real `[443](https://host:443)` answer (BB-661).
  return (
    markdown.match(/\]\((https?:[^)\s]+)\)/)?.[1] ??
    markdown.match(/\bhttps?:\/\/\S+/)?.[0]?.replace(/[)\]."'`]+$/, '')
  );
}

export class TicketAddonsScreen extends AsyncScreen<AddonsData> {
  // No `tab` here (BB-661): this screen is the full send/poll surface, kept
  // navigable from the Overview sidebar's inline card, never a tab a person
  // sees — the tab bar never shows the word "addon".
  static readonly route = {
    id: 'ticket.addons',
    path: '/tickets/:ticketId/addons',
    parent: 'project.tickets',
    fallback: { routeId: 'my.work' },
    context: ticketInputContext,
  } satisfies RouteMetadata;
  readonly id = TicketAddonsScreen.route.id;
  readonly frameId = 'ticket';
  private readonly cursor = new ListCursor();
  private selected = 0;
  private sending = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;

  protected async load(context: ScreenContext): Promise<AddonsData> {
    const ticket = readTicket(context, this.readyValue?.ticket);
    const client = context.services?.client;
    // No control plane (a bare pipe): nothing to show rather than an error.
    if (!client) return { ticket, model: { conductor: null, addons: [] } };
    return {
      ticket,
      model: await readTicketAddons(client, ticketUuidOf(context, ticket)),
    };
  }
  protected override didLoad(data: AddonsData, context: ScreenContext): void {
    this.selected = Math.min(
      this.selected,
      Math.max(0, data.model.addons.length - 1),
    );
    this.clampCursor();
    this.schedulePoll(context);
  }
  reload(context: ScreenContext): void {
    void this.retry(context);
  }
  override leave(): void {
    this.stopPoll();
    super.leave();
  }
  override reset(): void {
    this.stopPoll();
    super.reset();
    this.cursor.reset();
    this.selected = 0;
    this.sending = new Set();
    this.toast = '';
  }

  /** Re-read every 3 s while the shown addon has an open message. */
  private schedulePoll(context: ScreenContext): void {
    const addon = this.addon();
    if (!addon || !isOpen(addon)) {
      this.stopPoll();
      return;
    }
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (context.isActive()) this.reload(context);
    }, OPEN_POLL_MS);
    this.timer.unref?.();
  }
  private stopPoll(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private addon(): TicketAddon | undefined {
    return this.readyValue?.model.addons[this.selected];
  }
  private entries(): AddonEntry[] {
    const addon = this.addon();
    return addon ? addonEntries(addon) : [];
  }
  private clampCursor(): void {
    this.cursor.index = Math.max(
      0,
      Math.min(this.cursor.index, this.entries().length - 1),
    );
  }

  protected renderLoading(): string[] {
    return ['Loading addons…'];
  }
  private lines(): { table: ListTable<Line>; lines: Line[] } | undefined {
    const addon = this.addon();
    if (!addon) return undefined;
    const entries = this.entries();
    const table = tableFor();
    const lines = linesFor(entries).map((line) =>
      this.sending.has(line.id)
        ? { ...line, cells: [...line.cells.slice(0, -1), 'sending …'] }
        : line,
    );
    return { table, lines };
  }
  protected renderReady(data: AddonsData, context: ScreenContext): VNode {
    const view = this.lines();
    if (!view) return messageTree('addons', ['No addons for this ticket.']);
    const addon = this.addon();
    const markdown = addon ? latestMarkdown(addon) : undefined;
    const children = [
      messageTree('addons-bar', [addonBar(data.model, this.selected)]),
      listTableTree(view.table, view.lines, undefined, {
        selectedIndex: this.cursor.index,
      }),
    ];
    if (markdown) {
      children.push(
        Markdown({
          id: 'addons-answer',
          width: Math.max(16, (context.terminalColumns ?? 80) - 12),
          source: markdown,
        }),
      );
    }
    return columnNode('addons', ...children);
  }
  renderNonInteractive(context: ScreenContext): string[] {
    const notice = this.noticeRows(context);
    if (notice) return notice;
    const data = this.readyValue;
    const view = this.lines();
    // A ticket report prints every tab; one without addons adds nothing.
    if (!data || !view) return [];
    const addon = this.addon();
    const markdown = addon ? latestMarkdown(addon) : undefined;
    return flattenSections([
      {
        heading: addonBar(data.model, this.selected),
        lines: [
          ...listTableRows(view.table, view.lines, undefined),
          ...(markdown ? markdownLines(markdown).map((l) => l.text) : []),
        ],
      },
    ]).lines;
  }
  protected chrome(context: ScreenContext): FullScreenChrome {
    const ticket = this.readyValue?.ticket;
    const { identifier, title } = ticketTitleOf(ticket ?? {});
    const view = this.lines();
    const count = view?.lines.length ?? 0;
    return {
      title: ticket?.data
        ? `${identifier} · ${title}`
        : (context.params?.ticketId ?? 'ticket'),
      ...(ticket?.data
        ? { header: ticketHeaderTree(ticket, identifier, title, []) }
        : {}),
      selectable: count,
      selectedIndex: this.cursor.index,
      cursorMode: count > 1 ? 'select' : 'scroll',
      ...(view ? { rowIds: listRowIds(view.table, view.lines) } : {}),
    };
  }
  protected actions(): readonly ActionItem[] {
    const many = (this.readyValue?.model.addons.length ?? 0) > 1;
    return [
      actionItem('detail-tab', 'Tab', 'section'),
      actionItem('detail-edit', 'e', 'edit'),
      ...(many ? [actionItem('addons-switch', '←→', 'addon')] : []),
      actionItem('detail-arrows', '↑↓', 'select'),
      actionItem('addons-enter', 'Enter', 'run'),
      actionItem('addons-link', 'l', 'copy link'),
    ];
  }
  protected override notice(): string | undefined {
    const addon = this.addon();
    const offline = this.readyValue?.model.conductor?.status === 'offline';
    return (
      [
        offline
          ? 'Conductor offline — messages are queued until it returns'
          : '',
        addon && addon.contract !== 2
          ? `Addon contract ${addon.contract} is not supported`
          : '',
        addon
          ? (latestLine(addon) ?? 'You have not sent a message to this addon.')
          : '',
      ]
        .filter(Boolean)
        .join(' · ') || undefined
    );
  }

  select(index: number, context: ScreenContext): boolean {
    const next = Math.max(0, Math.min(index, this.entries().length - 1));
    if (next === this.cursor.index) return false;
    this.cursor.index = next;
    context.requestDraw();
    return true;
  }
  activate(index: number, context: ScreenContext): boolean {
    return this.run(index, context);
  }

  /** Runs an entry's message: sends it, or opens its form. */
  private run(index: number, context: ScreenContext): boolean {
    const entry = this.entries()[index];
    const addon = this.addon();
    const data = this.readyValue;
    if (!entry || !addon || !data) return false;
    const ticketUuid = ticketUuidOf(context, data.ticket);
    const { message } = entry;
    if (message.input) {
      const state: AddonFormState = {
        ticketUuid,
        addon: addon.name,
        key: message.key,
        label: message.label,
        input: message.input,
      };
      context.navigate?.(
        'ticket.addons.action',
        { ticketId: context.params?.ticketId ?? ticketUuid },
        state,
      );
      return true;
    }
    const client = context.services?.client;
    if (!client) return false;
    runRowAction({
      rowId: entry.id,
      busy: this.sending,
      context,
      perform: async () => {
        await sendAddonAction(
          client,
          ticketUuid,
          `${addon.name}.${message.key}`,
          {},
        );
        return { message: `${message.label} sent` };
      },
      refresh: (ctx) => this.retry(ctx),
      setStatus: (status) => {
        this.toast = status;
      },
      captureLifecycle: () => this.captureLifecycle(context),
      lifecycleIsCurrent: (guard, ctx) => this.lifecycleIsCurrent(guard, ctx),
      statusIsCurrent: (guard, ctx) => this.actionStillCurrent(guard, ctx),
      failPrefix: `${addon.name}.${message.key} failed`,
    });
    return true;
  }

  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    const data = this.readyValue;
    if (this.state !== 'ready' || !data) return false;
    const count = data.model.addons.length;
    if ((input === 'left' || input === 'right') && count > 1) {
      this.selected =
        (this.selected + (input === 'right' ? 1 : -1) + count) % count;
      this.cursor.reset();
      this.schedulePoll(context);
      context.requestDraw();
      return true;
    }
    if (input === 'enter' || input === ' ')
      return this.run(this.cursor.index, context);
    if (input === 'l') {
      const addon = this.addon();
      const markdown = addon ? latestMarkdown(addon) : undefined;
      const href = markdown ? firstHttpLink(markdown) : undefined;
      this.toast = copyThrough(
        context.copyToClipboard,
        href,
        href ?? '',
        'no link in the latest answer',
      );
      context.requestDraw();
      return true;
    }
    const entries = this.entries().length;
    if (entries > 1) {
      const before = this.cursor.index;
      if (this.cursor.handle(input, entries) && this.cursor.index !== before) {
        context.requestDraw();
        return true;
      }
    }
    return false;
  }
  commandForInput(input: string): string | undefined {
    return this.state === 'ready' && input === 'e'
      ? 'edit-assignment'
      : undefined;
  }
  actionForInput(
    input: string,
    context: ScreenContext,
  ): ScreenAction | undefined {
    return this.commandForInput(input)
      ? ticketEditAction(context, this.readyValue?.ticket)
      : undefined;
  }
  receiveResult(result: unknown, context: ScreenContext): void {
    const returned = result as { type?: string; message?: string };
    if (returned?.type === 'addon-action-sent') {
      this.toast = returned.message ?? '';
      this.reload(context);
    }
  }
}

type FormOptions = Record<string, { id: string; label: string }[]>;

/** The form of an action with input, built from its input subset. */
export class AddonActionFormScreen extends AsyncModalScreen<FormOptions> {
  static readonly route = {
    id: 'ticket.addons.action',
    path: '/tickets/:ticketId/addons/action',
    parent: 'ticket.addons',
    presentation: 'modal',
  } satisfies RouteMetadata;
  readonly id = AddonActionFormScreen.route.id;
  private target: AddonFormState | undefined;
  private form: AddonForm | undefined;
  private values: ReturnType<AddonForm['initial']> | undefined;
  private errors: Record<string, string> = {};
  private sending = false;

  protected async load(context: ScreenContext): Promise<FormOptions> {
    const target = context.navigationState as AddonFormState | undefined;
    if (!target?.input) throw new Error('No addon action to fill in');
    this.target = target;
    this.form = addonForm(target.input);
    const options: FormOptions = {};
    for (const field of formFields(target.input))
      if (field.options) options[field.id] = field.options;
    return options;
  }
  protected override didLoad(options: FormOptions): void {
    if (!this.form || !this.target) return;
    const prefill: AddonFormValues = {};
    for (const [id, field] of Object.entries(this.target.input.properties)) {
      if (field.type === 'boolean')
        prefill[id] = field.default === true ? 'yes' : 'no';
      else if (field.default !== undefined) prefill[id] = String(field.default);
    }
    this.values = this.form.initial(options, prefill);
  }
  protected renderLoading(): string[] {
    return ['Loading…'];
  }
  protected renderReady(options: FormOptions): VNode {
    if (!this.form || !this.values) return columnNode(FIELDS_REGION);
    return renderDeclaredFieldsTree(this.form.fields, this.values, options, {
      width: 58,
      errorFor: (field) => this.errors[field.id],
    });
  }
  protected modalChrome(): ModalChrome {
    return { title: this.target?.label ?? 'Addon action' };
  }
  protected override actions(): readonly ActionItem[] {
    return [
      actionItem('addon-form-field', '↑↓', 'field'),
      actionItem('addon-form-send', 'Ctrl+S', 'send'),
      actionItem('addon-form-esc', 'Esc', 'cancel'),
    ];
  }
  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    const options = this.readyValue;
    if (!options || !this.form || !this.values) return false;
    const intent = keyToIntent(input, this.form.activeField(this.values));
    if (!intent) return true;
    if (intent.kind === 'cancel') {
      context.back?.();
      return true;
    }
    if (intent.kind === 'submit') {
      void this.submit(context);
      return true;
    }
    this.values = this.form.apply(this.values, options, intent);
    context.requestDraw();
    return true;
  }
  private async submit(context: ScreenContext): Promise<void> {
    const target = this.target;
    const client = context.services?.client;
    if (!target || !client || !this.values || this.sending) return;
    const outcome = payloadFrom(target.input, this.values);
    if ('errors' in outcome) {
      this.errors = outcome.errors;
      context.requestDraw();
      return;
    }
    this.errors = {};
    this.sending = true;
    try {
      await sendAddonAction(
        client,
        target.ticketUuid,
        `${target.addon}.${target.key}`,
        outcome.payload,
      );
      context.back?.({
        type: 'addon-action-sent',
        message: `${target.label} sent`,
      });
    } catch (error) {
      this.toast = error instanceof Error ? error.message : String(error);
      context.requestDraw();
    } finally {
      this.sending = false;
    }
  }
  protected override notice(): string | undefined {
    return this.toast || undefined;
  }
  override reset(): void {
    this.target = undefined;
    this.form = undefined;
    this.values = undefined;
    this.errors = {};
    this.sending = false;
    super.reset();
  }
}
