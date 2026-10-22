// The ticket-detail screen: composes section-list (keyed rows), Component/markdown
// (the rendered `bb_rich` bodies — BB-372 D1/D11; this comment used to say
// "markdown bold", which was the whole of the rule before that ticket, and it named
// `lib/markdown` until D11 moved the rendering shell into its own component),
// sections (TICKET_SECTIONS) and comment-item (the collapsible Comments tab) into
// the two shapes the screen consumes — the whole document flattened
// (`detailLines`, the non-TTY render spec F5 leaves as text) and one tab at a
// time as a renderable tree (`tabViewTree`, the interactive screen).

import type { VNode } from '@opentui/core';
import {
  type ActionItem,
  actionItem,
} from '../../../../Component/footer-actions/index.js';
import {
  markdownLines,
  plainLine,
} from '../../../../Component/markdown/index.js';
import type {
  ExpandableView,
  Section,
  SectionLine,
  SectionRow,
} from '../../../../Component/section-list/index.js';
import {
  expandableRows,
  flattenSections,
  panelSectionKey,
  sectionKey,
  sectionRowNode,
  sectionRows,
  styledOf,
} from '../../../../Component/section-list/index.js';
import { copyThrough } from '../../../../lib/clipboard.js';
import { asString, formatDuration } from '../../../../lib/format.js';
import {
  type BORDER,
  columnNode,
  DEFAULT_FOREGROUND,
  FOREGROUND_HIGHLIGHT,
  type StyledLine,
  textNode,
} from '../../../../lib/vnode.js';
import type {
  ClipboardWriter,
  JsonApiResource,
  RendererServices,
  TicketDetailDocument,
} from '../../../../types.js';
import {
  listRowIds,
  listTableRows,
  listTableTree,
} from '../../../collection.js';
import { TICKET_RUN_TABLE, ticketRunRows } from '../../../run/Data/runs.js';
import { ticketUrl } from '../../Data/url.js';
import type { CommentItem } from '../comment-item/index.js';
import { commentRows } from '../comment-item/index.js';
import { TICKET_SECTIONS } from '../sections/index.js';

interface TicketActionContext {
  readonly params?: Readonly<Record<string, string>>;
  readonly services?: RendererServices;
  readonly copyToClipboard?: ClipboardWriter;
}

interface TicketEditNavigation {
  readonly type: 'navigate';
  readonly routeId: string;
  readonly params: Readonly<Record<string, string>>;
}

/** Inner header width at the documented 60-column terminal. */
const HEADER_WRAP_COLUMNS = 60;

function wrapHeaderLine(content: string, width: number): string[] {
  if (content.length <= width) return [content];
  const lines: string[] = [];
  let rest = content;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(' ', width);
    if (cut <= 0) cut = width;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) lines.push(rest);
  return lines;
}

function headerLineNodes(
  id: string,
  content: string,
  fg: typeof BORDER,
): VNode[] {
  return wrapHeaderLine(content, HEADER_WRAP_COLUMNS).map((line, index) =>
    textNode({
      id: index === 0 ? id : `${id}-${index}`,
      content: line,
      fg,
    }),
  );
}

export function ticketHeaderTree(
  document: TicketDetailDocument,
  identifier: string,
  title: string,
  lastRow: readonly VNode[],
  labels?: AssignmentLabels,
): VNode {
  // One compact meta line — state · assignee · labels — under the title. The
  // full set (created by, branch, …) lives in the Overview sidebar, so the
  // header stays two lines rather than five. Empty fields drop out.
  const meta = [
    headerState(document),
    headerAssignee(document, labels),
    headerLabels(document),
  ]
    .filter((part) => part !== '' && part !== '—')
    .join('  ·  ');
  return columnNode(
    'ticket-detail-header',
    textNode({
      id: 'ticket-detail-header-title',
      content: `${identifier} · ${title}`,
      bold: true,
      fg: DEFAULT_FOREGROUND,
    }),
    ...(meta === ''
      ? []
      : headerLineNodes(
          'ticket-detail-header-meta',
          meta,
          FOREGROUND_HIGHLIGHT,
        )),
    ...lastRow,
  );
}

export function ticketTitleOf(document: TicketDetailDocument): {
  identifier: string;
  title: string;
} {
  const attributes = document.data?.attributes;
  return {
    identifier:
      typeof attributes?.identifier === 'string' ? attributes.identifier : '',
    title: typeof attributes?.title === 'string' ? attributes.title : 'ticket',
  };
}

export function ticketCopyActions(): readonly ActionItem[] {
  return [
    actionItem('detail-copy', 'y', 'copy id'),
    actionItem('detail-link', 'Y', 'copy link'),
  ];
}

export function handleTicketCopy(
  input: string,
  context: TicketActionContext,
  document: TicketDetailDocument | undefined,
): string | undefined {
  if (input !== 'y' && input !== 'Y') return undefined;
  const attributes = document?.data?.attributes;
  const identifier =
    typeof attributes?.identifier === 'string' ? attributes.identifier : '';
  const id = document?.data?.id ?? context.params?.ticketId;
  return input === 'Y'
    ? copyThrough(
        context.copyToClipboard,
        ticketUrl(context.services?.baseUrl, id),
        `the link to ${identifier}`,
        `no link to ${identifier} · this session has no base URL`,
      )
    : copyThrough(
        context.copyToClipboard,
        identifier,
        identifier,
        'nothing to copy',
      );
}

export function ticketEditAction(
  context: TicketActionContext,
  document: TicketDetailDocument | undefined,
): TicketEditNavigation | undefined {
  const ticketId = document?.data?.id ?? context.params?.ticketId;
  return ticketId
    ? {
        type: 'navigate',
        routeId: 'ticket.assignment.edit',
        params: { ...(context.params ?? {}), ticketId },
      }
    : undefined;
}

function fieldValue(value: unknown): string {
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value: unknown }).value;
    if (typeof inner === 'string') return inner;
  }
  return typeof value === 'string' ? value : '';
}

function refCount(document: TicketDetailDocument, name: string): number {
  const data = document.data?.relationships?.[name]?.data;
  return Array.isArray(data) ? data.length : data ? 1 : 0;
}

/**
 * Newest-first — the exact reversal of the server's total order
 * (`CommentsItemList`: `created ASC, id ASC`), three keys applied in turn:
 * `created` DESC, then `drupal_internal__id` DESC (the server's own monotonic
 * key, so two comments written in the same second keep the server's relative
 * order, reversed), then the resource `id` DESC.
 *
 * The third key exists to make the comparator TOTAL rather than leaning on
 * `Array.prototype.sort` being stable in modern V8: the order must be
 * *deterministic* — identical for the same comments in any input order, and
 * defined even for a fixture or partial include that carries no
 * `drupal_internal__id`. Stability would only preserve whatever order the
 * include happened to arrive in.
 *
 * A missing or unparseable `created` sorts LAST (treated as the oldest), so a
 * malformed row can never take the top slot and steal the default expansion.
 */
function compareCommentsNewestFirst(
  a: JsonApiResource,
  b: JsonApiResource,
): number {
  const at = Date.parse(asString(a.attributes?.created) ?? '');
  const bt = Date.parse(asString(b.attributes?.created) ?? '');
  const aUnknown = Number.isNaN(at);
  const bUnknown = Number.isNaN(bt);
  if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
  if (!aUnknown && at !== bt) return bt - at;

  const ai = Number(a.attributes?.drupal_internal__id);
  const bi = Number(b.attributes?.drupal_internal__id);
  if (!Number.isNaN(ai) && !Number.isNaN(bi) && ai !== bi) return bi - ai;

  // Code-unit comparison, not localeCompare: a locale-sensitive collation would
  // put the "deterministic" back in the hands of the runtime's locale data.
  const aid = a.id ?? '';
  const bid = b.id ?? '';
  return aid === bid ? 0 : aid < bid ? 1 : -1;
}

