# Configuration

Change settings after initial setup. Each topic names its owner, required and optional values, examples and verification.

| Topic | Location and responsibility |
|---|---|
| [Connector](/configuration/connector) | Chat client's MCP settings; CLI connection files under `~/.bakers` |
| [Machine](/configuration/machine) | Private `~/.bakers/machine.config.js`: identity, capacity and preview policy |
| [Project](/configuration/project) | Committed `.bakers/conductor.config.js`: project identity and engine wiring |
| [Provisioning](/configuration/provisioning) | Repository scripts and conductor hooks: development environments |
| [Clients](/configuration/clients) | Local client runtime and project executor/workspace selection |
| [Agents](/configuration/agents) | Machine addons and agent policy: harnesses, models and routing |
| [Workflows](/configuration/workflows) | Ticket workflow/recipe and committed `WORKFLOW.md`: method and checks |
| [Security](/configuration/security) | Access, credentials, execution boundaries, previews and data locations |

Keep connections, `.bakers/connection.config.local.js`, `.bakers/conductor.config.local.js`, logs and evidence out of Git. Local conductor values apply only where the committed file explicitly imports them. `BB_HOME` names the private `.bakers` directory itself and moves machine and connection files together.

```sh
bakers config check --scope all --online
```

Check the selected connection and intended project before changing credentials. [Updates](/configuration/machine/updates) and [migration](/configuration/project/migration) cover existing installations; [Getting Started](/get-started/) covers new ones.
