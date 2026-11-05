import { describe, expect, it } from 'vitest';
import { inbox, tools } from '../src/preset.js';

describe('ports inbox', () => {
  it('answers Share tunnels through the ports_up tool', () => {
    expect(inbox?.messages.tunnel).toEqual({
      label: 'Share tunnels',
      access: 'view',
    });
    expect(inbox?.bindings).toEqual({ tunnel: { tool: 'ports_up', args: {} } });
    expect(inbox?.handlers).toBeUndefined();
    expect(tools?.tools).toHaveProperty('ports_up');
  });
});