/**
 * The document's `bb_comment` includes, NEWEST FIRST.
 *
 * This is the single function both renderings read — `detailSections`' Comments
 * section (→ `detailLines`, the non-TTY render) and `commentItems` (→ the
 * interactive Comments tab) — so newest-first is one line of code and the two
 * orders structurally cannot drift.
 *
 * It sorts the copy `filter` already allocated and NEVER `document.included`
 * itself: that array is mixed (comments *plus* sub-tickets, runs and referenced
 * tickets) and shared with those consumers, so an in-place sort would be an
 * invisible side effect on someone else's input.
 */
const COMMENT_TYPES = new Set(['bb_comment--bb_comment', 'bb_comment--review']);

function isCommentResource(resource: JsonApiResource): boolean {
  return typeof resource.type === 'string' && COMMENT_TYPES.has(resource.type);
}

function commentResources(document: TicketDetailDocument): JsonApiResource[] {
  const included = (document.included ?? []).filter(isCommentResource);
  const linkage = document.data?.relationships?.comments?.data;
  const comments =
    linkage === undefined
      ? included
      : included.filter((r) =>
          new Set(toManyIds(document, 'comments')).has(r.id ?? ''),
        );
  return comments.sort(compareCommentsNewestFirst);
}

function pendingReviewResources(
  document: TicketDetailDocument,
): JsonApiResource[] {
  const linked = new Set(toManyIds(document, 'pending_reviews'));
  return (document.included ?? [])
    .filter((r) => r.type === 'bb_comment--review' && linked.has(r.id ?? ''))
    .sort(compareCommentsNewestFirst);
}

function pendingReviewLines(
  document: TicketDetailDocument,
  baseUrl?: string,
): string[] {
  const pending = pendingReviewResources(document);
  if (!pending.length) return [];
  const web = ticketUrl(baseUrl, document.data?.id);
  return [
    `${pending.length} review${pending.length === 1 ? '' : 's'} awaiting acceptance`,
    ...pending.map((r) => {
      const author =
        asString(r.attributes?.author_name) ??
        asString(r.attributes?.author) ??
        'unknown';
      const state = asString(r.attributes?.review_state) ?? 'submitted';
      return `— ${author} · ${state}`;
    }),
    web
      ? `Open in Web to accept or reject: ${web}`
      : 'Open this ticket in Web to accept or reject.',
  ];
}

/**
 * The `expandedComments` set a freshly opened ticket detail starts with: the
 * newest comment expanded, every older one collapsed.
 *
 * It lives beside the sort on purpose — "index 0 is the newest" is one module's
 * invariant, so the kernel never needs to know which index that is.
 */
export function initialExpandedComments(
  document: TicketDetailDocument,
): Set<number> {
  return commentResources(document).length
    ? new Set<number>([0])
    : new Set<number>();
}

/** The id of a to-one relationship, or null. */
function relId(document: TicketDetailDocument, name: string): string | null {
  const data = document.data?.relationships?.[name]?.data;
  if (!data) return null;
  return Array.isArray(data) ? (data[0]?.id ?? null) : data.id;
}

/**
 * The ids of a to-many relationship, in the linkage's own order.
 *
 * `relId`'s counterpart, and the one place the JSON:API linkage shape is
 * normalised for a to-many: an array, a lone object the server sent unwrapped, or
 * nothing at all. Two renderers wrote this expression out (`labelNames` and
 * BB-369's `blockedByLines`), and a THIRD reading of the same three cases is
 * three more chances for one of them to treat the unwrapped object as absent.
 *
 * `refCount` deliberately does NOT read this: it needs a length and not the ids,
 * so routing it through here would allocate an array per section to measure it.
 */
function toManyIds(document: TicketDetailDocument, name: string): string[] {
  const data = document.data?.relationships?.[name]?.data;
  return (Array.isArray(data) ? data : data ? [data] : []).map((d) => d.id);
}

/**
 * ONE ticket's identity row: `<identifier> · <title>` from the sideload, the raw
 * uuid when the include is missing, and never an empty row — the ladder of D4.
 *
 * Extracted because `parentLines` and BB-369's `blockedByLines` each carried it
 * verbatim, and the failure mode of two copies is not a stale comment: it is one
 * surface degrading to a uuid while the other degrades to a blank, on the SAME tab,
 * for the same missing include. `Parent` and `Blocked by` sit next to each other
 * under `Related` precisely so their rows read alike (D6), which is a claim only a
 * shared function can keep.
 *
 * Deliberately NOT generalised over the resource type: both callers name
 * `bb_ticket--bb_ticket`, and a type parameter would invite a caller whose
 * resource has no `identifier` at all, for which this ladder says nothing.
 */
function ticketIdentityRow(document: TicketDetailDocument, id: string): string {
  const ticket = included(document, 'bb_ticket--bb_ticket', id);
  const identifier = asString(ticket?.attributes?.identifier);
  const title = asString(ticket?.attributes?.title);
  if (!identifier && !title) return id;
  return [identifier, title].filter((s) => s).join(' · ');
}

/** The sideloaded include with this type + id (BB-233 Finding 10). */
function included(
  document: TicketDetailDocument,
  type: string,
  id: string | null,
): JsonApiResource | undefined {
  if (id === null) return undefined;
  return (document.included ?? []).find((r) => r.type === type && r.id === id);
}

/**
 * Labels the caller already resolved through the WRITE client — the edit
 * popup's option lists (BB-233).
 *
 * Why this exists: spec Finding 10 measured the `conductor_id` include on a
 * ticket whose conductor was the SESSION's own, and generalised from it. It
 * does not generalise. `bb_conductor` is owner-gated for `session` (it sees
 * 2 of 4), so the moment the operator picks one of the conductors only `pm`
 * can see — which the popup legitimately offers, since its options come from
 * the write client — the include is access-filtered away and the section fell
 * back to a raw uuid. Measured live on BB-1: `Conductor:
 * dea98c92-eab0-44f7-813e-5a4ee632cb22`.
 *
 * The popup has already loaded those labels, so reusing them costs no request
 * and no second read profile. The include still wins where it arrives.
 */
export interface AssignmentLabels {
  users: { id: string; label: string }[];
  conductors: { id: string; label: string }[];
  reviewers?: { id: string; label: string }[];
}

const knownLabel = (
  list: { id: string; label: string }[] | undefined,
  id: string | null,
): string | undefined =>
  id === null ? undefined : list?.find((o) => o.id === id)?.label;

/**
 * The Assignment lines (BB-233 AC-12). The label ladder, best first:
 * the sideloaded include → the ticket's own computed field (assignee only) →
 * a label the caller already resolved → the raw uuid, which is ugly but is
 * still the truth and never an empty row.
 */
function assigneeName(
  document: TicketDetailDocument,
  labels?: AssignmentLabels,
): string | null {
  const a: Record<string, unknown> = document.data?.attributes ?? {};
  const userId = relId(document, 'assignee_user_id');
  const user = included(document, 'user--user', userId);
  return (
    asString(user?.attributes?.display_name) ??
    asString(user?.attributes?.name) ??
    asString(a.assignee_name) ??
    knownLabel(labels?.users, userId) ??
    userId
  );
}

