import { describe, expect, it } from 'bun:test';
import type {
  ConductorActionResult,
  ConductorProcessHost,
} from '../../src/Entity/conductor/Data/process.js';
import type {
  Collection,
  DropshClient,
  RendererServices,
  ResolvedRoute,
  Resource,
} from '../../src/types.js';
import { fakeClient, queryStringOf } from '../../tests/test-support.js';
import { bootTui, settle } from '../tui-harness.js';

/**
 * The project-scoped Conductors tab (BB-450 D13), driven through the
 * kernel's real key handling and rendered by the real bun renderer.
 *
 * BB-450 review B11 — `ProjectConductorsScreen` shipped with no test in
 * EITHER suite: `grep -rl 'ProjectConductorsScreen|project-conductors|PROJECT_CONDUCTOR_TABLE'`
 * over `tests-bun/` and `tests/` returned only a screen COUNT and the TABLE's
 * own data-layer test — never the screen itself. ~275 lines, including the
 * whole B6 fix and both halves of B9/B10, were executed by nothing. The
 * confirmed `test` comment's Seam 5 binds "rendering and key bindings through
 * the existing bun TUI harness with its frame capture", and AC-11's
 * retirement was conditioned on exactly that substitute existing. This file
 * is it — the project screen's own version of `Kernel/conductors.test.ts`,
 * not a duplicate of its assertions but proof the identical `act()`/`notice()`
 * code the root screen already covers actually RUNS here too.
 */
