# Project Board verification

The approved executable plan completed all five tasks. The implementation is a
Designbook prototype with frozen project fixtures; no Drupal routes, configuration,
production data model or role resolver were added. No visual reference exists, so
verification uses functional and layout observations rather than a similarity score.

## Functional evidence

The permanent browser scenarios are in
`tests/playwright/features/project-board/project-board.feature` and
`tests/playwright/steps/project-board.steps.ts`. All five scenarios passed against
the built Storybook output using:

```sh
cd tests/playwright
STORYBOOK_URL=http://127.0.0.1:34876 npm --ignore-scripts test -- --grep 'Project Board'
```

`STORYBOOK_URL` selects an already served build. When absent, the steps reuse or
start Storybook through the Designbook CLI. The test lifecycle's Drupal definition
generator is unnecessary for these fixture-only Storybook scenarios.

| Criteria | Observation |
|---|---|
| AC01 | Overview links to the Board; the rendered page retains seven project tabs, one main canvas region and one heading. |
| AC02–03 | Four persistent columns: Backlog (no conductor), Intake (qualification with conductor), Working (other open states with conductor), Done (terminal). |
| AC04 | Conductor filters the board; empty phases remain visible. |
| AC05 | Details splits only Working into exact state groups; empty subgroups disappear and cards remain within their column. |
| AC06 | PM context starts off; the developer/dual-role presentation context starts on. |
| AC07 | Blocked and Cancelled appear as text, including their coexistence; blocking leaves workflow state and derived status independent. |
| AC08 | Done 10 / 25 / 50 lives in the Done column and keeps the newest closed tickets under the frozen clock. Missing and future closing dates stay out of Done. |
| AC09 | Conductor is a native select of project-scoped active conductors; offline and other-project conductors stay out. |

Desktop (1440 × 900) and narrow (390 × 844) observations cover wrapping controls,
keyboard Details activation, a focusable horizontal board and no document overflow.
Legacy default/phases Board stories and all retained Board Card stories render.

## Project checks

- Theme build and static Storybook build: PASS.
- bakers.build CLI core tests: 556 passed; lint: PASS. The existing skill-eval package was
  installed from its lockfile to satisfy the suite's Promptfoo dependency.
- Token discipline, run-detail overlay, island links, appearance and icon Storybook
  contracts: PASS.
- Layout contract: PASS. A4 and A10 now follow a sole `entity: view.*` content
  child through `entity-mapping/<view>.<mode>.jsonata`, so a View that owns the
  canvas and page-header tabs satisfies D2/D7 without inlining that chrome in the
  scene YAML. Listings that still sit inside `canvas.main` keep the inline
  assertion. Missing mappings fail.
- Full Drupal BDD/install-path validation remains out of scope for this
  Designbook prototype. This is not a claim of production merge readiness.

Transient command output and screenshots live under `assets-ai/BB-629/`.
The ticket coding handoff records the tested commit, MR, final environment results
and the verified public preview. No review or merge is implied by plan completion.
