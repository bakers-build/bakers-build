# Clean-install acceptance

This runbook verifies bakers.build as a standalone application. It does not certify installation
inside an arbitrary Drupal site. A local checkout, a green contract test or an upstream ticket
marked done is not evidence of a public installation.

## Prerequisites and candidate

Use a maintainer-provided disposable Linux host and a unique experiment prefix. Record its owner,
OS, architecture, Git, Bash, jq, GNU coreutils, Docker/Compose, DDEV, Node, npm/pnpm, PHP and Composer
versions. Repository core tests require Node >=22.22.0; the CLI runtime minimum is Node 20.19.
Use a fresh user/home and empty caches, without Keytec registry credentials, mirrors or private
skills. Ordinary model-provider accounts, connector accounts, DNS, certificates and a test SMTP
provider are separate legitimate prerequisites. Never copy the operator's current authentication.

Before execution, obtain the first **cleared public `next` candidate**. Pin the public source URL
and commit, docs commit, exact npm versions and `dist.integrity`, image references with SHA-256
digests, and skill source commits. Record the harness commit separately. The tag `next` alone is
insufficient. Verify that source/history licensing and secret-review clearance covers these
artifacts. A private repository or unavailable image is BLOCKED, not a reason to use private caches.

Use the integrated [server reference](../configuration/project/server.md) only when the candidate
contains its supported standalone provisioning path. The currently integrated legacy Komodo stack
is not proof of an independent public service; do not replace missing upstream work with a new
deployment platform. Record source/artifact availability and clearance references in F1.

## Available public candidate

The public repository is `https://github.com/bakers-build/bakers-build`; pull requests target
`next`. The first published candidate selected for this acceptance is source/docs commit
`e592274d00d112c9d4e13185ed37fb4a8458ab5c`, npm `0.5.1-next.842`, plugin `0.50.4`.
Pin the full package integrity set and these runtime digests in the results:

- `ghcr.io/bakers-build/bakers-build/php@sha256:fbb0c3de5873949ab0ab3ee52e907637a5294eea15f16ec8583a19b7c1ed73fa`
- `ghcr.io/bakers-build/bakers-build/nginx@sha256:8dd1096ca2c5b1174ab3423f4f95a213e218528b1e03e2f0e484050d41c8955b`
- `ghcr.io/bakers-build/bakers-build/docs@sha256:6eefaedaecb8e7f61dea1a7e9d777c6808a33eeafc8f40df270cca903927a805`

Publication is available; it does not resolve the asset-provenance limitations recorded in
[licensing](licensing.md). The standalone `docker/self-host.yml` path is not yet integrated into
this candidate. Complete that upstream dependency before executing the corresponding install
path; do not silently test an unpublished sibling branch instead.

## Evidence checker

The checker only validates **recorded evidence**. It cannot verify that an operator's observations
are true, authenticate a report author, fetch artifacts, install software, run recorded commands,
provision a service or remove resources. Human review remains necessary.

Copy [the result template](clean-install-results.example.json) to a private evidence directory.
Fill each observation, keeping secrets and login URLs out. An unavailable candidate is `null`;
candidate-dependent checks must then be blocked/not_run. Local P1–P4 checks may use
`candidate_id: harness:<harness_sha>` to retain local evidence independently. The untouched template needs the harness SHA
filled in before validation. After pinning a candidate, calculate its identity with:

```sh
jq -Sc '.candidate' results.json | sha256sum
```

Put that digest (without the filename marker) into each executed row's `candidate_id`. For candidate checks, a changed
candidate requires new observations; never merely relabel an old row. A non-null candidate has:

```json
{
  "source_url": "https://example.test/source.git",
  "source_sha": "<40 lowercase hex characters>",
  "docs_sha": "<40 lowercase hex characters>",
  "packages": [{"name": "@bakers-build/bakers", "version": "0.1.0-next.1", "integrity": "sha512-<npm integrity>"}],
  "images": ["registry.example.test/php@sha256:<64 lowercase hex characters>", "registry.example.test/nginx@sha256:<64 lowercase hex characters>"],
  "skills": [{"source": "https://example.test/skills.git", "revision": "<40 lowercase hex characters>"}]
}
```

Inventory every installed package/artifact needed by the paths, including addons and prerequisite
image digests; these sample URLs are deliberately not installation destinations.

```sh
bash scripts/clean-install-acceptance.sh results.json new-report.json
```

Requires Bash, jq and GNU coreutils. The output parent must already exist and contain no symlinks;
the output itself must be new. Exit 0 means recorded PASS, 1 means a valid FAIL/BLOCKED report,
2 means invalid input or unsafe output. Existing output is preserved on any outcome. Invalid
input creates no report. The report includes the full manifest and computed candidate identity.

