# Return to qualification

Read only when the entry guard finds a missing recipe, type, state or acceptance criteria.

**When the recipe, type, state or acceptance criteria are missing**, including a missing handoff —
emit one structured finding per defect and do all of the following, then stop:

1. Publish **all** structured findings naming each defect (which field, why it fails).
2. Publish the honest summary; invoke authorized [origin status](origin-status.md) with `qualification`.
3. Invoke [transition ticket](transition-ticket.md) with destination `qualification` as the final
   mutation.
4. Return `returned_to_qualification`.