describe('the project-scoped Conductors tab', () => {
  const WORKSPACE = '/tmp/bakers-project-conductors-test/.bakers';
  const PROJECT = 'pppppppp-0000-0000-0000-000000000001';
  const MACHINE_UUID = 'machine-uuid-1';

  const PROJECT_ROUTE: ResolvedRoute = {
    screen: 'project',
    projectId: PROJECT,
    projectName: 'bakers',
  };

  interface FakeHostOptions {
    result?: ConductorActionResult;
    thisHostKey?: string;
  }

  interface FakeHost extends ConductorProcessHost {
    starts: Array<{ workspaceRoot: string; conductorName: string | undefined }>;
    stops: Array<{ pid: number | undefined; hostKey: string | undefined }>;
  }

  /** Same fixed-value contract as the root screen's fake (BB-450 B10) —
   *  never the real `~/.bakers/machine.config.js`. */
  function fakeHost(options: FakeHostOptions = {}): FakeHost {
    const starts: FakeHost['starts'] = [];
    const stops: FakeHost['stops'] = [];
    return {
      starts,
      stops,
      async start(input) {
        starts.push(input);
        return options.result ?? { ok: true, message: 'done' };
      },
      async stop(input) {
        stops.push(input);
        return options.result ?? { ok: true, message: 'done' };
      },
      async thisHostKey() {
        return options.thisHostKey ?? 'cw-framework';
      },
    };
  }

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
      current_load: 1,
      max_parallel: 5,
      ...attrs,
    },
    relationships: {
      project_id: { data: { id: PROJECT } },
      ...(machineId
        ? { machine: { data: { id: machineId, type: 'bb_machine' } } }
        : {}),
    },
  });

  const machineDoc = (attrs: Record<string, unknown> = {}) => ({
    id: MACHINE_UUID,
    type: 'bb_machine--bb_machine',
    attributes: { host_key: 'cw-framework', max_parallel: 5, ...attrs },
  });

  /**
   * A catch-all fake: every screen the project's Dashboard, Tickets,
   * Ticket-Agents and Runs tabs read from answers with an empty collection —
   * this suite only cares that navigation REACHES Conductors intact — and
   * `bb_conductor/bb_conductor` answers with this test's own rows.
   */
  function fakeServices(
    docs: ReturnType<typeof conductorDoc>[],
    machines: ReturnType<typeof machineDoc>[],
  ): RendererServices {
    const collection = (): Collection => {
      const c: Collection = {
        where: () => c,
        sort: () => c,
        page: () => c,
        first: async () => null,
        list: async (): Promise<Resource[]> => [],
      };
      return c;
    };
    const client = {
      collection,
      get: async (path: string) => {
        // A single-entity read (the conductor detail scope's shared header)
        // asks `bb_conductor/bb_conductor/<id>?include=machine` — answer
        // it with ONE resource, never the list's array, or the detail read
        // silently resolves every field blank.
        if (path.startsWith('bb_conductor/bb_conductor/')) {
          const id = path
            .slice('bb_conductor/bb_conductor/'.length)
            .split('?')[0];
          const doc = docs.find((d) => d.id === id) ?? docs[0];
          return { data: doc, included: machines };
        }
        if (path === 'bb_conductor/bb_conductor') {
          return { data: docs, included: machines };
        }
        return { data: [] };
      },
      patch: async () => ({}),
      post: async () => ({}),
    } as unknown as DropshClient;
    return { client, baseUrl: 'http://web' };
  }

  async function openProjectConductors(
    opts: {
      host?: ConductorProcessHost;
      rows?: ReturnType<typeof conductorDoc>[];
      machines?: ReturnType<typeof machineDoc>[];
      /**
       * BB-450 review B13 — a caller that needs to assert on the request
       * the screen actually sent (its project filter) supplies a real
       * `fakeClient()`, which records `.requests`; `fakeServices()`'s own
       * hand-rolled double discards `params` and cannot answer that question.
       */
      client?: DropshClient;
    } = {},
  ) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(WORKSPACE, { recursive: true });

    const docs = opts.rows ?? [conductorDoc()];
    const machines = opts.machines ?? [machineDoc()];
    const services = opts.client
      ? { client: opts.client, baseUrl: 'http://web' }
      : fakeServices(docs, machines);
    const host = opts.host ?? fakeHost();

    const tui = await bootTui({
      services,
      columns: 140,
      rows: 44,
      tui: { route: PROJECT_ROUTE, conductorProcess: host },
    });
    // Project route lands on the Dashboard (BB-256 D12); one Tab per step of
    // the registry order reaches: tickets(1) → ticket-agents(2) → runs(3) →
    // conductors(4).
    for (let i = 0; i < 4; i += 1) await tui.press('\t');
    return tui;
  }

  async function quit(tui: Awaited<ReturnType<typeof bootTui>>): Promise<void> {
    tui.mockInput.pressKey('q');
    await tui.running;
    await tui.stop();
  }

  function text(tui: { frame(): string }): string {
    return tui.frame().replace(/\s+/g, ' ');
  }

  it("lands on the Conductors tab and lists this project's conductors, with LOAD", async () => {
    const tui = await openProjectConductors();

    expect(text(tui)).toContain('cw-framework');
    // BB-450 D11: the fresh word is `online`, the server's own word.
    expect(text(tui)).toContain('online');
    // BB-450 review B3/B7: the LOAD column reaches this screen too —
    // `<currentLoad>/<maxParallel>` from the sideloaded machine.
    expect(text(tui)).toContain('1/5');
    // D13: no PROJECT column — every row is already this one project's.
    expect(text(tui)).not.toContain(' PROJECT ');

    await quit(tui);
  });

  it('`s` starts the selected conductor and reports the outcome (BB-450 review B6)', async () => {
    const host = fakeHost();
    const tui = await openProjectConductors({
      host,
      rows: [conductorDoc({ status: 'offline' })],
    });

    await tui.press('s');
    await settle();
    await tui.renderOnce();

    expect(host.starts.length).toBe(1);
    expect(host.starts[0]?.workspaceRoot).toBe(WORKSPACE);
    expect(text(tui)).toContain('done');

    await quit(tui);
  });

  it('`x` stops the selected conductor, passing its pid (BB-450 review B6)', async () => {
    const host = fakeHost();
    const tui = await openProjectConductors({ host });

    await tui.press('x');
    await settle();
    await tui.renderOnce();

    expect(host.stops.length).toBe(1);
    expect(host.stops[0]?.pid).toBe(4242);
    expect(text(tui)).toContain('done');

    await quit(tui);
  });

  it('opens the conductor detail scope for a foreign row too, and its Log tab says there is none here', async () => {
    const host = fakeHost({ thisHostKey: 'cw-framework' });
    const tui = await openProjectConductors({
      host,
      // SAME workspace_root as the default fixture (BB-281 Finding 2's
      // shape) — only the machine's host_key differs, so `isLocal` alone
      // could not catch this, which is exactly what let B12 tail THIS
      // machine's own log under a foreign conductor's heading.
      rows: [conductorDoc()],
      machines: [machineDoc({ host_key: 'some-other-machine' })],
    });

    // Enter now opens the conductor detail scope for every row (D1) — the
    // `mine` gate moved onto the log tab.
    await tui.press('\r');
    await settle();
    expect(text(tui)).toContain('bakers.build conductor —');

    for (let i = 0; i < 3; i++) await tui.press('\t');
    await settle();
    expect(text(tui)).toContain('runs on another machine; no log here');

    await quit(tui);
  });

  it('still tails the real log on the Log tab for a row this machine owns', async () => {
    const tui = await openProjectConductors();

    await tui.press('\r');
    await settle();
    expect(text(tui)).toContain('bakers.build conductor —');

    for (let i = 0; i < 3; i++) await tui.press('\t');
    await settle();
    expect(text(tui)).toContain('log —');

    await quit(tui);
  });

  it('filters the conductor read to the project in context (BB-450 review B13)', async () => {
    // BB-450 review B13: measured by mutation at review — deleting
    // `context.project.id` from the screen's `load()` left every suite green,
    // because neither fake client here recorded the params `client.get`
    // received. `fakeClient()` does (`.requests`), which is what a real
    // regression test on the SCREEN's own call — not just the data layer's
    // the data layer's own read, already covered in
    // `tests/Entity/conductor/Data/conductors.test.ts` — requires.
    const client = fakeClient({
      documents: {
        'bb_conductor/bb_conductor': {
          data: [conductorDoc()],
          included: [machineDoc()],
        },
      },
    });

    const tui = await openProjectConductors({ client });

    // Every screen the navigation passes through (Dashboard, Tickets,
    // Ticket-Agents, Runs) issues its OWN `client.get()`, all recorded in
    // order — the request that matters is the CONDUCTOR one, not index 0.
    const conductorRequest = client.requests.find(
      (r) => r.path === 'bb_conductor/bb_conductor',
    );
    const query = queryStringOf(conductorRequest?.params);
    expect(query).toContain('project_id.id');
    expect(query).toContain(PROJECT);

    await quit(tui);
  });

  it('marks a conductor whose host_key is not this machine view-only, before any key is pressed, and hides Start/Stop (BB-450 review B9/B10)', async () => {
    const host = fakeHost({ thisHostKey: 'cw-framework' });
    const tui = await openProjectConductors({
      host,
      // SAME workspace_root as the default fixture (BB-281 Finding 2's
      // shape) — only the machine's host_key differs, so isLocal alone could
      // not catch this.
      rows: [conductorDoc()],
      machines: [machineDoc({ host_key: 'some-other-machine' })],
    });

    expect(text(tui)).toContain('view-only');
    expect(text(tui)).not.toContain('Start');
    expect(text(tui)).not.toContain('Stop');

    await tui.press('s');
    await tui.press('x');

    expect(host.starts.length).toBe(0);
    expect(host.stops.length).toBe(0);
    expect(text(tui)).toContain('view-only');

    await quit(tui);
  });

  it('reports the already-online refusal in the footer instead of staying silent (BB-450 review B6)', async () => {
    const host = fakeHost();
    const nowS = Math.floor(Date.now() / 1000);
    const tui = await openProjectConductors({
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
});
