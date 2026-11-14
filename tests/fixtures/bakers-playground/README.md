# bakers-playground
Status: active

Minimal Drupal 11 fixture project for the bakers.build Conductor test setup.

`.bakers/scripts/setup-test-project.sh` serves this tree from a local bare repository and clones it into
an isolated workspace; `--fixture-repo <url>` uses a real remote instead. Runtime dependencies,
Drupal core and generated configuration are not committed. The DDEV configuration and commands
are committed so the clone can run DDEV setup locally.

## Local setup

Run `node .bakers/scripts/setup-worktree.mjs` to prepare the gitignored worktree identity and public env
without starting DDEV. Run `ddev init` only when deliberately installing/replacing the local
minimal Drupal database; it starts DDEV, installs Composer dependencies, installs minimal and
rebuilds caches. `ddev coder-init` reuses a bootstrapped database. No keytec DDEV addon is needed.
The full Bakers recipe-test site is the parent control plane, not this minimal fixture.

## Worked items
- #1: playground smoke run.
