# Project — WORKFLOW

Invoke `bakers:bb-workflow` and follow it for the ticket's current state.

## bb-phase-provision

<!-- The `provision_up` profile each kind of check needs (its commands live in the conductor's
     `hooks.provision_up`), and how container commands run. Leave empty when no work needs a
     runtime. -->

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