The mandatory set is P1–P5 and F1–F11. A failed row/prerequisite/cleanup produces FAIL even if other
rows are blocked. Otherwise missing observations, blocked prerequisites, or incomplete cleanup
produce BLOCKED. Required rows cannot use `reused`. Supplemental client history belongs in
`clients`, with `status: reused`, `original_status`, `revision`, `client`, `scope`, `evidence` and
`reference`; it cannot replace F5 or change this candidate's verdict. Record additional conditional
WORKFLOW gates in P2's evidence and mark P2 failed/blocked if any applicable gate is unresolved.

## Ordered checks

Each row records its ACs, actor/environment, command or ordered actions, expected/observed result,
UTC timestamp, sanitized evidence location, defect/upstream reference and cleanup outcome. Keep
source SHA, exact commands and results in durable release/ticket evidence; transient captures alone
are not durable. Do not dump environment files, credentials, SMTP DSNs, tokens or login links.

| ID | AC | Action and required observation |
|---|---|---|
| P1 | 1,6,7 | Run `bash tests/contract/clean-install-acceptance.sh` during development. Complete fixture succeeds; incomplete/inconsistent evidence, false PASS and unsafe output fail. The core suite also runs it; do not repeat at the same revision/environment. |
| P2 | 1,7 | Install documented project dependencies, then `cd bakers-cli && pnpm --filter @bakers-build/core test && pnpm lint`. Apply every other matching WORKFLOW gate, recording commands/results. |
| P3 | 7 | From root: `bash tests/contract/token-discipline.sh && bash tests/contract/run-detail-overlay.sh && bash tests/contract/island-links.sh && node tests/contract/appearance.mjs && node tests/contract/icon-storybook.mjs && node tests/contract/period-range.mjs`. All must pass. |
| P4 | 1,5,7 | `cd website && pnpm build && node --test scripts/manual.test.mjs scripts/marketplace.test.mjs`. Also inspect README/CONTRIBUTING/SECURITY links, which are outside the rendered manual. |
| P5 | 1,7 | From the independently obtained public checkout: `cd bakers-cli && pnpm install && pnpm -r run build`, then the candidate's documented theme/Composer builds. Record lockfiles and versions. |
| F1 | 1,6 | Inventory the fresh host, public obtain commands, immutable artifacts and clearance. Verify no inherited internal authentication/cache. |
| F2 | 1,3 | Provision the candidate's standalone Compose service with owned persistence, TLS and SMTP; record service identity, readiness and ordinary first-account bootstrap. Use no recipe-test login shortcuts. |
| F3 | 1,7 | Separately provision the public contributor checkout: `ddev init --provider recipe-test`, then relevant checks. Afterwards use a **different owned site at the same SHA**: `ddev init --provider existing-config`, `ddev drush updb -y`, `ddev drush cim -y`, `ddev drush cr`, `ddev drush status`. Never repair existing-config by applying a recipe. |
| F4 | 2 | From the public landing page follow [connector setup](../get-started/connector.md), authenticate an ordinary isolated account, inspect scope and perform an authorized harmless read. No machine setup required. |
| F5 | 3 | Follow [machine setup](../get-started/machine.md) and [project setup](../get-started/connect-a-project.md). Install public CLI/skills, create an isolated first ticket and observe normal conductor dispatch, a small file/assertion task, persisted report and terminal state. Record executable/version, client/model, effective sandbox, workflow/recipe, run/session ID and dispatched SHA. Verify one allowed and one denied write; never substitute system/yolo. |
| F6 | 4 | An invited ordinary member follows [join a project](../get-started/first-ticket.md), verifies identity and creates/observes a permitted ticket using the existing team conductor without repeating machine/project bootstrap. |
| F7 | 4 | In separate guest/non-member sessions test project/ticket reads, prohibited updates/conductor actions and direct protected requests. Include an authorized positive control. Reuse existing workspace/rank-access, workspace-invite, entity-edit-access and project-create scenarios. |
| F8 | 5 | Read README, CONTRIBUTING and SECURITY anonymously; verify standalone positioning, honest support limits and a reachable **monitored private reporting route**, without submitting a report. Human reviews clarity and ownership. |
| F9 | 6 | Reconcile all rows and client evidence with the candidate; run the checker. No inherited four-client PASS or false aggregate PASS. |
| F10 | 7 | Export sanitized evidence; verify ownership and remove only the named experiment services, volumes, sites, records and credentials. Compare inventories and unrelated sentinel data before/after, including after failure. |
| F11 | 1,3,5,6 | Trace environment inputs below, vary domain/mail on the isolated service, recreate/restart through the candidate's documented method and verify web/cron delivery, generated URLs and conductor reconnection/persistence. Missing providers block the check. |

Browser paths start anonymously at the candidate's landing page and continue on the owned service.
Verify the persona before each authenticated walk. Capture setup entry, connected/project-ready
state, completed run and denials. Keep auth-state files private. The playground helper's checkout
shim is not public-install evidence and its local-only guards must not be repointed at a hosted site.

## Environment configuration inventory

Source inspection baseline: `36d95d0fda56e813be93aacfc475507de2a2e432`. Recheck on the actual candidate;
this table is not runtime acceptance. No environment variable provisions DNS, TLS certificates,
SMTP accounts or provider DNS records.

