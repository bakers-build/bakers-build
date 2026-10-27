# bakers.build — WORKFLOW

Invoke `bakers:bb-workflow` and follow it for the ticket's current state.

## bb-phase-provision

Runtime: DDEV through `@bakers-build/bb-runtime-ddev`. Drupal checks start from a verified
`recipe-test` environment (`ddev init --provider recipe-test`; installation-config changes need
`--fresh`); `config/sync` validation uses a disposable `existing-config` site afterwards, at the
same revision. Core tests, Playwright, conductor and skill-behavior setup:
[testing](docs/bakers/testing.md#setup).

## bb-phase-work

Apply all matching rows.

| When | Skill |
|---|---|
| Planning, writing, changing or reviewing tests (any test tool) | `keytec-qa:keytec-testing` |
| `web/modules/custom/`, `web/themes/custom/`, `recipes/`, `config/` | `keytec-drupal:keytec-drupal-developer` |
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
| bakers.build CLI, bakers.build skills, `WORKFLOW.md`, `scripts/**` or `tests/contract/**` | `cd bakers-cli && pnpm --filter @bakers-build/core test && pnpm lint` |
| bakers.build CLI source | `cd bakers-cli && pnpm install && pnpm -r run build` |
| PHP implementation | `ddev phpcs && ddev phpmd && ddev phpstan` |
| Config in `config/sync/**` or a module's/recipe's `config/install`, `config/optional`, `config/` | `bash tests/config-sync/check-config-sync.sh` |
| `docker-compose*.yml`, `docker/**`, `komodo/**` | `bash tests/contract/mcp-compose.sh` |
| `.gitlab-ci.yml` | `glab ci lint .gitlab-ci.yml && bash tests/config-sync/check-ci-wiring.sh` |
| Web UI implementation | `cd web/themes/custom/bb_theme && pnpm run build && pnpm exec storybook build` |
| Web UI implementation | `bash tests/contract/layout-components.sh` |
| Web UI implementation, or `tests/contract/**` | `bash tests/contract/token-discipline.sh && bash tests/contract/run-detail-overlay.sh && bash tests/contract/island-links.sh && node tests/contract/appearance.mjs && node tests/contract/icon-storybook.mjs && node tests/contract/period-range.mjs` |
| Playwright configuration, fixtures, steps or helpers | `cd tests/playwright && npm run typecheck && npm run test:unit` |
| Adding or removing component directories | `bash tests/contract/data-display-components.sh` |

## bb-phase-deliver

PHPUnit and browser E2E run once, in the CI merge gate, immediately before the merge request is
merged, against the images that deploy:

1. Bring the branch up to date with its target (rebase or merge), push, and wait for the fast checks.
2. Play the manual `gate` job of the newest merge request pipeline. `build` builds the images once;
   `phpunit`, `e2e` and `config_install` run against them in parallel.
3. Merge only when the whole pipeline is green; GitLab blocks the merge until it is. A red gate job
   is a failed check: fix it on the branch and play the gate again on the new pipeline.

Local runs are for debugging a failure or selecting affected tests, never a substitute for the gate
([testing](docs/bakers/testing.md)).

### Before merge

The merge request title is the squash subject, verbatim, and the release changelog is generated
from it: a Conventional Commits subject `type(scope)!: subject`, with `type` one of `feat`, `fix`,
`chore`, `docs`, `refactor`, `test`, `ci`, `build`, `perf`, an optional scope (`cli`, `server`, a
module) and `!` for a breaking change (`feat(stats): new vs. done flow chart`). The title lint job
and the merge refuse any other title; retitle the merge request before playing the gate.

## bb-phase-outtake

`test_as` personas come from [testing › Test users](docs/bakers/testing.md#test-users): the one
whose rank and team the change needs (default `north-lead`), plus every persona the criteria expect
to be denied (e.g. `north-guest`, `no-bakery`). Manual review gives each a one-time login link
(`@bakers-build/bb-runtime-ddev` › `bb-phase-outtake`); on a `recipe-test` site the *Test personas* buttons on
`/user/login` are the fallback.

## bb-phase-transition

| State | Origin label |
|---|---|
| qualification | doing |
| plan | doing |
| working | doing |
| review | doing |
| done | review |
