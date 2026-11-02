---
name: testing
description: Use when planning, writing, updating, or reviewing tests in this repository.
---

# Testing

Use Playwright for browser tests; in Drupal, prefer it over
Functional/FunctionalJavascript tests. Use the suite's existing fixtures and
steps. Follow the project's test configuration and commands.

- **Describe behavior first.** Before implementation, define expected outcomes
  and relevant failure and boundary cases. Express user flows as small, readable BDD
  scenarios. Derive assertions from requirements, independently of the
  implementation; tests should survive internal refactoring.
- **Reuse before adding.** Inspect existing scenarios, steps, and helpers. Extend
  them; add regression coverage only for a genuine behavior gap, not for every
  bug fix. Permanent tests check function and visibility only. Layout and design
  checks are always temporary; never commit temporary tests.
- **Organize by responsibility.** Scenarios belong to features and may be
  entity-specific. Steps belong to business capabilities or reusable UI components,
  never tickets or entity types; pass entity-specific values as parameters.
  Share common component interactions across pages; keep page prerequisites and
  business rules with their features. Not every component needs its own steps.
- **Generalize only what matches.** Parameterize variations of the same action or
  result using meaningful values. Use every parameter and identify the intended
  component when several are present. Share technical helpers without hiding
  different roles, permissions, or outcomes behind a universal step.
- **Keep scenarios independent.** Let fixtures own actors, data, and cleanup,
  including after failure. Use configured environments and resolved test data.
  Assert observable readiness instead of fixed delays. Setup must not bypass
  the behavior the scenario is meant to test.
- **Verify selectively.** Always filter test runs to tests relevant to the change,
  including consumers of changed shared steps. Run a complete suite only when the
  project's test-selection rules allow it; the CI pipeline owns routine full-suite execution. Resolve missing or ambiguous bindings and preserve existing assertions
  when consolidating coverage. Missing, skipped, or weakened checks are not
  evidence that a regression disappeared. Report the command, environment,
  result, and report or trace location so the run can be verified and repeated.
