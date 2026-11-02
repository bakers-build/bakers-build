# GitHub migration rehearsal

GitLab remains the development, npm publication and deployment authority during overlap.
The GitHub workflow is a rehearsal: it grants only `contents: read`, uses disposable
Blacksmith Ubuntu 24.04 runners, and has no registry login, publish token or deployment job.
Do not transfer uncleared repository history to enable it.

## Checks

`.github/workflows/checks.yml` runs on pull requests and manual dispatch. All validation
jobs run without path filtering. The `required` aggregate fails if any prerequisite fails,
is cancelled or is skipped. It must be configured as a required check with strict
up-to-date branch protection before GitHub becomes authoritative. Repository policy must
also require a merge commit for `main`, preserving the frozen release second parent.
Neither repository setting has been applied by this change.

The PHP, CLI, renderer (glibc and musl), theme/Storybook, configuration, compose, docs,
skill-version and title checks retain the existing GitLab commands. The image gate builds
PHP, PHP-test, nginx, docs and the browser runner once. PHPUnit runs inside PHP-test;
recipe/browser/integration checks use those local images, followed by a separate
existing-config database. The Docker socket belongs only to the disposable job machine.
No registry credentials or shared deployment daemon are involved.

Image configuration IDs, layer identities, candidate tree, workflow run and attempt are
retained with the reports. These reports are evidence, not authorization to promote images.
The current rehearsal does not retain transferable image archives or implement promotion.
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

The private rehearsal uses `blacksmith-4vcpu-ubuntu-2404` for fast jobs and
`blacksmith-8vcpu-ubuntu-2404` for the Docker image and private registry gates.
PHPUnit uses eight processes on these 8-vCPU runners. The Blacksmith GitHub App must have access to the repository.
The same-source conductor benchmark passed 4,679 tests (3 existing skips) in 3m07s,
compared with 7m27s on GitHub standard runners and 2m21s on the existing GitLab runner.
This single sample does not establish full-pipeline runtime or cost.
[Benchmark evidence](https://github.com/bakers-build/bakers-build/actions/runs/41542518835).

PHPUnit, browser/integration tests and config import continue using the images built
once by `scripts/ci/github-image-gate.sh`; runner selection does not change the gates.
Public fork execution remains unverified and must be checked before public cutover.

## Private registry rehearsal

`registry-rehearsal.yml` runs only on the dedicated `ci/ghcr-rehearsal` branch or
explicit manual dispatch. It grants `packages: write` only to its image-gate job;
PR checks retain read-only permissions. After the full Docker/PHPUnit/browser/config
sequence passes, the same PHP, nginx and docs images are pushed to private
`ghcr.io/bakers-build/bakers-rehearsal-{php,nginx,docs}` packages with SHA/run tags.
The script rejects existing non-private packages before login, verifies visibility
after publication, pulls by digest and checks the image ID against the tested image.
Evidence is retained in `gate-reports/registry.txt`. No `latest`/`next` tags or
application deployment is performed. Public release clearance remains separate.
