# Contributing to bakers.build

bakers.build is a standalone application with a Drupal server, Node CLI/conductors and agent
skills. It is not distributed as a module for arbitrary Drupal sites. Components have different
[licenses](docs/bakers/licensing.md); keep their notices with source and published artifacts.

## Obtain a candidate

Use the public repository `https://github.com/bakers-build/bakers-build` and an immutable
candidate SHA. The contribution target is `next`; `main` is the stable release branch. Public source,
packages, images and skill revisions must be available without company credentials. Do not
substitute the internal remote or an installed developer shim when testing public installation.
The [clean-install runbook](docs/bakers/clean-install-acceptance.md) records availability, explicit
prerequisites and the current support limits. A missing public candidate blocks that acceptance.

```sh
git clone https://github.com/bakers-build/bakers-build.git bakers
cd bakers
git checkout --detach <candidate-sha>
git switch -c chore/my-change
```

## Build and check

For CLI work install Git, Node **>=22.22.0** (the core-test minimum), npm and pnpm compatible with
the committed lockfile. The published CLI alone requires Node >=20.19. Shell contracts also need
Bash, jq, Python 3 with PyYAML and GNU coreutils. Use the exact versions recorded for the candidate.

```sh
(cd bakers-cli && pnpm install --frozen-lockfile && pnpm -r run build)
npm ci --prefix tests/skill-eval
./bakers-cli/bin/bakers --help
(cd bakers-cli && pnpm --filter @bakers-build/core test && pnpm lint)
```

Call the checkout build explicitly. A global `bakers` is a different artifact. For Drupal work,
Docker/Compose and DDEV are additional prerequisites; Composer and theme builds are owned by the
[documented DDEV setup](docs/bakers/testing.md#local-ddev-preparation). Use an isolated site and
explicit provider: `ddev init --provider recipe-test` reinstalls its database. Validate
`existing-config` afterwards on a separate owned site at the same revision. Never initialize a
shared installation. Ordinary provider accounts are needed only for the paths using those services.

Contracts referencing rendered theme assets also require `(cd web/themes/custom/bb_theme &&
pnpm install --frozen-lockfile && pnpm build)` before their checks.

For documentation, install the site dependencies in `docs/` and run its existing build and tests:

```sh
(cd docs && pnpm install --frozen-lockfile && pnpm build && pnpm test)
```

Read [CLAUDE.md](CLAUDE.md), [WORKFLOW.md](WORKFLOW.md), [conventions](docs/bakers/conventions.md)
and [testing](docs/bakers/testing.md). Select every check matching the final diff, including callers
of changed helpers. CI owns the full PHPUnit/browser merge gate. Local contracts or fixture runs
do not establish a clean public install or effective client sandbox protection.

## Submit a change

Keep the change focused, use English and add behavior coverage at the existing public seam where
needed. Describe the user-visible result, commands actually run, immutable revision and remaining
blockers. Follow the [commit/MR conventions](docs/bakers/git-and-delivery.md); open a pull request against `next` in `bakers-build/bakers-build` on GitHub. A draft is not
release acceptance. Never commit private connection files, tokens, login links or customer data.

For work within an existing Bakers project, follow [join a project](docs/get-started/first-ticket.md)
with your own account. An existing team conductor can supply execution capacity. For a new local
machine use [machine setup](docs/get-started/machine.md); connector-only use starts at
[connector setup](docs/get-started/connector.md). These paths have different prerequisites.

Security concerns follow [SECURITY.md](SECURITY.md), not a public issue containing sensitive details.
