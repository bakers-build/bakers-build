// BB-255 D6 — the run detail screen's content.
//
// It renders the run resource the TICKET DOCUMENT ALREADY CARRIES, selected by
// id: the `runs` include ships each run's full attribute set (spec fact 5), so
// this screen performs no read, makes no client call and adds no failure path.
// It is titled sections of rows like every other block, and every section has an
// explicit empty state — a missing value is stated, never a blank row.
//
// BB-340 D1 — the FIRST block to hand its content over as renderables rather
// than as rows of text: the sections are built once, keyed, and turned into a
// VNode tree.
//
// BB-372 D9 — IT IS `markdownRow`'S ONLY CALLER NOW, and the ATX-only rule is
// THIS SCREEN'S rule rather than a rule shared with the ticket detail. A run log
// entry is MACHINE OUTPUT, not authored Markdown: an agent line full of `*`, `_`
// and backticks would be re-styled and have characters deleted by a renderer
// meant for prose. So the log keeps the narrow rule while the ticket detail's
// `bb_rich` bodies go through `Component/markdown/`. Nothing about this screen's
// behaviour changed; routing the log through the full subset is a separate
// ticket, not a silent side effect of that one.
//
// Read-only by design (the ticket's own out-of-scope list): no write, no edit, no
// navigation out of it except Esc.

import type { VNode } from '@opentui/core';
import { markdownRow } from '../../../../Component/markdown/index.js';
import { asString } from '../../../../lib/format.js';
import { columnNode, textNode } from '../../../../lib/vnode.js';
import type {
  JsonApiResource,
  TicketDetailDocument,
} from '../../../../types.js';

/** The sideloaded `bb_run` with this id, or undefined. */
export function runResource(
  document: TicketDetailDocument,
  runId: string | null | undefined,
): JsonApiResource | undefined {
  if (!runId) return undefined;
  return (document.included ?? []).find(
    (r) => r.type === 'bb_run--bb_run' && r.id === runId,
  );
}

/** The id of a to-one relationship on a resource, or null. */
function relId(resource: JsonApiResource, name: string): string | null {
  const data = resource.relationships?.[name]?.data;
  if (!data) return null;
  return Array.isArray(data) ? (data[0]?.id ?? null) : data.id;
}

/** A scalar field as a display row value: the value, or an explicit dash. */
function scalar(value: unknown): string {
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '—';
}

/**
 * A row, with the KEY its renderable is identified by (BB-340 D4/R4).
 *
 * The key says what the row IS — `field-state`, `log-12` — never where it sits
 * in the block. `Kernel/mount.ts` patches a standing tree by `props.id`, so a
 * positional key would move one row's content onto another row's node as soon
 * as anything above it appears or disappears, with nothing on screen to say so.
 * Every key here is scoped by its section, which is what makes the whole set
 * unique by construction rather than by the labels happening not to repeat.
 */
interface KeyedRow {
  readonly key: string;
  readonly text: string;
}

/** A titled block of keyed rows — the run block's own shape (see D4). */
interface KeyedSection {
  readonly key: string;
  readonly heading: string;
  readonly rows: readonly KeyedRow[];
}

/** `label:<pad> value` — one physical row, aligned so the values line up. */
const row = (label: string, value: unknown): string =>
  `${`${label}:`.padEnd(15)}${scalar(value)}`;

/** A labelled value row, keyed by its label: `claim expires` → `field-claim-expires`. */
const field = (label: string, value: unknown): KeyedRow => ({
  key: `field-${label.replace(/\s+/g, '-')}`,
  text: row(label, value),
});

/** The owning ticket's identifier, from the document the run was read out of. */
const ticketIdentifier = (document: TicketDetailDocument): string =>
  asString(document.data?.attributes?.identifier) ?? '—';

/**
 * The conductor that owns the run: the sideloaded include's label, else its
 * `machine_id`, else the raw uuid, else an explicit dash. The same ladder the
 * ticket's Assignment section uses — `bb_conductor` is owner-gated for
 * `session`, so the include is genuinely absent for someone else's conductor and
 * a uuid is ugly but true (BB-233).
 */
function conductorLabel(
  document: TicketDetailDocument,
  run: JsonApiResource,
): string {
  const id = relId(run, 'conductor_id');
  if (id === null) return '—';
  const included = (document.included ?? []).find(
    (r) => r.type === 'bb_conductor--bb_conductor' && r.id === id,
  );
  return (
    asString(included?.attributes?.label) ??
    asString(included?.attributes?.machine_id) ??
    id
  );
}

