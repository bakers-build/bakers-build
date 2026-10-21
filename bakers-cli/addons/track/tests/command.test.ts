import { Command } from 'commander';
import { expect, it, vi } from 'vitest';
import { registerTrack } from '../src/index.js';

it('passes explicit selection/connection to the reader and prints its JSON report', async () => {
  const program = new Command().exitOverride();
  const output = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const read = vi.fn(async () => ({ owner_id: 'employee', days: [] }));
  try {
    registerTrack(program, read);
    await program.parseAsync(
      [
        'track',
        'evidence',
        '--from',
        '2026-10-12',
        '--to',
        '2026-10-13',
        '--timezone',
        'Europe/Berlin',
        '--connection',
        'employee',
      ],
      { from: 'user' },
    );
    expect(read).toHaveBeenCalledWith({
      from: '2026-10-12',
      to: '2026-10-13',
      timezone: 'Europe/Berlin',
      connection: 'employee',
    });
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual({
      owner_id: 'employee',
      days: [],
    });
  } finally {
    output.mockRestore();
  }
});

it('emits no success report when a required read fails', async () => {
  const program = new Command().exitOverride();
  const output = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  try {
    registerTrack(program, async () => {
      throw new Error('access denied');
    });
    await expect(
      program.parseAsync(
        ['track', 'evidence', '--from', '2026-10-12', '--to', '2026-10-13'],
        { from: 'user' },
      ),
    ).rejects.toThrow('access denied');
    expect(output).not.toHaveBeenCalled();
  } finally {
    output.mockRestore();
  }
});
