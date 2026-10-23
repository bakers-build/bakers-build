# playground

Trivial target file for bakers.build conductor playground runs. Agents append one bullet
per worked ticket below.

## Running the e2e integration test

- Run `ddev bakers-test-integration` to build `conductor/`, generate the conductor
  config, and execute the dropsh smoke check plus the Vitest integration suite.

## Worked-item convention

- GLE2E-6: every ticket appends exactly one bullet under `## Worked items`, led by its ticket
  identifier and followed by one sentence naming the change; older entries lead with the bare
  ticket number instead of the full identifier.

## Worked items

- #6: documented the `ddev bakers-test-integration` command.
- GL-E2E-CONDUCTOR: conductor E2E loop smoke run — coding handler appended this bullet.
- #3: Playground run 0027 — added this worked-item note in playground.md.
