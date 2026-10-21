import { HttpError } from 'dropsh/plugin';
import { describe, expect, it, vi } from 'vitest';
import { registerTemplateCommand, runTemplate } from '../src/template.js';

const UUID = '3f0c1d2e-4a5b-4c6d-8e7f-0123456789ab';
const doc = () => ({
  data: {
    type: 'bb_ticket--bb_ticket',
    id: 'ticket-uuid',
    attributes: { identifier: 'BB-9' },
  },
  meta: { created: true },
});

describe('bakers dropsh template run', () => {
  it('posts one empty body to the instantiate endpoint', async () => {
    const post = vi.fn(async () => doc());
    expect(await runTemplate({ post }, UUID)).toEqual({
      ticket_uuid: 'ticket-uuid',
      identifier: 'BB-9',
      created: true,
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      `bb_ticket_template/bb_ticket_template/${UUID}/instantiate`,
      {},
    );
  });

  it('posts the given overrides as one ticket document', async () => {
    const post = vi.fn(async () => doc());
    await runTemplate({ post }, UUID, {
      title: 't',
      project_id: 'p',
      labels: ['a', 'b'],
      target_state: 'spec',
    });
    expect(post).toHaveBeenCalledWith(
      `bb_ticket_template/bb_ticket_template/${UUID}/instantiate`,
      {
        data: {
          type: 'bb_ticket--bb_ticket',
          attributes: { title: 't' },
          relationships: {
            project_id: {
              data: { type: 'bb_project--bb_project', id: 'p' },
            },
            labels: {
              data: [
                { type: 'bb_term--bb_labels', id: 'a' },
                { type: 'bb_term--bb_labels', id: 'b' },
              ],
            },
          },
        },
        meta: { target_state: 'spec' },
      },
    );
  });

  it('rejects a non-uuid without posting', async () => {
    const post = vi.fn();
    await expect(runTemplate({ post }, 'nope')).rejects.toThrow(/uuid/);
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    [400, /rejected/],
    [403, /not allowed/],
    [404, /not found/],
    [422, /invalid/i],
  ])('maps HTTP %i to a clear message', async (status, re) => {
    const post = vi.fn(async () => {
      throw new HttpError(status, `HTTP ${status}`, {
        errors: [{ detail: 'server says so' }],
      });
    });
    await expect(runTemplate({ post }, UUID)).rejects.toThrow(re);
    await expect(runTemplate({ post }, UUID)).rejects.toThrow(/server says so/);
    expect(post).toHaveBeenCalledTimes(2); // one per call, no hidden retry
  });

  it('reports an uncertain outcome after a transport failure', async () => {
    const post = vi.fn(async () => {
      throw new HttpError(0, 'Network failure', {});
    });
    await expect(runTemplate({ post }, UUID)).rejects.toThrow(/may have been/);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('registerTemplateCommand', () => {
  async function run(args: string[]) {
    const { Command } = await import('commander');
    const program = new Command().exitOverride();
    const out: string[] = [];
    const codes: number[] = [];
    const post = vi.fn(async () => doc());
    registerTemplateCommand(program, {
      contextFactory: async () => ({ client: { post } }) as never,
      stdout: (s) => out.push(s),
      stderr: () => {},
      setExitCode: (c) => codes.push(c),
    });
    await program.parseAsync(['template', 'run', UUID, ...args], {
      from: 'user',
    });
    return { out, codes, post };
  }

  it('posts an empty body without flags and prints the result', async () => {
    const { out, codes, post } = await run([]);
    expect(JSON.parse(out.join(''))).toEqual({
      ticket_uuid: 'ticket-uuid',
      identifier: 'BB-9',
      created: true,
    });
    expect(codes).toEqual([]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]).toEqual([
      `bb_ticket_template/bb_ticket_template/${UUID}/instantiate`,
      {},
    ]);
  });

  it('builds a body only from given flags', async () => {
    const { post } = await run([
      '--project_id',
      'p',
      '--title',
      't',
      '--labels',
      'a',
      'b',
    ]);
    expect(JSON.stringify((post.mock.calls[0] as unknown[])[1])).toBe(
      JSON.stringify({
        data: {
          type: 'bb_ticket--bb_ticket',
          attributes: { title: 't' },
          relationships: {
            project_id: {
              data: { type: 'bb_project--bb_project', id: 'p' },
            },
            labels: {
              data: [
                { type: 'bb_term--bb_labels', id: 'a' },
                { type: 'bb_term--bb_labels', id: 'b' },
              ],
            },
          },
        },
      }),
    );
  });

  it('prints an error and sets a non-zero exit code', async () => {
    const { Command } = await import('commander');
    const program = new Command().exitOverride();
    const err: string[] = [];
    const codes: number[] = [];
    registerTemplateCommand(program, {
      contextFactory: async () =>
        ({
          client: {
            post: async () => {
              throw new HttpError(404, 'HTTP 404', {});
            },
          },
        }) as never,
      stdout: () => {},
      stderr: (s) => err.push(s),
      setExitCode: (c) => codes.push(c),
    });
    await program.parseAsync(['template', 'run', UUID], { from: 'user' });
    expect(err.join('')).toMatch(/not found/);
    expect(codes).toEqual([1]);
  });
});
