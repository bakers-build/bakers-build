# GitHub migration

GitHub is public with `next` as its default branch and `main` as stable. Both have active PR,
required-check and history-protection rules. GitLab still owns publication and live deployment
until the explicit handover below; private customer branches remain there.

## Checks

`.github/workflows/checks.yml` runs on `next`/`main` pushes, pull requests and manual dispatch. All validation
jobs run without path filtering. The `required` aggregate fails if any prerequisite fails,
is cancelled or is skipped. It must be configured as a required check with strict
up-to-date branch protection before GitHub becomes authoritative. Repository policy must
also require a merge commit for `main`, preserving the frozen release second parent.
These rules are active on both GitHub branches.

The PHP, CLI, renderer (glibc and musl), theme/Storybook, configuration, compose, docs,
skill-version and title checks retain the existing GitLab commands. The image gate builds
PHP, PHP-test, nginx, docs and the browser runner once. PHPUnit runs inside PHP-test;
recipe/browser/integration checks use those local images, followed by a separate
existing-config database. The Docker socket belongs only to the disposable job machine.
No registry credentials or shared deployment daemon are involved.

Image configuration IDs, layer identities, candidate tree, workflow run and attempt are
retained with the reports. These reports are evidence, not authorization to promote images.
The private registry rehearsal transfers verified images and checks their digest and image ID.
A real GitHub run must establish runner disk/time requirements and prove every gate before
required-check enforcement is considered verified.

The package rehearsal builds and verifies the existing complete package set and calculates
Conventional Commit release notes. No-change ranges produce no release notes. GitHub runs
use GitHub commit links; the GitLab path retains its current behavior.

## Next version allocation

After disabling and draining the GitLab next publisher, capture immutable published versions
for **every package** discovered by `prepare-publish.mjs`. Flatten their version lists into
one JSON array. A missing package query is a failed snapshot, not an empty package.

```sh
node bakers-cli/scripts/next-version.mjs 0.6.0 < published-versions.json
```

The allocator chooses a sequence above the highest observed next version, including partial
publication. It rejects a base already released as stable, a newer published base, malformed
input or an unfamiliar prerelease format. It does not read npm, reserve a version, publish,
resume a partial release or change dist-tags. The complete snapshot and exclusive publisher
lock are prerequisites; a concurrent writer invalidates the allocation.

Before enabling publication, reconcile every package from any partial attempt, verify exact
candidate/artifact identity and deployment evidence, and serialize the whole publication.
Keep GitLab `latest` and production unchanged. Do not add a second active next publisher.

## Remaining external evidence

A cleared candidate, real PR and separate fork PR, required-check rejection, package/GHCR
rights, transferable tested-image identity and explicit publisher handover remain necessary.
Consumer URL/default changes wait for reachable target repositories. License/history gates
also apply to later GitLab integrations. Existing GitLab customer connectors are unchanged.

## Runner selection

Jobs run on WarpBuild runners in three tiers. Each tier reads a repository variable and falls back
to its WarpBuild label when the variable is unset:

| Tier | Variable | Default label | Jobs |
|---|---|---|---|
| checks | `RUNNER_CHECKS` | `warp-ubuntu-latest-x64-2x` | every `checks.yml` job except the after-merge jobs, including `required` and `report_failure`; `report_failure` in `release.yml` |
| image gate | `RUNNER_IMAGE_GATE` | `warp-ubuntu-latest-x64-16x` | `image_gate` in `checks.yml` (PHPUnit with 16 processes, Playwright with 6 workers) |
| after-merge | `RUNNER_AFTER_MERGE` | `warp-ubuntu-latest-x64-4x` | `tui_musl`, `release_rehearsal` in `checks.yml`; `release` in `release.yml`; `registry` and `transfer` in `registry-rehearsal.yml` |

The variable holds a JSON label or label array. To send a tier back to the self-hosted
`github-runner-1` (Docker via dind, one job at a time), set its variable; deleting it returns the
tier to WarpBuild:

```sh
gh variable set RUNNER_CHECKS --body '["self-hosted","github-runner-1"]'
gh variable set RUNNER_AFTER_MERGE --body '["self-hosted","github-runner-1"]'
gh variable delete RUNNER_CHECKS
gh variable delete RUNNER_AFTER_MERGE
```

`self-host-lifecycle.yml` runs on a fixed `warp-ubuntu-latest-x64-4x` with no fallback: it
installs, restores and wipes a self-host stack and needs a disposable runner.