/**
 * The ticket's assignee as ONE row of text — the header box's Assigned row.
 *
 * Same ladder as {@link assignmentLines}: include → computed `assignee_name` →
 * a label the caller already resolved → the raw uuid. `—` when none of those
 * exist, matching State/Labels rather than inventing a person.
 */
export function headerAssignee(
  document: TicketDetailDocument,
  labels?: AssignmentLabels,
): string {
  return assigneeName(document, labels) || '—';
}

/**
 * The ticket's creator as ONE row of text, resolved from `owner_user_id`.
 *
 * Same ladder shape as {@link assigneeName}: the sideloaded include → the
 * ticket's own computed `owner_name` attribute (survives an access-filtered
 * include, BB-416) → a label the caller already resolved → the raw uuid.
 * `unknown` is the honest fallback when there is no owner at all.
 */
export function headerCreatedBy(
  document: TicketDetailDocument,
  labels?: AssignmentLabels,
): string {
  const a: Record<string, unknown> = document.data?.attributes ?? {};
  const userId = relId(document, 'owner_user_id');
  if (userId === null) return 'unknown';
  const user = included(document, 'user--user', userId);
  return (
    asString(user?.attributes?.display_name) ??
    asString(user?.attributes?.name) ??
    asString(a.owner_name) ??
    knownLabel(labels?.users, userId) ??
    userId
  );
}

function reviewerName(
  document: TicketDetailDocument,
  id: string,
  labels?: AssignmentLabels,
): string {
  const user = included(document, 'user--user', id);
  return (
    asString(user?.attributes?.display_name) ??
    asString(user?.attributes?.name) ??
    knownLabel(labels?.reviewers, id) ??
    knownLabel(labels?.users, id) ??
    id
  );
}

function assignmentLines(
  document: TicketDetailDocument,
  labels?: AssignmentLabels,
): string[] {
  const assignee = assigneeName(document, labels);
  const reviewerIds = toManyIds(document, 'reviewers');
  const reviewerLabel = reviewerIds.length
    ? reviewerIds.map((id) => reviewerName(document, id, labels)).join(', ')
    : '—';

  const conductorId = relId(document, 'conductor_id');
  const conductor = included(
    document,
    'bb_conductor--bb_conductor',
    conductorId,
  );
  const conductorLabel =
    asString(conductor?.attributes?.label) ??
    asString(conductor?.attributes?.machine_id) ??
    knownLabel(labels?.conductors, conductorId) ??
    conductorId;

  return [
    assignee ? `Assignee:  ${assignee}` : 'Unassigned.',
    `Reviewers: ${reviewerLabel}`,
    conductorLabel ? `Conductor: ${conductorLabel}` : 'No conductor.',
  ];
}

/** How many physical lines of the body the collapsed summary may show (D1). */
export const SUMMARY_MAX_LINES = 5;

/**
 * The SHORT SUMMARY the Overview tab opens with (BB-255 D1, AC-1).
 *
 * > Skip leading blank lines **and leading ATX headings** (`#`…`######`); take the
 * > run of consecutive non-empty lines that follows; cap it at
 * > {@link SUMMARY_MAX_LINES}. When the full body has more lines than the summary
 * > shows, append the explicit marker `… +N more lines`.
 *
 * **Why skip headings.** Every bakers.build ticket body opens with `## Context`, so "the
 * first paragraph" naively read is the *heading alone* — a summary that says
 * `## Context` and nothing else. Skipping them yields the actual gist.
 *
 * **Why a LINE cap and not a character cap.** The TUI never wraps; `fitLine`
 * truncates each row to the terminal width. A physical line is therefore exactly a
 * row, so a line cap is a viewport budget and a character cap is not.
 *
 * **Why 5.** It fits the paragraph shape of real ticket bodies while leaving the
 * Overview tab's other sections above the fold on a 40-row terminal
 * (`viewHeight() = rows - 9` ⇒ 31 body rows).
 *
 * R7 — the unusual bodies. A body that is ONLY headings (or only a fence) leaves
 * nothing after the skip, so it falls back to the first non-empty lines as they
 * are: showing the headings beats showing nothing. An empty body is the unchanged
 * `No description.`
 *
 * BB-372 D8 — IT WORKS ON RENDERED LINES NOW, and every documented property
 * above is kept. Two things change, and both make the answer more nearly true:
 *
 *  - "skip leading ATX headings" reads `line.heading` instead of re-matching
 *    `/^#{1,6}\s/` on the text. That is not a tidy-up: after rendering, the text
 *    of a heading no longer HAS its markers, while a `## comment` inside a fenced
 *    block does — so a re-match would skip exactly the wrong rows.
 *  - the count is over RENDERED lines, which is the number the operator acts on:
 *    expanding swaps the extract for those same rendered lines, and a dropped
 *    fence row is not a line the expand produces (R8).
 */
export function descriptionSummary(all: readonly StyledLine[]): StyledLine[] {
  const isBlank = (line: StyledLine | undefined): boolean =>
    (line?.text ?? '').trim() === '';

  /** The run of consecutive non-empty lines at or after `from`, capped. */
  const paragraphFrom = (from: number): StyledLine[] => {
    let i = from;
    while (i < all.length && isBlank(all[i])) i += 1;
    const taken: StyledLine[] = [];
    while (
      i < all.length &&
      !isBlank(all[i]) &&
      taken.length < SUMMARY_MAX_LINES
    ) {
      taken.push(all[i] as StyledLine);
      i += 1;
    }
    return taken;
  };

  let start = 0;
  while (start < all.length) {
    const line = all[start] as StyledLine;
    if (isBlank(line) || line.heading) start += 1;
    else break;
  }

  const afterSkip = paragraphFrom(start);
  const lines = afterSkip.length ? afterSkip : paragraphFrom(0);
  if (!lines.length) return [plainLine('No description.')];
  // WHICH count this is: how many more lines EXPANDING REVEALS — the whole
  // rendered body minus what is shown — so it includes the headings and blank
  // lines skipped ABOVE the summary as well as everything below it. That is the
  // number the operator acts on, because expanding swaps these `lines` for the
  // whole body (`descriptionEntry`: `expanded: lines`). Counting only the lines
  // BELOW the summary would under-report what the expand actually produces.
  const hidden = all.length - lines.length;
  // A PLAIN line, deliberately: the marker is the component's own text, not the
  // author's, so nothing may parse it (D3).
  return hidden > 0 ? [...lines, plainLine(`… +${hidden} more lines`)] : lines;
}

/**
 * The NEWEST comment of an exact `bb_comment_type`, or `null` — BB-381 D1.
 *
 * WHICH "newest": {@link commentResources}' total newest-first order
 * (`created` DESC, then `drupal_internal__id` DESC, then resource `id` DESC), so
 * every typed surface (summary / spec / plan) shares one comparator with the
 * Comments tab and with `initialExpandedComments`.
 *
 * Exact string match on `bb_comment_type` (BB-369 R5 / BB-381 R3): a typo
 * is invisible. Summary still falls back to empty copy; Spec/Plan omit the
 * section entirely (D2).
 */
function latestCommentOfType(
  document: TicketDetailDocument,
  type: string,
): JsonApiResource | null {
  return (
    commentResources(document).find(
      (c) => asString(c.attributes?.bb_comment_type) === type,
    ) ?? null
  );
}

