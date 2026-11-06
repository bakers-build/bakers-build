/**
 * Renderer-neutral page latency protocol for the ten former React routes.
 *
 * The same file drives the React revision and the native revision: it reaches
 * every route through the router (a contributed launcher tab captures
 * `context.navigate`), serves every read from local deterministic fixtures, and
 * stops each clock only on a verified frame — a ready sample when the route's
 * marker is painted, an input sample when the frame differs from the one before
 * the dispatch and satisfies the action's own predicate. No fixed wait is
 * timed or subtracted.
 */

import type { CapturedFrame } from '@opentui/core';
import { ticketInputContext } from '../../src/Entity/ticket/Data/input.js';
import { TicketReactMarkdownScreen } from '../../src/Entity/ticket/Screen/ticket-react-markdown.js';
import { register, resetCollector } from '../../src/Extension/store.js';
import { columnNode, textNode } from '../../src/lib/vnode.js';
import {
  BaseScreen,
  presentation,
  type ScreenContext,
  type ScreenPresentation,
} from '../../src/Screen/screen.js';
import type {
  Collection,
  DropshClient,
  RendererServices,
  Resource,
} from '../../src/types.js';
import { type BootedTui, bootTui, settle } from '../tui-harness.js';
import {
  DESCRIPTION_FIRST,
  LONG_TICKET_ID,
  longTicketDocument,
} from './long-ticket.js';

export const BENCH_ROUTES = [
  'ticket.detail',
  'ticket.planning',
  'ticket.comments',
  'ticket.react-markdown',
] as const;
export type BenchRoute = (typeof BENCH_ROUTES)[number];

export const BENCH_SIZES = [
  { columns: 80, rows: 24 },
  { columns: 140, rows: 45 },
] as const;

export interface PageSample {
  route: string;
  columns: number;
  rows: number;
  kind: 'ready' | 'input';
  action: string;
  elapsedMs: number;
  frameVerified: boolean;
}

export interface Protocol {
  readonly warmups: number;
  readonly ready: number;
  readonly inputs: number;
}

export const FULL_PROTOCOL: Protocol = { warmups: 5, ready: 30, inputs: 100 };
export const SMOKE_PROTOCOL: Protocol = { warmups: 0, ready: 1, inputs: 1 };

/** Fixed clock for relative dates, identical on both legs. */
export const FIXED_NOW_SECONDS = Date.parse('2026-09-28T12:00:00Z') / 1000;

const WORKSPACE_ID = '019d3518-5180-7000-8000-00000000a002';
const LAUNCHER_MARKER = 'BENCH-LAUNCHER-READY';
const SPEC_MARKER = 'PLANNING-SPEC-MARKER';

// ---- fixtures --------------------------------------------------------------

const planningComment = (type: 'spec' | 'plan' | 'test', index: number) => ({
  type: 'bb_comment--bb_comment',
  id: `019d3518-5180-7000-8000-00000000b00${index}`,
  attributes: {
    drupal_internal__id: 9900 + index,
    bb_comment_type: type,
    author_name: `planner-${index}`,
    created: '2026-09-20T10:00:00Z',
    body: {
      value: [
        `## ${type === 'spec' ? SPEC_MARKER : `${type.toUpperCase()}-MARKER`}`,
        '',
        ...Array.from(
          { length: 60 },
          (_, line) =>
            `${type} line ${line} with **bold** text and \`code\` in a paragraph long enough to wrap at narrow widths.`,
        ),
      ].join('\n'),
    },
  },
});

export const benchTicketDocument = () => {
  const document = longTicketDocument();
  return {
    ...document,
    included: [
      ...document.included,
      planningComment('spec', 1),
      planningComment('plan', 2),
      planningComment('test', 3),
    ],
  };
};

const resource = (
  id: string,
  attributes: Record<string, unknown>,
): Resource => ({
  id,
  type: 'fixture',
  attr: (key) => attributes[key],
  rel: () => null,
  rels: () => [],
});

export interface BenchWorld {
  readonly services: RendererServices;
  /** Writes attempted through the fixture client — the demos must make none. */
  writes(): number;
}

