# Moving this folder to keytec/infra

This folder holds keytec's bakers-ddev Coder image and template. It was built in the bakers.build repository and belongs in `git.key-tec.de/keytec/infra`, whose layout it mirrors. The template is forked from bakers.build's `coder/bakers-ddev` at `0633e1e4d21ee420a1d0fc3eae2114750eb103bd`; later changes there reach this fork only by a manual diff:

```sh
git -C <bakers-build> diff 0633e1e4d21ee420a1d0fc3eae2114750eb103bd..origin/next -- coder/bakers-ddev
```

## 1. Copy

Every file keeps its path below `keytec/`:

| From (bakers.build) | To (keytec/infra) |
|---|---|
| `keytec/ci/bakers-ddev.gitlab-ci.yml` | `ci/bakers-ddev.gitlab-ci.yml` |
| `keytec/coder/images/bakers-ddev/Dockerfile` | `coder/images/bakers-ddev/Dockerfile` |
| `keytec/coder/images/bakers-ddev/README.md` | `coder/images/bakers-ddev/README.md` |
| `keytec/coder/images/bakers-ddev/files/managed-settings.json` | `coder/images/bakers-ddev/files/managed-settings.json` |
| `keytec/coder/images/bakers-ddev/files/codex-config.toml` | `coder/images/bakers-ddev/files/codex-config.toml` |
| `keytec/coder/images/bakers-ddev/files/smoke.sh` | `coder/images/bakers-ddev/files/smoke.sh` |
| `keytec/coder/templates/bakers-ddev/template.tf` | `coder/templates/bakers-ddev/template.tf` |
| `keytec/coder/templates/bakers-ddev/README.md` | `coder/templates/bakers-ddev/README.md` |
| `keytec/coder/templates/bakers-ddev/pm-bot.compose.yaml` | `coder/templates/bakers-ddev/pm-bot.compose.yaml` |
| `keytec/coder/templates/bakers-ddev/scripts/*` (install.sh, git-setup.sh, bakers-setup.sh, projects.sh, frp-setup.sh, frp-config.mjs, machine-config.mjs, health.sh, pm-bot.sh, conductors.sh) | `coder/templates/bakers-ddev/scripts/` |
| `keytec/coder/templates/bakers-ddev/tests/*` (run.sh, lib.sh, *.test.sh, template.tftest.hcl) | `coder/templates/bakers-ddev/tests/` |
| `keytec/MOVE.md` | not copied; this guide |

```sh
cd <keytec-infra>
cp -R <bakers-build>/keytec/ci <bakers-build>/keytec/coder .
```

After the copy, `tests/frp-setup.test.sh` no longer finds addon-ports-frp's validator in the bakers.build checkout and skips that one check; set `PORTS_FRP_JS=<bakers-build>/bakers-cli/addons/ports-frp/src/frp.ts` to keep it. Optionally add the template tests to infra's `validate-stacks` job, or a job of their own on `node:22` with `bash`, `git` and `terraform`.

## 2. CI include

Add to infra's `.gitlab-ci.yml`:

```yaml
include:
  - local: "templates/docker-compose-deploy.yml"
  - local: "ci/bakers-ddev.gitlab-ci.yml"
```

The job extends infra's `.docker_image_build` (stage `build`, runner tag `parallel`, registry login) and uses `DDEV_BASE_IMAGE_VERSION` for its base. Its own version is `BAKERS_DDEV_IMAGE_VERSION` in the included file. It runs on `main` when `ci/bakers-ddev.gitlab-ci.yml` or `coder/images/bakers-ddev/**` changes. It builds `coder-bakers-ddev:<version>`, runs the smoke test, pushes, and writes the digest to the `digest.txt` artifact and the job log.

## 3. First image

Merge to `main` and take the `image = …@sha256:…` line from the job log. Before the move, or without CI, the same by hand:

```sh
docker login git.key-tec.de:5050
cd coder/images/bakers-ddev
docker build --platform linux/amd64 -t git.key-tec.de:5050/keytec/infra/coder-bakers-ddev:1.0.0 .
docker run --rm --platform linux/amd64 git.key-tec.de:5050/keytec/infra/coder-bakers-ddev:1.0.0 /usr/local/share/bakers-ddev/smoke.sh
docker push git.key-tec.de:5050/keytec/infra/coder-bakers-ddev:1.0.0
docker inspect --format '{{index .RepoDigests 0}}' git.key-tec.de:5050/keytec/infra/coder-bakers-ddev:1.0.0
```

## 4. Push the template

