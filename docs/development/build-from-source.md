# Build the CLI from source

Take a fresh clone of the bakers.build repository to a `bakers` built from your own checkout, so you can change the CLI and run it.

::: tip You probably do not need this
To use bakers.build, install the published CLI with `npm install -g @bakers-build/bakers` and follow [Install and sign in](/get-started/machine). Build from source only to work on the CLI itself.
:::

**You need:** a clone of the repository, Node 20.19 or later, and [pnpm](https://pnpm.io/installation).

1. Check the prerequisites. If pnpm is missing, enable it through corepack.

   ```sh
   node --version
   pnpm --version
   corepack enable pnpm
   ```

2. Build every package once, then bootstrap from the repository root. On a fresh clone the bootstrap alone stops at the addon build (see [Troubleshooting](#troubleshooting)). The bootstrap is idempotent, so run it again after any pull that touches `bakers-cli/`.

   ```sh
   (cd bakers-cli && pnpm install --config.minimumReleaseAge=0 && pnpm -r run build)
   bakers-cli/scripts/setup.sh
   ```

   The same script runs from `bakers-cli/` as `pnpm run bootstrap`.

3. Run the checkout's own build by explicit path.

   ```sh
   ./bakers-cli/bin/bakers --version
   ./bakers-cli/bin/bakers --help
   ```

4. Sign in as described in [Install and sign in](/get-started/machine), calling `./bakers-cli/bin/bakers` in place of `bakers`.

**Done when:** `./bakers-cli/bin/bakers --help` lists `oven`, `ui`, `tools`, `auth`, `deployment`, `agents`, `info` and `ports`. A source build reports the workspace version, currently `0.0.1`.

## Rebuild after an edit

The CLI runs the compiled `dist/` folders, so an edit has no effect until you rebuild. From `bakers-cli/`:

```sh
pnpm install && pnpm -r run build
```

`pnpm run build:all` is the same command under another name. The recursive build orders the packages by their workspace dependencies. Once every package has been built, re-running the bootstrap also rebuilds them and refreshes the resolution farm and the shim.

## What the bootstrap does

`bakers-cli/scripts/setup.sh` finds the repository root from its own path and runs eight steps.

1. **Prerequisites.** It checks that pnpm exists and that Node is 20.19 or later.
2. **Install.** It runs `pnpm install --config.minimumReleaseAge=0` in `bakers-cli/`. The flag avoids the workspace's supply-chain age policy, which would fail a plain install on a fresh tree.
3. **Build.** It calls `tsc` for each package in dependency order: `core`, then `conductor`, then every folder under `addons/`, then `ui`, then `host`. The conductor comes before the addons because every conductor addon imports its contract. The addon `workspace-git` is forced first because `herdr` depends on it.
4. **Resolution farm.** It links every package into the repository's `node_modules/@bakers-build/` under its real package name, and the `@dropsh/*` packages beside it, so a `.bakers/conductor.config.js` can resolve its bare imports.
5. **PATH shim.** It copies `bakers-cli/templates/bakers.pathshim.sh` to `~/.local/bin/bakers`. This writes outside the repository. A different `bakers` already there is left untouched and the script prints the command that replaces it.
6. **Local scaffold.** It writes `.bakers/conductor.config.local.js` from a template, asking for an OAuth client id in an interactive shell. It carries no identity; `bakers init` generates the machine UUID. The file is gitignored. See the warning below.
7. **herdr plugin.** When `herdr` is on the PATH it links the repository's `spiceedit` plugin. This is best effort and never fails the bootstrap.
8. **Summary.** It prints next steps. They are out of date; use `bakers init` from [Install and sign in](/get-started/machine) instead.

::: warning The scaffold and the printed next steps are retired
`bakers config check` reports the `oauth` keys that step 6 writes as dead keys, because sign-in is now `bakers init` and `bakers auth login`. Ignore the printed instructions to export a consumer secret, and delete the scaffold's `oauth` block if a check warns about it.
:::

## Monorepo layout

```
bakers-cli/
  core/        @bakers-build/core       surface-agnostic kernel, no @bakers-ai dependency
  conductor/   @bakers-build/conductor  run engine, the conductor command, the conductor contract
  ui/          @bakers-build/ui         the bakers ui command
  host/        @bakers-build/bakers       the bakers binary, config, init, update, validate
  addons/*     @bakers-build/addon-*    one package per addon
  scripts/     setup.sh, prepare-publish.mjs, release.mjs, verify-package.mjs, assert-acyclic.mjs
  templates/   config and path-shim templates
```

`bakers-cli/` is a private workspace root and is never published. Its pnpm workspace covers `core`, `host`, `conductor`, `ui` and `addons/*`. How the packages may depend on each other is described in [architecture](/development/architecture), and how to add an addon in [addon contracts](/addons/build/contracts).

## Which `bakers` runs

Two launchers exist, and a bare `bakers` runs the released CLI unless you are inside a test workspace.

- `bakers-cli/bin/bakers` is the dev launcher. It loads the built host from `host/dist/src/host.js`, which mounts only the command you invoke. From a checkout, call it by path.
- `~/.local/bin/bakers` is the shim from step 5. Inside a skill-test workspace, found by a `.bakers-testbuild` marker file at or above the working directory, it runs the checkout that marker names and fails loudly if that checkout is unbuilt. Everywhere else, including inside a plain clone, it runs the globally installed `@bakers-build/bakers`.

The shim wins only when `~/.local/bin` comes before the directory where `npm install -g` places `bakers`. Put it first if the bootstrap warns about shadowing.

```sh
export PATH="$HOME/.local/bin:$PATH"
```

The bootstrap never overwrites a different shim. To adopt the current template, diff first and then copy it.

```sh
diff ~/.local/bin/bakers bakers-cli/templates/bakers.pathshim.sh
cp bakers-cli/templates/bakers.pathshim.sh ~/.local/bin/bakers && chmod 0755 ~/.local/bin/bakers
```

## Tests and checks

Run these from `bakers-cli/`.

| Command | What it does |
|---|---|
| `pnpm run test:vitest` | Unit tests of every package under `*/tests/` |
| `pnpm run test:tui` | Terminal UI tests of `bakers ui`, run with bun |
| `pnpm test` | Both of the above |
| `pnpm run test:integration` | The conductor integration tests, strictly one file at a time |
| `pnpm lint` | The Biome check |
| `pnpm run typecheck` | Builds every package, then type-checks it |

For one file, use vitest directly, for example `pnpm exec vitest run core/tests/workflow/repository-contracts.test.ts`.

## Check the publish shape

The CLI ships as a set of npm packages: the `@bakers-build/bakers` binary package, `core`, `conductor`, `ui`, and every addon except the private `@bakers-build/addon-fake`, which is a test fixture. The set is discovered from the workspace, never listed by hand: every package that is not marked `"private": true` is published, in the order of its workspace dependencies.

To reproduce what npm users get, build first, then run the gate.

```sh
pnpm -r run build
pnpm run verify:package
```

The gate stages a fresh manifest per package, packs each one, installs the whole set into a throwaway project with plain `npm install`, and asserts that:

- no published manifest ships a `scripts` block;
- `bakers --help` works and lists the command plugins;
- `bakers deployment tickets --help` mounts from its own package;
- the `config` commands work on a broken checkout;
- an engine config and a connection config resolve their addons;
- `bakers ui --print-config` runs on plain Node.

It needs network access to the npm registry. `pnpm run prepare:publish` alone writes the manifests into each package's `publish/` folder, with every `workspace:` dependency rewritten to the release version. Publishing is CI's job: on a `v` tag it builds, type-checks, tests and verifies, then runs `pnpm run release:semver`. Do not run the release scripts from a laptop.

## Troubleshooting

- **`ERR_MODULE_NOT_FOUND` for `@bakers-build/bakers`, an addon or `@dropsh/*`.** The resolution farm or a build is missing or stale. Re-run the bootstrap, or rebuild as shown above.
- **The bootstrap stops at the addon build with a `TS2307` error naming `@bakers-build/addon-name-refs`.** It builds the addons in directory order, and `essentials` comes before `name-refs`, which it needs. Build once with the recursive command instead, then run the bootstrap again: `cd bakers-cli && pnpm install && pnpm -r run build`.
- **`bakers: command not found`.** `~/.local/bin` is not on the PATH; use the `export` line above.
- **`bakers: test workspace ... names checkout ..., which is not built.** This is deliberate. The message prints the rebuild command to run.
- **`bakers: no global bakers on PATH, and no .bakers-testbuild workspace above ...`.** You are outside every test workspace and have no global CLI. Install `@bakers-build/bakers` or call `./bakers-cli/bin/bakers`.
- **A bare `bakers` runs the released CLI inside your clone.** That is the rule, not a fault. Call `./bakers-cli/bin/bakers` to run your build.

For connecting, signing in and migrating configuration, see [Install and sign in](/get-started/machine) and [Connect a project by hand](/get-started/connect-a-project).
