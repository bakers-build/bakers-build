import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addonEntries,
  isOpen,
  readTicketAddons,
  type TicketAddon,
  type TicketAddons,
} from '../../../src/Entity/ticket/Data/addons.js';
import {
  formFields,
  payloadFrom,
} from '../../../src/Entity/ticket/Form/addon-action.js';
import {
  AddonActionFormScreen,
  TicketAddonsScreen,
} from '../../../src/Entity/ticket/Screen/ticket-addons.js';

const portInput = {
  type: 'object' as const,
  required: ['port'],
  properties: { port: { type: 'integer' as const, title: 'Port' } },
};

/** A contract-2 addon fixture: one parameterless message, one with input. */
function ports(over: Partial<TicketAddon> = {}): TicketAddon {
  return {
    id: 'a-ports',
    name: 'ports',
    version: '1.0.0',
    contract: 2,
    label: 'Ports',
    messages: [
      {
        key: 'tunnel',
        label: 'Share tunnels',
        input: null,
        access: 'view',
        access_ok: true,
      },
      {
        key: 'stop',
        label: 'Stop',
        input: portInput,
        access: 'update',
        access_ok: true,
      },
    ],
    latest: null,
    ...over,
  };
}

const fake: TicketAddon = {
  id: 'a-fake',
  name: 'fake',
  version: '0.0.1',
  contract: 2,
  label: 'Fake',
  messages: [
    {
      key: 'echo',
      label: 'Echo',
      input: {
        type: 'object',
        required: ['text'],
        properties: { text: { type: 'string' } },
      },
      access: 'view',
      access_ok: true,
    },
  ],
  latest: null,
};

function model(addons: TicketAddon[] = [ports(), fake]): TicketAddons {
  return { conductor: { status: 'online' }, addons };
}

function context(read: () => TicketAddons = () => model()) {
  const post = vi.fn(async () => ({}));
  const get = vi.fn(async () => ({ data: { attributes: read() } }));
  return {
    post,
    get,
    ctx: {
      requestDraw: vi.fn(),
      isActive: () => true,
      sessionGeneration: 1,
      params: { ticketId: 'ticket-uuid' },
      navigate: vi.fn(),
      copyToClipboard: vi.fn(() => 'copied' as const),
      services: { client: { get, post } },
    },
  };
}

async function open(read?: () => TicketAddons) {
  const io = context(read);
  const screen = new TicketAddonsScreen();
  screen.enter(io.ctx as never);
  await vi.waitFor(() => expect(io.get).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { screen, ...io };
}

afterEach(() => vi.useRealTimers());

describe('addon read model helpers', () => {
  it('reads the ticket read model', async () => {
    const get = vi.fn(async () => ({ data: { attributes: model() } }));
    const out = await readTicketAddons({ get } as never, 't-1');
    expect(get).toHaveBeenCalledWith('bakers/addons/ticket/t-1');
    expect(out.addons.map((a) => a.name)).toEqual(['ports', 'fake']);
  });

  it('lists every permitted message as a sendable entry', () => {
    const entries = addonEntries(ports());
    expect(entries.map((e) => e.message.key)).toEqual(['tunnel', 'stop']);
    expect(addonEntries(fake).map((e) => e.message.key)).toEqual(['echo']);
  });

  it('omits a message the viewer may not send', () => {
    const entries = addonEntries(
      ports({
        messages: [
          {
            key: 'tunnel',
            label: 'Share tunnels',
            input: null,
            access: 'view',
            access_ok: false,
          },
        ],
      }),
    );
    expect(entries).toEqual([]);
  });

  it('maps the input subset onto text and select fields', () => {
    const fields = formFields({
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', title: 'Name' },
        color: { type: 'string', enum: ['red', 'blue'] },
        force: { type: 'boolean' },
        port: { type: 'integer' },
      },
    });
    expect(fields.map((f) => [f.id, f.kind, f.label])).toEqual([
      ['name', 'text', 'Name *'],
      ['color', 'select', 'color'],
      ['force', 'select', 'force'],
      ['port', 'text', 'port'],
    ]);
    expect(fields[2]?.options?.map((o) => o.id)).toEqual(['yes', 'no']);
  });

  it('types the payload and names invalid fields', () => {
    expect(payloadFrom(portInput, { port: '443' })).toEqual({
      payload: { port: 443 },
    });
    expect(payloadFrom(portInput, { port: 'x' })).toEqual({
      errors: { port: 'must be a whole number' },
    });
    expect(payloadFrom(portInput, { port: '' })).toEqual({
      errors: { port: 'is required' },
    });
    expect(
      payloadFrom(
        {
          type: 'object',
          properties: { force: { type: 'boolean' }, note: { type: 'string' } },
        },
        { force: 'yes', note: '' },
      ),
    ).toEqual({ payload: { force: true } });
  });
});

