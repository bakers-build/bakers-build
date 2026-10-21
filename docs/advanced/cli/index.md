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
| `bakers validate` | Validate a project's `WORKFLOW.md` against the loaded skills' step contract |
| `bakers conductor` | Node-agent lifecycle and the registry of conductors: [bakers conductor](/advanced/cli/conductor) |
| `bakers ui` | Interactive terminal UI: [bakers ui](/advanced/cli/ui) and [keys](/advanced/cli/ui-keys) |
| `bakers dropsh` | JSON:API shell bound to the bakers.build connection: [bakers dropsh](/advanced/cli/dropsh) |
| `bakers deployment` | Release and deployment helpers: [bakers deployment](/advanced/cli/deployment) |
| `bakers agents` | Print the locally resolved agent catalog as JSON |
| `bakers info` | Print the resolved project and workspace context as JSON |
| `bakers ports` | List a ticket worktree's running services and share them over a tunnel |
| `bakers help [command]` | Show help |

## Install and update

```sh
npm install -g @bakers-build/bakers
bakers --version
bakers update
```

`bakers update` runs `npm install -g @bakers-build/bakers@latest` and prints the version change. It installs code only; configuration files are migrated by `bakers config upgrade`. The step-by-step guide is [Install and sign in](/get-started/install).

## bakers init

```sh
bakers init
bakers dropsh auth login
```

`bakers init` is the first command a person runs. It sets up the machine identity and the connection to your server, never the project, and it needs no scope. `bakers init --help` still lists a `--scope` line, which `bakers init` does not require. A fresh connection signs in with a device code unless you pass a secret: `bakers dropsh auth login` then prints a URL and a short code, you confirm on any device, and it waits until you are signed in.

| Option | Meaning |
|---|---|
| `--base-url <url>` | Server URL for the connection |
| `--client-id <id>` | OAuth client identifier |
| `--auth-type <type>` | `device` (default, no secret) or `client_credentials` (internal and CI use) |
| `--secret-env <name>` | Environment variable holding the OAuth secret |
| `--machine-id <id>`, `--user-id <id>`, `--max-parallel <number>` | Host identity, operator and capacity |
| `--workspace-id <uuid>` | Explicit workspace UUID |
| `--connection <id>` | Write or use the named connection `~/.bakers/connections/<id>.js` |
| `--config <file>`, `--machine-path <file>` | Override the connection or machine file location |
| `--online` | Authenticate and verify each selected workspace |
| `--dry-run` | Report planned changes without imports, network or writes |
| `--yes` | Disable prompts and automatic selections |
| `--format <format>` | Report as `text` (default) or `json`; `json` disables prompts |

Interactive runs prompt for what is missing. With `--yes`, `--format json`, `--dry-run` or `$CI` set, nothing is asked, so pass the values that have no default, such as `--base-url` and `--client-id`. The two location overrides steer only where those files are read and written; the committed `.bakers/conductor.config.js` always resolves its imports through `BB_HOME` (default `~/.bakers`) so it stays portable. Connection files and auth profiles: [Connections](/advanced/connections); the machine file: [Machines](/advanced/machines).

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
| `upgrade` | Migrate the selected scope without changing existing values. `--dry-run` previews. See [Configuration migration](/advanced/migration). |

`init` and `upgrade` also take `--dry-run`, `--machine-id`, `--user-id`, `--max-parallel`, `--base-url`, `--client-id`, `--workspace-id`, `--secret-env` and `--auth-type` as above, plus:

| Option | Meaning |
|---|---|
| `--workspace <name>` | Committed project workspace name (`bakers.workspace`) |
| `--after-create <command>`, `--after-done <command>` | The committed conductor config's `after_create` and `after_done` hooks; empty means none |

`--project` is required to initialize a project; `--workspace` names the committed workspace. `--connection <id>` picks a named connection from `~/.bakers/connections`; the old `--project-connection` is retired and fails with a pointer to it. Project and connection initialization sign in; machine initialization is local.

## Other setup commands

```sh
bakers agents
bakers info
bakers validate
```

- `bakers agents [--config <path>]` prints the available agent aliases and machine defaults as JSON; `--config` names the conductor config.
- `bakers info [--config <path>] [--connection <id>]` prints the resolved project and workspace context as JSON.
- `bakers validate [path] [--project <dir>] [--skills <dir>]` checks the project's `WORKFLOW.md` against the step contract of the loaded skills. `path` is a project directory or a `WORKFLOW.md` file (default: the working directory); `--project` is the root where `.claude/skills` and `.agents/skills` are discovered; `--skills` adds another skill root and may repeat.

  It indexes every `SKILL.md`, expands bundles, derives the work type × workflow × step triples the project can produce and checks that exactly one loaded skill owns each, and that every inline override names an input the skill declares. A pass prints `OK` with the step owners and exits `0`; a defect goes to stderr, exits `1` and names the first thing to fix: a coverage gap, a collision or an unknown override. Skills installed as a plugin sit outside the repository: pass the exact installed version's root with `--skills`, because the plugin cache holds every version side by side and is not scanned by default. Run it in CI or before a run.

## bakers ports

`bakers ports` works on the worktree you stand in. `list` shows every service an addon has claimed (a Storybook, a DDEV site), `status` this worktree's tunnel records, `up [service-key]` shares one claimed service, or every eligible one when no key is given, `down [service-key]` takes it down, and `reap` reconciles the machine's tunnel records and kills orphaned tunnel processes. Only claimed services are shared, never a raw port. The transport (a named Cloudflare tunnel, a Cloudflare quick tunnel or frp) is configured on the machine and documented with the [Ports](/addons/ports) addon; tunnel state lives machine-wide in `~/.bakers/tunnels.json`.
