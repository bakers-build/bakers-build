# Testing in the bakers.build repository

Repository-internal test rules: who the test users are, how environments are set up, how tests are
selected and where they run. `CLAUDE.md` points here; `WORKFLOW.md` names the commands.
This document owns the project's PHPUnit selection and database rules. The generic DDEV
adapter reads these project instructions; persona access follows [DDEV logins](ddev-logins.md).
The [development skill ledger](development-skills.md) records dependencies, public source
revisions and the repository-owned project skills.

## Where tests run

PHPUnit and browser E2E are **not** per-revision checks. They run **once, in the CI merge gate**,
immediately before the merge request is merged, against the images that deploy (`WORKFLOW.md` ›
*deliver*). Local runs are for debugging a failure or selecting affected tests, never a substitute
for the gate:

| When | Command |
|---|---|
| PHP implementation | `ddev exec ./vendor/bin/phpunit --configuration=phpunit.xml <path/to/AffectedTest.php> …` |
| Web UI implementation or Playwright behavior changes | `cd tests/playwright && npm test -- --list <affected-generated-feature-path> … && npm test -- <affected-generated-feature-path> …` |

## Setup

| When | Setup |
|---|---|
| Core tests | Use Node >=22.22.0 and install the offline skill-evaluation dependency once with `npm ci --prefix tests/skill-eval`, as the CI conductor job does. |
| Playwright checks | Install dependencies once with `cd tests/playwright && npm ci`; `ddev init` does it in the web container. Installation uses the public npm registry without credentials. Unit/type checks need no browser or Drupal; discovery also works without a site using `PLAYWRIGHT_BASE_URL=http://127.0.0.1:9 npm test -- --list`. Browser checks and `playwright-cli` run in the DDEV web container, whose image carries Chromium (`.ddev/web-build/Dockerfile.playwright`) and drush; an agent calls them through `ddev_exec` (`cd tests/playwright && npm test -- <path>`, or `playwright-cli open <url>` from the worktree root, which reads `.playwright/cli.config.json`). That execution is the container's, outside the agent sandbox, with the boundary described in [tools](/addons/build/tools): `.ddev/config.yaml` omits the SSH agent and blanks the `KEYTEC_*` registry tokens, but any other `web_environment` entry of the machine's global DDEV config still reaches the container, and `ddev_exec` runs any command. Measured under Claude Code's sandbox, headless Chromium starts inside it, but its proxy refuses loopback targets such as the `.ddev.site` URL and its filesystem rules deny the Docker socket that drush needs. Verified matrix: Claude Code 2.1.319 with its sandbox (bubblewrap, filtering proxy) in a conductor run, Linux 6.12 (Debian 13), DDEV v1.25.5. Codex is not verified on this path. Keep a run under about five minutes per call, or start it in the background and read its report from the worktree. |
| Drupal checks | Start with a verified `recipe-test` environment; otherwise `ddev init --provider recipe-test`. Then validate in order: (1) **recipe first** — run the project and ticket checks on `recipe-test` (explicit initialization always reinstalls), never importing `config/sync` there; (2) **config/sync last** — on a disposable site run `ddev init --provider existing-config`, `ddev drush updb -y`, `ddev drush cim -y`, `ddev drush cr`, `ddev drush status` and verify the affected behavior, without applying recipes to make it pass; (3) record provider, command, result and revision for both at the **same revision**; a fix after step 2 returns to step 1. Always name the provider: plain `ddev init` means `existing-config`. |
| Conductor or skill behavior | Isolated workspace: `scripts/setup-test-project.sh`; read its help and the fixture's committed workflow. Setup generates local configs. Commit the candidate workflow to the fixture branch and verify the dispatched worktree revision and that its run log shows `bb-workflow` and the recipe loaded. Register with `bakers oven once`; use the normal workspace connection to create and assign a local ticket (type `chore`, recipe `matt`) in `working`. Start Conductor with the default worker connection and observe the worker. Release the test setup with `scripts/teardown-test-project.sh`. |
| Docs preview | Start it with `provision_up('docs-preview')`: outside the sandbox the conductor installs the `docs` dependencies, builds the site and serves the build detached on a free `127.0.0.1` port, and the result names the URL. It needs a Linux host (`/proc`, `setsid`), as the ports addon does. Share it with `ports_up docs` for the reviewer link. A repeated call replaces the preview with a new build, one per worktree; `after_done` stops it when the ticket is done. A run never starts `vitepress preview` itself: inside the sandbox nobody else can reach it and `ports_up` cannot find it. |
| Skill availability | Agent environment's own installation and discovery facilities. |