describe('TicketAddonsScreen', () => {
  it('shows the addon bar and the selected addon messages', async () => {
    const { screen, ctx } = await open();
    const text = screen.renderNonInteractive(ctx as never).join('\n');
    expect(text).toContain('[Ports]');
    expect(text).toContain('Fake');
    expect(text).toContain('Share tunnels');
    expect(text).toContain('Stop');
    screen.leave();
  });

  it('switches addons with ← and →', async () => {
    const { screen, ctx } = await open();
    expect(screen.handleInput('right', ctx as never)).toBe(true);
    expect(screen.renderNonInteractive(ctx as never).join('\n')).toContain(
      '[Fake]',
    );
    expect(screen.handleInput('left', ctx as never)).toBe(true);
    expect(screen.renderNonInteractive(ctx as never).join('\n')).toContain(
      '[Ports]',
    );
    screen.leave();
  });

  it('Enter on a parameterless message sends it directly, no form', async () => {
    const { screen, ctx, post } = await open();
    expect(screen.handleInput('enter', ctx as never)).toBe(true);
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith('bakers/inbox/send', {
        data: {
          attributes: {
            ticket: 'ticket-uuid',
            message_id: 'ports.tunnel',
            payload: {},
          },
        },
      }),
    );
    expect(ctx.navigate).not.toHaveBeenCalled();
    screen.leave();
  });

  it('a message with input opens its form', async () => {
    const { screen, ctx } = await open();
    screen.handleInput('down', ctx as never);
    screen.handleInput('enter', ctx as never);
    expect(ctx.navigate).toHaveBeenCalledWith(
      'ticket.addons.action',
      { ticketId: 'ticket-uuid' },
      expect.objectContaining({
        addon: 'ports',
        key: 'stop',
        ticketUuid: 'ticket-uuid',
      }),
    );
    screen.leave();
  });

  it('shows "No addons" when the conductor runs none; a pipe prints nothing', async () => {
    const { screen, ctx } = await open(() => ({ conductor: null, addons: [] }));
    expect(JSON.stringify(screen.present(ctx as never).body)).toContain(
      'No addons for this ticket.',
    );
    expect(screen.renderNonInteractive(ctx as never)).toEqual([]);
    screen.leave();
  });

  it('polls every 3 s while a message is open, and stops after', async () => {
    let status = 'pending';
    const read = () =>
      model([
        ports({
          latest: {
            action: 'tunnel',
            label: 'Share tunnels',
            status,
            result: null,
            changed: 1,
          },
        }),
      ]);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { screen, get } = await open(read);
    const before = get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(get.mock.calls.length).toBe(before + 1);
    status = 'done';
    await vi.advanceTimersByTimeAsync(3000);
    const after = get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9000);
    expect(get.mock.calls.length).toBe(after);
    screen.leave();
  });

  it('says messages are queued while the conductor is offline', async () => {
    const { screen, ctx } = await open(() => ({
      ...model(),
      conductor: { status: 'offline' },
    }));
    expect(JSON.stringify(screen.present(ctx as never))).toContain(
      'Conductor offline — messages are queued until it returns',
    );
    screen.leave();
  });

  it('shows the newest message as the status line, none without one', async () => {
    const running = model([
      ports({
        latest: {
          action: 'stop',
          label: 'Stop',
          status: 'running',
          result: null,
          changed: 2,
        },
      }),
    ]);
    expect(isOpen(running.addons[0] as TicketAddon)).toBe(true);
    const busy = await open(() => running);
    expect(JSON.stringify(busy.screen.present(busy.ctx as never))).toContain(
      'Stop: running',
    );
    busy.screen.leave();

    const idle = await open(() => model([ports()]));
    expect(JSON.stringify(idle.screen.present(idle.ctx as never))).not.toMatch(
      /Stop: /,
    );
    idle.screen.leave();
  });

  it('copies the first http(s) link of the latest Markdown answer', async () => {
    const answered = ports({
      latest: {
        action: 'tunnel',
        label: 'Share tunnels',
        status: 'done',
        result: { markdown: '- [443](https://x.trycloudflare.com)' },
        changed: 1,
      },
    });
    const { screen, ctx } = await open(() => model([answered]));
    expect(screen.handleInput('l', ctx as never)).toBe(true);
    expect(ctx.copyToClipboard).toHaveBeenCalledWith(
      'https://x.trycloudflare.com',
    );
    screen.leave();
  });

  it('warns "no link" when the latest answer carries none', async () => {
    const { screen, ctx } = await open();
    expect(screen.handleInput('l', ctx as never)).toBe(true);
    expect(ctx.copyToClipboard).not.toHaveBeenCalled();
    screen.leave();
  });
});

