---
title: Server
description: For operators - what a bakers.build control plane consists of, how the repository deploys it with Komodo, first install, sign-in and access, updates, verification, failure diagnosis and rollback.
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

Volumes hold the database, public files, private files, `/tmp` and the OAuth keys. Ingress is a per-host overlay: `docker-compose.traefik.yml` for Traefik hosts or `docker-compose.caddy.yml` for caddy-docker-proxy hosts. Each stack lists exactly one overlay in its `file_paths`.

## Deployment path

The repository deploys through GitLab CI and Komodo:

1. The `build` job builds the `php` and `nginx` images and pushes them to the project registry tagged `:<branch>`.
2. The `deploy` job runs `keytec-ai deployer deploy`, which starts a Komodo DeployStack and polls it. It runs for the fixed branches: `develop` deploys the stack `bakers-develop`, `main` deploys `bakers-prod`.
3. The stacks are declared in git in `komodo/bakers.toml`, one `[[stack]]` per branch, and created by a Komodo Resource Sync. Each stack sets the server, repository and branch, `file_paths`, the domain, `STACK_NAME`, `DB_*`, the image references and its secrets.

Secrets are Komodo Variables referenced as `[[NAME]]` in the stack environment. `keytec-ai deployer provision-secrets` creates missing ones as random hex, idempotently. Some values must be real: the GitLab API token, and the SMTP values `MAIL_SMTP_DSN`, `MAIL_FROM_ADDRESS` and `MAIL_FROM_NAME`. A random token breaks the GitLab import connector and a random SMTP value breaks outbound mail.

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

This runs `site:install --existing-config`, which drops and recreates the database, then an optional content recipe (`DEPLOY_CONTENT_RECIPE`; production leaves it unset and installs from `config/sync` only), the deploy hooks, OAuth key generation and the one-time consumer seed. Never run it against a live site.

## Sign-in and access

The install seeds the OAuth consumers once and never touches an existing one, so deploys cannot invalidate a working secret. Afterwards, manage consumers, including secret rotation, in the Drupal consumers UI at `/admin/config/services/consumer`.

- **Device code and browser sign-in.** A shared public consumer `bakers-cli` has no secret; a person signs the CLI in with `bakers init`. `device_code` is the default and works over SSH and in containers.
- **Service identities.** One confidential `client_credentials` consumer per team user, `bakers-<handle>`, with its secret read from the environment variable `BB_CONSUMER_SECRET_<HANDLE>`. A conductor on a server uses this profile.
- **Scope and rows.** Every token carries the umbrella scope `bb_session`, which is a ceiling. What a token reaches comes from the account's workspace membership and rank, so add each user to the right workspace and projects.
- **Web sign-in.** Google sign-in needs `BB_OAUTH_GOOGLE_CLIENT_ID` and `BB_OAUTH_GOOGLE_CLIENT_SECRET`, registered for the host's own redirect URI.

Give users the server URL and their login method through a private channel. They connect with `bakers init --base-url https://<your-domain>` ([Connections](/advanced/connections)).

## Update

1. Record the deployed and target release. Back up the database and the file volumes, and the OAuth key volume.
2. Merge to the deploy branch. The pipeline builds and deploys. To re-run the `deploy` service by hand, run `docker compose up -d` in the stack directory on the host.
3. The `deploy` service applies database updates and imports `config/sync`. Configuration and schema changes travel only this way; never patch a live server with `drush`.
4. Verify, as below.

## Verify

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://<your-domain>/user/login
docker inspect <stack>-deploy-1 --format '{{.State.ExitCode}}'
bakers config check --scope all --online
```

Expect `200` and exit code `0`; the online check proves sign-in and workspace access. Then run a small ticket through a conductor and confirm a run appears.

## Diagnose a failed deploy

If every path answers a plain-text `404 page not found`, the containers are not running: `php`, `nginx` and `cron` stay in state `Created` when `deploy` exits non-zero. On the host:

```sh
docker ps -a --format '{{.Names}}\t{{.Status}}' | grep <stack>
docker logs <stack>-deploy-1 2>&1 | tail -60
cd /etc/komodo/stacks/<stack> && docker compose up -d
```

The pipeline trace shows only the Komodo orchestration; the real error is in the `deploy` log. A `Lock wait timeout exceeded` during configuration import is transient: retry with `docker compose up -d`. A PHP `Allowed memory size` failure is not a host out-of-memory kill; check the log and `State.OOMKilled` before changing capacity, and keep the CLI's 384 MiB ceiling.

## Roll back

Images carry only the moving `:<branch>` tag, so there is no earlier tag to select. To roll back code, revert the change on the deploy branch and let the pipeline rebuild and redeploy. Database updates do not reverse themselves: when a release changed the schema or data, restore the database and file backups taken in step 1 of the update, redeploy the matching code and verify again. Keep the failed check visible and record the recovery procedure that worked.
