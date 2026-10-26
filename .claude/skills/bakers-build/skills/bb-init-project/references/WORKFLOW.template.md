# Project — WORKFLOW

Invoke `bakers:bb-workflow` and follow it for the ticket's current state.

## bb-phase-provision

<!-- The runtime guide and setup that bring the environment up, e.g. `@bakers-build/bb-runtime-ddev`
     and its provider. Leave empty when no work needs a runtime. -->

## bb-phase-work

| When | Skill |
|---|---|

## bb-phase-validate

| When | Command |
|---|---|

## bb-phase-deliver

<!-- How a merge request is merged: the merge gate and what runs in it. -->

## bb-phase-outtake

<!-- Where the test-user list lives and how each `test_as` persona gets its login for manual review. -->

## bb-phase-transition

<!-- The origin-label table: the label each state puts on the ticket's origin issue. Delete the
     table and no origin label is ever written. -->

| State | Origin label |
|---|---|
| qualification | doing |
| plan | doing |
| working | doing |
| review | doing |
| done | review |
