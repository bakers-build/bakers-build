# bakers.build — WORKFLOW

Invoke `bakers:bb-workflow` and follow it for the ticket's current state.

## bb-phase-provision

Drupal checks run on `provision_up('recipe-test')`, which reuses a ready `recipe-test` site;
`config/sync` validation uses `provision_up('existing-config-fresh')` afterwards, a fresh
`existing-config` install at the same revision. In a run with conductor tools, a `ddev <cmd>` row
runs as `ddev_exec("<cmd>")`, and a project web command runs by path
(`ddev_exec(".ddev/commands/web/<cmd>")`). Core tests, Playwright, conductor and skill-behavior
setup: [testing](docs/bakers/testing.md#setup).

## bb-phase-work

Apply all matching rows.

| When | Skill |
|---|---|
| Planning, writing, changing or reviewing tests (any test tool) | `testing` |
| `web/modules/custom/`, `web/themes/custom/`, `recipes/`, `config/` | `drupal-developer` |
| Drupal core or contrib updates | `drupal-update` |
| Components and stories under `web/themes/custom/bb_theme/` | `designbook:design-component` |
| Scenes under `web/themes/custom/bb_theme/` | `designbook:design-screen`, or `designbook:design-shell` for the application shell |
| Entity mappings under `web/themes/custom/bb_theme/` | `designbook:design-entity` |
| Design tokens under `web/themes/custom/bb_theme/` | `designbook:tokens` |
| Skills, frontmatter or plugin manifests | `mattpocock-skills:writing-for-agents`, `ponytail:ponytail` |

## bb-phase-validate

Apply all matching rows to the plan and final diff. Run each distinct command once per revision and
environment; reuse covered results, and do not separately rerun repository contracts already
included in core tests. Ticket-specific functional checks apply separately.

| When | Command |
|---|---|
| `docs/**` or documentation links | `cd docs && pnpm build && node --test scripts/manual.test.mjs scripts/marketplace.test.mjs` |
| bakers.build CLI, bakers.build skills, `WORKFLOW.md`, `scripts/**` or `tests/contract/**` | `cd bakers-cli && pnpm --filter @bakers-build/core test && pnpm lint` |
| bakers.build CLI source | `cd bakers-cli && pnpm install && pnpm -r run build` |
| PHP implementation | `ddev phpcs && ddev phpmd && ddev phpstan` |
| Config in `config/sync/**` or a module's/recipe's `config/install`, `config/optional`, `config/` | `bash tests/config-sync/check-config-sync.sh` |
| `docker-compose*.yml`, `docker/**`, `komodo/**` | `bash tests/contract/compose.sh` |
| `.ddev/**` | `bash tests/contract/ddev-provision.sh` |
| `.gitlab-ci.yml` | `glab ci lint .gitlab-ci.yml && bash tests/config-sync/check-ci-wiring.sh` |
| Web UI implementation | `cd web/themes/custom/bb_theme && pnpm run build && pnpm exec storybook build` |
| Web UI implementation | `bash tests/contract/layout-components.sh` |
| Web UI implementation, or `tests/contract/**` | `bash tests/contract/token-discipline.sh && bash tests/contract/run-detail-overlay.sh && bash tests/contract/island-links.sh && node tests/contract/appearance.mjs && node tests/contract/icon-storybook.mjs && node tests/contract/period-range.mjs` |
| Playwright configuration, fixtures, steps or helpers | `cd tests/playwright && npm run typecheck && npm run test:unit` |
| Adding or removing component directories | `bash tests/contract/data-display-components.sh` |

## bb-phase-deliver

PHPUnit, browser E2E and config import run against the built Docker images in CI.

For GitHub, update the branch from its target, push and wait for the complete `GitHub checks`
workflow and its aggregate `required`. PRs into `next` skip `image_gate`; it runs on the push to `next`
after the merge, before the develop deployment. PRs into `main` run it, and `required` fails without it. A failed check blocks
the PR; fix it on the branch and require green checks on the new revision. Protected `next` accepts
squashed feature PRs. Stable `main` accepts merge commits only from this repository's `next`,
preserving its tree and second parent.

For a project still using GitLab, play the newest MR pipeline's manual `gate` after fast checks.
Its `build`, `phpunit`, `e2e` and `config_install` jobs must all succeed before merging.

Local runs are for debugging, never a substitute for the CI gate
([testing](docs/bakers/testing.md)).

### Before merge

The merge request title is the squash subject, verbatim, and the release notes are generated
from it: a Conventional Commits subject `type(scope)!: subject`, with `type` one of `feat`, `fix`,
`chore`, `docs`, `refactor`, `test`, `ci`, `build`, `perf`, an optional scope (`cli`, `server`, a
module) and `!` for a breaking change (`feat(stats): new vs. done flow chart`). The title lint job
and the merge refuse any other title; retitle the merge request before playing the gate.

## bb-phase-outtake

`test_as` personas come from [testing › Test users](docs/bakers/testing.md#test-users): the one
whose rank and team the change needs (default `north-lead`), plus every persona the criteria expect
to be denied (e.g. `north-guest`, `no-bakery`). Manual review gives each a one-time login link
using the project's [DDEV login instructions](docs/bakers/ddev-logins.md); on a `recipe-test` site the *Test personas* buttons on
`/user/login` are the fallback.

## bb-phase-transition

| State | Origin label |
|---|---|
| qualification | doing |
| plan | doing |
| working | doing |
| review | doing |
| done | review |
