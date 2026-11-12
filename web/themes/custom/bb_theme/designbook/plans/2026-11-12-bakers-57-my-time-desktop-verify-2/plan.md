# Plan: design-verify
<!-- digest: d2885ae96146d31242e744bee571f94fc65e1f717a48f2c022260b5ee1bd9860 -->

## Schemas
```yaml
definitions:
  StoryId:
    type: string
    description: |
      CSF story id (`sanitize(title)--sanitize(name)`). `sanitize` lowercases and turns spaces, slashes and other non-alphanumerics into `-` (CSF `toId`).

      SDC component stories: derive from frozen identity namespace + group + component + variant (see designbook-drupal `sdc-components` story-address rule). Example: `test-integration-drupal-shell-header--default`.

      Vue component stories: derive from title `Components/<Human Name>` (see designbook-vue `vue-components` story-address rule). Example: `components-book-card--default`.

      Scene files (`*.scenes.yml`): each scene export uses title `<group>/Scenes` and the scene display name, so the id is `sanitize(<group>/Scenes)--sanitize(<scene>)`. The stem is the `group` field, not the section file `id`. Example: group `Designbook/Sections/Wayfinding`, scene `signage` → `designbook-sections-wayfinding-scenes--signage`. The overview entry (section files only) uses title `<group>` and name `Overview`, so the id is `sanitize(<group>)--overview`. Example: group `Designbook/Sections/Wayfinding` → `designbook-sections-wayfinding--overview`.

      Entity stories use their own title prefixes. Copy retained ids from the live index when unchanged.
    examples:
      - test-integration-drupal-shell-header--default
      - test-integration-drupal-action-button--primary
      - components-book-card--default
      - designbook-sections-wayfinding-scenes--signage
      - designbook-sections-wayfinding--overview
  FrozenObservationQuery:
    type: object
    title: Bound observation cell
    additionalProperties: false
    required:
      - reference
      - package
      - subjects
      - states
      - views
      - fingerprint
    properties:
      reference:
        type: string
        description: Absolute directory of the published revision.
      package:
        type: string
        enum:
          - component
      subjects:
        type: array
        minItems: 1
        maxItems: 1
        items:
          type: string
        description: Exactly one observed subject for this comparison.
      states:
        type: array
        minItems: 1
        maxItems: 1
        items:
          type: string
        description: Exactly one observed state for this comparison.
      views:
        type: array
        minItems: 1
        maxItems: 1
        items:
          type: string
        description: Exactly one native view
        explicitly mapped to the other side.: null
      fingerprint:
        type: string
        pattern: ^[a-f0-9]{64}$
        description: Fingerprint returned by reference prepare.
  ObservationComparison:
    type: object
    title: Explicit correspondence between captured source and actual observations
    additionalProperties: false
    required:
      - reference_query
      - actual_query
      - threshold
      - diff_path
    properties:
      reference_query:
        $ref: '#/definitions/FrozenObservationQuery'
      actual_query:
        $ref: '#/definitions/FrozenObservationQuery'
      threshold:
        type: number
        minimum: 0
        maximum: 1
        description: Maximum measured pixel deviation accepted by this check.
      diff_path:
        type: string
        description: Absolute planned path for the comparison diff outside either published revision.
  CaptureFile:
    title: Captured binary artifact
    description: Declared direct screenshot or asset file; plan done records its exact file integrity.
  Issue:
    type: object
    required:
      - severity
      - description
    properties:
      id:
        type: string
      story_id:
        type: string
      checkKey:
        type: string
      severity:
        type: string
        enum:
          - critical
          - major
          - minor
      description:
        type: string
      file_hint:
        type: string
      check:
        type: string
      source:
        type: string
      details:
        type: string
      properties:
        type: array
        items:
          type: object
          properties:
            property:
              type: string
            expected:
              type: string
            actual:
              type: string
  ObservationCompareArtifact:
    type: object
    title: Measured comparison of two published observation cells
    required:
      - story_id
      - reference_subject
      - reference_view
      - reference_state
      - actual_subject
      - actual_view
      - actual_state
      - passed
      - diff_percent
      - severity
      - reference_path
      - screenshot_path
    properties:
      story_id:
        $ref: '#/definitions/StoryId'
      reference_subject:
        type: string
        description: Selected source subject identity.
      reference_view:
        type: string
        description: Selected native source view identity.
      reference_state:
        type: string
        description: Selected observed source state.
      actual_subject:
        type: string
        description: Corresponding actual subject identity.
      actual_view:
        type: string
        description: Corresponding actual view identity.
      actual_state:
        type: string
        description: Corresponding observed actual state.
      passed:
        type: boolean
        description: Measured diff is within the declared threshold and all evidence is valid.
      diff_percent:
        type: number
        description: Measured pixel deviation from compare-images.
      severity:
        type: string
        enum:
          - pass
          - minor
          - major
          - critical
      reference_path:
        type: string
        description: Exact source image path returned by the frozen query.
      screenshot_path:
        type: string
        description: Exact actual image path returned by the frozen query.
      diff_path:
        type: string
        description: Written comparison diff path.
```