describe('AddonActionFormScreen', () => {
  it('sends typed values and goes back', async () => {
    const post = vi.fn(async () => ({}));
    const back = vi.fn(() => true);
    const ctx = {
      requestDraw: vi.fn(),
      isActive: () => true,
      sessionGeneration: 1,
      params: { ticketId: 'ticket-uuid' },
      back,
      navigationState: {
        ticketUuid: 'ticket-uuid',
        addon: 'fake',
        key: 'echo',
        label: 'Echo',
        input: fake.messages[0]?.input,
      },
      services: { client: { get: vi.fn(), post } },
    };
    const screen = new AddonActionFormScreen();
    screen.enter(ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const ch of 'hi') screen.handleInput(ch, ctx as never);
    screen.handleInput('down', ctx as never);
    screen.handleInput('enter', ctx as never);
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith('bakers/inbox/send', {
        data: {
          attributes: {
            ticket: 'ticket-uuid',
            message_id: 'fake.echo',
            payload: { text: 'hi' },
          },
        },
      }),
    );
    await vi.waitFor(() => expect(back).toHaveBeenCalled());
  });
});

/** A minimal contract-2 addon fixture (BB-661). */
function demo(over: Partial<TicketAddon> = {}): TicketAddon {
  return {
    id: 'a-demo',
    name: 'demo',
    version: '1.0.0',
    contract: 2,
    label: 'Demo',
    messages: [
      {
        key: 'tunnel',
        label: 'Share tunnels',
        input: null,
        access: 'view',
        access_ok: true,
      },
    ],
    latest: null,
    ...over,
  };
}

describe('contract-2 messages (BB-661)', () => {
  it('lists a parameterless message as a sendable entry', () => {
    const entries = addonEntries(demo());
    expect(entries.map((e) => e.message.key)).toEqual(['tunnel']);
  });

  it('omits a message the viewer may not send', () => {
    const entries = addonEntries(
      demo({
        messages: [
          {
            key: 'tunnel',
            label: 'Share tunnels',
            input: null,
            access: 'view',
            access_ok: false,
          },
        ],
      }),
    );
    expect(entries).toEqual([]);
  });

  it('shows the explicit empty state before this requester has sent anything', async () => {
    const { screen, ctx } = await open(() => model([demo()]));
    expect(JSON.stringify(screen.present(ctx as never))).toContain(
      'You have not sent a message to this addon.',
    );
    screen.leave();
  });

  it("sends the message and renders its Markdown answer, not another requester's", async () => {
    const answered = demo({
      latest: {
        action: 'tunnel',
        label: 'Share tunnels',
        status: 'done',
        result: { markdown: '- [443](https://preview.example.test)' },
        changed: 1,
      },
    });
    const { screen, ctx, post } = await open(() => model([answered]));
    screen.activate(0, ctx as never);
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith('bakers/inbox/send', {
        data: {
          attributes: {
            ticket: 'ticket-uuid',
            message_id: 'demo.tunnel',
            payload: {},
          },
        },
      }),
    );
    const text = screen.renderNonInteractive(ctx as never).join('\n');
    expect(text).toContain('preview.example.test');
    expect(text).not.toContain('[443]');
    screen.leave();
  });
});