PHPUnit, browser/integration tests and config import continue using the images built
once by `scripts/ci/github-image-gate.sh` in `image_gate`. `image_gate`, `tui_musl` (musl
compatibility) and `release_rehearsal` (package and release notes) are after-merge jobs. They run:

- on every push to `next` and `main` and on manual dispatch. A push runs only these: the other
  checks already passed in the PR on the same tree. The push run exports the tested images that
  `release.yml` deploys (`next` to develop, `main` to app);
- on every PR into `main`. There, the aggregate `required` check fails when one of them fails or
  is skipped;
- not on PRs into `next`. There, `required` passes with them skipped, so their failures show up on
  the push to `next` and block that deployment.

When a push or dispatch run on `next` has a failed job, `report_failure` runs
`scripts/ci/github-failure-ticket.sh`. It signs in to `https://app.bakers.build` as a service
account and comments on the open BAKERS ticket titled `CI failure: GitHub checks on next`, or
creates that ticket as a `bug` with recipe `superpowers` (workflow `bb_work`) when none is open
and assigns it to the `cw-framework` conductor with the label `auto`, so the conductor carries it
to `done` without approvals; a comment on an open ticket leaves its labels alone. The comment or ticket names the failed jobs, the
commit and the run. When the `release` job of `release.yml` fails on `next` or `main`, the
`report_failure` job of `release.yml` runs the same script for its own ticket,
`CI failure: GitHub release on <branch>`, so release and checks failures never share a ticket.
Both jobs need repository secrets `BB_CI_CLIENT_ID` and `BB_CI_CLIENT_SECRET` (the service
account's OAuth client).
The public fork full check passed; a separate probe confirmed secrets were absent and a write
to the base repository failed with HTTP 403.

## Private registry rehearsal

`registry-rehearsal.yml` runs only on the dedicated `ci/ghcr-rehearsal` branch or
explicit manual dispatch. It grants `packages: write` only to its image-gate job;
PR checks retain read-only permissions. After the full Docker/PHPUnit/browser/config
sequence passes, the same PHP, nginx, docs and PM bot images are pushed to private
`ghcr.io/bakers-build/bakers-rehearsal-{php,nginx,docs,pm-bot}` packages with SHA/run tags.
The script rejects existing non-private packages before login, verifies visibility
after publication, pulls by digest and checks the image ID against the tested image.
Evidence is retained in `gate-reports/registry.txt`. No `latest`/`next` tags or
application deployment is performed. Public release clearance remains separate.

## Publisher handover

The prepared `release.yml` is disabled until repository variable `RELEASE_OWNER=github`.
It accepts successful same-repository branch push checks only, serializes each branch without
cancelling an active deployment, and uses the `release` environment. Its immutable plan artifact
binds the version allocation to the candidate and is reused on retries. npm publication verifies
existing package integrity and advances channel tags only after the complete package set exists.
The release imports the successful source run’s image archive and checks its commit, tree, run,
attempt, checksum and image IDs. Version/revision labels are reproducible and may change the image
config; the tested filesystem layers must remain identical. It publishes candidate digests, promotes branch image tags,
deploys through Komodo, smoke-checks, then publishes npm. Stable releases tag the frozen second
parent and publish GitHub release notes and versioned/latest images.

Before enabling it:

1. Resolve the open GitLab MR backlog; keep customer branches private. Merge the reviewed changes
   through the normal working/review gates. Update the Bakers project repository/default to GitHub
   and `next` only after those branches have a safe destination.
2. Set the canonical GHCR packages `bakers-build/php`, `bakers-build/nginx`, `bakers-build/docs`, `bakers-build/pm-bot`
   public in Package settings and verify anonymous pulls. The rehearsal packages stay private.
3. Protect GitHub's `release` environment for `next` and `main` and transfer npm/Komodo credentials
   into that environment. Update the versioned infra Resource Sync to GitHub/`next`, run the sync,
   and verify the standard stacks keep their identities, data volumes and secrets.
4. Install the GitLab `RELEASE_OWNER` guards, set its variable to `github`, and drain all existing
   publication/deployment runs. Capture current production image digests and npm channel values.
   Only then set GitHub's owner variable. Do not activate both publishers.
5. Verify the first next deployment and full package set. Stable production changes only through
   an explicit `next` → `main` promotion; do not relabel a next candidate as the old stable image.

Rollback disables and drains GitHub first, then restores the recorded Komodo source/image digests
and GitLab ownership. Never move a published version backwards or overwrite immutable npm versions.
A failed partial npm attempt is resumed with its saved plan, not a freshly allocated version.
Public repository approval does not close outstanding third-party image/license provenance items.
