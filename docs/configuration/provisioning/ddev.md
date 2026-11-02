# Set up DDEV

**Bring a container-based development environment.** DDEV is one option for your project; bakers.build does not require it.

- **DDEV** manages the project's development services.
- **Docker** provides the containers.
- **bakers.build hooks** call your project's setup commands for each ticket worktree.

## AI first

```text
Read https://bakers.build/configuration/provisioning/ddev.
Read this repository’s DDEV setup. Propose repeatable per-ticket setup,
readiness and cleanup using this reference. Explain data deletion and
isolation, then confirm exact hook commands before wiring them with bb-init-
project.
```

The reference below explains the commands and configuration changes.

**You need:** a non-root worker user, a Docker provider supported by DDEV, and a project that uses DDEV.

1. **Install and start Docker** using [DDEV's platform guide](https://docs.ddev.com/en/stable/users/install/docker-installation/). Check access as the worker user:

   ```sh
   docker info
   ```

   This must succeed without `sudo`. Resolve provider startup or user-access errors before continuing.

2. **Install DDEV** using its [official installation guide](https://docs.ddev.com/en/stable/users/install/ddev-installation/), then check:

   ```sh
   ddev version
   ```

3. **Connect the project through hooks.** Use the repository's documented provisioning script in [lifecycle hooks](/configuration/provisioning/hooks). Each ticket worktree needs its own DDEV project identity; reusing one name can make tickets share or replace the same environment.

   Keep the script repeatable. Required readiness checks belong in `WORKFLOW.md`: a failed hook is logged but does not stop dispatch.

**Done when:** Docker and DDEV work as the worker user, and the project's documented setup and readiness checks pass in a ticket worktree.

**Using another stack?** Keep your own tools and [connect them through hooks](/configuration/provisioning/hooks). No DDEV installation is needed.

## Example: one DDEV project per ticket

**For a repository with an existing `.ddev/config.yaml`.** Merge these entries into `hooks` in `.bakers/conductor.config.js`:

```js
hooks: {
  after_create: 'sh scripts/prepare-ddev.sh',
  after_done: 'sh scripts/cleanup-ddev.sh',
},
```

Create `scripts/prepare-ddev.sh`:

```sh
set -eu
: "${BB_ID:?bakers.build supplies the ticket UUID during dispatch}"
printf 'name: bakers-%s\n' "$BB_ID" > .ddev/config.zz-bakers.local.yaml
ddev start
```

Create `scripts/cleanup-ddev.sh`:

```sh
set -eu
name=$(sed -n 's/^name: //p' .ddev/config.zz-bakers.local.yaml)
ticket_id=${name#bakers-}
case "$ticket_id" in
  ''|*[!0-9a-f-]*) echo 'Invalid ticket identity; refusing cleanup' >&2; exit 1 ;;
esac
printf '%s\n' "$name" | grep -Eq '^bakers-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
ddev delete --omit-snapshot --yes --clean-containers=false "$name"
```

- **Isolated name:** the ticket UUID gives each worktree its own DDEV project. Repeated dispatches reuse that name.
- **Local override:** reserve this file for the hook and add `.ddev/config.zz-bakers.local.yaml` to the repository's `.gitignore`. It uses DDEV's [config overrides](https://docs.ddev.com/en/stable/users/extend/customization-extendibility/#extending-configyaml-with-custom-configyaml-files); no later override may replace the name.
- **Project-specific resources:** also isolate any fixed ports, extra hostnames or external services in your existing setup.
- **Cleanup:** the script validates the generated ticket identity and deletes that named project, including its database, without a prompt or snapshot. A missing or invalid override aborts deletion. Export data you need before cleanup. It needs no ticket variable; global container cleanup is disabled.
- **Keep the database instead?** Use `after_done: 'ddev stop'` to stop services without deleting their data.
- **Application setup:** add your repository's repeatable install/import steps after startup. Required readiness checks belong in `WORKFLOW.md`.

[Hook lifecycle and environment →](/configuration/provisioning/hooks)
