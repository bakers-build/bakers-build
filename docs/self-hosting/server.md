---
title: Server
description: Run the bakers.build server with one Docker Compose file behind your own HTTPS reverse proxy.
---

# Self-host the server

The server runs from one Docker Compose file on a Linux `amd64` host with Docker Compose v2.24.4
or newer. You need a DNS name for the host, an SMTP account (sign-in works by email link) and an
HTTPS reverse proxy ([examples](/self-hosting/proxy)). Releases are listed on
[GitHub](https://github.com/bakers-build/bakers-build/releases); their images are public.

## Compose file

Save this as `docker-compose.yml` in an empty directory:

```yaml
# bakers.build server. Fill in .env next to this file, then:
#   docker compose --profile install run --rm install   # first install only: creates the database
#   docker compose up -d
# nginx listens on 127.0.0.1:${HTTP_PORT}; put your HTTPS reverse proxy in front of it.
x-app: &app
  image: ghcr.io/bakers-build/bakers-build/php:${BAKERS_VERSION:?Set BAKERS_VERSION, e.g. 0.7.0}
  restart: unless-stopped
  depends_on:
    init-perms:
      condition: service_completed_successfully
    db:
      condition: service_healthy
  volumes:
    - public_files:/var/www/html/web/sites/default/files
    - private_files:/var/www/html/private-files
    - tmp_files:/tmp
    - oauth_keys:/var/www/oauth-keys
  networks: [internal]

x-env: &env
  DB_HOST: db
  DB_NAME: bakers
  DB_USER: bakers
  DB_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD}
  DB_DRIVER: mysql
  DB_PORT: "3306"
  DOMAIN: ${DOMAIN:?Set DOMAIN to the public hostname}
  DRUSH_OPTIONS_URI: https://${DOMAIN}
  DRUPAL_HASH_SALT: ${DRUPAL_HASH_SALT:?Set DRUPAL_HASH_SALT}
  # Your reverse proxy reaches nginx from this network (or its gateway), so it is trusted.
  DRUPAL_TRUSTED_PROXY_SUBNET: ${INTERNAL_SUBNET:-172.30.42.0/24}
  MAIL_SMTP_DSN: ${MAIL_SMTP_DSN:?Set MAIL_SMTP_DSN; sign-in works by email}
  MAIL_FROM_ADDRESS: ${MAIL_FROM_ADDRESS:?Set MAIL_FROM_ADDRESS}
  BB_OAUTH_GOOGLE_CLIENT_ID: ${BB_OAUTH_GOOGLE_CLIENT_ID:-}
  BB_OAUTH_GOOGLE_CLIENT_SECRET: ${BB_OAUTH_GOOGLE_CLIENT_SECRET:-}
  FEATURE_FLAG_RUN_LOG_STORAGE: ${FEATURE_FLAG_RUN_LOG_STORAGE:-0}

services:
  init-perms:
    image: alpine:3.22.2
    command: sh -c "chown -R 1000:1000 /pf /privf /oauthkeys && chown 1000:1000 /tmpdir && chmod 1777 /tmpdir"
    volumes:
      - public_files:/pf
      - private_files:/privf
      - tmp_files:/tmpdir
      - oauth_keys:/oauthkeys
    restart: "no"

  db:
    image: wodby/mariadb:10.11-3.30.1
    restart: unless-stopped
    stop_grace_period: 30s
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_ROOT_PASSWORD:?Set DB_ROOT_PASSWORD}
      MYSQL_DATABASE: bakers
      MYSQL_USER: bakers
      MYSQL_PASSWORD: ${DB_PASSWORD}
    volumes:
      - db:/var/lib/mysql
    healthcheck:
      test: ["CMD-SHELL", "mysqladmin ping -h 127.0.0.1 -uroot -p\"$$MYSQL_ROOT_PASSWORD\" --silent"]
      interval: 5s
      timeout: 5s
      retries: 20
      start_period: 30s
    networks: [internal]

  # First install only: site:install DROPS and recreates the database.
  install:
    <<: *app
    profiles: [install]
    restart: "no"
    environment:
      <<: *env
      ADMIN_EMAIL: ${ADMIN_EMAIL:?Set ADMIN_EMAIL, the first administrator}
    command: |
      sh -c '
        set -e
        DRUSH=/var/www/html/vendor/bin/drush
        echo "[install] site:install --existing-config (DROPS + recreates the DB)"
        $$DRUSH -y site:install --existing-config --account-mail="$$ADMIN_EMAIL"
        $$DRUSH -y deploy:hook
        echo "[install] OAuth keys"
        mkdir -p /var/www/oauth-keys
        [ -f /var/www/oauth-keys/private.key ] || $$DRUSH simple-oauth:generate-keys /var/www/oauth-keys
      '

  # Runs the database updates on every `up`; php starts only when it succeeds.
  deploy:
    <<: *app
    restart: "no"
    environment: *env
    command: |
      sh -c '
        set -e
        DRUSH=/var/www/html/vendor/bin/drush
        echo "[deploy] UPDATE — drush deploy (fails loudly if the site is not installed)"
        $$DRUSH -y deploy
        echo "[deploy] entity schema: enable tool, apply, re-import config to disable"
        $$DRUSH -y pm:install devel_entity_updates
        $$DRUSH -y devel-entity-updates
        $$DRUSH -y config:import
        echo "[deploy] OAuth keys"
        mkdir -p /var/www/oauth-keys
        [ -f /var/www/oauth-keys/private.key ] || $$DRUSH simple-oauth:generate-keys /var/www/oauth-keys
      '

  php:
    <<: *app
    depends_on:
      deploy:
        condition: service_completed_successfully
    environment:
      <<: *env
      PHP_FPM_USER: wodby
      PHP_FPM_GROUP: wodby
      PHP_FPM_CLEAR_ENV: "no"

  cron:
    <<: *app
    depends_on:
      deploy:
        condition: service_completed_successfully
    environment: *env
    command: sh -c 'while true; do /var/www/html/vendor/bin/drush core:cron || true; sleep 300; done'

  nginx:
    image: ghcr.io/bakers-build/bakers-build/nginx:${BAKERS_VERSION}
    restart: unless-stopped
    depends_on: [php]
    environment:
      NGINX_BACKEND_HOST: php
      NGINX_SERVER_ROOT: /var/www/html/web
      NGINX_VHOST_PRESET: drupal10
      NGINX_STATIC_OPEN_FILE_CACHE: "off"
      NGINX_SERVER_EXTRA_CONF_FILEPATH: /etc/nginx/oauth-discovery.conf
    volumes:
      - public_files:/var/www/html/web/sites/default/files
    ports:
      - 127.0.0.1:${HTTP_PORT:-8080}:80
    networks: [internal]

volumes:
  db:
  public_files:
  private_files:
  tmp_files:
  oauth_keys:

networks:
  internal:
    ipam:
      config:
        - subnet: ${INTERNAL_SUBNET:-172.30.42.0/24}
```

Next to it, save this as `.env` and fill it in:

```sh
# Release without the leading v, e.g. 0.7.0.
BAKERS_VERSION=
# Public hostname, no scheme or path.
DOMAIN=
# The first administrator; signs in with an email link.
ADMIN_EMAIL=
# Three random values (openssl rand -hex 32). Keep them for every update.
DB_PASSWORD=
DB_ROOT_PASSWORD=
DRUPAL_HASH_SALT=
# smtp:// or smtps:// URL; percent-encode the user and password, e.g. user%40example.org.
MAIL_SMTP_DSN=
MAIL_FROM_ADDRESS=
# 1 lets workspace leads store agent run transcripts on this server.
FEATURE_FLAG_RUN_LOG_STORAGE=0
# Optional.
HTTP_PORT=8080
INTERNAL_SUBNET=172.30.42.0/24
BB_OAUTH_GOOGLE_CLIENT_ID=
BB_OAUTH_GOOGLE_CLIENT_SECRET=
```

| Variable | Value |
|---|---|
| `BAKERS_VERSION` | Release without the leading `v`, e.g. `0.7.0`. |
| `DOMAIN` | The public hostname, e.g. `bakers.example.org`. |
| `ADMIN_EMAIL` | The first administrator's email address. |
| `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `DRUPAL_HASH_SALT` | Three random values, e.g. from `openssl rand -hex 32`. Keep them; an update needs the same ones. |
| `MAIL_SMTP_DSN`, `MAIL_FROM_ADDRESS` | Your SMTP URL, e.g. `smtp://user%40example.org:password@smtp.example.org:587`, and its sender address. |
| `FEATURE_FLAG_RUN_LOG_STORAGE` | See [Run-log storage](#run-log-storage). |
| `HTTP_PORT` | Loopback port your proxy forwards to. |
| `INTERNAL_SUBNET` | Change only if `172.30.42.0/24` is already used on the host. |

`docker compose config -q` reports a missing value. Keep `.env` private (`chmod 600 .env`).

## Install

```sh
docker compose --profile install run --rm install
docker compose up -d
```

The `install` service creates the database; run it once, never on an existing installation.
Then set up your [reverse proxy](/self-hosting/proxy).

## First sign-in

Open `https://DOMAIN/user/login`, enter `ADMIN_EMAIL` and follow the link in the email. Create a
workspace and a project, then connect a machine with `bakers init --base-url https://DOMAIN`
([Machine setup](/provision/machine)).

## Verify

- `http://DOMAIN` redirects to `https://DOMAIN` with a valid certificate.
- The sign-in email arrives and its link starts with `https://DOMAIN`.
- A connected conductor appears and one ticket runs one state.

## Update

Read the release notes, then:

```sh
docker compose exec -T db sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" bakers' > backup-$(date +%F).sql
# set BAKERS_VERSION in .env to the new release
docker compose pull
docker compose run --rm deploy
docker compose up -d
```

`deploy` runs the database updates; `up -d` also runs it before PHP starts. Keep `.env` otherwise
unchanged. If `deploy` fails, the site stays down: set the previous `BAKERS_VERSION` and load the
dump with `docker compose exec -T db sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" bakers' < backup-….sql`.

## Run-log storage

With `FEATURE_FLAG_RUN_LOG_STORAGE=1` a workspace lead can tick *Store agent run logs* in the
workspace settings; only then does the server keep agent run transcripts. Both are off by default.
