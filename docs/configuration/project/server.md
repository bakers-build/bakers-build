---
title: Server
description: Install a standalone control plane from public release images with Docker Compose, Traefik HTTPS and persistent storage.
---

# Self-host the server

The control plane runs on one Linux Docker host. It does not require Coder, FRP,
Komodo, a private registry or a source build. Clients and workers are installed
separately through [Get started](/get-started/machine). Existing operator-managed
Komodo stacks retain their [current deployment procedure](/configuration/project/server-komodo).

A release is a GitHub release `vX.Y.Z` of
[`bakers-build/bakers-build`](https://github.com/bakers-build/bakers-build/releases).
Its public images are `ghcr.io/bakers-build/bakers-build/php:X.Y.Z` and
`ghcr.io/bakers-build/bakers-build/nginx:X.Y.Z`, pullable without a registry login. Install
only a release; `latest`, `main` and `next` are moving channel tags, and `next`
images are pre-release builds.

## AI first

```text
Read https://bakers.build/configuration/project/server.
Read this server reference and inspect the existing deployment. Explain
missing operator prerequisites, storage and secrets. Propose the documented
install or update steps and verification; wait for explicit deployment
authorization.
```

## Host and release inputs

Use a dedicated Linux Docker Engine host with Docker Compose v2.24.4 or newer,
on `amd64` (the release images are published for `linux/amd64` only), and enough disk for the
working data plus a separate backup. Select capacity based on your workload.
Provide a DNS hostname pointing directly to this host (including correct AAAA
records if present), inbound TCP 80/443, outbound HTTPS, and outbound access to
your SMTP service. Disable any upstream TLS termination for the documented
TLS-ALPN ACME challenge. Do not expose database or PHP ports.

Obtain these files from the same release tag, retaining paths, and pin both
images by digest:

```sh
set -euo pipefail
VERSION=X.Y.Z  # the selected release, without the leading v
for f in docker-compose.yml docker-compose.traefik.yml docker/self-host.yml docker/self-host.env.example; do
  curl -fsSL --create-dirs -o "$f" "https://raw.githubusercontent.com/bakers-build/bakers-build/v$VERSION/$f"
done
for image in php nginx; do
  docker buildx imagetools inspect "ghcr.io/bakers-build/bakers-build/$image:$VERSION" --format '{{.Name}}@{{.Manifest.Digest}}'; echo
done
```

No checkout build toolchain is needed. Put the files in a private installation
directory. Never run this path inside an existing operator's stack directory.
The following commands use Bash from that directory:

```sh
set -euo pipefail
umask 077
cp docker/self-host.env.example .env
chmod 600 .env
```

Edit `.env` before proceeding. Do not source it as a shell script. Compose reads
it directly; single-quote values containing `$` to avoid interpolation.

| Input | Value to provide |
|---|---|
| `COMPOSE_PROJECT_NAME` | Stable, unique project name; changing it selects different networks and volumes. |
| `STACK_NAME` | Unique router name, normally the same as the project name. |
| `DOMAIN`, `ACME_EMAIL` | Public hostname without scheme/path and certificate contact email. |
| `TRAEFIK_SUBNET` | Unused private IPv4 CIDR for this project's ingress network. Check host/VPN routes and existing Docker networks first; e.g. `172.30.42.0/24` only if free. |
| `REGISTRY_IMAGE_PHP`, `REGISTRY_IMAGE_NGINX` | The two pinned references printed above, e.g. `ghcr.io/bakers-build/bakers-build/php:X.Y.Z@sha256:…`. Both must come from the same release. |
| `TRAEFIK_IMAGE` | Versioned public Traefik image; the example selects `traefik:v3.6.1`. |
| `DB_NAME`, `DB_USER` | Application database and user. |
| `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `DRUPAL_HASH_SALT` | Three independent private random values, e.g. generate each with `openssl rand -hex 32`. Retain them across updates/restores. |
| `MAIL_SMTP_DSN`, `MAIL_FROM_ADDRESS` | Working SMTP URL and permitted sender. For example `smtp://user:password@smtp.example.org:587`; percent-encode credential characters. Use your provider's TLS settings; do not disable peer verification. |
| `BB_OAUTH_GOOGLE_CLIENT_ID`, `BB_OAUTH_GOOGLE_CLIENT_SECRET` | Optional Google login credentials for this domain; otherwise empty. |

Leave `COMPOSE_PROFILES` empty. The docs-site image is not required. Coder and FRP
are not part of this stack. MariaDB retains the base stack's pinned version;
the standalone helper is pinned in `docker/self-host.yml`.

Define this function in every operator shell used below:

```sh
dc() {
  docker compose --env-file .env -f docker-compose.yml \
    -f docker-compose.traefik.yml -f docker/self-host.yml "$@"
}
dc config -q
```

Missing required values fail before startup. Full `docker compose config` output
contains secrets; use `-q` for validation and keep diagnostic output private.
The self-host overlay forwards domain, SMTP and strict security settings to all
PHP services. Drupal accepts only `DOMAIN`, trusts forwarding only from the
selected ingress subnet, ignores forwarded host headers and requires a salt.
The DDEV and existing Komodo configuration paths retain their current behavior.

## First install — empty project only

Confirm this project has no existing data: inspect `dc ps -a` and
`docker volume ls` before running install. **The install service drops and
recreates the selected database. Never run it as an update or restore step.**

```sh
dc --profile install pull
dc --profile install run --rm install
dc up -d
dc ps -a
dc logs --tail 80 deploy
```

`install` is profile-gated. Normal startup runs the update-only `deploy` hook,
then PHP, Nginx and cron; a failed hook keeps application services from starting.
Named volumes preserve database, public/private files and OAuth signing keys.
The `/tmp` volume is disposable. Do not use `down -v` or volume pruning.

Traefik owns ports 80/443, redirects HTTP to HTTPS and requests/renews certificates
with Let's Encrypt through TLS-ALPN on port 443. Its `acme` volume preserves
certificate/account material. Its dashboard is disabled. The project-specific
ingress network is created by Compose; no pre-existing company network is needed.
Traefik discovers only this project's labelled containers. Its Docker socket
mount is read-only, but Docker API access is still privileged: use a dedicated
host and do not give untrusted containers access to that socket or ingress network.

Obtain the first administrator's one-time login link privately:

```sh
dc exec php /var/www/html/vendor/bin/drush --uri="https://YOUR_DOMAIN" uli
```

Replace `YOUR_DOMAIN` with the configured hostname. Open the link, configure the
owner's email, and create the initial workspace and memberships. Verify normal
passwordless sign-in by receiving a real email. Google login is optional. Existing
application permissions remain authoritative; do not give ordinary members admin
rights to bypass an access failure. Connect clients with
`bakers init --base-url https://YOUR_DOMAIN`.

## Verify before opening access

Check HTTP redirects to HTTPS, the certificate matches the hostname, the sign-in
page and mail links use HTTPS, and normal/denied member access behaves as expected.
A request with an unrelated Host must not reach the application. Spoofed forwarded
headers from outside the ingress network must not be trusted. Verify OAuth discovery
at `/.well-known/oauth-authorization-server` and MCP access at `/mcp` using the
appropriate signed-in client. A server response alone is not a permission check.

Maintainers with the repository and Node can additionally run:

```sh
node scripts/deploy/deploy-report.mjs --smoke-only https://YOUR_DOMAIN
```

Record release versions, resolved digests, architecture, source revision and
observations without login tokens or secrets. Maintainers exercise this guide's
install, restart, backup, update and restore blocks against two published
versions with the manual *Self-host lifecycle* GitHub Actions workflow
(`scripts/ci/self-host-lifecycle.sh`); it substitutes a test ACME CA and mail
catcher for the public CA and SMTP provider.

## Restart and backup

`dc restart php nginx cron traefik` restarts services without reinstalling. Verify
records, public/private file access and OAuth identity afterwards.

For a consistent backup, stop all application writers and ingress. Keep any
external automation stopped too; do not run deploy/install during the backup.
Use a fresh backup directory outside the installation directory and protect it:

```sh
set -euo pipefail
umask 077
backup="$(mktemp -d ../bakers-backup.XXXXXXXX)"
dc stop traefik nginx php cron
dc exec -T db sh -c 'exec mysqldump --single-transaction --routines --triggers --events -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' > "$backup/database.sql"
dc run --rm --no-deps -T --entrypoint tar php -C /var/www/html/web/sites/default/files -cf - . > "$backup/public.tar"
dc run --rm --no-deps -T --entrypoint tar php -C /var/www/html/private-files -cf - . > "$backup/private.tar"
dc run --rm --no-deps -T --entrypoint tar php -C /var/www/oauth-keys -cf - . > "$backup/oauth.tar"
dc run --rm --no-deps -T --entrypoint tar init-perms -C /acme -cf - . > "$backup/acme.tar"
cp .env docker-compose.yml docker-compose.traefik.yml "$backup/"
cp -R docker "$backup/"
dc config --images > "$backup/images.txt"
dc images --format json > "$backup/running-images.json"
(cd "$backup" && sha256sum database.sql public.tar private.tar oauth.tar acme.tar > SHA256SUMS)
touch "$backup/COMPLETE"
dc start php nginx cron traefik
```

If a command fails, leave writers stopped until the cause is resolved. A directory
without `COMPLETE` is not a completed backup. Copy completed backups to separate,
access-controlled storage; they contain the database, private files, signing keys,
certificate private keys and `.env` secrets. Do not commit or publish them.

## Update

Take and verify the backup above first. Stop writers again with
`dc stop traefik nginx php cron`. Read the release's supported upgrade path and
replace the installation artifacts only as directed, then update both application
image references to the matching release. Keep project identity, database inputs
and salt unchanged. Do not independently upgrade MariaDB as part of an application
update.

```sh
dc config -q
dc pull
dc run --rm --no-deps deploy
dc up -d
```

If the update hook fails, do not reopen ingress. Resolve the failure or restore a
matching backup. After success, compare pre/post-update record IDs, public/private
file checksums and the OAuth public-key fingerprint, then repeat login and access
checks. A code-only downgrade does not reverse database/schema changes.

## Restore onto empty isolated storage

Practice recovery in a **new installation directory and a different Compose
project**, preferably on a separate host. Never restore over the source instance.
Copy the completed backup's configuration and exact release files to the new
directory, keep `.env` private, and redefine `dc` there. Verify `SHA256SUMS` in the
backup directory and inspect the archive inventories before extraction.

Set a new `COMPOSE_PROJECT_NAME` and `STACK_NAME`, a separate test hostname and an
unused `TRAEFIK_SUBNET`. Retain the original database credentials, salt and exact
image digests. Update optional provider redirect registrations if testing login
on the new hostname. A new test hostname obtains its own ACME certificate; restore
the saved ACME archive only for recovery of the original domain on its replacement
host, with the original ingress stopped. Two hosts must not compete for that name.

Check `dc ps -a` and the project-labelled volumes are absent before creating any
storage. Explicitly select and inspect the destination project; never use existing
operator volumes. Do **not** run the install service.

```sh
set -euo pipefail
# Set this to the complete, verified backup directory.
backup=/absolute/path/to/backup
test -f "$backup/COMPLETE"
(cd "$backup" && sha256sum -c SHA256SUMS)
dc config -q
dc pull
dc up -d --wait db
dc run --rm --no-deps init-perms
dc exec -T db sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < "$backup/database.sql"
dc run --rm --no-deps -T --entrypoint tar php -C /var/www/html/web/sites/default/files -xf - < "$backup/public.tar"
dc run --rm --no-deps -T --entrypoint tar php -C /var/www/html/private-files -xf - < "$backup/private.tar"
dc run --rm --no-deps -T --entrypoint tar php -C /var/www/oauth-keys -xf - < "$backup/oauth.tar"
# Original-domain recovery only, before Traefik starts:
# dc run --rm --no-deps -T --entrypoint tar init-perms -C /acme -xf - < "$backup/acme.tar"
dc up -d
```

Verify record IDs, file checksums, private-file permissions, OAuth public-key
fingerprint and sign-in against the source snapshot. Keep the source instance and
backup intact. Failed-upgrade recovery uses this same matched image/data snapshot;
switching traffic or changing production DNS is a separate operator decision.
