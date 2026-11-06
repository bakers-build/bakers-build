import { describe, expect, it } from 'vitest';
import type { RunRow } from '../../src/Entity/run/Data/runs.js';
import { RunsScreen } from '../../src/Entity/run/Screen/runs.js';

class RunsSubject extends RunsScreen {
  // The ready value is a PAGE since BB-292 (rows plus `hasNext` plus the page
  // index), so seeding builds one; `hasNext: false` is a screen on its last page.
  seed(rows: RunRow[]): void {
    this.replaceReady({ rows, hasNext: false, page: 0, window: null });
  }
}
describe('project activity screen ownership', () => {
  it('Runs restores selection by run id', () => {
    const screen = new RunsSubject();
    screen.seed([{ id: 'r1' }, { id: 'r2' }] as RunRow[]);
    screen.selectedIndex = 1;
    const token = screen.saveState();
    screen.selectedIndex = 0;
    screen.restoreState(token);
    expect(screen.rows[screen.selectedIndex]?.id).toBe('r2');
  });
});