export function benchWorld(): BenchWorld {
  let writes = 0;
  const ticket = benchTicketDocument();
  const collection = (type: string): Collection => {
    const result: Collection = {
      where: () => result,
      sort: () => result,
      page: () => result,
      first: async () =>
        type === 'bb_workspace'
          ? resource(WORKSPACE_ID, {
              drupal_internal__id: 7,
            })
          : null,
      list: async () => [],
    };
    return result;
  };
  const client: DropshClient = {
    collection,
    get: async (path: string) => {
      if (path.includes(LONG_TICKET_ID)) return ticket;
      return { data: [] };
    },
    update: async () => {
      writes++;
      return {};
    },
    create: async () => {
      writes++;
      return {};
    },
  };
  return {
    services: {
      client,
      writeClient: client,
      baseUrl: 'https://example.test',
      currentUser: 'operator',
      workspaceId: WORKSPACE_ID,
    },
    writes: () => writes,
  };
}

// ---- route access ----------------------------------------------------------

/** Holds the navigate seam of the running router while the launcher is shown. */
const launcher: { context: ScreenContext | undefined } = { context: undefined };

class BenchLauncherScreen extends BaseScreen {
  static readonly route = {
    id: 'bench.launcher',
    path: '/tickets/:ticketId/bench',
    parent: 'project.tickets',
    tab: { id: 'bench', label: 'Bench', scope: 'ticket', weight: 900 },
    fallback: { routeId: 'my.work' },
    context: ticketInputContext,
  };
  readonly id = BenchLauncherScreen.route.id;
  override enter(context: ScreenContext): void {
    launcher.context = context;
    context.requestDraw();
  }
  present(): ScreenPresentation {
    return presentation(
      columnNode(
        'bench-launcher',
        textNode({ id: 'bench-launcher-marker', content: LAUNCHER_MARKER }),
      ),
    );
  }
  renderNonInteractive(): string[] {
    return [LAUNCHER_MARKER];
  }
}

const TICKET = { ticketId: LONG_TICKET_ID, view: 'full' };

const routeParams = (route: BenchRoute): Record<string, string> => {
  switch (route) {
    case 'ticket.detail':
    case 'ticket.planning':
    case 'ticket.comments':
    case 'ticket.react-markdown':
      return { ...TICKET };
  }
};

// ---- frames ----------------------------------------------------------------

const colour = (value: { r: number; g: number; b: number; a: number }) =>
  `${value.r},${value.g},${value.b},${value.a}`;

/** Characters plus styling — selection is a colour change, not a text change. */
const signatureOf = (frame: CapturedFrame): string =>
  frame.lines
    .map((line) =>
      line.spans
        .map(
          (span) =>
            `${span.text}\u0001${colour(span.fg)}\u0001${colour(span.bg)}\u0001${span.attributes}`,
        )
        .join('\u0002'),
    )
    .join('\n');

const has = (tui: BootedTui, id: string): boolean =>
  tui.renderer.root.findDescendantById(id) !== undefined;

interface Marker {
  readonly text: string;
  /** A renderable that proves the content, not just its heading, mounted. */
  readonly node?: string;
}

const MARKERS: Record<BenchRoute, Marker> = {
  'ticket.detail': { text: DESCRIPTION_FIRST },
  'ticket.planning': { text: SPEC_MARKER },
  'ticket.comments': { text: 'planner-3' },
  'ticket.react-markdown': { text: 'Ticket description' },
};

const markerPainted = (tui: BootedTui, marker: Marker): boolean =>
  tui.frame().includes(marker.text) &&
  (marker.node === undefined || has(tui, marker.node));

const yieldTurn = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

/**
 * Render until `done` holds and return when the frame that satisfied it was
 * painted — the timestamp is taken right after that `renderOnce`, so the cost
 * of checking a frame is never part of a sample. The yields let real promise
 * chains and scheduled updates settle; they are measured because the route's
 * own deferred work is.
 */
async function paintUntil(
  tui: BootedTui,
  done: () => boolean,
  maxPasses = 200,
): Promise<number | undefined> {
  for (let pass = 0; pass < maxPasses; pass++) {
    await tui.renderOnce();
    const painted = performance.now();
    if (done()) return painted;
    await yieldTurn();
  }
  return undefined;
}

// ---- actions ---------------------------------------------------------------

const ENTER = '\r';
const PAGE_DOWN = '\x1b[6~';
const PAGE_UP = '\x1b[5~';

interface InputAction {
  readonly name: string;
  /** Dispatch sample `index`; alternating steps keep every sample a change. */
  dispatch(tui: BootedTui, index: number, size: Size): Promise<void> | void;
  /** Extra condition beyond "the frame changed". */
  verify?(tui: BootedTui, index: number): boolean;
  /** Untimed setup that makes the action's target visible. */
  prepare?(tui: BootedTui, size: Size): Promise<void>;
}