## Local DDEV preparation

Standard DDEV, Node, Composer and the existing Node package tools are sufficient; no DDEV addon
or keytec-ai configuration tool is required. From the selected checkout root:

```sh
node scripts/setup-worktree.mjs       # public env/identity only; leaves DDEV stopped
bash .ddev/worktree-post.sh           # also prepares the CLI/test workspace, when needed
ddev init --provider recipe-test     # explicit database replacement, builds and seeds
```

The conductor calls `worktree-post.sh`, which prepares env before checking its bootstrap sentinel.
The script copies missing parent client/audience settings, sets the worktree-local base URL, and
runs `setup-test-project.sh --workspace-only`. Only that setup script owns the conditional CLI
build. Hooks remain conductor best-effort; a failed hook is not proof of a usable environment.

`ddev init` defaults to `existing-config`; `recipe` installs the Bakers recipe and playground seed,
while `recipe-test` installs that recipe and the test seed. It starts DDEV, installs Composer
packages, builds the theme and installs locally through Drush or the recipe installer. It never
pulls, downloads or imports a database. Every explicit init reinstalls the
selected local database. Legacy `--fresh` is accepted with the same behavior. Bootstrap and
workspace reuse never invoke init. An installed site missing the requested project fails with
recovery guidance instead of being automatically reinstalled.

Only `DDEV_WORKTREE_NAME` and its derived `PLAYWRIGHT_BASE_URL` are written to gitignored
`.env.ddev`; `.ddev/config.worktree.yaml` carries the same name. Existing overlay/env names must
agree. A primary checkout keeps its configured name; new linked worktrees use a bounded readable
prefix and canonical-path hash. Playground clones retain their path-hashed overlay. Ambient host
or ticket variables are never exported. Playwright precedence is explicit process URL, file URL,
file name-derived URL, then ambient DDEV URL.

Setup preserves unrelated bytes, including quoted multiline env values, and rejects unsupported
selected values, conflicting identities and symlink outputs. Writes are atomic and private, with
the overlay written first so retry repairs a missing env file. A per-worktree directory lock
serializes setup. Retrying recovers a dead process's lock; a live or unrecognized lock fails
with an actionable message instead of permitting overlapping writes. Keep legacy `.ddev/.env`
and `.ddev/.env.web` private; they are no longer generated or read by project setup. Mixed local
settings are never deleted automatically.

The three retained QA commands (`phpcs`, `phpmd`, `phpstan`) use Composer's binaries and the
project rulesets. Other addon QA commands and generic snapshot, multisite and config-feed
machinery have been removed. The standalone playground uses its own `ddev init` for a minimal
Drupal installation; it is not a full recipe-test control plane.

## Test selection

Select tests by affected behavior: include created/changed tests **and every affected consumer of
changed shared helpers, fixtures or configuration**. Search callers before choosing the union. If
impact cannot be bounded, run the relevant full suite and state why. Preserve role/permission
assertions, independent scenarios and both JS/no-JS consumers when affected.

