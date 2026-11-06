import { describe, expect, it } from 'bun:test';
import { createTextAttributes } from '@opentui/core';
import type {
  ConductorActionResult,
  ConductorProcessHost,
} from '../../src/Entity/conductor/Data/process.js';
import { NOTICE_ANIM_MS } from '../../src/Kernel/chrome.js';
import type {
  Collection,
  DropshClient,
  RendererServices,
  Resource,
} from '../../src/types.js';
import { bootTui, settle } from '../tui-harness.js';

/**
 * The Conductors screen, driven through the kernel's real key handling.
 *
 * Every action runs through an injected host, so this suite spawns no process
 * and signals no pid. The property that matters most is AC-8: an action is
 * FIRED, never awaited — the cockpit must stay navigable while a conductor
 * starts, because a start goes through herdr and is not instant.
 *
 * BB-375 — Conductors is a normal AsyncScreen. Refresh is the shared
 * `ui-refresh` file + `R` (see `auto-refresh.test.ts`), not a private 5 s tick.
 */
/** The attribute bit a bold cell carries — the same one `lib/vnode.ts` sets. */
const BOLD = createTextAttributes({ bold: true });

describe('the Conductors screen', () => {
  const WORKSPACE = '/tmp/bakers-conductors-test/.bakers';

  it('lists the conductors of the control plane', async () => {
    const tui = await openConductors();

    expect(text(tui)).toContain('cw-framework');
    // BB-450 D11: the fresh word is `online`, the server's own word.
    expect(text(tui)).toContain('online');

    await quit(tui);
  });

  // BB-345 AC 3/AC 4 — asserted on CELLS, on this surface, because nothing
  // else in the tree can see it.
  //
  // The conductors list gained a header with this ticket (spec D6) and bold is
  // what distinguishes it from a data row. Bold is invisible to
  // `captureCharFrame`, to every vitest node suite and to `verify-screen.mjs` —
  // the node case in `tests/Entity/conductor/Data/conductors.test.ts` asserts
  // that the eight LABELS are there and would pass with the emphasis missing.
  // `captureSpans()` reads the same attribute bits `createTextAttributes` sets,
  // so this is the only harness that can fail on it.
  it('paints the header row bold, and the rows under it plain', async () => {
    const tui = await openConductors();

    // Row 4 gap, row 5 tab bar, row 6 frame top, rows 7-9 the `mine`/`c clear`
    // badge strip (BB-460 D6), row 10 list header.
    const spans = tui.captureSpans().lines;
    const bold = (line: { spans: { attributes: number }[] } | undefined) =>
      (line?.spans ?? []).some((span) => (span.attributes & BOLD) !== 0);
    expect(tui.rows()[4], 'row 4 is the gap above the tabs').toBe('');
    expect(tui.rows()[5], 'row 5 is the tab bar').toMatch(/\[/);
    expect(tui.rows()[6], 'row 6 is the frame top').toMatch(/╭/);
    expect(tui.rows()[10], 'row 10 is the list header').toContain('WORKSPACE');
    expect(bold(spans[10]), 'the header row is bold').toBe(true);
    expect(bold(spans[11]), 'the conductor row under it is not').toBe(false);

    await quit(tui);
  });

  it('`s` starts the selected conductor exactly once, and reports the outcome (BB-450 review B6)', async () => {
    const host = fakeHost();
    // A stopped conductor: a running one is refused, which its own test covers.
    const tui = await openConductors({
      host,
      rows: [conductorDoc({ status: 'offline' })],
    });

    await tui.press('s');
    await settle();
    await tui.renderOnce();

    expect(host.starts.length).toBe(1);
    expect(host.starts[0]?.workspaceRoot).toBe(WORKSPACE);
    expect(host.stops.length).toBe(0);
    // The host's own `{ok, message}` reaches the footer — no longer discarded
    // at the call site.
    expect(text(tui)).toContain('done');

    await quit(tui);
  });

  it('start reloads the list in place and keeps the outcome in the footer', async () => {
    const host = fakeHost();
    const tui = await openConductors({
      host,
      rows: [conductorDoc({ status: 'offline' })],
    });
    const before = tui.reads();

    await tui.press('s');
    await settle();
    await tui.renderOnce();

    expect(tui.reads()).toBeGreaterThan(before);
    expect(text(tui)).toContain('done');
    expect(text(tui)).toContain('cw-framework');
    expect(text(tui)).not.toContain('Loading…');

    await quit(tui);
  });

  it('settles the action toast from a dot to a check without another key', async () => {
    const host = fakeHost();
    // A controlled clock, not a real setTimeout: the notice picks `·` vs `✓`
    // from its wall-clock age, so racing a real timer made this flaky (under
    // load the real gap between the toast appearing and the render overran
    // NOTICE_ANIM_MS and the mark was already `✓`). Holding the clock fixed
    // pins the age at 0 for the dot phase; advancing it past NOTICE_ANIM_MS
    // settles it — deterministically, regardless of how long `settle()` takes.
    let clockMs = 1000;
    const tui = await openConductors({
      host,
      rows: [conductorDoc({ status: 'offline' })],
      now: () => clockMs,
    });

    await tui.press('s');
    await settle();
    await tui.renderOnce();
    expect(text(tui)).toContain('· done');

    // Advance the (fake) clock past the animation window, then let the notice
    // spinner's real timer fire one draw: the mark it paints is decided by the
    // fake clock (deterministically `✓`), only the redraw trigger is real.
    clockMs += NOTICE_ANIM_MS + 40;
    await new Promise((resolve) => setTimeout(resolve, NOTICE_ANIM_MS + 40));
    await tui.renderOnce();
    expect(text(tui)).toContain('✓ done');
    expect(text(tui)).not.toContain('· done');

    await quit(tui);
  });

  it('`x` stops the selected conductor, passing its pid, and reports the outcome (BB-450 review B6)', async () => {
    const host = fakeHost();
    const tui = await openConductors({ host });

    await tui.press('x');
    await settle();
    await tui.renderOnce();

    expect(host.stops.length).toBe(1);
    expect(host.stops[0]?.pid).toBe(4242);
    expect(text(tui)).toContain('done');

    await quit(tui);
  });

  it('reports a refused start (host-mismatch) in the footer instead of discarding it (BB-450 review B6)', async () => {
    const host = fakeHost({
      result: { ok: false, message: 'refused: foreign host_key' },
    });
    const tui = await openConductors({
      host,
      rows: [conductorDoc({ status: 'offline' })],
    });

    await tui.press('s');
    await settle();
    await tui.renderOnce();

    expect(host.starts.length).toBe(1);
    expect(text(tui)).toContain('refused: foreign host_key');

    await quit(tui);
  });

  it('AC-8: a hanging action leaves the screen usable', async () => {
    // The action never resolves. What this asserts is that the screen stays
    // operable meanwhile: further keys are handled, the list re-reads, the
    // frame keeps drawing.
    //
    // What it deliberately does NOT claim is to have caught an `await` in the
    // key handler. Two earlier versions tried and both passed with an `await`
    // in place: the kernel handles one key event at a time and there is no way
    // from this harness to queue a second key behind a blocked handler. The
    // `void` in the branch is defence in depth rather than the load-bearing
    // part. Recorded here rather than left as a test that looks stronger than
    // it is.
    const host = fakeHost({ neverResolves: true });
    const tui = await openConductors({
      host,
      rows: [conductorDoc({ status: 'offline' })],
    });

    await tui.press('s');
    expect(host.starts.length).toBe(1); // the action fired

    const before = tui.reads();
    await tui.press('R');

    // and the screen still answers keys
    expect(tui.reads()).toBeGreaterThan(before);
    expect(text(tui)).toContain('cw-framework');

    await quit(tui);
  });

  it('a second press while an action is in flight does not act twice', async () => {
    const host = fakeHost({ neverResolves: true });
    const tui = await openConductors({
      host,
      rows: [conductorDoc({ status: 'offline' })],
    });

    await tui.press('s');
    await tui.press('s');
    await tui.press('s');

    expect(host.starts.length).toBe(1);

    await quit(tui);
  });

  it('marks a conductor whose host_key is not this machine view-only, before any key is pressed (BB-450 review B6/B10)', async () => {
    const host = fakeHost({ thisHostKey: 'cw-framework' });
    const tui = await openConductors({
      host,
      // SAME workspace_root as the default fixture — deliberately, per
      // BB-281 Finding 2: two `bb_conductor` records can name one
      // checkout under DIFFERENT machines. `isLocal` (a path check) cannot
      // tell these apart; only the machine's `host_key` can (B10).
      rows: [conductorDoc()],
      machines: [machineDoc({ host_key: 'some-other-machine' })],
    });

    // The footer already states it BEFORE any key is pressed — BB-375's
    // "actions-only footer, silent refusal" no longer holds for an identity
    // refusal: nothing else on this row says "not yours".
    expect(text(tui)).toContain('view-only');
    // BB-450 review B9: a row that cannot be acted on does not even
    // ADVERTISE the actions in the footer.
    expect(text(tui)).not.toContain('Start');
    expect(text(tui)).not.toContain('Stop');

    await tui.press('s');
    await tui.press('x');

    expect(host.starts.length).toBe(0);
    expect(host.stops.length).toBe(0);
    expect(text(tui)).toContain('view-only');

    await quit(tui);
  });

  it('opens the conductor detail scope for a foreign row too, and its Log tab says there is none here', async () => {
    const host = fakeHost({ thisHostKey: 'cw-framework' });
    const tui = await openConductors({
      host,
      // SAME workspace_root as the default fixture — this machine really has
      // a directory there (BB-281 Finding 2's shape) — only the machine's
      // host_key differs. `isLocal`'s filesystem check alone cannot tell this
      // row apart from a truly local one, which is exactly what let B12 tail
      // THIS machine's own log under a foreign conductor's heading.
      rows: [conductorDoc()],
      machines: [machineDoc({ host_key: 'some-other-machine' })],
    });

    // Enter is no longer gated on `mine` (D1/D12): it opens the conductor
    // detail scope for every row, and the `mine` gate moved onto the Log tab.
    await tui.press('\r');
    await settle();
    expect(text(tui)).toContain('bakers.build conductor —');

    for (let i = 0; i < 3; i++) await tui.press('\t');
    await settle();
    expect(text(tui)).toContain('runs on another machine; no log here');

    await quit(tui);
  });

  it('still tails the real log on the Log tab for a row this machine owns', async () => {
    const tui = await openConductors();

    await tui.press('\r');
    await settle();
    expect(text(tui)).toContain('bakers.build conductor —');

    for (let i = 0; i < 3; i++) await tui.press('\t');
    await settle();
    expect(text(tui)).toContain('log —');

    await quit(tui);
  });

  it('advertises Start/Stop in the footer for a row this machine owns (BB-450 review B9)', async () => {
    const tui = await openConductors({
      rows: [conductorDoc({ status: 'offline' })],
    });

    expect(text(tui)).toContain('Start');
    expect(text(tui)).toContain('Stop');

    await quit(tui);
  });

  it('reports the already-online refusal in the footer instead of staying silent (BB-450 review B6)', async () => {
    const host = fakeHost();
    const nowS = Math.floor(Date.now() / 1000);
    const tui = await openConductors({
      host,
      rows: [
        conductorDoc({
          last_seen: nowS,
          lease_expires_at: nowS + 300,
          status: 'online',
        }),
      ],
    });

    await tui.press('s');

    expect(host.starts.length).toBe(0);
    expect(text(tui)).toContain('already online');

    await quit(tui);
  });

  it('allows a start when the conductor crashed without saying so', async () => {
    // `status: online` with a lapsed lease is a crash: derived `stale`. The
    // block keys on the derived status precisely so this restart is possible.
    const host = fakeHost();
    const nowS = Math.floor(Date.now() / 1000);
    const tui = await openConductors({
      host,
      rows: [
        conductorDoc({
          status: 'online',
          last_seen: nowS - 5000,
          lease_expires_at: nowS - 4700,
        }),
      ],
    });

    await tui.press('s');

    expect(host.starts.length).toBe(1);

    await quit(tui);
  });

  it('`R` re-reads at once rather than waiting out the tick', async () => {
    const tui = await openConductors();
    const before = tui.reads();

    await tui.press('R');

    expect(tui.reads()).toBeGreaterThan(before);

    await quit(tui);
  });

  it('the footer names the SHARED `R reload`, not a screen-local `R refresh` (AC-4)', async () => {
    const tui = await openConductors();

    expect(text(tui)).toContain('R:reload');
    expect(text(tui)).not.toContain('R refresh');

    await quit(tui);
  });

  it('an explicit R keeps the list and shows a footer spinner until the re-read lands', async () => {
    const tui = await openConductors();

    tui.mockInput.pressKey('R');
    await tui.renderOnce();
    expect(text(tui)).toContain('cw-framework');
    expect(text(tui)).toContain('R:reload');
    expect(text(tui)).not.toContain('Loading…');

    await settle();
    await tui.renderOnce();
    expect(text(tui)).toContain('R:reload');
    expect(text(tui)).toContain('cw-framework');

    await quit(tui);
  });

  // BB-375 — private 5s tick removed; refresh is shared ui-refresh + R (see auto-refresh.test.ts).

  // ---- harness -------------------------------------------------------------

  interface FakeHostOptions {
    neverResolves?: boolean;
    result?: ConductorActionResult;
    /** BB-450 B10: THIS machine's own host_key, as `start`/`stop` see it. */
    thisHostKey?: string;
  }

  interface FakeHost extends ConductorProcessHost {
    starts: Array<{ workspaceRoot: string; conductorName: string | undefined }>;
    stops: Array<{ pid: number | undefined; hostKey: string | undefined }>;
  }

  /**
   * A fake `ConductorProcessHost` that answers `thisHostKey()` from a fixed
   * value (BB-450 B10) — never `defaultThisHostKey()`'s real
   * `~/.bakers/machine.config.js` read, which would make this suite as
   * non-deterministic as `conductor/tests/config.test.ts` names for the CLI
   * side. Defaults to `'cw-framework'`, matching {@link conductorDoc}'s
   * default machine so the existing start/stop cases stay `mine: true`
   * without every one of them naming the value.
   */
  function fakeHost(options: FakeHostOptions = {}): FakeHost {
    const starts: FakeHost['starts'] = [];
    const stops: FakeHost['stops'] = [];
    const answer = (): Promise<ConductorActionResult> =>
      options.neverResolves
        ? new Promise<ConductorActionResult>(() => {})
        : Promise.resolve(options.result ?? { ok: true, message: 'done' });
    return {
      starts,
      stops,
      async start(input) {
        starts.push(input);
        return answer();
      },
      async stop(input) {
        stops.push(input);
        return answer();
      },
      async thisHostKey() {
        return options.thisHostKey ?? 'cw-framework';
      },
    };
  }

  const MACHINE_UUID = 'machine-uuid-1';

  const conductorDoc = (
    attrs: Record<string, unknown> = {},
    machineId: string | null = MACHINE_UUID,
  ) => ({
    id: 'c1',
    type: 'bb_conductor--bb_conductor',
    attributes: {
      label: 'cw-framework',
      machine_id: 'cw-framework',
      status: 'online',
      workspace_root: WORKSPACE,
      last_seen: Math.floor(Date.now() / 1000),
      lease_expires_at: Math.floor(Date.now() / 1000) + 300,
      last_pid: 4242,
      conductor_name: 'conductor',
      // NO host_key here (BB-450 B7): bb_conductor carries no such field
      // in reality. It lives on the sideloaded machine below.
      current_load: 0,
      max_parallel: 5,
      ...attrs,
    },
    relationships: machineId
      ? { machine: { data: { id: machineId, type: 'bb_machine' } } }
      : {},
  });

  const machineDoc = (attrs: Record<string, unknown> = {}) => ({
    id: MACHINE_UUID,
    type: 'bb_machine--bb_machine',
    attributes: { host_key: 'cw-framework', max_parallel: 5, ...attrs },
  });

  async function openConductors(
    opts: {
      host?: ConductorProcessHost;
      rows?: ReturnType<typeof conductorDoc>[];
      machines?: ReturnType<typeof machineDoc>[];
      now?: () => number;
    } = {},
  ) {
    // The screen marks a row local by whether its workspace exists, so the
    // default fixture points at a directory this test creates.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(WORKSPACE, { recursive: true });

    let conductorReads = 0;
    const docs = opts.rows ?? [conductorDoc()];
    const machines = opts.machines ?? [machineDoc()];
    const services = fakeServices(docs, machines, () => {
      conductorReads += 1;
    });
    // A controlled clock lets the toast-animation test assert the transient
    // `·` phase deterministically instead of racing a real setTimeout.
    if (opts.now) services.now = opts.now;
    // BB-450 B10: always a FAKE host, even when the test does not care
    // about start/stop — `load()` now resolves `thisHostKey()` on every
    // read, and the real default would touch this machine's actual
    // `~/.bakers/machine.config.js`.
    const host = opts.host ?? fakeHost();

    // The geometry the fake TTY used, kept so every column-sensitive
    // assertion below reads the same frame it always did.
    const tui = await bootTui({
      services,
      columns: 140,
      rows: 44,
      tui: { conductorProcess: host },
    });
    // Boot lands on My work. From there the product order is Projects →
    // Conductors.
    await tui.press('\t');
    await tui.press('\t');
    return { ...tui, reads: () => conductorReads };
  }

  /**
   * The two read surfaces a conductor is reachable through, both faked.
   *
   * `client.get` is the one THIS screen uses: BB-353 moved
   * the conductor read onto the raw JSON:API path so host capacity (and,
   * since BB-450, `host_key`) can be sideloaded (`include=machine`), and
   * `conductorDoc` is already a raw resource, so it needs no projection
   * there. The `collection` route stays for the form adapters that still
   * read conductors through it. Only the raw path counts as a read, because
   * only it is the screen's.
   *
   * A silent `{ data: [] }` for every path is what made this suite fail after
   * the develop merge: an unfaked path answers "no conductors" rather than
   * erroring, so a broken fixture reads as an empty collection. Fake every
   * path the screen reaches, or the suite reports a fixture gap as a product
   * one.
   */
  function fakeServices(
    docs: ReturnType<typeof conductorDoc>[],
    machines: ReturnType<typeof machineDoc>[],
    onConductorRead: () => void,
  ): RendererServices {
    const collection = (type: string): Collection => {
      const c: Collection = {
        where: () => c,
        sort: () => c,
        page: () => c,
        first: async () => null,
        list: async () =>
          type === 'bb_conductor' ? (docs.map(toResource) as Resource[]) : [],
      };
      return c;
    };
    const client = {
      collection,
      get: async (path: string) => {
        // A single-entity read (the conductor detail scope's shared header)
        // asks `bb_conductor/bb_conductor/<id>?include=machine` — answer
        // with ONE resource, never the list's array.
        if (path.startsWith('bb_conductor/bb_conductor/')) {
          const id = path
            .slice('bb_conductor/bb_conductor/'.length)
            .split('?')[0];
          const doc = docs.find((d) => d.id === id) ?? docs[0];
          return { data: doc, included: machines };
        }
        if (path !== 'bb_conductor/bb_conductor') return { data: [] };
        onConductorRead();
        return { data: docs, included: machines };
      },
      patch: async () => ({}),
      post: async () => ({}),
    } as unknown as DropshClient;
    return { client, baseUrl: 'http://web' };
  }

  function toResource(doc: ReturnType<typeof conductorDoc>): Resource {
    return {
      id: doc.id,
      type: doc.type,
      attr: <T>(name: string): T | undefined =>
        (doc.attributes as Record<string, unknown>)[name] as T | undefined,
      rel: () => null,
    } as unknown as Resource;
  }
});

type BootedConductors = Awaited<ReturnType<typeof bootTui>> & {
  reads: () => number;
};

async function quit(tui: BootedConductors): Promise<void> {
  tui.mockInput.pressKey('q');
  await tui.running;
  await tui.stop();
}

/**
 * The CURRENT screen as one whitespace-collapsed string.
 *
 * The vitest original sliced the write transcript at its last clear-screen and
 * collapsed the runs of spaces, so a `toContain` could span the gap between
 * two columns of a row. That normalization is kept deliberately — every
 * assertion in this file was written against it — but the input is now the
 * render buffer, so nothing that has scrolled away can answer.
 */
function text(tui: { frame(): string }): string {
  return tui.frame().replace(/\s+/g, ' ');
}