interface Size {
  readonly columns: number;
  readonly rows: number;
}

const key =
  (...keys: string[]) =>
  (tui: BootedTui, index: number) => {
    tui.mockInput.pressKey(keys[index % keys.length] as string);
  };

const wheel = async (tui: BootedTui, index: number, size: Size) => {
  await tui.mockMouse.scroll(
    Math.floor(size.columns / 3),
    Math.floor(size.rows / 2),
    index % 2 === 0 ? 'down' : 'up',
    { delayMs: 0 },
  );
};

const SELECT: InputAction = { name: 'select', dispatch: key('j', 'k') };
const TOGGLE: InputAction = { name: 'expand', dispatch: key(ENTER) };
const WHEEL: InputAction = { name: 'wheel', dispatch: wheel };
const ACTIONS: Record<BenchRoute, readonly InputAction[]> = {
  'ticket.detail': [SELECT, TOGGLE, WHEEL],
  'ticket.planning': [SELECT, TOGGLE],
  'ticket.comments': [SELECT, TOGGLE, WHEEL],
  'ticket.react-markdown': [
    WHEEL,
    { name: 'page', dispatch: key(PAGE_DOWN, PAGE_UP) },
  ],
};

// ---- protocol --------------------------------------------------------------

async function bootBench(size: Size): Promise<{
  tui: BootedTui;
  world: BenchWorld;
  navigate: (route: string, params: Record<string, string>) => void;
}> {
  resetCollector();
  register('bench/pages', (api) => {
    api.add(TicketReactMarkdownScreen);
    api.add(BenchLauncherScreen);
  });
  launcher.context = undefined;
  const world = benchWorld();
  const tui = await bootTui({
    services: world.services,
    columns: size.columns,
    rows: size.rows,
    tui: {
      route: { screen: 'ticket', ticketId: LONG_TICKET_ID, view: 'full' },
      // The workspace member routes exist only for a workspace lead.
      isWorkspaceAdmin: true,
    },
  });
  // Overview → Shift+Tab wraps to the last ticket tab, the launcher.
  for (let step = 0; step < 6 && launcher.context === undefined; step++)
    await tui.press('\x1b[Z');
  const context = launcher.context as ScreenContext | undefined;
  const navigate = context?.navigate;
  if (navigate === undefined)
    throw new Error('page benchmark: the launcher tab was not reachable');
  return { tui, world, navigate };
}

async function quit(tui: BootedTui): Promise<void> {
  tui.mockInput.pressKey('\x03');
  await tui.running.catch(() => undefined);
  await tui.stop();
}

let sampleSeq = 0;

async function readySample(
  tui: BootedTui,
  navigate: (route: string, params: Record<string, string>) => void,
  route: BenchRoute,
): Promise<{ elapsedMs: number; frameVerified: boolean }> {
  navigate('bench.launcher', { ...TICKET, benchSample: String(++sampleSeq) });
  if (
    (await paintUntil(tui, () => tui.frame().includes(LAUNCHER_MARKER))) ===
    undefined
  )
    throw new Error('page benchmark: launcher frame not painted');
  const marker = MARKERS[route];
  const params = { ...routeParams(route), benchSample: String(++sampleSeq) };
  const start = performance.now();
  navigate(route, params);
  const painted = await paintUntil(tui, () => markerPainted(tui, marker));
  return outcome(start, painted);
}

async function inputSample(
  tui: BootedTui,
  action: InputAction,
  index: number,
  size: Size,
): Promise<{ elapsedMs: number; frameVerified: boolean }> {
  await tui.renderOnce();
  const before = signatureOf(tui.captureSpans());
  const start = performance.now();
  await action.dispatch(tui, index, size);
  const painted = await paintUntil(
    tui,
    () =>
      signatureOf(tui.captureSpans()) !== before &&
      (action.verify === undefined || action.verify(tui, index)),
  );
  return outcome(start, painted);
}

/** An unverified sample keeps its (capped) time but is marked as such. */
const outcome = (
  start: number,
  painted: number | undefined,
): { elapsedMs: number; frameVerified: boolean } => ({
  elapsedMs: (painted ?? performance.now()) - start,
  frameVerified: painted !== undefined,
});

export interface BenchmarkOptions {
  readonly protocol: Protocol;
  readonly routes?: readonly BenchRoute[];
  readonly sizes?: readonly Size[];
}