/** The NEWEST `summary` comment, or `null` — BB-369 D3 via {@link latestCommentOfType}. */
function latestSummary(document: TicketDetailDocument): JsonApiResource | null {
  return latestCommentOfType(document, 'summary');
}

/**
 * The `Latest summary` section's rows: a marker row naming the comment, then its
 * body one row per physical line (D3).
 *
 * The marker MIRRORS the `Comments` section's shape so the type is on screen next
 * to the text, and carries the author and the created stamp because this section
 * shows exactly one comment out of many — "which handoff am I reading" is the
 * question a lone extract raises and the Comments tab answers by context.
 *
 * Empty parts are dropped rather than rendered as ` ·  · `: a partial fixture, or
 * a comment whose author the read profile filtered, would otherwise show
 * punctuation with nothing between it. Same ladder as `parentLines`.
 *
 * ONE ROW PER PHYSICAL LINE, like every other section: `draw()`'s
 * one-entry-one-row invariant means a multi-line body held in a single entry would
 * render as N terminal rows from one array member.
 *
 * BB-369 AC-9b — AN EMPTY BODY CONTRIBUTES NO ROW AT ALL. This fell back to
 * `['']` (the shape the `Comments` section still uses for its many comments), and
 * on a section that renders exactly ONE comment that cost two lies at once: a
 * blank row in the flat render, and — because this section is an
 * {@link EXPANDABLE_HEADINGS} entry — a collapsed extract of one line measured
 * against a two-line body, so `descriptionSummary` appended `… +1 more lines` for
 * a line that is empty. Dropping the row leaves the marker alone, which is the
 * honest rendering of "there is a summary comment and it says nothing".
 *
 * The `Comments` section's own `['']` is deliberately untouched: it is a separate
 * expression on a separate section, its rows are a FLAT list of many comments where
 * the blank is the separation between two bodies, and it is not measured by an
 * extract. The duplication is a duplicated pattern, not a shared code path.
 *
 * BB-372 D3/AC-1/AC-2 — THE BODY IS RENDERED, THE MARKER IS NOT, and the split
 * is the whole point of the return type below. This is the THIRD `bb_rich` body
 * on the ticket detail, and it reaches its rows through the same `markdownLines`
 * seam `Description` and `Comments` use — that is what makes "the same rendering"
 * structural rather than an agreement between three producers. Rendering it is not
 * a nicety: `Latest summary` sits directly ABOVE `Description` on the Overview tab
 * (D7), so a raw body here would have put `## Outcome` and `- [x] shipped` one row
 * above the same constructs drawn properly, i.e. one screen contradicting itself.
 *
 * The `— <marker>` row and the `No summary comment.` empty state stay PLAIN
 * strings, because a plain string is never parsed (D3): they are this component's
 * own text, not the author's, and nothing about them may be re-spelled by a
 * Markdown rule. An author name holding `_` is the case that makes it matter.
 *
 * AC-9b above is unchanged by this and stays measured in RENDERED lines: an empty
 * body still contributes no row, so the marker still stands alone and the extract
 * still counts nothing it cannot reveal.
 */
function summaryLines(document: TicketDetailDocument): SectionLine[] {
  const summary = latestSummary(document);
  if (summary === null) return ['No summary comment.'];
  const marker = [
    'summary',
    asString(summary.attributes?.author_name),
    asString(summary.attributes?.created),
  ]
    .filter((part) => part)
    .join(' · ');
  const body = fieldValue(summary.attributes?.body);
  return [`— ${marker}`, ...(body ? markdownLines(body) : [])];
}

/**
 * Marker + body for a typed latest-comment section, or `null` when absent.
 *
 * BB-381 D2 — Spec/Plan HIDE when absent (contrast with {@link summaryLines},
 * which always returns empty-state copy so Overview's selectable stays stable).
 * Marker shape mirrors summary: `— <type> · <author> · <created>`, then
 * `markdownLines(body)`; empty body contributes no row (AC-9b).
 */
function typedCommentLines(
  document: TicketDetailDocument,
  type: string,
): SectionLine[] | null {
  const comment = latestCommentOfType(document, type);
  if (comment === null) return null;
  const marker = [
    type,
    asString(comment.attributes?.author_name),
    asString(comment.attributes?.created),
  ]
    .filter((part) => part)
    .join(' · ');
  const body = fieldValue(comment.attributes?.body);
  return [`— ${marker}`, ...(body ? markdownLines(body) : [])];
}

/** The `bb_term` label names of the ticket, resolved include → uuid (D4/D8). */
function labelNames(document: TicketDetailDocument): string[] {
  return toManyIds(document, 'labels').map(
    (id) =>
      asString(
        included(document, 'bb_term--bb_labels', id)?.attributes?.name,
      ) ?? id,
  );
}

/**
 * The ticket's labels as ONE row of text — the header box's labels row (AC-8) and
 * the `Labels` section's row (D11) read the same function, so the flat render and
 * the header can never disagree about what the ticket is tagged with.
 *
 * `—` when the ticket has none: explicit, never a blank or missing region. A raw
 * uuid when an include is missing — ugly, but still the truth (the ladder of D4).
 */
export function headerLabels(document: TicketDetailDocument): string {
  const names = labelNames(document);
  return names.length ? names.join(', ') : '—';
}

/**
 * The ticket's current workflow state as ONE row of text — BB-369 D1, AC-1.
 *
 * Shared exactly as {@link headerLabels} is: the header box's state row and the
 * `State` section's row read this one function, so the TTY and
 * `bakers ui <id> | cat` structurally cannot disagree about which state the ticket
 * is in. Two readers of `attributes.state` would be two chances to format it
 * differently.
 *
 * `—` when the attribute is absent (a partial fixture, or a document the read
 * profile stripped): explicit, never a blank row — the same rule the labels row
 * follows, for the same reason. A blank row in a fixed-height header box is
 * indistinguishable from a rendering bug.
 *
 * BB-369 AC-9a — `||`, NOT `??`, and the difference is the whole promise above.
 * `asString('')` is `''`, so `?? '—'` covered the ABSENT attribute and let the
 * EMPTY one through: a ticket whose `state` is `""` rendered a bare `State: `,
 * which is precisely the blank row this docblock says cannot happen. `||` treats
 * "no value" and "the empty string" as the one case they are for a display row.
 */
export function headerState(document: TicketDetailDocument): string {
  return asString(document.data?.attributes?.state) || '—';
}

/**
 * The parent's identity row (D4): `<identifier> · <title>` from the sideloaded
 * `parent_id`, degrading to the raw uuid, with the explicit empty state
 * `No parent ticket.` (AC-4).
 *
 * A to-one relationship is rendered as an IDENTITY, not through `relSection`: a
 * count of one parent (`1 parent`) carries no information at all.
 *
 * The ladder itself is {@link ticketIdentityRow}'s, shared with `Blocked by`; what
 * is this function's own is the to-ONE read and the empty state.
 */
function parentLines(document: TicketDetailDocument): string[] {
  const id = relId(document, 'parent_id');
  if (id === null) return ['No parent ticket.'];
  return [ticketIdentityRow(document, id)];
}

/**
 * The source (origin) ticket's URL — BB-678. A plain attribute, not a
 * relationship, so there is no identity row to resolve: the URL verbatim, or
 * the pane's usual empty state when the ticket carries none.
 */
function sourceLines(document: TicketDetailDocument): string[] {
  const origin = asString(document.data?.attributes?.origin);
  return origin === undefined ? ['none'] : [origin];
}

