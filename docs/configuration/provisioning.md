# Provisioning

Choose the environment during [project setup](/get-started/connect-a-project#set-up-your-environment), after choosing the client. Your repository's tooling prepares each ticket worktree. bakers.build invokes it through [lifecycle hooks](/configuration/provisioning/hooks); it does not supply a general DDEV, Docker or native Node provisioner.

| Environment | Use when | Canonical example |
|---|---|---|
| DDEV | The project has `.ddev/config.yaml` | [Per-ticket DDEV identity, cleanup and readiness](/configuration/provisioning/ddev) |
| Docker Compose | The project has a Compose application | [Isolated Compose projects](/configuration/provisioning/docker-compose) |
| Native Node | The project runs directly on Node | [Locked dependency setup](/configuration/provisioning/node#node-js-projects) |

## Ownership and values

**Owner:** committed repository scripts and `.bakers/conductor.config.js` → `hooks`. Project requirements determine whether provisioning is needed. All hook keys are optional; omitted hooks do nothing. If used, each value is a repeatable shell command on the conductor's `PATH`, running in the ticket worktree.

For an npm project with a lockfile, merge this fragment into the conductor config:

```js
hooks: { after_create: 'npm ci' },
```

The [hooks reference](/configuration/provisioning/hooks) owns lifecycle timing, available environment variables and addon listeners. `after_done` receives no ticket variables: cleanup must read a validated worktree-local identity.

## Verify and isolate

```sh
bakers config check --scope project
```

Then run the selected setup twice in a disposable worktree, run the application's readiness checks, and inspect one dispatch. Give simultaneous tickets separate service identities, ports and data. Export needed data before destructive cleanup.

**Hook failures are logged and dispatch continues.** Put mandatory readiness checks in `WORKFLOW.md`, not only in hooks. Keep long-running development servers out of blocking setup hooks.

The [DDEV](/addons/ddev) and [Docker Compose](/addons/docker-compose) support libraries discover ports; installing them does not provision the environment. [Ports](/addons/ports) handles sharing, with the exposure considerations in [Security](/configuration/security#public-previews-and-ports).