## Context
### task:compare-observations (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/tasks/compare-observations.md)
```
---
title: Compare published observations
trigger:
  steps: [compare-observations]
params:
  type: object
  required: [story_id, comparison]
  properties:
    story_id: { $ref: '../../scenes/schemas.yml#/StoryId' }
    comparison: { $ref: '../schemas.yml#/ObservationComparison' }
result:
  type: object
  required: [issues, compare_artifacts]
  properties:
    diff:
      path: '{{ comparison.diff_path }}'
      submission: direct
      validators: [image]
      $ref: '../schemas.yml#/CaptureFile'
    issues:
      type: array
      items: { $ref: '../schemas.yml#/Issue' }
    compare_artifacts:
      type: array
      items: { $ref: '../schemas.yml#/ObservationCompareArtifact' }
---

# Compare published observations

Measured visual and structural findings for the explicitly corresponding source
and actual observation cells. Every selected cell has one comparison artifact;
missing evidence produces a blocked check rather than a visual pass.

```

### task:triage (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/tasks/triage.md)
````
---
name: designbook:design:triage--design-verify
title: "Triage: {{ story_id }}"
trigger:
  steps: [triage]
priority: 10
params:
  type: object
  required: [story_id, issues]
  properties:
    story_id:
      $ref: ../../scenes/schemas.yml#/StoryId
    issues:
      type: array
      items:
        $ref: ../schemas.yml#/Issue
result:
  type: object
  required: [issues]
  properties:
    issues:
      type: array
      items:
        $ref: ../schemas.yml#/Issue
---

# Triage

Reads all draft issues from the compare stage, consolidates duplicates and overlapping issues, improves descriptions, and passes the consolidated `issues` array as workflow params for the polish stage.

## Step 1: Read All Draft Issues

Read the `issues` array from scope — it contains all issues collected from the compare tasks via their `result: issues` declarations.

If the `issues` array is empty, complete the task (no issues to consolidate).

## Step 2: Consolidate and Rewrite

Review the full issue list across all checks and breakpoints:

1. **Merge duplicates** — same element + same property across different breakpoints or check types (e.g., markup extraction and screenshot both flag the same font-size). Keep the most specific description, note affected breakpoints.

2. **Group related issues** — multiple property deviations on the same element (e.g., Hero Heading has wrong fontSize AND fontFamily AND color) become ONE issue with a combined description. This prevents 6 separate polish tasks for one CSS fix.

   **Separation rule:** Each distinct actionable fix SHALL be a separate issue. If fixing one problem does not fix the other, they are separate issues — even if both appear in the same region or component. Example: "Logo icon missing" and "Search button missing" are two issues, not one.

3. **Assign an ID** — each consolidated issue gets a short, stable ID: `issue-<NNN>` (zero-padded, sequential). Example: `issue-001`, `issue-002`. The ID is used as task identifier in the polish stage.

4. **Rewrite descriptions as work instructions** — each issue description is rewritten so the polish task can execute it without additional context:

   **Format:**
   ```
   <Element>: <Property1> FROM → TO, <Property2> FROM → TO. File: <file_hint>. [Breakpoints: sm, xl.]
   ```

   **Example:**
   ```
   Hero Heading: fontSize 14px → 48px, fontFamily 'Nunito Sans' → 'Inter', color #1D1B20 → #FFFFFF. File: components/hero/hero.twig. Breakpoints: sm, xl.
   ```

   Rules for rewriting:
   - Start with the element name (from `label` or inferred from description)
   - List ALL properties with concrete FROM → TO values
   - Always include `File:` with the file path
   - If the issue spans multiple breakpoints, list them
   - Keep it to one line — no markdown, no bullet lists

5. **Assign priority** — `critical` before `major`. Within same severity, group by file (so one polish task can fix multiple properties in one file).

## Result: issues