export interface BenchmarkResult {
  readonly samples: PageSample[];
  readonly writes: number;
}

/** Run every route at every size; warmups are executed and discarded. */
export async function runPageBenchmark(
  options: BenchmarkOptions,
): Promise<BenchmarkResult> {
  const samples: PageSample[] = [];
  let writes = 0;
  const realNow = Date.now;
  Date.now = () => FIXED_NOW_SECONDS * 1000;
  try {
    for (const size of options.sizes ?? BENCH_SIZES) {
      for (const route of options.routes ?? BENCH_ROUTES) {
        const { tui, world, navigate } = await bootBench(size);
        try {
          const record = (
            kind: PageSample['kind'],
            action: string,
            result: { elapsedMs: number; frameVerified: boolean },
          ) =>
            samples.push({
              route,
              columns: size.columns,
              rows: size.rows,
              kind,
              action,
              ...result,
            });
          for (let index = 0; index < options.protocol.warmups; index++)
            await readySample(tui, navigate, route);
          for (let index = 0; index < options.protocol.ready; index++)
            record('ready', 'open', await readySample(tui, navigate, route));
          for (const action of ACTIONS[route]) {
            // A fresh visit per class, so one class's state cannot starve the
            // next (an expanded entry scrolled away, a dialog left open).
            const visit = async () => {
              await readySample(tui, navigate, route);
              // Untimed: let deferred work of the fresh visit (effects,
              // subscriptions) settle before its first input is dispatched.
              await settle();
              await tui.renderOnce();
              await action.prepare?.(tui, size);
            };
            await visit();
            for (let index = 0; index < options.protocol.warmups; index++)
              await inputSample(tui, action, index, size);
            await visit();
            for (let index = 0; index < options.protocol.inputs; index++)
              record(
                'input',
                action.name,
                await inputSample(tui, action, index, size),
              );
          }
          writes += world.writes();
        } finally {
          await quit(tui);
        }
      }
    }
  } finally {
    Date.now = realNow;
    resetCollector();
  }
  return { samples, writes };
}

// ---- reporting -------------------------------------------------------------

export const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? Number.NaN;
};

export interface ActionStats {
  readonly n: number;
  readonly verified: number;
  readonly median: number;
  readonly p95: number;
}

export interface RouteSummary {
  readonly route: string;
  readonly size: string;
  readonly ready: ActionStats;
  readonly inputs: Record<string, ActionStats>;
  /** Median over input samples, every class weighted equally. */
  readonly inputMedian: number;
}

const statsOf = (samples: readonly PageSample[]): ActionStats => {
  const values = samples.map((sample) => sample.elapsedMs);
  return {
    n: samples.length,
    verified: samples.filter((sample) => sample.frameVerified).length,
    median: percentile(values, 50),
    p95: percentile(values, 95),
  };
};

/**
 * Balanced input median: each class contributes the same number of samples
 * (the smallest class size), taken in sample order, so a fast common action
 * cannot hide a slow rare one.
 */
const balancedMedian = (
  byClass: readonly (readonly PageSample[])[],
): number => {
  const size = Math.min(...byClass.map((samples) => samples.length));
  return percentile(
    byClass.flatMap((samples) =>
      samples.slice(0, size).map((sample) => sample.elapsedMs),
    ),
    50,
  );
};

export function summarize(samples: readonly PageSample[]): RouteSummary[] {
  const summaries: RouteSummary[] = [];
  for (const size of BENCH_SIZES) {
    for (const route of BENCH_ROUTES) {
      const mine = samples.filter(
        (sample) =>
          sample.route === route &&
          sample.columns === size.columns &&
          sample.rows === size.rows,
      );
      if (mine.length === 0) continue;
      const inputs: Record<string, ActionStats> = {};
      const byClass: PageSample[][] = [];
      for (const action of ACTIONS[route]) {
        const ofClass = mine.filter(
          (sample) => sample.kind === 'input' && sample.action === action.name,
        );
        inputs[action.name] = statsOf(ofClass);
        byClass.push(ofClass);
      }
      summaries.push({
        route,
        size: `${size.columns}x${size.rows}`,
        ready: statsOf(mine.filter((sample) => sample.kind === 'ready')),
        inputs,
        inputMedian: balancedMedian(byClass),
      });
    }
  }
  return summaries;
}

/** The action classes a route is measured with — exported for the smoke test. */
export const actionsFor = (route: BenchRoute): readonly string[] =>
  ACTIONS[route].map((action) => action.name);
