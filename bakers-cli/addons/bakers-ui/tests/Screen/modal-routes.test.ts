import { describe, expect, it } from 'vitest';
import { EditAssignmentFormScreen } from '../../src/Entity/ticket/Screen/edit-assignment-form.js';
import { TicketDetailScreen } from '../../src/Entity/ticket/Screen/ticket-detail.js';
import { WorkspacePickerScreen } from '../../src/Entity/workspace/Screen/workspace-picker.js';

describe('routed modal and detail ownership', () => {
  it('marks form routes as modal presentations', () => {
    expect(EditAssignmentFormScreen.route.presentation).toBe('modal');
    // BB-472: the workspace switch is a short, dismissable action from
    // wherever the operator already is, not a destination of its own -- the
    // same reasoning that makes the assignment form a modal.
    expect(WorkspacePickerScreen.route.presentation).toBe('modal');
  });

  it('returns a typed assignment mutation result', () => {
    expect(EditAssignmentFormScreen.result('t1', 'u1')).toEqual({
      type: 'ticket-assignment-updated',
      ticketId: 't1',
      assigneeId: 'u1',
    });
  });

  it('saves and restores the overview selection', () => {
    const screen = new TicketDetailScreen();
    screen.restoreState({ selectedKey: 'section:Technical details' });
    expect(screen.saveState()).toEqual({
      selectedKey: 'section:Technical details',
    });
  });
});