/** `#<id> · <ticket> · <state>` — the run screen's header-box title row. */
export function runDetailTitle(
  document: TicketDetailDocument,
  runId: string | null | undefined,
): string {
  const run = runResource(document, runId);
  if (!run) return 'run';
  const a = run.attributes ?? {};
  return `#${scalar(a.drupal_internal__id)} · ${ticketIdentifier(document)} · ${scalar(a.state)}`;
}

/**
 * The run's sections as KEYED rows, in the order the screen draws them. An
 * unresolvable run yields ONE section saying so, rather than an empty screen
 * that looks like a failed render.
 *
 * This is the one place the block's content is stated, and {@link runDetailTree}
 * is the one thing that renders it. The `Section[]` projection this component
 * used to export beside it went with the row surface (BB-340 D1): nothing drew
 * it once the screen handed over nodes, and a second description of a screen
 * that nobody draws is exactly what drifts.
 */
function keyedSections(
  document: TicketDetailDocument,
  runId: string | null | undefined,
  baseUrl: string | undefined,
): KeyedSection[] {
  const run = runResource(document, runId);
  if (!run) {
    return [
      {
        key: 'run',
        heading: 'Run',
        rows: [{ key: 'missing', text: 'No run selected.' }],
      },
    ];
  }
  const a = run.attributes ?? {};
  // The transcript/error payload no longer lives on the entity (BB-556) —
  // preSave() writes it to a private file and clears the field, so what the
  // API returns is the byte count, not the text. `bytes > 0` and "unset"
  // read differently: the first is a payload retrievable through the run
  // log download route, the second is either a true empty log or, for the
  // transcript, a `capture_logs: false` conductor — the operator cannot
  // tell those apart from a truncated body, so say "not captured" instead
  // of implying failure.
  const logSizeSection = (
    key: string,
    heading: string,
    bytes: unknown,
    notCapturedMessage: string,
    kind: 'log' | 'error_log',
  ): KeyedSection => {
    const captured = typeof bytes === 'number';
    const text = captured
      ? `Captured (${bytes} bytes). ${runLogUrl(baseUrl, run.id, kind) ?? 'Retrieve via the run log download route.'}`
      : notCapturedMessage;
    return {
      key,
      heading,
      rows: [{ key: `${key}-empty`, text }],
    };
  };

  return [
    {
      key: 'run',
      heading: 'Run',
      rows: [
        {
          key: 'run-identity',
          text: `#${scalar(a.drupal_internal__id)} · ${run.id ?? '—'}`,
        },
        field('ticket', ticketIdentifier(document)),
      ],
    },
    {
      key: 'state',
      heading: 'State',
      rows: [
        field('state', a.state),
        field('phase', a.state_at_start),
        field('agent', a.agent),
        field('conductor', conductorLabel(document, run)),
      ],
    },
    {
      key: 'timing',
      heading: 'Timing',
      rows: [
        field('started', a.started_at),
        field('heartbeat', a.heartbeat),
        field('claim expires', a.claim_expires_at),
        field('duration', a.duration_s),
        field('active', a.active_s),
      ],
    },
    {
      key: 'footprint',
      heading: 'Footprint',
      rows: [
        field('tokens', a.tokens),
        field('tool calls', a.tool_calls),
        field('agent turns', a.agent_turns),
        field('user prompts', a.user_prompts),
        field('prompt words', a.user_prompt_words),
      ],
    },
    {
      key: 'worktree',
      heading: 'Worktree',
      rows: [
        {
          key: 'worktree-path',
          text:
            typeof a.worktree_path === 'string' && a.worktree_path !== ''
              ? a.worktree_path
              : 'No worktree path.',
        },
      ],
    },
    // R5 no longer applies to what's rendered here: the payload moved to a
    // private file (BB-556), so the section shows the size, not the text.
    logSizeSection(
      'log',
      'Log',
      a.log_bytes,
      'Transcript not captured.',
      'log',
    ),
    logSizeSection(
      'error-log',
      'Error log',
      a.error_log_bytes,
      'No errors logged.',
      'error_log',
    ),
  ];
}

