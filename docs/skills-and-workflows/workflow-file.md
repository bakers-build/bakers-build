# Set project rules

Use `WORKFLOW.md` at the repository root for preparation, project checks, extra skills and delivery rules. Start with a [connected project](/get-started/connect-a-project) and the [bakers skills](/skills-and-workflows/skills).

## Start with your project

Ask your agent:

```text
Use bakers:bb-init-project to set up WORKFLOW.md for this repository.
Include our runtime, checks and test users. Preserve existing project rules.
```

The file starts with this entry line:

```md
# Project — WORKFLOW

Invoke `bakers:bb-workflow` and follow it for the ticket's current state.
```

Add only the phase sections your project needs:

| Your rule | Section |
|---|---|
| Which environment to prepare and how commands run | `## bb-phase-provision` |
| Extra skills for matching changes | `## bb-phase-work`, with a When / Skill table |
| Required checks for matching changes | `## bb-phase-validate`, with a When / Command table |
| CI and merge requirements | `## bb-phase-deliver` |
| Test users and how to get manual-review logins | `## bb-phase-outtake` |
| Optional GitLab origin-label mapping | `## bb-phase-transition` |

Every matching table row applies. These are instructions the agent reads, not configuration parsed or enforced by the conductor. Install every named skill; a missing required skill stops the agent. Keep longer repository conventions in repository docs and link them.

## Example: run PHP checks in DDEV

Suppose your existing check runs directly in the checkout:

```md
## bb-phase-validate

| When | Command |
|---|---|
| PHP implementation | `vendor/bin/phpcs` |
```

Your team now needs the test site's container and PHP version. First configure a `test` provisioning profile and a `phpcs` execution key through your [project hooks](/configuration/project/hooks). Then replace the section above with:

```md
## bb-phase-provision

For PHP checks, call `provision_up` with profile `test` to prepare the DDEV
site. Run its checks through the configured `provision_exec` keys.

## bb-phase-validate

| When | Command |
|---|---|
| PHP implementation | `provision_exec` with key `phpcs` |
```

Here `test` and `phpcs` must name your configured operations. Writing them in this file does not create the environment or command. The [DDEV addon](/addons/ddev) describes the adapter.

**Verify:** run a small PHP-change ticket. Its log should show preparation with `test`, followed by `phpcs` through the execution tool. Its handoff must record the check's result at the checked revision. A missing profile or a failed check is not a pass.

## Add delivery and review instructions

For example, append:

```md
## bb-phase-deliver

The merge request requires green CI, including PHP checks. Do not merge
until those checks pass.

## bb-phase-outtake

Use the test users in docs/testing.md. Provide each required persona's
preview link and login instructions for manual review.
```

Use your own test-user document. **Verify:** the handoff names the required personas and their access, and delivery records the required CI results. Missing access stays missing; it must not be replaced with an administrator account.

Choose [a recipe](/skills-and-workflows/recipes) for the engineering method and [collaboration labels](/skills-and-workflows/collaboration) for human approvals. Project rules cannot change the [fixed workflow boundaries](/skills-and-workflows/states#what-stays-fixed).

## Optional: mirror progress to GitLab

For a ticket with a GitLab origin, an authorized agent transition can also update an existing origin label. Manual state changes do not mirror labels. Install and sign in to `glab` on the conductor host, then add:

```md
## bb-phase-transition

| State | Origin label |
|---|---|
| qualification | doing |
| plan | doing |
| working | doing |
| review | doing |
| done | review |
```

Name labels that already exist in the GitLab project or a parent group. The agent maintains exactly one mapped label and leaves unrelated labels alone. Matching ignores case, preferring an exact match; a missing label warns without blocking the ticket transition. Omit a state to skip its write, or omit the table to disable mirroring.

**Verify:** after an authorized transition, check the origin issue for the mapped label and confirm its unrelated labels remain.
