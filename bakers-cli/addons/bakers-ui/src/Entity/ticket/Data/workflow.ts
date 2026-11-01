// The `bb_ticket` `workflow` field's fixed vocabulary — a ticket property, so it
// lives in the ticket slice.
//
// One declaration with two consumers: the create form's workflow picker and the
// edit form's workflow select. It mirrors the `bb_ticket` group of
// `bb_core.workflows.yml`.

/** One entry of the classification: the stored id and how it is shown. */
export interface WorkflowKind {
  id: string;
  label: string;
}

/** The single source of truth, in the pickers' order; the first is the default. */
export const WORKFLOW_KINDS: readonly WorkflowKind[] = [
  // feature/bug/chore is the ticket's `ticket_type` term, not its workflow.
  { id: 'bb_work', label: 'work' },
  // Same states as bb_work; its gates approve automatically except the merge.
  { id: 'bb_autopilot', label: 'autopilot' },
];

/** The picker's `{id, label}` list — what the create form's `workflow` field offers. */
export const WORKFLOW_OPTIONS: WorkflowKind[] = WORKFLOW_KINDS.map((k) => ({
  id: k.id,
  label: k.label,
}));