```sh
docker buildx imagetools inspect ghcr.io/bakers-build/bakers-build/pm-bot:<tag> --format '{{.Manifest.Digest}}'
coder templates push bakers-ddev -d coder/templates/bakers-ddev \
  --variable image=git.key-tec.de:5050/keytec/infra/coder-bakers-ddev:1.0.0@sha256:<digest> \
  --variable pm_bot_image=ghcr.io/bakers-build/bakers-build/pm-bot:<tag>@sha256:<digest>
```

No tool version variables. A reference without `@sha256:` fails the push.

## 5. First workspace

Fill these parameters (sensitive ones are masked):

| Parameter | Value |
|---|---|
| `github_token` | GitHub service account token (`repo`) |
| `gitlab_token` | `git.key-tec.de` service account token (`api`, `write_repository`) |
| `git_user_name`, `git_user_email` | The service identity (defaults below) |
| `bakers_client_id`, `bakers_client_secret` | The box's bakers.build OAuth client (client credentials) |
| `projects` | HTTPS URLs of the projects to check out |
| `frp_enrollment` | The box's `bkfrp1.…` string: base64url JSON `{"server":"frps.preview.bakers.build","port":7000,"zone":"frps.preview.bakers.build","user":"<box>","token":"<from Vault secret/infrastructure/frp>"}` until `bakers ports setup frp` exists |
| `pm_bot_*` | As in the [template README › PM bot](coder/templates/bakers-ddev/README.md#pm-bot) |

```sh
coder create <box> --template bakers-ddev   # the form asks for the parameters
```

## 6. Defaults to check

Values this branch could not confirm; each is a default you can change without a rebuild unless noted:

| Value | Where | Set to |
|---|---|---|
| Commit identity `keytec bakers` / `bakers@keytec.de` | `git_user_*` parameter defaults, `template.tf` | The service account's real name and email |
| bakers.build instance `https://app.bakers.build` | `locals.bakers_url`, `template.tf` | keytec's instance |
| Enabled plugins (`keytec-base`, `keytec-drupal`, `keytec-qa`, `bakers`, `mattpocock-skills`, `superpowers`) and marketplaces | `files/managed-settings.json` (rebuild) | What keytec boxes run with; the `managed-settings.json` keys were written for Claude Code 2.1 |
| Codex `check_for_update_on_startup = false` | `files/codex-config.toml` (rebuild) | Confirm the key for the pinned Codex |
| infra's `DDEV_BASE_IMAGE_VERSION` | infra's `.gitlab-ci.yml` variables | The job builds on `coder-drupal-ddev-base:$DDEV_BASE_IMAGE_VERSION`; it must name a tag infra has pushed |
| Registry login of `.docker_image_build` | infra's CI template | The job pushes to `git.key-tec.de:5050` only if `.docker_image_build` logs in there; check it still does |
| The frps certificate | frps host (`/opt/frp/tls`) | Must verify against the system CA bundle, since `frpc.json` trusts `/etc/ssl/certs/ca-certificates.crt`. A private CA does not, until it is in the image |

## 7. Operator checks

On a workspace created as in step 5:

1. **Conductor (AC-1):** bakers.build shows the box's conductor online; the dashboard's *Conductor* item says `<checkout> online`.
2. **PM bot (AC-2):** mention the bot in its Slack channel; it answers.
3. **Git (AC-3):** in a run or `coder ssh`, clone, commit and push to a GitHub and a `git.key-tec.de` test project; `git log -1` shows the service identity. No `gh`/`glab` login by hand.
4. **Previews (AC-4):** `bakers ports up web` in a DDEV project returns an `https://…frps.preview.bakers.build` URL; a run's environment has `BB_TUNNEL=1`.
5. **Nothing by hand (AC-5), no installs (AC-6):** `/tmp/coder-startup-script.log` of the first start has no download or install line, only `git:`, `bakers:`, `projects:`, `frp:`, `machine-config:`, `codex:`, `herdr:`, `pm-bot:`, `conductors:` and `health:` lines.
6. **Rebuild (AC-7):** rebuild the workspace on the same template version, repeat 1 to 4, then `NODE_PATH=/usr/local/lib/node_modules node -e "require('playwright').chromium.launch().then(b => b.close())"` succeeds with no browser download.
7. **Health (AC-10):** the dashboard shows *PM bot*, *PM bot poller* and *Conductor*. `docker compose -p pm-bot stop`; *PM bot* shows `down` within a minute. `docker compose -p pm-bot start` afterwards.

When the move is done, delete `keytec/` from the bakers.build repository.