Return the complete consolidated issue list with stable IDs, severity, affected targets and evidence.
Completion: every input finding is accounted for. After this check completes, its intake hands
these issues to a separate repair intake; the checking workflow's task list remains fixed.

````

### task:outtake--design (task, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/tasks/outtake--design.md)
````
---
name: designbook:design:outtake--verify-scenes
title: "Outtake: Verify Scenes"
trigger:
  steps: [design-verify:outtake]
priority: 50
params:
  type: object
  required: [story_id, issues]
  properties:
    reference: { type: array, default: [] }
    story_id:
      $ref: ../../scenes/schemas.yml#/StoryId
    issues:
      type: array
---

# Outtake — Score & Verify

Displays the visual comparison results from the inline capture/compare stages, then offers to run design-verify.

## Step 1: Read Issues and Compute Score

Read the `issues` array from scope — it contains all issues collected from the compare tasks via their `result: issues` declarations. Each issue has `severity` (critical, major, minor) and `check` (breakpoint--region).

**Score formula per region:**
```
score = (critical_count × 3) + (major_count × 2) + (minor_count × 1)
```

If the `issues` array is empty (compare found no issues), skip to Step 2.

## Step 2: Display Score Table

Display a table with the comparison results:

```
## Visual Comparison — ${story_id}

| Breakpoint | Region | Score | Diff |
|------------|--------|-------|------|
| sm         | header |     5 | Background color mismatch (#00336a → #1a1a2e), nav font too large |
| sm         | footer |     0 | — |
| xl         | header |     3 | Logo left spacing too small |
| xl         | footer |     1 | Link color slightly off |

**Total Score: 9** (0 = perfect match)
```

- Score 0 for a region means perfect visual match — show `—` as Diff
- List the key issues from each draft file as a short summary in the Diff column
- Total score is the sum of all region scores

## Step 3: Ask for User Observations

Ask the user:

> "Anything else you noticed?"

Wait for the response. If the user mentions additional issues, acknowledge them.

## Step 4: Offer Design-Verify

Ask the user:

> "Start design-verify?"

- **If yes** → create and run the design-verify workflow as a child workflow with params `{"story_id": "${story_id}", "reference": <params.reference>}`.

  Execute the child workflow completely. Since screenshots already exist from the inline capture, the capture tasks will auto-skip.

- **If no** → archive the workflow normally.

## Output

```
## Outtake — ${story_id}

Total Score: {score} (0 = perfect match)
{score table}

User feedback: {feedback or "none"}
Design-verify: {launched / skipped}
```

````

### ctx:cli-surface (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/workflow/rules/cli-surface.md)
```
---
name: designbook-cli-surface
trigger:
  steps:
    [
      capture,
      capture-backend,
      capture-file,
      capture-image,
      compare,
      compare-observations,
      compile-css,
      create-data-model,
      create-sample-data,
      create-scene-file,
      create-tokens,
      create-vision,
      generate-css,
      generate-index,
      generate-jsonata,
      guard-css,
      map-entity,
      observe-figma,
      observe-storybook,
      observe-website,
      outtake,
      polish,
      polish-config,
      prepare-fonts,
      publish-capture,
      re-capture,
      re-capture-backend,
      re-compare,
      refresh-components,
      setup-storybook,
      sync,
      transform,
      triage,
      triage-config,
      validate,
      verify-install,
      write-component,
      write-config,
      write-scene,
    ]
---

# CLI command surface

`_debo` / `npx storybook-addon-designbook` is the command contract for every
workflow. Run the command. Its stdout and stderr are the spec: intake context,
schemas, instructions, status. Skill descriptions only fire the skill; they
are not the command surface.

Every intake's first command is `intake <id>`. Source dumps use
`_debo reference save --reference <dir> --url <url> --state <name> --session
<name>`. Screenshots use `_debo reference capture-image --reference <dir> --path
<png> --url <url> --selector <sel> --width <px> --session <name>` (optional
`--steps`, `--prelude`). Asset files use `_debo reference capture-file
--reference <dir> --path <rel> --url <absolute-http-url> --session <name>`.
Unpublished revisions are read with `_debo reference inspect`; a prelude is
fingerprinted with `_debo reference prelude`. A full matrix uses
`_debo capture matrix`. Story identity uses `_debo storybook check`.
`plan instructions` supplies the saved step. A nonzero CLI exit ends this
work with that exact message. Recover with `--help`, the intake context, or the
saved step instructions.

`packages/storybook-addon-designbook` is not a recovery path. When the work needs
a fact that `--help`, the intake context and the saved step instructions do not carry,
stop and name that missing fact in the report — the skills own it, so the gap is
the finding. Reconstructing it from the addon source, or from a stored artifact
opened off disk, publishes a guess in the place of an observation.

```

