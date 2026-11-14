---
title: Write a runtime addon
description: Implement and register an outer agent execution backend through the runtime slot, with explicit paths, credentials, tool connectivity and cleanup.
---

# Write a runtime addon

A **runtime addon** is a package contributing an implementation of the conductor's `runtime` slot. It wraps the agent launch before the executor starts it. A **tool** is a callable operation exposed to the agent; contributing a runtime does not itself create a tool. Review [how permissions, isolation and tools fit together](/provision/security/) and the [isolation models](/agents/isolation) before choosing what to implement.

Use a runtime when you need another **per-run execution environment**. An operator-provided container around the whole conductor needs no runtime addon. Agent permission rules belong to the harness integration; an executor owns the terminal, and a workspace owns the worktree.

This guide targets the current `next` contract alongside the Experimental Docker/Bubblewrap backends. Build the addon and conductor against matching contracts; older installed builds may lack these exports. Check the version you target; an addon does not gain verified platform or agent support merely by implementing the interface.

## Implement the contract

Import `RuntimePlugin`, `BbRuntime` and `RuntimeLaunch` from `@bakers-build/conductor/contract`. In a source checkout, the authoritative types are in `bakers-cli/conductor/src/plugins/runtime.ts`.

A `RuntimePlugin` has `kind: 'runtime'`, `id`, `isolates`, `requiredModules` and `createRuntime(config, { logger })`. The factory returns a `BbRuntime`. Validate options, platform and backend prerequisites; reject unavailable isolation rather than returning a host launcher. `isolates: true` makes the conductor require a [run clone](/provision/security/shared-settings#isolated-git-delivery) from the workspace, protect `.bakers/` and the project's `runtime.read_only` paths, check host command entry points and transfer only checked commits back; your backend must still enforce the boundary itself.

| Member | Your responsibility |
|---|---|
| `id` | Identify the runtime |
| `prepareRun(run, agent)` (optional) | Allocate the run's private home; return `{ homePath, env? }` before agent preparation |
| `wrap(launch)` | Establish the intended boundary and return `{ command, env }` for the executor; reject on failure |
| `cleanup(run)` | Remove only that run's resources; tolerate absent resources and repeated cleanup |
| `toolsUrl(hostUrl)` (optional) | Translate the conductor tool-server URL to one reachable inside your environment |
| `toolServerHosts()` (optional) | Supply additional tool-server listening addresses; default is loopback only |

### Launch sequence and agent preparation

The conductor resolves the runtime, optionally calls `prepareRun`, then asks the agent to prepare files in that home. It builds the agent command and calls `wrap`, then passes the rewritten command/environment to `executor.startRun`. A rejected wrap fails dispatch; there is no host fallback.

`RuntimeLaunch` includes the command, environment, workspace path, run UUID/id and harness id. With a run clone it adds `gitDir`, which you mount as `<workspace>/.git`, and for a `shared` clone `sharedObjects`, which you mount read-only at its own path. Optional `homePath`, `readPaths`, `writePaths`, `installCommand` and `modelApi` carry preparation and installation/API metadata. If your runtime supplies a home, support the agent's neutral preparation instead of adding harness-specific copying to the runtime. Only Claude currently supplies the preparation used by the shipped outer backends; other combinations need their own implementation and evidence.

The runtime does not own project lifecycle hooks or worktree creation. Those remain conductor/workspace responsibilities. Runtime cleanup is called after executor cleanup; handle partial launches and conductor restarts without relying only on in-memory resource records.

## Implement the actual boundary

The interface is launch plumbing, not a sandbox implementation. Decide and implement:

- **Filesystem:** expose the workspace, `gitDir`, temporary/home paths and declared agent paths explicitly; never mount the parent repository. Mount every `readPaths` entry read-only, including the protected project paths. Validate canonical paths and symlinks. Read/write declarations do not mount themselves.
- **Processes:** contain and stop children as well as the launcher before removing resources. Preserve transcripts for collection; scope resource names and cleanup to the run identity.
- **Credentials/environment:** pass only required variables. Keep tokens out of command arguments and logs; private credential files need restrictive permissions. Model metadata is not permission to expose the conductor's secrets.
- **Network/tools:** define egress and conductor connectivity separately. Keep the run-bound tool token, URL and authorization intact. Additional listening addresses expose the server to another network and require deliberate review.
- **Native policy:** preserve the configured agent permission mode. Inner sandbox tools and namespace support must exist inside your environment. Host-only preflight does not establish that they work there.

Host conductor tools and project hooks remain outside the runtime. With `isolates: true` the conductor accepts only host commands that start in a protected path, but it checks only that entry point, not what the script calls; containers those commands reach, such as DDEV's web container, are as untrusted as the run. [Tools across boundaries](/provision/tools#work-across-permissions-and-isolation) explains the separate authority.

## Package and register it

Follow [Addon contracts](/addons/build/contracts#write-an-addon): create an ESM package, export `./preset`, declare compatible contract dependencies, and ship an options schema. A local addon may live under `.bakers/addons/`; it need not become part of Bakers itself.

Once your tested `myRuntime(options)` factory returns `RuntimePlugin`, register it in `src/preset.ts`:

```ts
import type { Preset } from '@bakers-build/conductor/contract';
import { myRuntime } from './index.js';

export const scopes: Preset['scopes'] = ['machine'];
export const runtimes: Preset['runtimes'] = (acc, options) => [
  ...acc,
  myRuntime(options),
];
```

This fragment registers your implementation; it supplies no isolation by itself. Have the factory validate the received options against its supported configuration.

Make the package resolvable from the machine config or CLI installation, then select it in `~/.bakers/machine.config.js`:

```js
runtime: { use: 'my-runtime-addon' },
```

The package name is your addon's name, not a tool name. Use one selected runtime per machine; `with` passes backend options. The default runtime is the host. See [runtime selection](/addons/slots#runtime-where-a-run-starts).

## Verify before claiming support

Test through the runtime's public methods: private home preparation, declared mounts, command/environment wrapping, tool URL reachability, rejected prerequisites, partial failures and idempotent cleanup. Keep credentials out of recordings. Inspect the shipped `runtime-bwrap` and `runtime-docker` sources/tests plus `conductor/tests/core/conductor-runtime.test.ts` for integration examples.

Then run the **real backend and target agent**: demonstrate allowed work and denied access through file tools and children, successful conductor tool calls, transcript collection, stopping and cleanup. Verify each claimed platform/network mode; CLI stubs, a type check or host preflight are insufficient. Keep unsupported combinations Unverified and document residual limits.