/**
 * The blockers' identity rows — BB-369 D5, AC-3.
 *
 * IDENTITIES RATHER THAN A COUNT, which is the one design decision in this
 * function. `relSection`'s `N sub-tickets` does not answer the question an
 * operator has about a blocked ticket — "which ticket is holding this up?" — and
 * the live include measurement (spec fact 10) removed the only obstacle the
 * qualification raised against rows: `include=blocked_by` sideloads
 * `bb_ticket--bb_ticket` resources carrying `identifier` under `session`.
 * `Sub-tickets` and `Referenced tickets` deliberately stay counts; rows for those
 * need their own selection and navigation, which is a separate change.
 *
 * Same ladder as {@link parentLines}, and since the round-2 review LITERALLY the
 * same code: {@link ticketIdentityRow} is that ladder — the sideload's
 * `<identifier> · <title>`, degrading to the raw uuid, and never an empty row —
 * and {@link toManyIds} is the linkage normalisation `labelNames` also reads.
 * `Not blocked.` when there are none, which is the shape a real unblocked ticket
 * produces, since the linkage arrives as `{"data": []}` whether or not the include
 * is asked for.
 *
 * D6 — A ROW CARRIES NO STATE. Appending the blocker's own state
 * (`BB-19 · done · …`) would answer "is the blocker still open" in one glance,
 * and was rejected for it: it breaks the row format `Parent` establishes on the
 * SAME tab, and AC-3 asks for rows consistent with that tab's other sections. The
 * identifier is a jump target; the blocker's state is one keystroke away.
 */
function blockedByLines(document: TicketDetailDocument): string[] {
  const ids = toManyIds(document, 'blocked_by');
  if (!ids.length) return ['Not blocked.'];
  return ids.map((id) => ticketIdentityRow(document, id));
}

/**
 * The accounted-time rows: the estimate, the spent time, and their difference.
 *
 * Both values are human-confirmed accounting (BB-308 D1), NOT the run
 * footprint — the Runs section below shows what the machine measured, and the
 * two are allowed to differ (R6), which is why they are labelled distinctly.
 * The difference is only rendered when both values exist; one of them alone has
 * nothing to be a difference from.
 */
function timeLines(a: Record<string, unknown>): string[] {
  const estimate = typeof a.time_estimate === 'number' ? a.time_estimate : null;
  const spent = typeof a.time_spent === 'number' ? a.time_spent : null;
  if (estimate == null && spent == null) {
    return ['No estimate and no accounted time.'];
  }
  const lines = [
    `estimate: ${formatDuration(estimate)}`,
    `spent:    ${formatDuration(spent)}`,
  ];
  if (estimate != null && spent != null) {
    const delta = spent - estimate;
    lines.push(
      delta > 0
        ? `over:     ${formatDuration(delta)}`
        : `left:     ${formatDuration(-delta)}`,
    );
  }
  return lines;
}

/**
 * The ticket detail sections, each with an explicit empty state — BB-369 D7 /
 * BB-381 D3 order, which IS the order the flat `| cat` render prints:
 * State, Labels, Source, Parent, Latest summary, Latest spec?, Latest plan?, Description,
 * Assignment, Time, Comments, Sub-tickets, Blocked by, Runs, Referenced tickets,
 * Links, Branch, Environments. Spec/Plan are omitted when no matching comment.
 *
 * The TAB order is independent of this list — `sectionsForTab` looks each heading
 * up by name — so the two are free to differ where meaning differs, and `State`
 * and `Labels` are listed by no tab at all.
 *
 * `nowSeconds` reaches the `Runs` section's relative START column (BB-255 D5);
 * it is optional so every pre-existing caller and fixture is unchanged, and the
 * kernel passes the real clock.
 */
export function detailSections(
  document: TicketDetailDocument,
  labels?: AssignmentLabels,
  nowSeconds = 0,
  baseUrl?: string,
): Section[] {
  const a: Record<string, unknown> = document.data?.attributes ?? {};
  const sections: Section[] = [];

  // BB-369 D1/D7: `State` LEADS, and no tab lists it — the same arrangement
  // `Labels` has had since BB-255 D11, for the same two reasons. In the TTY the
  // header box carries the value on EVERY tab, which is what AC-1's "without
  // leaving the detail screen" asks for and what a tab-listed section could not
  // give; the flat `bakers ui <id> | cat` render has no header box at all, so
  // without this section the pipe would be the one rendering that silently lost
  // the state (AC-4). First in the list because the state is the fact an operator
  // scans a piped ticket for.
  sections.push({ heading: 'State', lines: [headerState(document)] });

  // BB-255 D11: no tab lists `Labels` — the TTY shows them in the header box,
  // which the non-TTY flat render does not have at all. Without this section
  // `bakers ui BB-255 | cat` would be the one rendering that silently lost them.
  sections.push({
    heading: 'Labels',
    lines: labelNames(document).length ? labelNames(document) : ['No labels.'],
  });

  // BB-678: the upstream ticket this one was imported from — above `Parent`,
  // matching the interactive Related pane's row order.
  sections.push({ heading: 'Source', lines: sourceLines(document) });

  sections.push({ heading: 'Parent', lines: parentLines(document) });

  // BB-369 D3/D7: ABOVE `Description`, matching its Overview position — the
  // newest phase handoff is what an operator reads before the ticket's own body,
  // because it says where the work actually stands. Collapsible through the same
  // `EXPANDABLE_HEADINGS` entry path `Description` uses.
  sections.push({ heading: 'Latest summary', lines: summaryLines(document) });

  // BB-381 D2/D3: Latest spec then Latest plan AFTER summary, BEFORE
  // Description. Conditionally pushed — omit entirely when no matching comment
  // (AC-3; contrast with summary's always-visible empty state). `sectionsForTab`
  // drops HEADINGS listed but absent.
  const specLines = typedCommentLines(document, 'spec');
  if (specLines !== null) {
    sections.push({ heading: 'Latest spec', lines: specLines });
  }
  const planLines = typedCommentLines(document, 'plan');
  if (planLines !== null) {
    sections.push({ heading: 'Latest plan', lines: planLines });
  }

  const description = fieldValue(a.description);
  sections.push({
    heading: 'Description',
    // BB-372 D3/AC-1 — the ONE seam where a `bb_rich` body becomes rows, so
    // rendering it here is the whole of what makes the description render as
    // Markdown on the Overview tab AND in `bakers ui <id> | cat`. The empty state
    // stays a plain string: it is the component's own text, not the author's.
    lines: description ? markdownLines(description) : ['No description.'],
  });

  // BB-233 AC-12: right after Description, because it is what AC-2/AC-3's
  // "the detail view reflects it" reflects INTO.
  sections.push({
    heading: 'Assignment',
    lines: assignmentLines(document, labels),
  });

  const pendingLines = pendingReviewLines(document, baseUrl);
  if (pendingLines.length) {
    sections.push({ heading: 'Pending reviews', lines: pendingLines });
  }

  // BB-308 AC-9: an overrun has to be visible where the pair is read. Right
  // after Assignment, and deliberately ABOVE Runs — the accounted number is
  // read first, the machine footprint that informed it second.
  sections.push({ heading: 'Time', lines: timeLines(a) });

  const comments = commentResources(document);
  sections.push({
    heading: 'Comments',
    // One physical line per body line: a `— type ·` marker followed by the
    // RENDERED body (BB-372 D3/AC-2 — the same function the Description section
    // calls, which is what makes "the same rendering" structural rather than an
    // agreement between two producers). The marker itself stays a plain string:
    // it is this component's text, not the author's. Keeping a multi-line body in
    // a single entry breaks draw()'s one-entry-one-row invariant (AC-4).
    lines: comments.length
      ? comments.flatMap((c) => {
          const type = asString(c.attributes?.bb_comment_type) ?? 'comment';
          const body = fieldValue(c.attributes?.body);
          return [`— ${type} ·`, ...(body ? markdownLines(body) : [''])];
        })
      : ['No comments.'],
  });

  const relSection = (heading: string, rel: string) => {
    const n = refCount(document, rel);
    sections.push({
      heading,
      lines: n
        ? [`${n} ${heading.toLowerCase()}`]
        : [`No ${heading.toLowerCase()}.`],
    });
  };
  relSection('Sub-tickets', 'sub_tickets');
  // BB-369 D5/D7: beside the other relationship sections, and rendered as
  // identity ROWS rather than a count (see `blockedByLines` for why the two
  // neighbours stay counts).
  sections.push({ heading: 'Blocked by', lines: blockedByLines(document) });
  // BB-255 AC-6: real rows, not `N runs`. Rendered from the SAME configuration
  // the project-wide Runs screen renders — BB-345 D7 made that literally the
  // same value, `TICKET_RUN_TABLE` differing from `RUN_TABLE` in its empty
  // message alone — so the two screens cannot disagree about what a run looks
  // like. Sub-tickets and Referenced tickets stay counts on purpose (an explicit
  // non-goal: they need their own rows, selection and navigation, which is a
  // separate change).
  sections.push({
    heading: 'Runs',
    lines: listTableRows(TICKET_RUN_TABLE, ticketRunRows(document), nowSeconds),
  });
  relSection('Referenced tickets', 'referenced_tickets');

  const links: unknown[] = Array.isArray(a.links) ? a.links : [];
  sections.push({
    heading: 'Links',
    lines: links.length
      ? links.map((l) => {
          const link = l as { title?: string; uri?: string; url?: string };
          return `${link.title ?? ''} ${link.uri ?? link.url ?? ''}`.trim();
        })
      : ['No links.'],
  });

  sections.push({
    heading: 'Branch',
    lines: [
      `branch: ${asString(a.branch_name) ?? '—'}`,
      `base:   ${asString(a.base_branch) ?? '—'}`,
    ],
  });

  relSection('Environments', 'environments');

  return sections;
}