### ctx:compare-observations (rule, source: /Users/pascalglass/.claude/plugins/cache/designbook/designbook/a4fea9d7cf8d/design/rules/compare-observations.md)
```
---
name: compare-published-observations
trigger:
  steps: [compare-observations]
---

# Compare the bound observation pair

Resolve `comparison.reference_query` and `comparison.actual_query` through
`reference query --request <query-file>`. Each query must return exactly one
capture and its corresponding observed structure. Use the exact returned capture
paths. Native source and actual node identities may differ; their declared
subject/view/state correspondence determines the pair.

Compare observed hierarchy, dimensions, content and available properties against
the planner's supplied acceptance criteria. Required unavailable evidence, a
missing story or an error-page capture blocks this check. A file existing alone
cannot establish that the intended subject was captured.

Measure the two images using `compare-images --reference <reference-path>
--actual <actual-path> --diff <comparison.diff_path>`. Keep the returned
`diff_percent`, dimensions and deterministic `severity`. Set `passed` only when
both cells are valid and the deviation is within `comparison.threshold`; report
structural dimension drift explicitly. Preserve every finding and both native
cell identities in the comparison artifact.

The two capture revisions remain read-only. Additional evidence requires a new
capture workflow and a new comparison plan. Diff output belongs outside either
published directory.

```

## Steps

### Step: compare-observations
Context: [ctx:cli-surface, ctx:compare-observations]

- [x] compare-observations — my-time desktop

  Instruction: task:compare-observations

  #### Params
  ```yaml
  story_id: designbook-sections-user-scenes--personal-time-week
  comparison:
    reference_query:
      reference: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-57-vorschl-ge-mitg/web/themes/custom/bb_theme/designbook/references/8c75dc05ca021b53/96b34e1b9fb7053f
      package: component
      subjects:
        - my-time
      states:
        - default
      views:
        - desktop
      fingerprint: 1f34d5e8faf11b65fab0b02b18c35c5ed97a1e5bd165714b03b0d65e12f4a1b8
    actual_query:
      reference: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-57-vorschl-ge-mitg/web/themes/custom/bb_theme/designbook/references/d6f4f6c1cf1b2c3c/e1b065751f4896c7
      package: component
      subjects:
        - my-time
      states:
        - default
      views:
        - desktop
      fingerprint: 9f1d0422b5793366493ca3c1bf37e4f493777b863c470a897a73017f1ddd16d1
    threshold: 0.02
    diff_path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-57-vorschl-ge-mitg/web/themes/custom/bb_theme/designbook/plans/2026-11-12-bakers-57-my-time-desktop-verify/diff-my-time.png
  ```

  #### Contract
  ```yaml
  outputs:
    diff:
      required: false
      schema:
        $ref: '#/definitions/CaptureFile'
      submission: direct
      validators:
        - image
      path: /Users/pascalglass/Projects/bakers-build/.bakers-worktrees/feat/bakers-57-vorschl-ge-mitg/web/themes/custom/bb_theme/designbook/plans/2026-11-12-bakers-57-my-time-desktop-verify/diff-my-time.png
    issues:
      required: true
      schema:
        type: array
        items:
          $ref: '#/definitions/Issue'
      submission: data
      validators: []
    compare_artifacts:
      required: true
      schema:
        type: array
        items:
          $ref: '#/definitions/ObservationCompareArtifact'
      submission: data
      validators: []
  ```

  #### Results
  <!-- done -->

### Step: triage
Context: [ctx:cli-surface]

- [x] triage — my-time

  Instruction: task:triage

  #### Params
  ```yaml
  story_id: designbook-sections-user-scenes--personal-time-week
  issues: []
  ```

  #### Contract
  ```yaml
  outputs:
    issues:
      required: true
      schema:
        type: array
        items:
          $ref: '#/definitions/Issue'
      submission: data
      validators: []
  ```

  #### Results
  <!-- done -->

### Step: outtake
Context: [ctx:cli-surface]

- [x] outtake--design — my-time verify

  Instruction: task:outtake--design

  #### Params
  ```yaml
  story_id: designbook-sections-user-scenes--personal-time-week
  issues: []
  reference: []
  ```

  #### Contract
  ```yaml
  outputs: {}
  ```

  #### Results
  <!-- done -->

