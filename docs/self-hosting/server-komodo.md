---
title: Server
description: For operators - what a bakers.build control plane consists of, how the repository tests and deploys it with Komodo, first install, sign-in and access, updates, releases and their image versions, verification, failure diagnosis and rollback.
---

# Server

A bakers.build control plane is a Drupal site deployed as one Docker Compose stack; this page is for the operator who provisions, updates or recovers it. Workstation setup needs none of this.

## What runs

`docker-compose.yml` in the repository root is the ingress-agnostic base. Its services:

| Service | Role |
|---|---|
| `init-perms` | One-shot root container that fixes ownership of the file volumes before PHP starts. |
| `db` | MariaDB 10.11 on the `db` volume, with a health check. |
| `deploy` | One-shot update: `drush deploy` (database updates, configuration import, cache rebuild, deploy hooks), then code-defined entity schema changes and OAuth key generation. It never installs. |
| `install` | First install only. Profile-gated, so it never starts on a normal `up`. |
| `php`, `nginx`, `cron` | The site, its web server and a `drush core:cron` loop (`CRON_INTERVAL`, default 300 seconds). They start only after `deploy` exits successfully. |

Volumes hold the database, public files, private files, `/tmp` and the OAuth keys. Ingress is the overlay `docker-compose.traefik.yml` in both stacks' `file_paths`. Each host runs Traefik on the external network `traefik_proxy` with Let's Encrypt certificates through the TLS-ALPN challenge, so DNS must point straight at the host (Cloudflare: DNS only). `nginx` limits the open MCP client registration `/oauth/register` to 10 requests a minute with a burst of 5, one budget for all clients behind Traefik.

## Deployment path

The repository tests and deploys through GitLab CI and Komodo; the images the merge gate tested are the images that deploy:

1. A merge request push runs only the fast checks (lint, static analysis, CLI tests, contracts).
2. Before the merge, the merge step plays the manual `gate` job. It refuses a branch not up to date with its target. `build` then builds `php`, `nginx` and the test images `php-test` and `e2e` once as `:tree-<git tree hash>`, and `phpunit`, `e2e` and `config_install` test them in parallel. *Pipelines must succeed* blocks the merge until all are green.
3. On a `develop` or `main` push, `promote` tags the images of the commit's tree `:<branch>`, which the stack pulls, and `:<commit-sha>`: same digests, no rebuild. A merged up-to-date branch keeps its tree. Without a tree image, `promote` fails: that commit skipped the gate.
4. The `deploy` job runs `keytec-ai deployer deploy`, a Komodo DeployStack it polls. `scripts/deploy/deploy-report.mjs` then prints the deployed commit and the server's `deploy` service log with its exit state, and smoke-checks TLS, the sign-in page, OAuth discovery and `/mcp`, retrying for up to three minutes; any failure fails the job. `develop` deploys the stack `bakers-develop` to `https://develop.dev.bakers.build` (server `dev2`), `main` deploys `bakers-prod` to `https://app.bakers.build` (server `bakers-prod`).
5. The stacks are declared in git in `komodo/bakers.toml`, one `[[stack]]` per branch, and created by a Komodo Resource Sync. Each stack sets the server, repository and branch, `file_paths`, the domain, `STACK_NAME`, `DB_*`, the image references and its secrets.

The pipeline needs the masked, protected project variables `KOMODO_URL`, `KOMODO_API_KEY`, `KOMODO_API_SECRET` and `NPM_TOKEN`. They reach only protected refs (`develop`, `main`, tags `v*`), so a feature branch can neither deploy nor publish. Komodo pulls the images with a project deploy token (`read_registry`), the stack's `registry_account`.

Secrets are Komodo Variables referenced as `[[NAME]]` in the stack environment. `keytec-ai deployer provision-secrets` creates missing ones as random hex, idempotently. `MAIL_SMTP_DSN` and `MAIL_FROM_ADDRESS` must be real, or outbound mail and with it passwordless sign-in break; `MAIL_FROM_NAME` is `bakers.build`. The Google sign-in variables stay empty until a Google client is registered for the host. Keep an intentionally empty variable non-secret: Komodo redacts secret values, and an empty secret breaks the deploy.

To add an installation, first agree DNS, TLS, storage, backups and secret ownership. Copy a `[[stack]]` in `komodo/bakers.toml`; change name, server, branch, domain, images and variable names (`[A-Za-z0-9_]`). Run `keytec-ai deployer provision-secrets`, review the Resource Sync diff, and sync before the first deploy and any `file_paths` change, or the stack can lose its ingress and answer 404 everywhere. Then point DNS and push the branch.

## Outbound mail

Every mail goes through the `bb_html_mail` backend: a branded HTML part plus a plain-text alternative. Without `MAIL_SMTP_DSN` it uses local sendmail; with it, `settings.komodo.php` sets only the SMTP transport. A per-module or per-key entry under `system.mail` › `interface` sends that mail without the template. When a mail arrives as plain text only, check:

```sh
drush config:get system.mail --include-overridden
```

The account mail texts at `/admin/config/people/accounts` follow three conventions that shape the HTML part:

- A first line `# Headline` becomes the heading; the subject keeps the product name.
- A line `Label: [token-url]` becomes a button named *Label*. Each mail has at most one link.
- A paragraph that is only the login code is shown in a box.