| Input | Path to consumer and current limit |
|---|---|
| `DOMAIN` | Root Compose substitutes it into `DRUSH_OPTIONS_URI=https://…` for install/deploy/PHP/cron. It does **not** explicitly forward `DOMAIN` to those processes. `settings.komodo.php` reads `DOMAIN` for trusted hosts, but the base settings already contain `.*`; appending a pattern does not restrict that wildcard. |
| Public URL and proxy/TLS | Drush consumes `DRUSH_OPTIONS_URI`; browser URL generation depends on the request/proxy. `settings.php` enables reverse proxy and trusts private IPv4 ranges in source, not an environment switch. Check HTTPS host/scheme in login, invitation and OAuth callbacks through the actual ingress. |
| `MAIL_SMTP_DSN` | Forwarded to PHP/cron; `settings.komodo.php` parses scheme, host, port, decoded credentials and query options into `system.mail.mailer_dsn`. Empty or malformed DSN leaves fallback configuration, rather than failing closed. Test invalid/missing inputs and encryption with an owned sink; never count fallback as successful SMTP. |
| `MAIL_FROM_ADDRESS` | PHP/cron environment overrides `system.site.mail` when nonempty; otherwise exported configuration remains. |
| `MAIL_FROM_NAME` | Forwarded to PHP/cron, but no consumer was found in current application source. Do not claim a working sender-name environment override. |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ROOT_PASSWORD` | Compose passes values to MariaDB and applicable app services. App `DB_HOST=db`, `DB_PORT=3306`, `DB_DRIVER=mysql` are literal Compose values; `settings.komodo.php` consumes DB settings when `DB_HOST` exists. Root password is for MariaDB only. |
| `DRUPAL_HASH_SALT` | Passed to install/deploy/PHP/cron; nonempty value overrides `$settings.hash_salt`. Preserve it across restarts and keep it private. |
| `BB_OAUTH_GOOGLE_CLIENT_ID`, `BB_OAUTH_GOOGLE_CLIENT_SECRET` | Optional, default empty; passed to install/PHP and consumed by settings when `DB_HOST` is set. Provider registration and a correct callback remain external requirements. Check other service contexts if OAuth-dependent jobs require them. |
| `CRON_INTERVAL` | Compose cron loop interval, default 300 seconds. Mail delivery from cron still needs its own observation. |
| Conductor endpoint/authentication | `bakers init --base-url https://<owned-host>` creates the selected private connection; `site.base_url` is the consumer. Sign in through `bakers auth login`, verify `bakers auth status` and `bakers config check --scope connection --online`. No universal server-URL environment override is assumed. |
| Connection selection | Explicit config/connection selectors feed `resolveBbConnectionSelection`; `BB_CONFIG` maps to the dropsh config selector, `BB_CONNECTION` takes precedence over `DROPSH_CONNECTION`, then the project connection file and default discovery apply. Record the effective selection with `bakers info`, without exposing credentials. |
| Machine/config roots | `BB_HOME` relocates Bakers' private configuration root; it does not isolate the separate dropsh credential store or all agent homes. Machine identity and execution/security settings belong to `machine.config.js` and supported addon configuration. Do not invent identity/security environment switches. |
| Conductor selection | Explicit config overrides `BB_CONDUCTOR_CONFIG`; explicit conductor name overrides `BB_CONDUCTOR`. Settings come from the selected project conductor and its local overrides. Persist config and ordinary authentication as documented, restart, and verify it reconnects to the intended service. |

F11 must record settings that require CLI/configuration rather than environment values and obtain
explicit review of their sufficiency. Coordinate runtime fixes with the standalone deployment work;
these observed limitations are not silently repaired by the acceptance harness.

## Support and cleanup

| Combination | Acceptance status | Required evidence |
|---|---|---|
| Linux + public standalone Compose + local DDEV contributor checkout | Public candidate available; BLOCKED on standalone integration, clearance and disposable host | F1–F3, P2/P5; exact OS/architecture and revision/date |
| Connector-only setup | Not yet observed on that candidate | F4 with ordinary connector account |
| First project + sandbox client | BLOCKED without supported client evidence | F5; reuse client-matrix tickets BAKERS-30–34 only for their recorded scope |
| Existing-project member / guest / non-member | Not yet observed on that candidate | F6–F7 with separate accounts |
| Coder, FRP, Komodo, other OS/client combinations | Optional and unverified by this baseline | Separate candidate-specific evidence; docs alone are not support proof |
| Private security reporting | GitHub private reporting enabled; monitoring ownership pending | F8; no guessed mailbox/advisory URL |

Before creating anything, record canonical roots, Compose project/volume names, DDEV site names,
account/project/conductor IDs and credentials owned by this experiment. Export evidence before
cleanup. Check ownership immediately before each exact named deletion. Stop on mismatch. Never
use broad Docker/DDEV prune, delete shared seeded personas, or remove a shared control plane.
Record leftovers as blocked cleanup and revoke only experiment credentials. Human documentation
review and the CI merge gate remain separate from local checker success.