/** The detailSections that belong to a given (non-comments) tab, in tab order. */
export function sectionsForTab(
  document: TicketDetailDocument,
  tabIndex: number,
  labels?: AssignmentLabels,
  nowSeconds = 0,
  baseUrl?: string,
): Section[] {
  const tab = TICKET_SECTIONS[tabIndex];
  const headings = tab?.headings ?? [];
  if (!headings.length) return [];
  const byHeading = new Map(
    detailSections(document, labels, nowSeconds, baseUrl).map((s) => [
      s.heading,
      s,
    ]),
  );
  return headings
    .map((h) => byHeading.get(h))
    .filter((s): s is Section => s !== undefined);
}

/**
 * One item per comment for the collapsible Comments tab: type, author, created
 * (raw ISO — the plugin formats the relative age), the body RENDERED into
 * physical lines, and a first-line preview for the collapsed header.
 *
 * BB-372 D8 — `preview` is the rendered first line's text, for the same reason
 * the extract is computed on rendered lines: a collapsed header that reads
 * `## Outcome` is exactly the raw-source defect this ticket is about, one row
 * further out. It carries no inline styling, and that is a NAMED degradation —
 * the header row is drawn bold as a whole.
 */
export function commentItems(document: TicketDetailDocument): CommentItem[] {
  const comments = commentResources(document);
  return comments.map((c, index) => {
    const type = asString(c.attributes?.bb_comment_type) ?? 'comment';
    const author = asString(c.attributes?.author_name) ?? '';
    const created = asString(c.attributes?.created) ?? null;
    const body = fieldValue(c.attributes?.body);
    const bodyLines = body ? markdownLines(body) : [plainLine('')];
    return {
      // BB-340 D4 — the id this comment's nodes are keyed on. A wire resource
      // always carries one; the fallback is for a partial fixture, and it is
      // safe there for the reason it would NOT be on real data: a document whose
      // comments have no id cannot be re-sorted by one either, and
      // `compareCommentsNewestFirst` is total, so the position is stable for a
      // given document rather than an accident of arrival order.
      id: c.id ?? `index-${index}`,
      type,
      author,
      created,
      bodyLines,
      preview: bodyLines[0]?.text ?? '',
    };
  });
}

// The whole ticket-detail document flattened (all sections) — the NON-TTY ticket
// render, printed verbatim by the kernel when stdout is not a terminal
// (`Kernel/tui-kernel.ts:147`), i.e. what `bakers ui BB-nnn | cat` shows. The
// interactive screen renders one tab at a time via tabViewLines instead.
export function detailLines(
  detail?: TicketDetailDocument | null,
  labels?: AssignmentLabels,
  nowSeconds = 0,
): {
  lines: string[];
  boldRows: Set<number>;
} {
  return flattenSections(detailSections(detail ?? {}, labels, nowSeconds));
}

/**
 * The headings whose sections render as ONE COLLAPSIBLE ENTRY rather than as flat
 * rows (BB-255 D2/AC-1).
 *
 * A set rather than an `if (heading === 'Description')` so the rule is data: the
 * tab view below neither knows nor cares which tab lists it, which is what lets
 * `Description` be collapsible wherever it appears without a second code path.
 *
 * BB-369 D3 collects on that: `Latest summary` joins by being named here, and
 * the entry path underneath needed no change at all — which is the whole return on
 * BB-255 having made the rule data in the first place.
 *
 * BB-381 D2: `Latest spec` / `Latest plan` join the set the same way. They are
 * only pushed into `detailSections` when a matching comment exists, so a missing
 * type never draws a caret (`sectionsForTab` drops the heading).
 */
const EXPANDABLE_HEADINGS = new Set([
  'Description',
  'Latest summary',
  'Latest spec',
  'Latest plan',
]);

/**
 * The id the whole tab body hangs under, and the prefix every row carries.
 *
 * One name for all four tabs — see {@link tabViewTree} for why a per-tab root
 * would cost a rebuild on every Tab press. The prefix also keeps these rows
 * apart from a sibling tree's: `description-0` is a section row here and could
 * be one somewhere else, while `ticket-detail-description-0` is this screen's.
 */
const BODY_ID = 'ticket-detail';

/** One rendered ticket section: its body, and the selection map into it. */
export interface TabView {
  /** BB-340 D1 — the tab's rows as the renderable tree the screen hands over. */
  readonly body: VNode;
  /**
   * `headerRows[i]` is the ABSOLUTE row index of entry i's header.
   *
   * Still row INDICES rather than node ids, and for a reason that outlives the
   * conversion: they are what the kernel scrolls the selection into view by and
   * what the click hit test maps a clicked body row back to an entry through.
   * Both are geometry over the body window, not identity, so both stay numbers
   * until the mouse moves onto the renderables in plan Task 11.
   */
  readonly headerRows: number[];
  readonly selectable: number;
  /**
   * The node of each selectable entry, in selection order — what the screen
   * publishes as `ScreenPresentation.rowIds` so a click on an entry's header
   * resolves to the entry it is (BB-340 Task 11).
   *
   * The identity beside the geometry, for as long as `headerRows` lives: a
   * click reads THIS, and only the kernel's scroll-into-view still reads the row
   * indices. Both are derived from one `headerRows` walk below, so the entry a
   * click opens and the entry the cursor scrolls to cannot come apart.
   */
  readonly rowIds: string[];
}