The plain-text part keeps every line as written, without the `#`.

## First install

A new environment is installed once, deliberately, on the host, from the stack directory:

```sh
docker compose --profile install run --rm install
```

This runs `site:install --existing-config`, which drops and recreates the database from `config/sync`, then the deploy hooks and OAuth key generation. Never run it against a live site. The new environment is empty: no content, no users besides the first admin.

The first `deploy` job on an empty environment fails by design: the `deploy` service refuses an uninstalled site. Install, then re-run it.

The first admin signs in once with a one-time link and then creates the first workspace and accounts in the web UI:

```sh
docker compose exec php drush uli
```

## Sign-in and access

The install creates one OAuth consumer, and deploys never touch consumers. Manage them in the Drupal consumers UI at `/admin/config/services/consumer`.

- **Device code and browser sign-in.** A shared public consumer `bakers-cli` has no secret; a person signs the CLI in with `bakers init`. `device_code` is the default and works over SSH and in containers.
- **Service identities.** A user creates a key in the web UI and connects with `client_credentials` ([API keys](/provision/security/credentials)).
- **MCP clients.** Claude and other MCP clients register themselves at `/oauth/register`.
- **Scope and rows.** Every token carries the umbrella scope `bb_session`, which is a ceiling. What a token reaches comes from the account's workspace membership and rank, so add each user to the right workspace and projects.
- **Web sign-in.** Passwordless sign-in by mail works out of the box. Google sign-in needs `BB_OAUTH_GOOGLE_CLIENT_ID` and `BB_OAUTH_GOOGLE_CLIENT_SECRET`, registered for the host's own redirect URI; both are empty at launch.

Give users the server URL and their login method through a private channel. They connect with `bakers init --base-url https://<your-domain>` ([Connections](/configuration/connector/connections)).

## Update

1. Record the deployed and target release. Back up the database and the file volumes, and the OAuth key volume.
2. Merge through the gate; the pipeline promotes and deploys. To re-run the `deploy` service by hand, run `docker compose up -d` in the stack directory on the host.
3. The `deploy` service applies database updates and imports `config/sync`. Configuration and schema changes travel only this way; never patch a live server with `drush`.
4. Verify, as below.

## Release

CLI and server share one version, held only in the `v*` tag. A release is the prod deployment of a `deploy-and-release` ticket ([Release](/addons/deployment/reference#release)):

1. The ticket branch `release/<identifier>`, reset to the frozen `develop` SHA with no commit of its own, merges into `main` through one merge request, its gate and a merge commit; the gate builds and tests the images of the branch's tree. The pipeline promotes them and deploys prod.
2. The `release` job derives the version from the Conventional Commits merge request titles since the last version tag (`release:version`), tags `v0.2.0` on the merge's second parent, the frozen `develop` commit, and creates the GitLab release with the generated notes. A tagged commit or a range without `feat`, `fix` or breaking commit releases nothing.
3. The tag pipeline's `publish:npm` publishes `@bakers-build/bakers` and its packages as `latest`, and `release_images` tags that commit's `:tree-<tree>` images `php` and `nginx` as `:0.2.0` and `:latest`. Never publish by hand.

Nothing merges back: `develop` already contains the tagged commit.

`php:0.2.0` is the server of `@bakers-build/bakers@0.2.0`. Release images carry the labels `org.opencontainers.image.version` and `org.opencontainers.image.revision`: the layers equal the deployed `:<commit-sha>`, the digest differs. `docker inspect <image>` shows them for what a host runs. The registry cleanup policy deletes `tree-*` tags after 30 days.

Every `develop` deploy also publishes the CLI under the dist-tag `next` (`<next patch>-next.<pipeline number>`), matching the commit on dev.

## Verify

By hand:

```sh
node scripts/deploy/deploy-report.mjs --smoke-only https://<your-domain>
bakers config check --scope all --online
```

The online check proves sign-in and workspace access; then run a small ticket through an oven.

## Diagnose a failed deploy

If every path answers a plain-text `404 page not found`, the containers are not running: `php`, `nginx` and `cron` stay in state `Created` when `deploy` exits non-zero. On the host:

```sh
docker ps -a --format '{{.Names}}\t{{.Status}}' | grep <stack>
docker logs <stack>-deploy-1 2>&1 | tail -60
cd /etc/komodo/stacks/<stack> && docker compose up -d
```

A `Lock wait timeout exceeded` during configuration import is transient: retry with `docker compose up -d`. A PHP `Allowed memory size` failure is not a host out-of-memory kill; check the log and `State.OOMKilled` before changing capacity, and keep the CLI's 384 MiB ceiling.

## Roll back

Every release has a `:<version>` tag and every deployed commit a `:<commit-sha>` tag; the `deploy` job log names the deployed commit. To roll back code at once, set the stack's `REGISTRY_IMAGE_PHP` and `REGISTRY_IMAGE_NGINX` in Komodo to the last good version, such as `:0.1.0` (on dev: the last good `:<commit-sha>`), and redeploy the stack. The next Resource Sync puts `:<branch>` back, so follow up with a revert merge request. Database updates do not reverse themselves: when a release changed schema or data, restore the backups from step 1 of the update, redeploy the matching code and verify again. Record the recovery that worked.
