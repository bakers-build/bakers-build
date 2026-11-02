# bakers.build BDD feature tests

Behaviour-driven browser and HTTP contract tests built on [`playwright-bdd`](https://vitalets.github.io/playwright-bdd/)
and `@playwright/test`, with project-owned fixtures and steps. Features are English Gherkin;
steps in `steps/` and `support/steps/` share the `test` and BDD bindings exported by
`bdd.fixtures.ts`. No hand-written selectors belong in `.feature` files.

The suite covers browser navigation and form behavior, plus the JSON:API contracts that
previously used PHPUnit `BrowserTestBase`. API scenarios use Playwright request contexts;
browser scenarios use Chromium. Both are English Gherkin with scenario-local fixtures.
Storybook and `tests/contract/` remain separate component gates.

## Layout

```
tests/playwright/
├── package.json               # pinned deps + scripts
├── playwright.bdd.config.ts   # TWO defineBddConfig suites (see below); workers:4;
│                              #   list + junit + html + json
├── bdd.fixtures.ts            # BDD test + worker auth and API cleanup fixtures
├── resolve-base-url.ts        # baseURL precedence (env -> .env.ddev)
├── resolve-base-url.test.ts   # vitest unit test for the resolver (`npm run test:unit`)
│                              #   scoped away from .features-gen/: vitest would otherwise
│                              #   collect the GENERATED Playwright specs and fail on them,
│                              #   and only after a run had generated them — green on a
│                              #   fresh checkout, red afterwards.
├── support/                   # helpers WITHOUT step registrations, imported by steps
│   ├── api-client.ts          #   JSON:API request client + recipe UUID aliases
│   ├── contract-world.json    #   the aliases themselves
│   ├── worker-auth-provider.ts #  per-worker session cache (+ its vitest test)
│   ├── shell.ts               #   document mark, island selectors, seed-account handles
│   ├── listing.ts             #   state + helpers of the faceted list screens
│   ├── drush.ts               #   Drush.exec(), php() and billing-lock retry
│   ├── login-flow.ts          #   Mailpit / login-link / flood helpers
│   ├── picker.ts              #   option-picker locators
│   ├── detail-cards.ts        #   detail-page cards, Activities, card save round trip
│   ├── provision-state.ts     #   account/workspace provisioning snapshots
│   └── steps/                 # SHARED steps; each file names its consumer folders
│       ├── core.ts            #   administrator/anonymous login and button click
│       ├── accounts.steps.ts  #   switch to a named seed account
│       ├── api.steps.ts       #   JSON:API client, requests, document assertions
│       ├── contract-browser.steps.ts # recipe-account browser + form-field contracts
│       ├── landing.steps.ts   #   site root, workspace chooser, gate chrome
│       ├── listing.steps.ts   #   facets, chips, address, closed-rows control
│       ├── detail-cards.steps.ts # detail-page cards and the Activities feed
│       └── shell.steps.ts     #   shell navigation, reload mark, request counts
├── steps/<folder>/            # steps + hooks owned by ONE feature folder
└── features/<folder>/         # the Gherkin, one folder per feature area:
    conductors/  deployments/  dialogs/  entity-detail/  home/  island-profiles/  projects/
    runs/  settings/  shell/  sign-in/  statistics/  team/  tickets/  user/  workspace/
```

**A step lives with the feature it expresses.** `steps/<folder>/` mirrors `features/<folder>/`
(a folder whose steps are all shared, such as `deployments/`, has no `steps/` folder), and a step there is used by that folder's features only. A step that more than one feature
folder uses lives in `support/steps/`, whose files open with the list of folders that consume
them; a helper that registers nothing lives in `support/`. Reuse existing shared steps
before adding a generic step, and register a step text once: playwright-bdd matches by text, so a second copy is an ambiguity error.
Module state (a `let` read by several steps) stays in the module of every step that reads
it; state read across modules sits in a `support/` module (`listing.ts`). Both
`defineBddConfig()` calls discover `./steps/**/*.ts` and `./support/steps/**/*.ts`.

**`workers: 4`, each with its own Drupal session.** Sharing a cookie across workers lets
one worker drain another's server-side status messages. `support/worker-auth-provider.ts`
keys sessions by `(workerIndex, uid)` under the run output directory, which Playwright clears
at the start of each run. Seeded accounts keep their existing workspace/team memberships.
Fresh login clears the previous account's cookies, retries one-time-link races up to three
attempts, and regenerates stale cached sessions after logout.

`fullyParallel: false` still keeps a FEATURE FILE as the unit of parallelism rather than a
scenario: playwright-bdd generates one spec file per feature, and this setting keeps a
file's scenarios in order on one worker — the ordering several scenarios rely on
(Backgrounds, `@feature:*` After hooks, addresses reused across scenarios of one file).

Four other resources used to be global and are not any more: `clearMailboxFor`/
`clearLoginFloodFor` (`support/login-flow.ts`) scope Mailpit clears and flood-table clears to
one address instead of the whole mailbox/table; `recipes/bb_e2e/recipe.yml` lifts
`user.flood.ip_limit` for the whole e2e world (one container IP is a budget four parallel
workers share) and makes `r4032login.settings.match_noredirect_pages` a permanent property
of that world; and `bb_browser_test`'s `CookieThemeNegotiator` replaces a site-wide
`system.theme:default` write with a per-request cookie, so one worker's browser context can
assert the neutral theme while others keep the product theme. The remaining scenarios that
write to a seeded fixture carry a one-line justification at the write site: either the
write is scoped to that scenario's own step arguments and no other feature reads that
fixture, or several callers write the identical fixed value, which settles on the same state
regardless of write order.

**Two Playwright projects, split by the `@nojs` tag.** `javaScriptEnabled` is a browser
*context* option: it is fixed when the context is created, so "this works with JavaScript
off" cannot be turned on by a step and can only be expressed as a second project.
`playwright.bdd.config.ts` therefore calls `defineBddConfig()` twice over the same features
and steps, with complementary tag expressions (`not @nojs` / `@nojs`) and separate
`outputDir`s — so every scenario is generated exactly once, into exactly one of them. Adding
`@nojs` to a scenario is the whole of moving it to the JS-less browser.

## Runtime prerequisites

Installation, unit checks and discovery require only Node/npm. Browser execution also needs:

- DDEV running for this worktree (`ddev describe`). `baseURL` is **not**
  hardcoded and **nothing needs to pass one** — not you, not `validate.command`,
  not CI. `playwright.bdd.config.ts` resolves it through `resolve-base-url.ts`,
  in this order:

  1. `node scripts/setup-worktree.mjs` writes this worktree's public identity and
     derived URL into gitignored `.env.ddev` without starting DDEV.
  2. The file URL (or its name-derived URL) wins over ambient `DDEV_PRIMARY_URL`.
     An explicit `PLAYWRIGHT_BASE_URL` is still the highest-priority override.
  3. Without a file, the resolver uses the container's `DDEV_PRIMARY_URL`.

  `PLAYWRIGHT_BASE_URL` in the environment still overrides both, for pointing
  the suite at a site that is not this worktree. It is an override, not the
  configuration — passing it routinely hides whether the worktree path works.
  If nothing resolves, the config fails fast and names all three sources.
- Seed data: the team feature reads the bb_e2e content — run
  `ddev init --provider recipe-test` first (single site, bb_e2e). It expects the
  seeded teams **"Platform Crew"** and **"Design Crew"**; the capital C matters.
- Drush access for `WorkerAuthProvider` and fixture setup: `support/drush.ts` uses native
  `drush` inside DDEV (`DDEV_DOCROOT`) or when it is on `PATH` (including the CI Docker shim).
  Otherwise it uses `ddev drush` when available. `DRUSH_CWD` overrides the command directory;
  the default is the current working directory. Command failures propagate to the test.
- A built bakers-cli (`cd bakers-cli && pnpm install && pnpm -r run build`) for
  `features/sign-in/cli-refresh.feature`. Its CLI clients are forked
  `bakers-cli/core/tests/fixtures/shared-session-worker.mjs` processes, which import the built
  core and sign in through the device grant on the seeded `bakers-cli-device-e2e` consumer.
  They run with `NODE_OPTIONS=--use-system-ca`, because DDEV's certificate comes from a CA the
  system store trusts and Node's bundled store does not.

## Install & run

```bash
cd tests/playwright
npm ci --registry=https://registry.npmjs.org
# Discovery works without Drupal, Drush, credentials, or generated entity definitions:
PLAYWRIGHT_BASE_URL=http://127.0.0.1:9 npm test -- --list
npm run typecheck
npm run test:unit               # pure helper checks, no browser or Drupal
npx playwright install chromium
npm test -- --list cli-refresh   # generate specs and verify a non-empty selection
npm test -- cli-refresh          # run the same affected selection
# The CI merge gate runs the full suite.
```

Before planning, writing, changing or reviewing tests, load `keytec-qa:keytec-testing`.
Select the union of affected scenarios, including unchanged consumers of shared steps/helpers.
For example, after generation the CLI-refresh path is
`.features-gen/js/features/sign-in/cli-refresh.feature.spec.js`; pass that path to both
`npm test -- --list <path>` and `npm test -- <path>`. Require a non-empty list and compare it
with the executed report. Do not use `--pass-with-no-tests`.

Changes to `support/worker-auth-provider.ts` affect the shared `bdd.fixtures.ts`, so select
all its consumers: list the full suite, including the complementary no-JS project, and use
the CI merge gate for full execution. Local execution is for debugging an affected selection.
Keep role, permission and negative assertions; reuse existing scenarios, steps and fixtures.
Run each selected command once per revision/environment; the full suite already includes
`@functional`, so a second functional run duplicates coverage. Temporary visual probes stay
outside permanent coverage.

Fixtures own cleanup after success and failure. Await owned CLI client closure before deleting
session state; browser/context cleanup remains Playwright-owned. Cancellation checks must
observe descendants, not merely the runner's exit, and must never signal unrelated processes.

`npm test` regenerates `.features-gen/` and writes `junit-playwright.xml`,
`playwright-report/` and `bdd-results.json`. All of those are run output and are
gitignored — do not commit them.

Two consecutive runs on the same world produce the same result (measured 2026-09-01,
29 passed / 2 failed twice — the two failures are AC 7's `<details>` scenarios, see
*Ticket-detail feature* below). That is a property the mutating scenarios pay for
explicitly: adding a member changes the world, and so does creating the foreign-workspace
fixture, so each one states its precondition (`Given the team "…" has no member "…"`,
`Given the other workspace has a project, a ticket and a member`) rather than inheriting
whatever the previous run left behind. A scenario that asserts absolute row counts without
such a precondition is single-use, and its second run looks like a regression while the
mechanism is fine.

## CI

The suite runs in the `e2e` job of the merge gate (`.gitlab-ci.yml`), against a compose stack of
the gate's own `php`, `nginx` and `mcp` images with MariaDB and Mailpit — the images that ship,
not a DDEV site. There is **no `ddev bakers-test-e2e` wrapper**; the job invokes `npm test`
directly.

It runs in the **e2e runner image** (`docker/e2e/Dockerfile`): the official Playwright image
matching `@playwright/test`, with this suite and a built bakers-cli inside. It reaches the site
as `http://nginx` and Mailpit as `http://mailpit:8025` on the stack network
(`PLAYWRIGHT_BASE_URL`, `MAILPIT_BASE_URL`); its `drush` (`docker/e2e/drush`) runs drush in the
stack's php container, which is where the Drush helpers' snippets execute.

**Two shards**, `--shard=<i>/2` with six workers each, every shard on its own stack. Playwright
splits by spec file, and a feature file is one spec file (see `fullyParallel` in the config), so
a feature never spans two shards.

**Ordering is a correctness constraint, not a preference.** The world is created first
(`scripts/e2e/seed-test-world.sh` after the recipe install), and shard 1 runs the conductor
integration suite (`scripts/e2e/run-integration.sh`) only after the browser suite, because it
mutates the bb_e2e seed so the conductor can claim a ticket.
`ddev bakers-test-functional` is now an alias for the `@functional` BDD subset. CI runs
the full suite, including these contracts, with `--retries=1`: only failed tests retry once.
Local runs default to zero retries. Tests passing on retry appear as flaky in the HTML report;
failed-attempt traces are retained, and a second failure still fails CI.

Results surface in the MR two ways:

- **JUnit** (`e2e-reports/junit-playwright.xml`, one per shard) → the MR "Tests" widget. It is
  its own file on purpose: a report shared between two suites has already been overwritten once
  in this repository, which is how a suite's evidence disappears with nothing going red.
- **`playwright-report/`, `test-results/` and the stack's container log** → `e2e-reports/`,
  exposed as the job's *e2e reports* artifact. A browser failure is close to undiagnosable from
  a JUnit line alone, so the artifact is the only durable copy a reviewer can open.

## Writing scenarios: a navigating scenario clicks TWICE

Binding for this suite, and it is a measured lesson rather than a style rule. The island
mechanism's first delivery applied the boost declaration at the *caller*, so every swapped
fragment came back bare and a boosted navigation worked exactly once per page load — measured
then as `rail attrs AFTER the click: []`. A one-click scenario passes against that defect.
The second click is the assertion.

The same reasoning applies one layer in: a *form* submit inside an island hands back a
fragment too, so the members scenario clicks a tab **after** the add, on a code path no
navigation click exercises.

Scenarios tagged `@negative-control` exist to keep the detectors honest — two in the team
feature, three in the ticket-detail one. Everything this suite claims about full page loads
rests on a mark set on `window` and a property set on the rail DOM node, and a detector that
cannot report failure proves nothing — so one scenario forces a real reload and one forces a
real rail replacement, and each asserts the *failing* side. Do not delete them to make a file
shorter.

What this suite deliberately does **not** assert: that the server answered with a fragment.
It does not. `island-content` runs in *configuration mode* — the server returns the ordinary
whole page (measured at ~64 KB, carrying `<html>`, `<head>` and both islands) and the client
narrows it with `hx-select`. That is a declared deviation, so the checkable claims are the
request count and the surviving document, never the shape of the response body.

## Dependency ownership and inventory

Bakers removed `@key-tec/playwright-core` after inspecting the exact pinned `0.0.0-dev.72`
artifact. Its consumed surface was small; keeping its general widget, definition, mail,
OAuth and visual-comparison framework added no needed behavior. No library project or
other consumer is migrated or retired by this change.

| Previously consumed export or surface | Consumers and replacement |
|---|---|
| `Given`, `When`, `Then` | 41/60/63 step-file imports respectively; now bound to the project test in `bdd.fixtures.ts` |
| BDD `test` | `bdd.fixtures.ts` and tagged hooks in `board-summary`, `avatar-crop`, `profile-administration`; one fixture hierarchy based on `playwright-bdd` |
| `Drush.exec` | 30 importing files across steps and support (one unused form import removed); narrow synchronous operation in `support/drush.ts` |
| `DrushAuthProvider` | `WorkerAuthProvider` already owned login/logout; inheritance removed, worker/account caching retained |
| `CoreTestOptions` | `playwright.bdd.config.ts`; unused mail options removed with the type |
| Catalog side effects | `support/steps/core.ts`; only administrator/admin/anonymous login and accessible button click are consumed |
| `entityForm`, `backendTheme` | `functional-forms.steps.ts` (Title) and `ambient-forms.steps.ts` (Name); direct Playwright fill/submit, original readback assertions and cleanup |
| `generate definitions` / `pretest` | Removed with form metadata usage; discovery needs no running site or `.playdrop` data |

The six former library dependencies were `@faker-js/faker`, `commander`, `js-yaml`,
`looks-same`, `undici` and `yaml`. npm prunes only entries no longer used by the remaining
public dependency graph; shared transitive dependencies remain. No private registry
configuration or credentials are needed. The original 106 feature files and their JS/no-JS
partition are preserved; pinned-baseline discovery expands to 837 Chromium and 27 no-JS tests.

## Login feature — messages region

The failed-login scenario asserts the **visible error** ("Unrecognized username or
password."). This required a product fix: the `bb_login` `page_layout` now wires the core
`system_messages_block` into the `auth_card` `messages` slot (it previously filled only
`form`/`footer`, so login errors were set server-side but never rendered). Messages render
through the `bb_theme:message` SDC (styled note-bar; error region carries `role="alert"`),
so `Then I see an error {string}` matches `.messages--error, [role="alert"]`.

> The sibling `bb_register` / `bb_password` page_layouts have the same empty
> `messages` slot — their validation errors are still swallowed (out of scope here;
> follow-up).

## Team feature — the island reference surface

`features/team/team-islands.feature` is the whole browser gate for BB-396. The team
screen's four IA tabs — **Load** (the canonical address), **Delivery**, **Runs**,
**Members** — are four *routes*, not four coexisting hulls: exactly one tab body is ever in
the document, and one content island swaps it. The scenarios cover

- each of the four addresses rendering its own tab on a direct visit (a `Scenario Outline`
  over Delivery/Runs/Members, plus the canonical Load scenario);
- a tab change keeping the document and costing exactly one navigation request;
- the rail surviving a tab swap, asserted by DOM node **identity** rather than presence — a
  re-rendered rail is "present" too, so presence cannot tell the two apart;
- the rail refreshing its own current entry on a rail click, while a *tab* click leaves it
  alone (two halves with different answers, so both are asserted);
- the interleaved case, alternating rail and tab clicks, which is the strongest thing this
  surface can be asked;
- the Members form: a successful add re-renders only that island, and a duplicate add grows
  no second row.

One known defect is recorded rather than dressed up: the duplicate add is refused
**silently** — no `aria-invalid`, no error class, no status message (measured 2026-08-30).
The scenario therefore locks in the property that matters for the data (the list cannot grow
a duplicate) and deliberately claims nothing about feedback, because asserting feedback would
be asserting something that does not happen.

## Ticket-detail feature — the screen a developer works in

`features/tickets/ticket-detail.feature` holds BB-414 D9. The screen is **one**
`bb_theme:canvas` returned by a controller, rendered inside the shell's existing
`island-content`; the `full` view mode emits only the body. The scenarios cover the shell on
the route, the canvas count and its four regions, the band's DOM order, the tab row's
absence, the handoff `<details>`, a two-click island round trip, and tenancy.

Three things in it are worth knowing before editing it.

**The band assertion is GEOMETRIC, not structural.** AC 4 says the link groups sit *below*
the summary, and the first iteration of `summary-band` put them in a second column beside it
— which the human rejected twice. DOM order cannot tell the two apart: a two-column band
also emits the summary before the links. So the scenario asserts DOM order **and** that the
links' top edge is at or below the summary's bottom edge. Measured 2026-09-01: links start
at `y=427.6`, the summary ends at `y=413.6`. Inverting the comparison fails the step with
both numbers in the message, which is how that detector was proved able to report the
rejected layout.

**Three negative controls, and they are load-bearing.** "No tab row", "no canvas" and "the
handoff stream is closed" are all NEGATIVES, and a selector with a typo in it is empty
everywhere. Each detector is therefore driven to its positive side against a surface that
really has the thing — the team screen has a tab row and no canvas; a reload really is a
reload. Do not delete them to make the file shorter.

**Tenancy: two different refusals, both pinned.** Measured on 2026-09-01 against a
`ddev init --provider recipe-test` world:

| account | path | status | what it is |
|---|---|---|---|
| member of `other` only | `/other/ticket/OTHER-1` | **200** | their own workspace |
| member of `other` only | `/bakers/ticket/BB-142` | **403** | an ACCESS check — they may not see that row under any address |
| member of both (admin) | `/other/ticket/BB-142` | **404** | PATH-SCOPED RESOLUTION — the row is visible, but not under that slug |

The 404 is deliberate and documented in `BbWorkspaceAccessCheck`: *"a 403 tells the
requester that the row exists somewhere they cannot see, which is exactly the fact a
workspace boundary withholds."* The two are different questions and neither substitutes for
the other, so the feature asserts both.

`recipes/bb_e2e/content/bb_workspace/` ships the second workspace (`other`) deliberately
**empty** — no group, no project, no ticket, no member — because its shipped job is to be the
wrong slug in `/other/ticket/BB-142`. That covers the 404 row of the table and nothing
else. The 403 row needs an account that is a member of one workspace and not the other, and
a ticket of its own to prove the refusal is not simply "this account sees nothing" — so
`Given the other workspace has a project, a ticket and a member` supplies exactly that,
create-if-absent, through drush. It adds a `bb_group`, a `bb_project` keyed `OTHER`, the
ticket `OTHER-1` and the account `south-contributor`; everything it depends on is the shipped
workspace, so it reproduces from a fresh provision and is idempotent across runs.

**Known RED: the handoff `<details>`.** Two scenarios — the AC 7 pair, one of them the
`@nojs` one — fail today, and the cause is not in this suite. The ticket body is a
display_builder-backed `core.entity_view_display`, and `display_builder_entity_view` is the
module that swaps `entity_view_display`'s entity class for the one that reads
`third_party_settings.display_builder`. It is listed in `config/sync/core.extension.yml` but
**not installed by `recipes/bakers/recipe.yml`**, so on the recipe-test world the
`third_party_settings` are inert and `canvas__main` renders the display's plain `content:`
fields instead of the zones and the collapsible. There is no `<details>` on the page to
assert against. The scenarios stay as written: they are the RED half of AC 7 and they go
green when the module reaches the recipe path.

## Authentication after provisioning

Session files live under the current run's output directory and are cleared by Playwright
on the next run. There is no persistent `.auth/` cache to delete after `ddev init`.
Use the isolated `recipe-test` provider for runtime checks and preserve every required
persona, including denied and anonymous users.

## Apps and Island Profiles

`features/island-profiles/` covers the configuration form and runtime profile boundaries.
The administration scenarios create disabled profiles through the UI, preserve
the generated placement IDs across rebuilds and save/reopen cycles, and remove
their own saved profiles in an `After` hook. They do not mutate shipped profile
configuration or create fixtures through Drush.

The profile form is a config-entity Form API form. Its steps use the actual dynamic
placement controls and the shared project BDD and authentication fixtures.

`bb_browser_test`, installed only by `recipes/bb_e2e`, supplies a persisted
app/profile and an administrator-only repeated-profile page. Its counter plugin
makes event delivery visible; rendering, action URLs, CSRF checks, host resolution,
event subscriptions and fragment responses all use the real Island APIs.

The standard Menu fixture places the same menu at depths one and two around an
ordinary controller result. Each menu navigates twice; every click must replace
exactly its source menu and PageContent, retain the other menu, and cost one XHR.
The mapped fixture supplies typed entity and bundle contexts to the existing
Note component. Its prop and slot mappings survive event refresh independently
in both profile instances, with exact response targets and retained DOM nodes.

Mapping administration selects the app's user-name field through the real
UI Patterns source chooser and saves its body text and event subscription twice.
Its repeated "Source" labels require recorded Form API name suffixes for exact
prop/slot scoping. Steps wait for Drupal's Ajax binding and completed command
queue before continuing; a visible replacement control may precede its binding.

Shell navigation selectors follow the direct content/sidebar placements in the
rendered shell. They do not hardcode the encoded runtime host: the tuple encoding
may change while placement identity and node survival remain the same contract.

## Functional contracts

Run the migrated contracts after normal installation and recipe provisioning:

```bash
npm test -- --grep @functional
```

`npm test` generates Playwright specs directly from Gherkin. Form steps interact with the
actual browser controls; they do not generate or load Drupal widget definitions.

The JSON:API contracts live with their feature: tenancy and ranks in `features/workspace/`,
claims, assignment and machine registration in `features/conductors/`, schema discovery,
workflow and session writeback, comments and label relationships in `features/tickets/`,
run pagination in `features/runs/`, statistics in `features/statistics/`, deployment targets
in `features/deployments/`. `features/sign-in/auth-contract.feature`,
`features/tickets/functional-forms.feature` and `features/workspace/ambient-forms.feature`
cover the corresponding browser behavior.

The recipe owns the two bakeries (Northside Bakery, the home workspace, and Southside
Bakery, the other one), explicit rank memberships, the public test accounts listed in
`docs/bakers/testing.md` › *Test users*, and pagination rows. `support/contract-world.json` maps their stable
UUIDs to readable aliases in feature documents. API actions create temporary resources;
the scenario fixture deletes them in reverse order. Owner and session tests restore
ordinary membership after conductor registration so automatic app rank cannot mask the
authority under test. Authentication policy overrides are similarly restored on teardown.
These scenarios require the isolated recipe-test world; each is confined to one feature
file, which `fullyParallel: false` keeps on one worker.
