---
title: Server
description: For operators - what a bakers.build control plane consists of, how the repository deploys it with Komodo, first install, sign-in and access, updates, releases, verification, failure diagnosis and rollback.
---

# Server

A bakers.build control plane is a Drupal site deployed as one Docker Compose stack; this page is for the operator who provisions, updates or recovers it.

Workstation setup needs an existing server and none of this.

## What runs

`docker-compose.yml` in the repository root is the ingress-agnostic base. Its services:

| Service | Role |
|---|---|
| `init-perms` | One-shot root container that fixes ownership of the file volumes before PHP starts. |
| `db` | MariaDB 10.11 on the `db` volume, with a health check. |
| `deploy` | One-shot update: `drush deploy` (database updates, configuration import, cache rebuild, deploy hooks), then code-defined entity schema changes and OAuth key generation. It never installs. |
| `install` | First install only. Profile-gated, so it never starts on a normal `up`. |
| `php`, `nginx`, `cron` | The site, its web server and a `drush core:cron` loop (`CRON_INTERVAL`, default 300 seconds). They start only after `deploy` exits successfully. |

Volumes hold the database, public files, private files, `/tmp` and the OAuth keys. Ingress is the overlay `docker-compose.traefik.yml`, which both stacks list in their `file_paths`. Each host runs Traefik on the external network `traefik_proxy` and gets its certificate from Let's Encrypt through the TLS-ALPN challenge, so the DNS record must point straight at the host (in Cloudflare: DNS only, not proxied). `nginx` limits `/oauth/register`, the open client registration for MCP clients, to 10 requests a minute with a burst of 5; behind Traefik that is one budget for all clients.

## Deployment path

The repository deploys through GitLab CI and Komodo:

1. The `build` job builds the `php`, `nginx` and `mcp` images and pushes each twice: as `:<branch>`, which the stack pulls, and as `:<commit-sha>`, for rollback.
2. The `deploy` job runs `keytec-ai deployer deploy`, which starts a Komodo DeployStack and polls it. Then `scripts/deploy/deploy-report.mjs` prints the deployed commit, the log of the server's `deploy` service and its exit state, and smoke-checks the host: valid TLS and the sign-in page, OAuth discovery, and `/mcp` answering from the MCP service. Any failure fails the job. It runs for the fixed branches: `develop` deploys the stack `bakers-develop` to `https://develop.dev.bakers.build` (server `dev2`), `main` deploys `bakers-prod` to `https://app.bakers.build` (server `bakers-prod`).
3. The stacks are declared in git in `komodo/bakers.toml`, one `[[stack]]` per branch, and created by a Komodo Resource Sync. Each stack sets the server, repository and branch, `file_paths`, the domain, `STACK_NAME`, `DB_*`, the image references and its secrets.

The pipeline needs the project variables `KOMODO_URL`, `KOMODO_API_KEY`, `KOMODO_API_SECRET` and `NPM_TOKEN`, masked and protected. Protected variables reach only pipelines on protected refs, so `develop`, `main` and the tags `v*` are protected: a feature branch can neither deploy nor publish. Komodo pulls the images with a project deploy token (`read_registry`), registered in Komodo as the stack's `registry_account`.

Secrets are Komodo Variables referenced as `[[NAME]]` in the stack environment. `keytec-ai deployer provision-secrets` creates missing ones as random hex, idempotently. The SMTP values `MAIL_SMTP_DSN` and `MAIL_FROM_ADDRESS` must be real, because a random value breaks outbound mail and with it passwordless sign-in; `MAIL_FROM_NAME` is `bakers.build`. The Google sign-in variables stay empty until a Google client is registered for the host.

To provision another installation, copy a `[[stack]]` from `komodo/bakers.toml` and change the server, domain, branch, image references and variable names, and use the `keytec-drupal-deploy` skill for the Komodo setup. Agree DNS and TLS, storage, backups and secret ownership first. Run the Resource Sync before the first deploy, and again before any deploy that changes `file_paths`; otherwise a running stack can lose its ingress overlay and answer 404 on every path.

## Outbound mail

Every mail bakers.build sends goes through the `bb_html_mail` backend: a branded HTML part and a plain-text alternative in one message. Without `MAIL_SMTP_DSN` it delivers through local sendmail; with it, `settings.komodo.php` sets only the SMTP transport and keeps the backend. A per-module or per-key entry under `system.mail` › `interface` overrides the default and sends that mail without the template. When a mail arrives as plain text only, check the effective configuration:

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

The first `deploy` job on an empty environment fails by design, because the `deploy` service refuses an uninstalled site. Install, then re-run the job.

The first admin signs in once with a one-time link and then creates the first workspace and accounts in the web UI:

