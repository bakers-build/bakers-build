# CLI commands

The `bakers` command is one program with twelve top-level commands; this page lists them all and covers the setup and configuration commands in detail, while the larger ones have a page of their own.

Options and subcommands are copied from `bakers --help` and the help of each command; run `bakers <command> --help` on your installed version for its complete output.

## Global options

| Option | Effect |
|---|---|
| `--conductor <name>` | Select a conductor config by file stem: `conductor` means `conductor.config.js`, anything else `<name>.conductor.config.js`. Environment: `$BB_CONDUCTOR`; the flag wins. Give it before the command. |
| `-V`, `--version` | Print the CLI version |
| `-h`, `--help` | Show help for `bakers` or for any command |

## All commands

| Command | What it does |
|---|---|
| `bakers version` | Print the CLI version |
| `bakers init` | Set up machine identity and the server connection (not a project) |
| `bakers config` | Initialize, migrate and validate scoped configuration: `init`, `upgrade`, `check` |
| `bakers update` | Install the latest CLI |
| `bakers oven` | Node-agent lifecycle and the registry of conductors: [bakers oven](/configuration/project/conductors) |
| `bakers ui` | Interactive terminal UI: [bakers ui](/addons/bakers-ui/reference) and [keys](/addons/bakers-ui-keys) |
| `bakers tools` | List, describe and call the server's named tools: [bakers tools](/configuration/clients/tools) |
| `bakers auth` | Sign in, switch auth profiles and show the session: [bakers auth](/configuration/clients/auth) |
| `bakers deployment` | Release and deployment helpers: [bakers deployment](/addons/deployment/reference) |
| `bakers agents` | Print the locally resolved agent catalog as JSON |
| `bakers info` | Print the resolved project and workspace context as JSON |
| `bakers ports` | List a ticket worktree's running services and share them over a tunnel |
| `bakers help [command]` | Show help |

## Install and update

[Machine setup](/get-started/machine) owns installation and sign-in. `bakers update` installs the latest CLI; [Updates](/configuration/machine/updates) separates code updates from configuration migration.

## bakers init

```sh
bakers init
bakers auth login
```

`bakers init` is the first command a person runs. It sets up the machine identity and the connection to your server, never the project, and it needs no scope. `bakers init --help` still lists a `--scope` line, which `bakers init` does not require. A fresh connection signs in with a device code unless you pass a secret: `bakers auth login` then prints a URL and a short code, you confirm on any device, and it waits until you are signed in.

| Option | Meaning |
|---|---|
| `--base-url <url>` | Server URL for the connection |
| `--client-id <id>` | OAuth client identifier |
| `--auth-type <type>` | `device` (default, no secret) or `client_credentials` (internal and CI use) |
| `--secret-env <name>` | Environment variable holding the OAuth secret |
| `--label <name>` | Machine label (default: short hostname); `bakers init` generates the machine UUID. The run budget is set on the machine in the backend |
| `--workspace-id <uuid>` | Explicit workspace UUID |
| `--connection <id>` | Write or use the named connection `~/.bakers/connections/<id>.js` |
| `--config <file>`, `--machine-path <file>` | Override the connection or machine file location |
| `--online` | Authenticate and verify each selected workspace |
| `--dry-run` | Report planned changes without imports, network or writes |
| `--yes` | Disable prompts and automatic selections |
| `--format <format>` | Report as `text` (default) or `json`; `json` disables prompts |

Interactive runs prompt for what is missing. With `--yes`, `--format json`, `--dry-run` or `$CI` set, nothing is asked, so pass the values that have no default, such as `--base-url` and `--client-id`. The two location overrides steer only where those files are read and written; the committed `.bakers/conductor.config.js` always resolves its imports through `BB_HOME` (default `~/.bakers`) so it stays portable. Connection files and auth profiles: [Connections](/configuration/connector/connections); the machine file: [Machines](/configuration/machine).

## bakers config

```sh
bakers config init --scope project --project <name> --workspace <name>
bakers config check --scope all --online
bakers config upgrade --scope all --dry-run
```

The three subcommands share one set of scopes, `machine`, `connection`, `project` and `all`, and these options: `--scope`, `--format`, `--path <directory>` (project root), `--project <name>`, `--machine-path`, `--config`, `--connection`, `--yes` and `--online`. `config check` exits non-zero when the result is not ok.

| Subcommand | What it does |
|---|---|
| `init` | Initialize or repair the selected scope and verify readiness. Requires a scope: `--scope`, or a prompt on a terminal. Online verification follows. |
| `check` | Validate offline; with `--online`, also authenticate and verify each workspace. Changes nothing. |
| `upgrade` | Migrate the selected scope without changing existing values. `--dry-run` previews. See [Configuration migration](/configuration/project/migration). |

`init` and `upgrade` also take `--dry-run`, `--label`, `--base-url`, `--client-id`, `--workspace-id`, `--secret-env` and `--auth-type` as above, plus:

| Option | Meaning |
|---|---|
| `--workspace <name>` | Committed project workspace name (`bakers.workspace`) |
| `--after-create <command>`, `--after-done <command>` | The committed conductor config's `after_create` and `after_done` hooks; empty means none |

`--project` is required to initialize a project; `--workspace` names the committed workspace. `--connection <id>` picks a named connection from `~/.bakers/connections`; the old `--project-connection` is retired and fails with a pointer to it. Project and connection initialization sign in; machine initialization is local.

## Other setup commands

```sh
bakers agents
bakers info
```

- `bakers agents [--config <path>]` prints the available agent aliases and machine defaults as JSON; `--config` names the conductor config.
- `bakers info [--config <path>] [--connection <id>]` prints the resolved project and workspace context as JSON.

## bakers ports

`bakers ports` works on the worktree you stand in. `list` shows every service an addon has claimed (a Storybook, a DDEV site), `status` this worktree's tunnel records, `up [service-key]` shares one claimed service, or every eligible one when no key is given, `down [service-key]` takes it down, and `reap` reconciles the machine's tunnel records and kills orphaned tunnel processes. Only claimed services are shared, never a raw port. The transport (a named Cloudflare tunnel, a Cloudflare quick tunnel or frp) is configured on the machine and documented with the [Ports](/addons/ports) addon; tunnel state lives machine-wide in `~/.bakers/tunnels.json`.
