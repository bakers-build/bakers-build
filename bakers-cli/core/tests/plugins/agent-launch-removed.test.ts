import { describe, expect, it } from 'vitest';
import * as core from '../../src/index.js';

// BB-194 AC-2: the agent-host contract is the TUI renderer's own plugin seam
// (`@bakers-build/addon-bakers-ui`), NOT a core (conductor engine) concern. Core must
// export none of the four former `agent-launch.ts` symbols. Only the runtime
// symbol `supportsAgentHost` is assertable (the three interfaces are erased at
// compile time); if the export block is re-added, this fails loudly.
describe('agent-launch contract removed from @bakers-build/core (BB-194 AC-2)', () => {
  it('does not export the supportsAgentHost runtime symbol', () => {
    expect((core as Record<string, unknown>).supportsAgentHost).toBeUndefined();
  });
});
