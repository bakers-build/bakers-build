import { describe, expect, it, vi } from 'vitest';

const stop = new Error('context built');
const createBbConnectionContext = vi.fn(() => {
  throw stop;
});

vi.mock('@bakers-build/core', async (original) => ({
  ...(await original<typeof import('@bakers-build/core')>()),
  loadReadyBbConnection: vi.fn(async () => ({
    plugins: [],
    config_path: '/x/bakers.config.js',
  })),
  createBbConnectionContext,
}));

describe('bakers dropsh wires the agent read filter', () => {
  it('builds every connection context with the unpublished-comment filter', async () => {
    const { dispatchBbDropsh } = await import('../src/index.js');
    const { hideUnpublishedComments } = await import(
      '../src/unpublished-comments.js'
    );
    await dispatchBbDropsh(
      { resolveBases: [import.meta.url] },
      ['read', 'bb_ticket/bb_ticket/00000000-0000-4000-8000-000000000000'],
      { stdout: () => {}, stderr: () => {} },
    ).catch((error: unknown) => {
      if (error !== stop) throw error;
    });
    expect(createBbConnectionContext).toHaveBeenCalled();
    expect(createBbConnectionContext.mock.calls[0]?.[1]).toMatchObject({
      wrapHttp: hideUnpublishedComments,
    });
  });
});
