import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import bakersUiPlugin from '../src/plugin.js';
import type {
  Collection,
  DropshClient,
  RendererServices,
} from '../src/types.js';

// BB-223 AC-3 (spec Decision 5) — WHERE resolution runs. The `bakers ui` entry
// has no JSON:API client at all; the client first exists as `services.client`
// inside the renderer's `run()`. So `run()` is where the unresolved
// `initialRoute` becomes a `ResolvedRoute`, and it is still strictly BEFORE the
// kernel reaches `input.setRawMode(true)`. A failure therefore draws nothing,
// takes no raw mode, and shows no dashboard — it rejects out of `run()`.

const TICKET = 'ffffffff-0000-0000-0000-000000000001';

const ticketDoc = {
  data: {
    id: TICKET,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-223',
      title: 'bakers ui deep links',
      description: 'The deep-link description body.',
    },
    relationships: {},
  },
  included: [],
};

function fakeServices(): RendererServices & { paths: string[] } {
  const paths: string[] = [];
  const collection = (): Collection => {
    const c: Collection = {
      where: () => c,
      sort: () => c,
      page: () => c,
      first: async () => null,
      list: async () => [],
    };
    return c;
  };
  const client: DropshClient = {
    collection,
    get: async (path: string) => {
      paths.push(path);
      if (path.startsWith(`bb_ticket/bb_ticket/${TICKET}`)) return ticketDoc;
      if (path === 'bb_ticket/bb_ticket') return { data: [] };
      return { data: [] };
    },
  };
  return { client, paths, baseUrl: 'https://bakers.example' };
}

class FakeInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  rawModeCalls: boolean[] = [];
  setRawMode(value: boolean): this {
    this.rawModeCalls.push(value);
    this.isRaw = value;
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
}

class FakeOutput extends EventEmitter {
  isTTY = false;
  columns = 120;
  rows = 40;
  chunks: string[] = [];
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  get text(): string {
    return this.chunks.join('');
  }
}

const realStdin = process.stdin;
const realStdout = process.stdout;

function replaceStreams(input: unknown, output: unknown): void {
  Object.defineProperty(process, 'stdin', { value: input, configurable: true });
  Object.defineProperty(process, 'stdout', {
    value: output,
    configurable: true,
  });
}

function restoreStreams(): void {
  Object.defineProperty(process, 'stdin', {
    value: realStdin,
    configurable: true,
  });
  Object.defineProperty(process, 'stdout', {
    value: realStdout,
    configurable: true,
  });
}

afterEach(restoreStreams);

/** The single `tui` renderer's `run(document, context, services)`. */
function rendererRun(options: Parameters<typeof bakersUiPlugin>[0]) {
  const renderer = bakersUiPlugin(options).renderers[0];
  if (!renderer) throw new Error('the plugin registered no renderer');
  return renderer.run;
}

describe('the tui renderer resolves the deep link in run() (AC-3)', () => {
  it('resolves an identifier target and boots that ticket', async () => {
    const input = new FakeInput();
    input.isTTY = false;
    const output = new FakeOutput();
    replaceStreams(input, output);
    const services = fakeServices();
    // One collection read resolves the identifier; the client only exists here.
    services.client.get = async (path: string) => {
      services.paths.push(path);
      if (path === 'bb_ticket/bb_ticket') {
        return { data: [ticketDoc.data] };
      }
      if (path.startsWith(`bb_ticket/bb_ticket/${TICKET}`)) return ticketDoc;
      return { data: [] };
    };

    await rendererRun({
      initialRoute: {
        kind: 'ticket',
        by: 'identifier',
        value: 'BB-223',
        view: 'full',
      },
    })({}, {}, services);

    expect(output.text).toContain('BB-223');
    expect(output.text).toContain('The deep-link description body.');
  }, 15_000);

  it('rejects an unknown target BEFORE the kernel takes the terminal', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    output.isTTY = true;
    replaceStreams(input, output);
    const services = fakeServices();

    await expect(
      rendererRun({
        initialRoute: {
          kind: 'ticket',
          by: 'identifier',
          value: 'BB-999999',
          view: 'full',
        },
      })({}, {}, services),
    ).rejects.toThrow(/BB-999999/);

    // The invariant AC-3 protects: nothing drawn, no raw mode, no dashboard.
    expect(input.rawModeCalls).toEqual([]);
    expect(output.text).toBe('');
    expect(services.paths.some((p) => p.startsWith('bb_conductor/'))).toBe(
      false,
    );
  });

  it('with NO initialRoute it never resolves anything (AC-4 regression)', async () => {
    const input = new FakeInput();
    input.isTTY = false;
    const output = new FakeOutput();
    replaceStreams(input, output);
    const services = fakeServices();

    await rendererRun({})({}, {}, services);

    // Straight to the dashboard read; no ticket/project lookup happened.
    expect(services.paths.some((p) => p.startsWith('bb_ticket/'))).toBe(false);
  });
});

// BB-232 spec Decision D9 / review finding F1 — the SECOND thing `run()`
// resolves, and for the same reason as the deep link: the `bakers ui` entry holds
// no JSON:API client, so it hands over the `.bakers` dir it is standing in and the
// renderer turns it into a project name + this machine's conductor id.
describe('the tui renderer resolves this checkout’s conductor in run() (D9)', () => {
  const CONDUCTORS = {
    data: [
      {
        id: 'c-1',
        type: 'bb_conductor--bb_conductor',
        attributes: {
          machine_id: 'cw-framework',
          workspace_root: '/repos/bakers/.bakers',
        },
        relationships: {
          project_id: { data: { id: 'p-1', type: 'bb_project' } },
        },
      },
    ],
    included: [
      {
        id: 'p-1',
        type: 'bb_project--bb_project',
        attributes: { name: 'bakers' },
      },
    ],
  };

  /** Boot the renderer non-interactively and report what the kernel received. */
  async function bootWith(
    options: Parameters<typeof bakersUiPlugin>[0],
    doc: unknown = CONDUCTORS,
  ) {
    const input = new FakeInput();
    input.isTTY = false;
    const output = new FakeOutput();
    replaceStreams(input, output);
    const services = fakeServices();
    services.client.get = async (path: string) => {
      services.paths.push(path);
      if (path === 'bb_conductor/bb_conductor') return doc;
      return { data: [] };
    };
    await rendererRun(options)({}, {}, services);
    return services;
  }

  it('reads the conductor collection only when a bakersDir was handed over', async () => {
    const without = await bootWith({});
    expect(without.paths.some((p) => p.startsWith('bb_conductor/'))).toBe(
      false,
    );

    const withDir = await bootWith({ bakersDir: '/repos/bakers/.bakers' });
    expect(withDir.paths).toContain('bb_conductor/bb_conductor');
  });

  it('an unreachable control plane still boots the cockpit', async () => {
    const input = new FakeInput();
    input.isTTY = false;
    const output = new FakeOutput();
    replaceStreams(input, output);
    const services = fakeServices();
    services.client.get = async () => {
      throw new Error('503 Service Unavailable');
    };

    await expect(
      rendererRun({ bakersDir: '/repos/bakers/.bakers' })({}, {}, services),
    ).resolves.toBeUndefined();
  });
});
