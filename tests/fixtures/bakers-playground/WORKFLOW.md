# bakers-playground — WORKFLOW

This project **loads** the skills below. Each skill self-declares, in its `when`, the `work_type`,
`workflow`, and `step` it is taken for, and owns that step's whole flow — guard, intake, work,
validation, outtake, confirmation, transition, origin publish, and STOP. This file **loads**; it
sequences nothing. The runtime matches the ticket's current `(work_type, workflow, step)` triple to
exactly one loaded skill and runs it; a gap or a collision is a configuration error. See
`@bakers-build/workflow-step` for the contract.

This file is **committed and hand-maintained**. It used to be generated per run by bakers.build's
`scripts/setup-test-project.sh` and hidden from git with `--skip-worktree`; it no longer is, so an
edit here is a reviewable change like any other and survives a fresh clone.

## Loaded skills

- @bakers-build/essential-skills
- @bakers-build/docs-authoring
    validate.command: |
      From the worktree root, confirm the change is present in the target document:
      `grep -n "<this ticket's identifier>" playground.md` must print the appended bullet, and
      `git status --short` must show no unintended file.
      A documentation change has no runtime surface here: this repository configures no Markdown
      or link linter and no skill-frontmatter or workflow-contract suite, so none of those checks
      exist. Do not reach for the Drupal site or PHPUnit either — those belong to `work:code`. Say
      honestly what does not exist instead of inventing a check.
- @bakers-build/ddev-drupal-feature
    validate.command: |
      From the worktree root, in this order: `ddev phpunit` for the unit/kernel coverage authored
      with the change, then `ddev phpcs` and `ddev phpstan` over the changed paths, and `ddev lint`
      when front-end assets changed. Assert the resulting behaviour with targeted `ddev drush`
      reads against the provisioned site.
      There is NO `ddev e2e` here: this repository configures no Playwright-BDD runtime and ships
      no `tests/` directory, so browser E2E does not exist. PHPUnit plus the drush assertions are
      the honest coverage — say so instead of inventing a browser walk.
- @bakers-build/ddev-drupal-bug
    validate.command: |
      From the worktree root, in this order: `ddev phpunit` for the regression test that reproduces
      the defect — RED before the fix, GREEN after — then `ddev phpcs` and `ddev phpstan` over the
      changed paths. Assert the repaired behaviour with targeted `ddev drush` reads against the
      provisioned site.
      There is NO `ddev e2e` here: this repository configures no Playwright-BDD runtime and ships
      no `tests/` directory, so browser E2E does not exist. A regression that cannot be expressed
      as a PHPUnit test is recorded as a drush assertion with its before/after output — say which
      it is rather than implying browser coverage.