/**
 * One expandable entry: the caret header, the D1 extract while collapsed, the
 * whole body while expanded.
 *
 * GENERIC OVER THE SECTION it is handed, and since BB-369 D3 that is load
 * bearing rather than incidental — it serves `Description` and `Latest summary`
 * alike, and neither needs a branch, because `descriptionSummary` reads RENDERED
 * LINES and since BB-372 both sections produce them. (Before that ticket the
 * shared property was that both sections were *text*; the property that carries
 * the sharing is now the stronger one, which is why the branch still does not
 * exist.)
 *
 * R6 — the caret is ALWAYS drawn and the entry is always selectable, even when
 * the body fits inside the extract and toggling changes nothing visible. That is
 * deliberate: a conditional caret would make `selectable` (and with it the click
 * map) depend on the LENGTH OF THE TICKET BODY, so the same click would mean
 * different things on different tickets. BB-369 D3 follows the same rule for
 * the empty summary — `No summary comment.` keeps its caret rather than making
 * Overview's `selectable` 1 or 2 depending on whether a handoff was written.
 */
function expandableEntry(
  section: Section,
  summarize: (lines: readonly StyledLine[]) => StyledLine[],
  // BB-373 AC-10 — the section's own key derivation, handed down rather than
  // chosen here, so an entry and the flat rows of the tab beside it cannot
  // disagree about what a heading is called.
  keyOf: (heading: string) => string,
): {
  key: string;
  header: string;
  collapsed: StyledLine[];
  expanded: StyledLine[];
} {
  // RENDERED lines, always — the sections this is called for are `Description`
  // and `Latest summary`, and since BB-372 D3 BOTH producers hand over
  // `markdownLines(...)`; since BB-373 a contributed panel's sections come
  // through here too. A plain string (either section's empty state, and the
  // `— <marker>` row `Latest summary` opens with) or a columned line is LIFTED by
  // `styledOf` rather than refused, because an expandable body is text and a
  // caller that hands one over means its text. Lifting never parses, so neither
  // the empty state nor the marker can acquire a Markdown rule on the way through.
  //
  // What used to happen here was `section.lines.map(lineText).join('\n')` — the
  // rows collapsed back into one string so `descriptionSummary` could re-split
  // it. That round trip is gone: the lines are already rows, and `summarize`
  // reads them as rows, which is why a panel's rule is a FUNCTION OVER LINES
  // rather than over a body.
  const lines = section.lines.map(styledOf);
  return {
    // Keyed on WHICH section this is, so the caret row is the same node on every
    // frame and a toggle writes the flipped glyph onto it (BB-340 D4).
    key: keyOf(section.heading),
    header: section.heading,
    collapsed: summarize(lines),
    expanded: lines,
  };
}

/**
 * BB-373 — the collapsed rule for a contributed panel entry: its FIRST LINE,
 * and a marker counting what expanding reveals.
 *
 * The counterpart of {@link descriptionSummary}, and separate from it because
 * they summarise different things. A ticket body's first line is a heading, so
 * `descriptionSummary` skips headings and takes a paragraph; a captured command
 * output's first line is THE COMMAND (BB-371 D3), so taking exactly one line
 * is what makes a collapsed Artifacts tab read as the list of commands the
 * ticket ran rather than as four rows of somebody's log.
 *
 * Over RENDERED LINES, like its counterpart and for BB-372 D3's reason: the
 * body is already rows by the time an entry summarises it, and re-joining them
 * into a string only to re-split it is the round trip that ticket removed. The
 * marker it appends is a plain line, never parsed — a captured log's own text
 * must not acquire a Markdown rule on the way to the collapsed row.
 */
export function firstLineSummary(lines: readonly StyledLine[]): StyledLine[] {
  const first = lines[0] ?? plainLine('');
  return lines.length > 1
    ? [first, plainLine(`… +${lines.length - 1} more lines`)]
    : [first];
}

/**
 * A section-listing tab's KEYED rows, with any {@link EXPANDABLE_HEADINGS}
 * section rendered as a collapsible entry instead of flat rows.
 *
 * `headerRows` stays a list of ABSOLUTE row indices — the click hit test maps a
 * clicked body row back to an entry through it, and the screen scrolls the
 * selected entry into view by it. What is gone is `boldRows`: a row's weight is
 * a prop on its own node now (BB-340 D3), so there is no second surface for an
 * index to point into. A tab with no expandable section (Related) comes out with
 * `headerRows: []` and `selectable: 0`, i.e. exactly today's scroll-only shape,
 * with no branch of its own.
 */
function sectionTabRows(
  sections: readonly Section[],
  {
    expanded,
    expandableHeadings = EXPANDABLE_HEADINGS,
    summarize = descriptionSummary,
    keyOf = sectionKey,
  }: {
    expanded: ReadonlySet<number>;
    /**
     * BB-373 — WHICH of these sections collapses, as an argument rather than
     * this module's own `Set`. A contributed panel marks its own expandables and
     * this function neither knows nor cares whose they are.
     */
    expandableHeadings?: ReadonlySet<string>;
    /**
     * BB-373 — what a collapsed entry shows instead of its body.
     *
     * `Description`'s rule (skip the leading ATX headings, take the first
     * paragraph, cap at five lines) is a rule about TICKET BODIES, so it stays
     * the default and does not become the definition of "collapsed". A panel
     * whose entries are captured command output wants its FIRST line — see
     * `firstLineSummary`.
     */
    summarize?: (lines: readonly StyledLine[]) => StyledLine[];
    /**
     * BB-373 AC-10 — HOW a heading becomes a node key.
     *
     * The built-in derivation is the default, so Overview, Comments, Related and
     * Runs keep the ids they have had since BB-340 (AC-2). A PANEL passes
     * `panelSectionKey`, because its headings are data — the shipped artifacts
     * viewer heads its sections with file paths, and the collapsing default maps
     * `playwright/logs/walk.txt` and `playwright/logs-walk.txt` onto one key.
     * Two nodes with one id is not a cosmetic collision: `Kernel/mount.ts`
     * refuses the tree, and it refuses it while MOUNTING, past the host's guard
     * around `panel.sections()`.
     *
     * ONE argument for all four uses below (the entry, its empty key, its gap
     * row and the flat branch's `sectionRows`) — a tab that keyed half its rows
     * one way and half the other would be a worse defect than the one this
     * repairs.
     */
    keyOf?: (heading: string) => string;
  },
): ExpandableView {
  const rows: SectionRow[] = [];
  const headerRows: number[] = [];
  for (const section of sections) {
    if (expandableHeadings.has(section.heading)) {
      const part = expandableRows(
        [expandableEntry(section, summarize, keyOf)],
        {
          expanded: expanded.has(headerRows.length)
            ? new Set<number>([0])
            : new Set<number>(),
          // BB-369 — PER-SECTION, derived from the section's own heading rather
          // than the `'No description.'` this said for every heading on the path.
          // The branch is UNREACHABLE either way (the entry array always has
          // exactly one member, so `expandableRows` never falls to its empty
          // message), and it is corrected precisely because it stopped being
          // Description-only: a constant naming one section on a path two sections
          // now share is a statement that would be wrong the first time the branch
          // ever ran.
          emptyMessage: `No ${section.heading.toLowerCase()}.`,
          emptyKey: `${keyOf(section.heading)}-empty`,
        },
      );
      for (const row of part.headerRows) headerRows.push(rows.length + row);
      rows.push(...part.rows, {
        // The blank that closes the entry, exactly as a flat section carries one.
        key: `${keyOf(section.heading)}-gap`,
        text: '',
        bold: false,
      });
      continue;
    }
    rows.push(...sectionRows([section], keyOf));
  }
  return { rows, headerRows, selectable: headerRows.length };
}

