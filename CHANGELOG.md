# Changelog

One version covers the CLI (`@bakers-build/bakers`) and the server.

## 0.1.1 — 2026-10-23

The first version on npm: `0.1.0` was tagged but its npm publish failed, so `@bakers-build/bakers@latest` starts at `0.1.1`.

### CLI

No changes.

### Server

#### Fixes

- Install the skill-eval packages before the release test run (!10)
- Read the release version without a pipe (!13)

## 0.1.0 — 2026-10-23

### CLI

#### Breaking changes

- Rename the conductor command to bakers oven and add the client-version contract (!2)

#### Features

- Deploy dev and prod on Traefik with deploy reports, next builds and releases (!3)
- Install the renamed Drupal side cleanly without update hooks (!1)

#### Fixes

- Verify the published package set under the @bakers-build scope (!5)

### Server

#### Breaking changes

- Rename the conductor command to bakers oven and add the client-version contract (!2)

#### Features

- Deploy dev and prod on Traefik with deploy reports, next builds and releases (!3)
- Install the renamed Drupal side cleanly without update hooks (!1)

#### Fixes

- Name the default workspace bakers instead of the interim site name (!8)
- Let the next build find no release tag under pipefail (!7)
- Retry the deploy smoke checks while the host comes up (!4)
