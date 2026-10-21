import { describe, expect, it, vi } from 'vitest';

vi.mock('dropsh', async (orig) => {
  const actual = await orig<typeof import('dropsh')>();
  return { ...actual, authStatus: vi.fn() };
});

import { authStatus } from 'dropsh';
import { ensureAuthenticated } from '../../src/commands/conductor.js';

function fakeLogger() {
  return { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}
const cfg = { site: { base_url: 'https://x.test' }, plugins: [] } as any;

describe('ensureAuthenticated', () => {
  it('returns true when authStatus reports loggedIn', async () => {
    (authStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      loggedIn: true,
    });
    const log = fakeLogger();
    expect(await ensureAuthenticated(cfg, log as any)).toBe(true);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('returns false and logs when not logged in', async () => {
    (authStatus as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      loggedIn: false,
    });
    const log = fakeLogger();
    expect(await ensureAuthenticated(cfg, log as any)).toBe(false);
    // ConductorLogger uses pino-style error(obj, msg) — the message is the second arg
    expect(log.error).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("run 'bakers dropsh auth login'"),
    );
  });
});
