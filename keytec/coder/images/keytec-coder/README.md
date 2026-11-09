# keytec-coder workspace image

The image of the [keytec bakers-ddev template](../../templates/bakers-ddev/README.md): `coder-drupal-ddev-base` plus every tool a bakers.build box runs, installed as root under `/usr/local` at pinned versions. The home volume holds data only, so a rebuild keeps tools and versions as the image has them.

| Tool | Pin (`ARG`) | Installed as |
|---|---|---|
| bakers CLI | `BAKERS_VERSION` | npm, `/usr/local/lib/node_modules` |
| Codex | `CODEX_VERSION` | npm |
| Playwright | `PLAYWRIGHT_VERSION` | npm, with Chromium and its system libraries in `/opt/ms-playwright` |
| Claude Code | `CLAUDE_VERSION` | native build, `/usr/local/bin/claude` |
| herdr | `HERDR_VERSION` | binary |
| cursor-agent | `CURSOR_VERSION` | `/usr/local/share/cursor-agent/<version>` |
| gh, glab, cloudflared, frpc | `GH_VERSION`, `GLAB_VERSION`, `CLOUDFLARED_VERSION`, `FRP_VERSION` | binaries |
| ss | Ubuntu `iproute2` | apt |

DDEV, Docker, Node 22 and the entrypoint come from the base (`BASE_IMAGE`, default `git.key-tec.de:5050/keytec/infra/coder-drupal-ddev-base:3.2.5`). DDEV's own images are not pre-pulled.

The image also carries:

- `/etc/claude-code/managed-settings.json` ([`files/managed-settings.json`](files/managed-settings.json)): the keytec, bakers and mattpocock marketplaces, the enabled plugins and `DISABLE_AUTOUPDATER`. Managed settings win over a user's own.
- `/usr/local/share/bakers-ddev/codex-config.toml`: copied to `~/.codex/config.toml` by the start script when missing.
- `/usr/local/share/bakers-ddev/smoke.sh`: checks every tool's version and launches Chromium headless.

Nothing updates itself on start (`DISABLE_AUTOUPDATER=1`, no installer in the start script).

## Build

```sh
cd coder/images/keytec-coder
docker build --platform linux/amd64 -t keytec-coder:dev .
docker run --rm --platform linux/amd64 keytec-coder:dev /usr/local/share/bakers-ddev/smoke.sh
```

The build needs pull access to `git.key-tec.de:5050`. CI runs the same build and smoke test, pushes the image and reports its digest ([`ci/keytec-coder.gitlab-ci.yml`](../../../ci/keytec-coder.gitlab-ci.yml)).

## Bumping a version

1. Change the `ARG` in the [`Dockerfile`](Dockerfile) and the expected version in [`files/smoke.sh`](files/smoke.sh).
2. Raise `KEYTEC_CODER_IMAGE_VERSION` in `ci/keytec-coder.gitlab-ci.yml`.
3. Merge to `main`: the pipeline builds, tests and pushes, and prints the new `image = …@sha256:…`.
4. Push the template with that digest and restart the workspaces.
