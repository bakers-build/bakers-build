// The `bb_ticket` `workflow` field's fixed vocabulary — a ticket property, so it
// lives in the ticket slice.
//
// BB-236 entity-slice phase 4 merged what were TWO spellings of this same enum
// into one declaration. BB-299 D2 then removed the filter consumer (the `t type`
// filter is gone), leaving exactly ONE consumer: the create form's workflow picker.
// The declaration stays because the `workflow` ATTRIBUTE stays (spec F4).

/** One entry of the classification: the stored id and how it is shown. */
export interface WorkflowKind {
  id: string;
  label: string;
}

/** The single source of truth, in the create form picker's order. */
export const WORKFLOW_KINDS: readonly WorkflowKind[] = [
  // BAKERS-17: one workflow for every work ticket; feature/bug/chore is the
  // ticket's `ticket_type` term now, not its workflow.
  { id: 'bb_work', label: 'work' },
];

/** The picker's `{id, label}` list — what the create form's `workflow` field offers. */
export const WORKFLOW_OPTIONS: WorkflowKind[] = WORKFLOW_KINDS.map((k) => ({
  id: k.id,
  label: k.label,
}));
