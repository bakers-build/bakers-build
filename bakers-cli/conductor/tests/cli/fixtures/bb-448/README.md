# Configuration history fixtures

`manifest.json` records actual source revisions and paths. Historical machine files
were unversioned; `null` is intentional, not a fabricated schema number. Connection
v1/v2/v3 and current v4 have their shipped markers. The first host-only machine
schema is current v1. The current row comes from the scoped-template implementation.

Historical templates were verified with `git show <revision>:<source>` against the
original source copies in the ticket's historical-inputs directory, then extracted
from `renderBbConfig`, `renderMachineContext` and `renderCommittedConfig` with synthetic
literal inputs. The renderer package and OAuth constants use that revision's actual
values. Machine fixtures use `historical-host`, `historical-user`, `historical-client`,
`historical-secret`, `https://historical.test`, and capacity 3 where supported.
Inputs are fixture-only, never operator credentials. Original comments and historical
command names are retained as migration inputs. The older `connection-v3.js.txt` is
kept for preceding planner regressions of the same source family.

The workspace template introduced a required workspace read but its machine renderer
did not write that key. The history suite supplies the explicit workspace UUID
`11111111-1111-4111-8111-111111111111`; without that input migration may not invent one.
All runtime fixture imports bind the generated home expression to a disposable test
home before execution. No test overrides HOME or CODEX_HOME.

`config-history.test.ts` covers every connection source family at global and project
scope, the early combined engine split, retained engine identity, partial independent
machine/connection/project files and refusal while a retired home-local override exists. `config-plan.test.ts` adds independently absent
layers, narrow-scope prerequisites, computed/conflicting local inputs, capacity
variants, engine-only connection shadow removal, private backups and idempotence.
`host/tests/config.test.ts` covers scoped command initialization and readiness; core
inventory/loader and dropsh/UI tests cover missing/partial loading and workspace recovery.
Current public generation is also executed in the installed-package harness.

Focused F1 gate from the repository root:

```bash
cd bakers-cli && pnpm exec vitest run host/tests conductor/tests/cli core/tests/cli addons/dropsh/tests ui/tests
```

The existing CI `conductor` job runs `cd bakers-cli && pnpm run test:vitest`; these fixture
consumers are inside its existing include paths. No separate test-discovery rule is needed.
