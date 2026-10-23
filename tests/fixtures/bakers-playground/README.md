# bakers-playground
Status: active

Minimal Drupal 11 fixture project for the bakers.build Conductor test setup.

`scripts/setup-test-project.sh` serves this tree from a local bare repository and clones it into
an isolated workspace; `--fixture-repo <url>` uses a real remote instead. Runtime dependencies,
Drupal core and generated configuration are not committed. The DDEV configuration and commands
are committed so the clone can run DDEV setup locally.

## Worked items
- #1: playground smoke run.
