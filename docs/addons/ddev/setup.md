# Set up DDEV

**Install DDEV and give each ticket worktree its own DDEV project, through hooks.**

## AI first

```text
Read https://bakers.build/addons/ddev/setup.
Read this repository’s DDEV setup. Propose repeatable per-ticket setup,
readiness and cleanup using this reference. Explain data deletion and
isolation, then confirm exact hook commands before wiring them with bb-init-
project.
```

## Install DDEV

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

3. **Connect the project through hooks.** Use the repository's documented provisioning script in [lifecycle hooks](/provision/hooks). Each ticket worktree needs its own DDEV project identity; reusing one name can make tickets share or replace the same environment.

   Keep the script repeatable. Required readiness checks belong in `WORKFLOW.md`: a failed hook is logged but does not stop dispatch.

**Done when:** Docker and DDEV work as the worker user, and the project's documented setup and readiness checks pass in a ticket worktree.

## Example: one DDEV project per ticket

**For a repository with an existing `.ddev/config.yaml`.** Merge these entries into `hooks` in `.bakers/conductor.config.js`:

```js
hooks: {
  after_create: 'sh scripts/prepare-ddev.sh',
  after_done: 'sh scripts/cleanup-ddev.sh',
  on_freeze: 'ddev stop',
  on_resume: 'ddev start',
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

## Provision on an agent's request

**For agents that need a running site.** The [`provision_up` hook](/provision/hooks#provision-on-an-agent-s-request) gives runs a tool that brings the site up. Merge a command per profile into `hooks`:

```js
hooks: {
  provision_up: {
    test: 'sh scripts/provision.sh test',
  },
},
```

Create `scripts/provision.sh`. It needs `jq` and `curl` on the host:

```sh
set -eu
profile="${1:?usage: provision.sh <profile>}"
marker=.ddev/.bakers-profile

ready() {
  url=$(ddev describe -j 2>/dev/null | jq -r 'select(.raw.status == "running") | .raw.primary_url' || true)
  [ -n "$url" ] || return 1
  code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 20 "$url" || true)
  [ "${code:-0}" -ge 100 ] && [ "$code" -lt 500 ]
}

if [ "$(cat "$marker" 2>/dev/null || true)" = "$profile" ]; then
  if ready; then echo "ready $url"; exit 0; fi
  if ddev start && ready; then echo "started $url"; exit 0; fi
fi
rm -f "$marker"
ddev start
sh scripts/install.sh "$profile"
if ! ready; then echo "Site does not answer: ${url:-not running}" >&2; exit 1; fi
echo "$profile" > "$marker"
echo "installed $url"
```

- **Ready site:** a running site of the requested profile whose URL answers is reused without any change.
- **Marker:** `.ddev/.bakers-profile` records the installed profile. Add it to `.gitignore`. Anything else that reinstalls the site should delete it.
- **Install step:** replace `scripts/install.sh` with your repository's install or import for the profile.
- **Local certificate:** `curl -k` accepts DDEV's local certificate even when the host does not trust it.

[Hook lifecycle and environment →](/provision/hooks)