```sh
docker compose exec php drush uli
```

## Sign-in and access

The install creates one OAuth consumer, and deploys never touch consumers. Manage them in the Drupal consumers UI at `/admin/config/services/consumer`.

- **Device code and browser sign-in.** A shared public consumer `bakers-cli` has no secret; a person signs the CLI in with `bakers init`. `device_code` is the default and works over SSH and in containers.
- **Service identities.** A user creates a key in the web UI and connects with `client_credentials` ([API keys](/advanced/api-keys)).
- **MCP clients.** Claude and other MCP clients register themselves at `/oauth/register`.
- **Scope and rows.** Every token carries the umbrella scope `bb_session`, which is a ceiling. What a token reaches comes from the account's workspace membership and rank, so add each user to the right workspace and projects.
- **Web sign-in.** Passwordless sign-in by mail works out of the box. Google sign-in needs `BB_OAUTH_GOOGLE_CLIENT_ID` and `BB_OAUTH_GOOGLE_CLIENT_SECRET`, registered for the host's own redirect URI; both are empty at launch.

Give users the server URL and their login method through a private channel. They connect with `bakers init --base-url https://<your-domain>` ([Connections](/advanced/connections)).

## Update

1. Record the deployed and target release. Back up the database and the file volumes, and the OAuth key volume.
2. Merge to the deploy branch. The pipeline builds and deploys. To re-run the `deploy` service by hand, run `docker compose up -d` in the stack directory on the host.
3. The `deploy` service applies database updates and imports `config/sync`. Configuration and schema changes travel only this way; never patch a live server with `drush`.
4. Verify, as below.

## Release

CLI and server share one version. A release is the merge of `develop` into `main`:

1. On `develop`, generate the entry and open it as a normal merge request:

   ```sh
   GITLAB_TOKEN=$(glab config get token --host <gitlab host>) node bakers-cli/scripts/changelog.mjs 0.2.0
   ```

   It prepends `## 0.2.0` to `CHANGELOG.md`: one line per merge request merged since the last version tag, with the MR title, split into **CLI** (the MR touched `bakers-cli/`) and **Server** (everything else). The MR's label picks the group: `breaking`, `feature`, `bug` or `maintenance`. MRs without one of these labels, such as documentation, are left out, and the script lists them; label them and run it again if they belong in the release notes. Correct the wording in the merge request.
2. Merge `develop` into `main`. The pipeline deploys prod; then the `release` job tags `v0.2.0` and creates the GitLab release with that entry. A `main` push whose CHANGELOG version is already tagged releases nothing.
3. The tag pipeline's `publish:npm` publishes `@bakers-build/bakers` and its packages as `latest`. Never publish by hand.

Every `develop` deploy also publishes a test build under the dist-tag `next`, at `<next patch>-next.<pipeline number>`, so `npm install -g @bakers-build/bakers@next` matches the commit on dev.

## Verify

The `deploy` job already prints the `deploy` service log and the smoke checks. By hand:

```sh
node scripts/deploy/deploy-report.mjs --smoke-only https://<your-domain>
bakers config check --scope all --online
```

The online check proves sign-in and workspace access. Then run a small ticket through an oven and confirm a run appears.

## Diagnose a failed deploy

If every path answers a plain-text `404 page not found`, the containers are not running: `php`, `nginx` and `cron` stay in state `Created` when `deploy` exits non-zero. On the host:

```sh
docker ps -a --format '{{.Names}}\t{{.Status}}' | grep <stack>
docker logs <stack>-deploy-1 2>&1 | tail -60
cd /etc/komodo/stacks/<stack> && docker compose up -d
```

The `deploy` job prints the `deploy` service log; on the host, `docker logs` shows the same. A `Lock wait timeout exceeded` during configuration import is transient: retry with `docker compose up -d`. A PHP `Allowed memory size` failure is not a host out-of-memory kill; check the log and `State.OOMKilled` before changing capacity, and keep the CLI's 384 MiB ceiling.

## Roll back

Every build also carries a `:<commit-sha>` tag, and the `deploy` job log names the deployed commit. To roll back code at once, set the stack's `REGISTRY_IMAGE_PHP`, `REGISTRY_IMAGE_NGINX` and `REGISTRY_IMAGE_MCP` in Komodo to the last good `:<commit-sha>` and redeploy the stack. The next Resource Sync puts `:<branch>` back, so follow up with a revert on the deploy branch and let the pipeline rebuild and redeploy. Database updates do not reverse themselves: when a release changed the schema or data, restore the database and file backups taken in step 1 of the update, redeploy the matching code and verify again. Keep the failed check visible and record the recovery procedure that worked.
