#!/bin/sh
# Runs on every `docker compose up` (deploy service): installs a reachable, EMPTY
# database from config/sync, updates an installed site, and aborts in every other case.
# site:install drops the database, so it never runs on a database that has any table.
set -eu
DRUSH=${DRUSH:-/var/www/html/vendor/bin/drush}
OAUTH_KEYS=${OAUTH_KEYS:-/var/www/oauth-keys}
count="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()"

tables=$($DRUSH sql:query "$count") || { echo "[deploy] database unreachable — nothing changed" >&2; exit 1; }
has_config=$($DRUSH sql:query "$count AND table_name = 'config'") || { echo "[deploy] database unreachable — nothing changed" >&2; exit 1; }

if [ "$has_config" = 1 ]; then
  # No dump here: it would lengthen every update; the backup runs before `up`.
  echo "[deploy] installed site: drush deploy"
  $DRUSH -y deploy
  # Code-defined entity schema changes are not created by config:import: enable the tool
  # just in time, apply, then re-import config so it is uninstalled again.
  $DRUSH -y pm:install devel_entity_updates
  $DRUSH -y devel-entity-updates
  $DRUSH -y config:import
elif [ "$tables" = 0 ]; then
  [ -n "${ADMIN_EMAIL:-}" ] || { echo "[deploy] empty database: set ADMIN_EMAIL to install" >&2; exit 1; }
  echo "[deploy] empty database: site:install --existing-config"
  # The password is never shown: the administrator signs in by email link.
  $DRUSH -y site:install --existing-config --account-mail="$ADMIN_EMAIL" \
    --account-pass="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >/dev/null
  $DRUSH -y deploy:hook
  echo "[deploy] installed — sign in at https://${DOMAIN:-<DOMAIN>}/user/login with $ADMIN_EMAIL"
else
  echo "[deploy] database has $tables tables but no Drupal site — refusing to install over it" >&2
  exit 1
fi

mkdir -p "$OAUTH_KEYS"
[ -f "$OAUTH_KEYS/private.key" ] || $DRUSH simple-oauth:generate-keys "$OAUTH_KEYS"
