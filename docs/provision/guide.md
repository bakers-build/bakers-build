# Provisioning

Choose the environment during [project setup](/get-started/connect-a-project#set-up-your-environment), after choosing the client. Your repository's tooling prepares each ticket worktree. bakers.build invokes it through [lifecycle hooks](/provision/hooks); it does not supply a general container or native Node provisioner.

| Environment | Use when | Canonical example |
|---|---|---|
| Docker Compose | The project has a Compose application | [Isolated Compose projects](/provision/docker-compose) |
| Native Node | The project runs directly on Node | [Locked dependency setup](/provision/node#node-js-projects) |

## Ownership and values

**Owner:** committed repository scripts and `.bakers/conductor.config.js` → `hooks`. Project requirements determine whether provisioning is needed. All hook keys are optional; omitted hooks do nothing. If used, each value is a repeatable shell command on the conductor's `PATH`, running in the ticket worktree.

For an npm project with a lockfile, merge this fragment into the conductor config:

```js
hooks: { after_create: 'npm ci' },
```

The [hooks reference](/provision/hooks) owns lifecycle timing, available environment variables and addon listeners. `after_done` receives no ticket variables: cleanup must read a validated worktree-local identity.

## Verify and isolate

```sh
bakers config check --scope project
```

Then run the selected setup twice in a disposable worktree, run the application's readiness checks, and inspect one dispatch. Give simultaneous tickets separate service identities, ports and data. Export needed data before destructive cleanup.

**Hook failures are logged and dispatch continues.** Put mandatory readiness checks in `WORKFLOW.md`, not only in hooks. Keep long-running development servers out of blocking setup hooks.

Runtime addons and the [Docker Compose](/addons/docker-compose) support library discover ports; installing them does not provision the environment. [Ports](/addons/ports) handles sharing, with the exposure considerations in [Security](/security/access-and-data#public-previews-and-ports).