For PHPUnit, list and run the affected classes by explicit path, never `--filter` or `--group`:
these can report `No tests executed!` with exit 0. An empty discovery is a failed selection, not
PASS. Use discovery output for counts; the CI merge gate owns the full `unit-kernel` suite. A full local run, when
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
[suite README](../../tests/playwright/README.md#install--run) shows generated paths and shared-helper
selection. The merge gate's `e2e` job runs the full suite, `@functional` included; do not launch that subset again.
Ad-hoc browser walks follow `@bakers-build/bb-workflow` › `references/browser.md`; the existing suite remains a separate gate.
Changed skill behavior requires a real worker example selected in the ticket.

## Test users

The `recipe-test` world (recipe `bb_e2e`) is two bakeries: **Northside Bakery** (the default
workspace, slug `bakers`) and **Southside Bakery** (slug `other`). Every account but the service
account `fixture-automation` (which may carry no address) lives on the reserved `@example.test` domain. Accounts with a password use **`Bb-test-login-426!`** (Playwright
`httpCredentials`, JSON:API basic auth); the others are reached through the persona picker,
Playwright's `authProvider` or a magic link.

**Naming rule.** A persona is named `<bakery>-<rank>` or after the one property that makes it a
persona (`site-admin`, `both-bakeries`, `no-bakery`); personas are shared and read-only, so
parallel scenarios can use them together. An account a scenario modifies (its rank, its own
settings or mailbox, or what it creates), or one that needs a site role or a team rank no persona
carries, is a fixture account named `fixture-<purpose>`.

**Persona picker.** On a `recipe-test` site, `/user/login` shows a *Test personas* section with one
button per active, human `@example.test` account: one click signs in as that account and lands like
a normal sign-in. The module (`bb_login_persona_test`) is installed by `bb_e2e` only, so the
section is absent on every other site.

| Persona | Bakery | Rank and teams | Use for |
|---|---|---|---|
| `north-lead` | Northside | lead; Design Crew | Default human persona: tickets, projects, machines, conductors, templates |
| `north-contributor` | Northside | contributor; North Crew | Ordinary member reads and writes, project and team time |
| `north-member` | Northside | member; Platform Crew (no password) | Crew member, reviewer and worklog author |
| `north-guest` | Northside | guest (ticket view, no update, no conductor) | Guest and addon overlay access checks |
| `south-lead` | Southside | lead | Lead of the other bakery only |
| `south-contributor` | Southside | contributor; South Crew | Cross-workspace visibility checks |
| `south-member` | Southside | member (no password) | Member of the other bakery |
| `south-guest` | Southside | guest | Guest of the other bakery |
| `site-admin` | — | site role `login_administrator` | Admin walks, JSON:API basic auth in the Playwright API client |
| `both-bakeries` | both | member of each | Workspace chooser and switching |
| `no-bakery` | none | no membership | Empty landing, refused and 403 paths |

| Fixture account | Memberships or site role | Purpose |
|---|---|---|
| `fixture-agent` | Northside lead, Platform Crew, Southside member | Conductor agent of `bakers-e2e-project` and the Conductor test setup |
| `fixture-automation` | Northside contributor service account, Automation Crew (no password) | Execution identity of the seeded monthly trigger on *Monthly Drupal update* |
| `fixture-app` | Northside lead, North Crew | Registers conductors, which grants it the app rank |
| `fixture-lead` | Northside lead, North Crew | JSON:API lead matrix; lead of the disposable detail-card worlds |
| `fixture-conductor-owner` | Northside contributor, only in Conductor Owner Crew (not in API home's team) | Owns the edit and conductor-properties conductors and their machine |
| `fixture-claim-owner` | Northside contributor in API home's team | Owns the assignable JSON:API contract conductors and claims with them |
| `fixture-foreign-lead` | Northside member, North Crew, Southside lead | A lead rank in another workspace grants nothing here |
| `fixture-api-machine` | site role `api_machine` | JSON:API machine registration matrix |
| `fixture-api-machine-app` | site role `api_machine`, Northside lead | JSON:API machine registration matrix |
| `fixture-api-machine-view` | site role `api_machine_view` | JSON:API machine registration matrix |
| `fixture-api-pagination` | site role `api_machine`, Northside member | Run pagination of its own conductor |
| `fixture-api-pagination-other` | site role `api_machine`, Southside member | Owns the foreign runs the pagination counts must exclude |
| `fixture-api-manager` | site role `api_manager` | Entity administration form contracts (`recipe account "manager"`) |
| `fixture-api-roster` | site role `api_roster`, Northside member | Crew roster query filtering |
| `fixture-api-session` | site role `api_session`, Northside contributor, North Crew | Session writeback and comments over JSON:API |
| `fixture-api-stats-outsider` | site role `api_statistics_outsider` | Statistics access matrix |
| `fixture-crew-mate` | North Crew and South Crew, no workspace | Personal and team time across workspaces; scenarios grant it the team lead rank |
| `fixture-profile` | no workspace | Saves its own position and background on the Profile tab |
| `fixture-team-lead` | Northside contributor, North Crew lead | Team-lead edit rights and team time |
| `fixture-workspace-only` | Northside member, no team | Workspace membership without project authority |
| `fixture-time-contributor` | Northside contributor, owner of Personal time crew | Personal time, work schedule and activity input; owns a crew, so it may read its own statistics |
| `fixture-settings` | Northside lead, Southside lead | Writes its own notification settings and work schedule |
| `fixture-north-creator` | Northside lead (no password) | Creates groups and teams in Northside |
| `fixture-south-creator` | Southside lead, Northside member (no password) | Creates groups and workspaces; a foreign lead rank grants no creation |
| `fixture-revocable` | Northside lead (no password) | Lead rank revoked mid-scenario |
| `fixture-mailbox` | no membership | Sign-up mail count for a known address |

Source of truth: `recipes/bb_e2e/content/user/*.yml` and `recipes/bb_e2e/config/user.role.*.yml`;
`tests/contract/test-users.sh` fails when this section and the seeded accounts drift apart.