/**
 * One ticket section as the renderable tree the screen hands over, plus
 * `selectable`/`headerRows` so the screen can scroll the selected entry into
 * view and the click hit test can map a row back to it.
 *
 * Three shapes, chosen by the tab's own id: Comments is the collapsible comment
 * list, Runs is the shared run table (BB-255 AC-6), and every section-listing
 * tab lists its own sections — with each {@link EXPANDABLE_HEADINGS} section
 * rendered as ONE collapsible entry (AC-1/AC-2). Since BB-369 D4 the Overview
 * tab lists two of them (`Latest summary`, then `Description`), so its selectable
 * count is 2 and its `cursorMode` is `select` rather than `scroll`; Related's is
 * still 0.
 *
 * ONE ROOT ID FOR ALL FOUR TABS, deliberately. Switching tabs does not navigate,
 * so the screen's tree is patched rather than remounted: a per-tab root would
 * make `patchTree` destroy the standing box and build another beside it on every
 * Tab press, where a shared one lets it park the rows the next tab does not want
 * and keep the box. Only ONE tab's rows are ever in the tree, so what has to hold
 * is that a tab's own rows are distinct: a comment keys by its uuid, a run by its
 * own, and a section by its heading — and `Kernel/mount.ts` refuses a repeated id
 * loudly rather than patching one row's content onto another's node.
 *
 * "A SECTION KEYS ITS ROWS BY ITS HEADING" USED TO BE ENOUGH ON ITS OWN, and
 * BB-373 is where it stopped being: while the headings were the built-in set,
 * `sectionKey` was injective over them by inspection. A contributed panel heads
 * its sections with whatever it lists — the shipped artifacts viewer with file
 * paths — and the collapsing derivation maps `playwright/logs/walk.txt` and
 * `playwright/logs-walk.txt` onto one key. The panel branch below therefore keys
 * with `panelSectionKey`, which is injective over arbitrary headings; the
 * built-ins are untouched.
 *
 * The one case that stays a refusal: two panel sections carrying the SAME
 * heading. No derivation from a heading can separate them, so the tree is
 * declined loudly rather than mis-patched, and giving a panel section an identity
 * apart from its title is a different ticket.
 *
 * MOUNTED WHOLE, and this is the screen where that bound is worth stating: a
 * ticket detail renders every comment, and a comment body is arbitrarily long
 * Markdown. One node per physical row plus one box, against
 * `@opentui/core@0.5.1`'s 16 382 renderables — so the ceiling is ~16 000 body
 * lines in the open tab. The Comments tab is the one that can approach it,
 * because only the EXPANDED comments contribute their bodies and a freshly
 * opened detail expands exactly one (`initialExpandedComments`): reaching it
 * needs an operator to expand enough comments to total sixteen thousand lines.
 * That is far past any ticket in the corpus but it is not three orders of
 * magnitude away like the dashboard's bound, so it is named rather than waved
 * off — the Runs tab, by contrast, is one node per run plus six cells and is
 * bounded by the document's sideloaded runs.
 */
export function tabViewTree(
  detail: TicketDetailDocument | null | undefined,
  tabIndex: number,
  {
    expanded = new Set<number>(),
    nowSeconds = 0,
    labels,
    selectedIndex = -1,
    panelSections,
  }: {
    expanded?: ReadonlySet<number>;
    nowSeconds?: number;
    labels?: AssignmentLabels;
    selectedIndex?: number;
    /**
     * BB-373 — a contributed panel's rows, already resolved by the screen.
     *
     * Present ⇒ this tab is a PANEL and `tabIndex` names no built-in section.
     * The panel's rows go through the very same expansion, keying and selection
     * arithmetic the built-ins use, which is the whole point of the narrow
     * `PanelSection[]` contract (spec D4): an addon restates none of it.
     */
    panelSections?: readonly (Section & { readonly expandable?: boolean })[];
  } = {},
): TabView {
  if (panelSections) {
    const sections: Section[] = panelSections.map((section) => ({
      heading: section.heading,
      lines: [...section.lines],
    }));
    const expandableHeadings = new Set(
      panelSections.filter((s) => s.expandable).map((s) => s.heading),
    );
    return tabViewFrom(
      sectionTabRows(sections, {
        expanded,
        expandableHeadings,
        summarize: firstLineSummary,
        // BB-373 AC-10 — and this is the ONE line that scopes the injective
        // derivation to contributions. A panel's headings are data, so they need
        // a key that does not collapse; a built-in's are a closed set that has
        // keyed the same way since BB-340 and must keep doing so.
        keyOf: panelSectionKey,
      }),
      selectedIndex,
    );
  }
  const id = TICKET_SECTIONS[tabIndex]?.id;
  if (id === 'runs') {
    const runs = ticketRunRows(detail ?? {});
    return {
      body: columnNode(
        BODY_ID,
        listTableTree(TICKET_RUN_TABLE, runs, nowSeconds, { selectedIndex }),
      ),
      // `headerRows[i] = 1 + i` because row 0 is the table's own header row —
      // exactly the `selRow = 1 + selectedRun` the project-wide Runs screen
      // uses, so the two screens' selection arithmetic is the same expression
      // rather than two guesses.
      headerRows: runs.map((_run, index) => 1 + index),
      selectable: runs.length,
      rowIds: listRowIds(TICKET_RUN_TABLE, runs),
    };
  }
  const view =
    id === 'comments'
      ? commentRows(commentItems(detail ?? {}), { expanded, nowSeconds })
      : sectionTabRows(
          sectionsForTab(detail ?? {}, tabIndex, labels, nowSeconds),
          { expanded },
        );
  return tabViewFrom(view, selectedIndex);
}

/**
 * An {@link ExpandableView}'s rows as the tree, the selection map and the click
 * map — the shape every non-table tab returns.
 *
 * Extracted in BB-373 rather than copied for the panel path: the three
 * derivations below have to stay one expression, or the entry a click opens and
 * the entry the cursor scrolls to could come apart for a contributed tab while
 * still agreeing for a built-in one.
 */
function tabViewFrom(view: ExpandableView, selectedIndex: number): TabView {
  return {
    body: columnNode(
      BODY_ID,
      // The selected ENTRY's header row, which is the row the highlight has
      // always been on. Stated for every row on every frame, off included:
      // `patchTree` writes only what the next tree declares and cannot clear a
      // prop it omits (`lib/vnode.ts`).
      ...view.rows.map((row, index) =>
        sectionRowNode(BODY_ID, row, view.headerRows[selectedIndex] === index),
      ),
    ),
    headerRows: view.headerRows,
    selectable: view.selectable,
    // The entry rows' own nodes, read off the same rows the tree is built from
    // — an entry is its HEADER row, which is exactly what `headerRows` indexes.
    rowIds: view.headerRows.map((row) => `${BODY_ID}-${view.rows[row]?.key}`),
  };
}