/**
 * The run-log download route's resolved URL (`_bakers-api/run/{uuid}/log/{kind}`,
 * @see bakers-cli/addons/remote-drupal/src/index.ts createRunLogFetcher), so an
 * operator reading the run detail screen has something to open rather than a
 * sentence naming a route with no address. `undefined` when the control plane's
 * base URL is not known, which the caller falls back on.
 */
function runLogUrl(
  baseUrl: string | undefined,
  runId: string | undefined,
  kind: 'log' | 'error_log',
): string | undefined {
  if (!baseUrl || !runId) return undefined;
  return `${baseUrl.replace(/\/+$/, '')}/_bakers-api/run/${runId}/log/${kind}`;
}

/**
 * One body row as a renderable. Bold is a PROP here, never an index (D3), and
 * it is stated on every row rather than only on the bold ones — a log line that
 * stops being an ATX heading has to stop being bold, which a prop the next tree
 * omits can never do (`lib/vnode.ts`).
 */
const textRow = (key: string, text: string, bold = false): VNode =>
  textNode({ id: `run-detail-${key}`, content: text, bold });

/**
 * The sections FLATTENED into the rows the screen draws, in draw order.
 *
 * The single traversal both shapes of this block come from: {@link
 * runDetailTree} turns each entry into a node, {@link runDetailRows} takes each
 * entry's text. Written once rather than twice on purpose — the tree and the
 * pipe's text would otherwise be two independent descriptions of the same
 * screen's order and content, which is exactly the drift Task 6 deleted a
 * `Section[]` projection to remove. `tests/Screen/run-detail-non-tty.test.ts`
 * asserts the two projections row for row, so a section reachable from only one
 * of them fails rather than diverges quietly.
 */
function flatRows(
  document: TicketDetailDocument,
  runId: string | null | undefined,
  baseUrl: string | undefined,
): { key: string; text: string; bold: boolean }[] {
  return keyedSections(document, runId, baseUrl).flatMap((section) => [
    { key: `section-${section.key}`, text: section.heading, bold: true },
    ...section.rows.map((entry) => ({
      key: entry.key,
      // The log's OWN minimal-markdown rule (BB-372 D9): an ATX heading inside
      // a log entry renders bold with its markers stripped, and a log line
      // starting with `#` must not render one way on screen and another way in a
      // pipe. Nothing else in an entry is parsed, deliberately — see the header.
      ...markdownRow(entry.text),
    })),
    // The blank row between two sections, which the flattened surface pushed
    // after every block. The kernel's non-interactive branch drops empties, so
    // it is a spacer on screen and invisible in a pipe — as it always was.
    { key: `gap-${section.key}`, text: '', bold: false },
  ]);
}

/**
 * The run block as the renderable tree the screen hands over (BB-340 D1).
 *
 * The FIRST screen on this side of the boundary, and the shape every other one
 * follows: one node per row, each with an id that says what the row is, and the
 * styling as props on the node rather than as indices into a surface the kernel
 * has to interpret. The root is the component's own `run-detail`;
 * `presentation()` puts the kernel's body-window root over it, because the id of
 * that slot is the kernel's to know and a component may not import it.
 */
export function runDetailTree(
  document: TicketDetailDocument,
  runId: string | null | undefined,
  baseUrl?: string | undefined,
): VNode {
  return columnNode(
    'run-detail',
    ...flatRows(document, runId, baseUrl).map((entry) =>
      textRow(entry.key, entry.text, entry.bold),
    ),
  );
}

/**
 * The run block as PLAIN TEXT — the pipe's own output (spec F5).
 *
 * The operator's ruling after plan Task 10: a run is handled exactly like every
 * other entity. `ticket.detail`, the dashboard and the project picker each print
 * a deliberately different text into a pipe rather than a rendering of their
 * surface; the run detail was the only entity detail that did not, which is the
 * only reason its rows went through the tree→text path at all. That path renders
 * a CELL GRID of a fixed width, and a pipe has no width: measured on run #4928,
 * 420 transcript rows were clipped at 80 columns and 97.7 % of a 1.34 MB
 * captured transcript never reached stdout.
 *
 * Nothing here measures a string (R5): a pipe's text is unpadded by definition,
 * so this is the same rows the tree carries and no column arithmetic at all.
 */
export function runDetailRows(
  document: TicketDetailDocument,
  runId: string | null | undefined,
  baseUrl?: string | undefined,
): string[] {
  return flatRows(document, runId, baseUrl).map((entry) => entry.text);
}
