# bakers.build — WORKFLOW

Read the complete ticket and comments, then execute only the current state's section of its loaded
bakers.build owner. `@bakers-build/workflow-step` owns lifecycle matching and order; this file selects context.

## Loaded skills

- @bakers-build/essential-skills
- @bakers-build/method-context
- @bakers-build/workflow-step
- @bakers-build/ddev-drupal-bug
- @bakers-build/ddev-drupal-feature
- @bakers-build/docs-authoring

## Skill set

- [Superpowers](.claude/skills/bakers-build/skills/method-context/references/superpowers.md)
- [Matt](.claude/skills/bakers-build/skills/method-context/references/matt.md)

## Skills

Binding under [Required skills](#required-skills). Apply all matching rows.

| When | Skill |
|---|---|
| Planning, writing, changing or reviewing tests (all work types and test tools) | `keytec-qa:keytec-testing` |
| `work:code`: `web/modules/custom/`, `web/themes/custom/`, `recipes/`, `config/` | `keytec-drupal:keytec-drupal-developer` |
| Components and stories under `web/themes/custom/bb_theme/` | `designbook:design-component` |
| Scenes under `web/themes/custom/bb_theme/` | `designbook:design-screen`, or `designbook:design-shell` for the application shell |
| Entity mappings under `web/themes/custom/bb_theme/` | `designbook:design-entity` |
| Design tokens under `web/themes/custom/bb_theme/` | `designbook:tokens` |
| Skills, frontmatter or plugin manifests | `mattpocock-skills:writing-for-agents`, `ponytail:ponytail` |

## Checks

Apply all matching rows to the plan and final diff. These are local checks; full CI gates remain
unchanged. Run each distinct command once per revision and environment, including across work types.
Reuse covered results; do not separately rerun repository contracts already included in core tests.
Ticket-specific functional checks apply separately. For other documentation, report applicable checks or none.

| When | Command |
|---|---|
| `work:code` or `work:docs`: bakers.build CLI, bakers.build skills, `WORKFLOW.md`, `scripts/**` or `tests/contract/**` | `cd bakers-cli && pnpm --filter @bakers-build/core test && pnpm lint` |
| bakers.build CLI source | `cd bakers-cli && pnpm install && pnpm -r run build` |
| PHP implementation | `ddev phpcs && ddev phpmd && ddev phpstan` |
| Config in `config/sync/**` or a module's/recipe's `config/install`, `config/optional`, `config/` | `bash tests/config-sync/check-config-sync.sh` |
| `docker-compose*.yml`, `docker/**`, `komodo/**` | `bash tests/contract/mcp-compose.sh` |
| Web UI implementation | `cd web/themes/custom/bb_theme && pnpm run build && pnpm exec storybook build` |
| Web UI implementation | `bash tests/contract/layout-components.sh` |
| Web UI implementation, or `tests/contract/**` | `bash tests/contract/token-discipline.sh && bash tests/contract/run-detail-overlay.sh && bash tests/contract/island-links.sh && node tests/contract/appearance.mjs && node tests/contract/icon-storybook.mjs` |
| Playwright configuration, fixtures, steps or helpers | `cd tests/playwright && npm run typecheck && npm run test:unit` |
| Adding or removing component directories | `bash tests/contract/data-display-components.sh` |

### Before merge

PHPUnit and browser E2E are **not** per-revision checks. They run **once, manually, in the runner**
(the dispatched worktree's DDEV environment) immediately before the merge request is merged, never
after each revision. Both must be runnable by hand there; if either cannot be started, the merge
is blocked until it can.

| When | Command |
|---|---|
| PHP implementation | `ddev exec ./vendor/bin/phpunit --configuration=phpunit.xml <path/to/AffectedTest.php> …` |
| Web UI implementation or Playwright behavior changes | `cd tests/playwright && npm test -- --list <affected-generated-feature-path> … && npm test -- <affected-generated-feature-path> …` |

### Test users

The `recipe-test` world (recipe `bb_e2e`) seeds these accounts. Every one has the password
**`Bb-test-login-426!`**; the passwordless login form is the product door, the password is for
Playwright `httpCredentials`, JSON:API basic auth and manual `drush uli`-free sign-in.

| User | Role | Use for |
|---|---|---|
| `login-admin` | `login_administrator` | Admin walks, JSON:API basic auth in the Playwright API client |
| `cwiedemann` | member of the seeded `bakers` workspace | Default human persona: tickets, projects, machines, conductors |
| `other-member` | member of another workspace | Cross-workspace visibility checks |
| `addon-reviewer` | guest of the seeded `bakers` workspace (ticket view, no update, no conductor) | Addon overlay access checks |
| `login-multi`, `login-empty`, `login-quiet`, `login-flood` | login fixtures (membership per name) | Sign-in landing rules, account navigation, shell |
| `login-blocked` | blocked account | Blocked-login error path |
| `api-operator`, `api-manager`, `api-session`, `api-roster`, `api-machine`, `api-machine-view`, `api-stats-outsider` | role of the same name | JSON:API permission matrix (`tests/playwright/features/api/**`) |
| `template-manager` | lead of the default workspace | Ticket-template management and instantiation (`tests/playwright/features/**/ticket-templates.feature`), ticket triggers (`ticket-template-triggers.feature`) |
| `template-automation` | Contributor service account of the default workspace (no password) | Execution identity of the seeded monthly trigger on *Monthly Drupal update* |
| `api-member`, `api-lead`, `api-dual-lead`, `api-foreign*`, `api-crew-mate`, `api-conductor-owner`, `api-app`, `api-pagination-*` | membership fixtures, no extra role | Query-access and pagination scenarios |

`create-*` accounts and `sgruber` have no password and are reached through magic links only.
Source of truth: `recipes/bb_e2e/content/user/*.yml` and `recipes/bb_e2e/config/user.role.*.yml`.

### Setup

| When | Setup |
|---|---|
| Core tests | Use Node >=22.22.0 and install the offline skill-evaluation dependency once with `npm ci --prefix tests/skill-eval`, as the CI conductor job does. |
| Playwright checks | Install dependencies once with `cd tests/playwright && npm ci`. Pure unit/type checks need no browser or Drupal. For browser checks, install Chromium with `npx playwright install chromium` as the run user and use recipe-test data. |
| Drupal checks | Start with a verified `recipe-test` environment; otherwise `ddev init --provider recipe-test`. Then validate in order: (1) **recipe first** — run the project and ticket checks on `recipe-test` (installation-config changes need `--fresh`), never importing `config/sync` there; (2) **config/sync last** — on a disposable site run `ddev init --provider existing-config --fresh`, `ddev drush updb -y`, `ddev drush cim -y`, `ddev drush cr`, `ddev drush status` and verify the affected behavior, without applying recipes to make it pass; (3) record provider, command, result and revision for both at the **same revision**; a fix after step 2 returns to step 1. Always name the provider: plain `ddev init` means `existing-config`. |
| Conductor or skill behavior | Isolated workspace: `scripts/setup-test-project.sh`; read its help and the fixture's committed workflow. Setup generates local configs. Commit the candidate workflow to the fixture branch and verify the dispatched worktree revision and actual required-skill loading in its run log. Register with `bakers conductor poll`; use the normal workspace connection to create and assign a local `work:docs` ticket. Start Conductor with the default worker connection and observe the worker. Release the test setup with `scripts/teardown-test-project.sh`. |
| Skill availability | Agent environment's own installation and discovery facilities. |

Select tests by affected behavior: include created/changed tests **and every affected consumer of
changed shared helpers, fixtures or configuration**. Search callers before choosing the union. If
impact cannot be bounded, run the relevant full suite and state why. Preserve role/permission
assertions, independent scenarios and both JS/no-JS consumers when affected.

For PHPUnit, list and run the affected classes by explicit path, never `--filter` or `--group`:
these can report `No tests executed!` with exit 0. An empty discovery is a failed selection, not
PASS. Use discovery output for counts; CI owns the full `unit-kernel` suite. A full local run, when
required by impact or the ticket's verification plan, uses ParaTest with **four workers** and one
path or suite (never a path list):
`ddev exec ./vendor/bin/paratest --configuration=phpunit.xml --testsuite unit-kernel --processes 4`

PHPUnit uses sqlite `:memory:` by default. Production uses MariaDB, so a MariaDB-dependent defect
can pass here: assert on values, not on the database's formatting (e.g. decimal scale `'0.8'` vs
`'0.8000'`). A check that needs MariaDB (every Functional test) sets it **inside the container**:
`ddev exec bash -c 'SIMPLETEST_DB=mysql://db:db@db/db ./vendor/bin/phpunit --configuration=phpunit.xml <path>'`;
exporting it on the host silently keeps sqlite.

Browser E2E uses Playwright, never PHPUnit. Navigation scenarios click twice. List the affected
selection first and require a non-empty list matching the executed report. The
[suite README](tests/playwright/README.md#install--run) shows generated paths and shared-helper
selection. Full CI runs include `@functional` already; do not launch that subset again.
Ad-hoc browser walks use `@bakers-build/verify-playwright-cli`; the existing suite remains a separate gate.
Changed skill behavior requires a real worker example selected in the ticket.

## Required skills

Selected skill-set entries, matching `Skills` rows, and `.prompt` values are **binding**: load every skill it requires before doing the work it governs.
**Load** means invoke the skill and read its **complete** `SKILL.md`, then announce what you loaded.
Equivalent reasoning, paraphrasing the method, or naming a skill afterwards does **not** count. A
value may mark a skill **advisory**; that one may be skipped, and you say so in the outtake.

**If a required skill is missing** — the value cannot be resolved, or a skill it names cannot be
resolved or read — **stop and report the exact identifier that failed**. Stop *before* editing a
file, committing, publishing a comment, asking for confirmation, or transitioning the ticket. Say
plainly that you cannot do the work because that skill is unavailable; do not substitute your own
method for it.

## Standards

**Read before designing, building or reviewing; every entry binds.** This section is a map and
copies nothing:

- Repository conventions (English only, standard Drupal, islands, config homes, Designbook,
  pre-merge tests, `bakers ui`, CLI build and layering): [`docs/bakers/conventions.md`](docs/bakers/conventions.md).
- Commit message, merge request and ticket-identifier rules: [`docs/bakers/git-and-delivery.md`](docs/bakers/git-and-delivery.md).
- The task map: [`docs/index.md`](docs/index.md).
- The workflow contract: `@bakers-build/workflow-step`, asserted by
  `bakers-cli/core/tests/workflow/step-contract.test.ts`.
