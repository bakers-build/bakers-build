#!/bin/sh
# Runs on every `docker compose up` (deploy service): installs bakers.build into a reachable,
# EMPTY database, updates an installed bakers.build, and aborts in every other case.
# The install drops the database, so it never runs on a database that has any table.
set -eu
DRUSH=${DRUSH:-/var/www/html/vendor/bin/drush}
OAUTH_KEYS=${OAUTH_KEYS:-/var/www/oauth-keys}
export DRUSH_OPTIONS_URI="${DRUSH_OPTIONS_URI:-${DOMAIN:+https://$DOMAIN}}"
count="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()"

say() { echo "[bakers] $*"; }
fail() { echo "[bakers] $*" >&2; exit 1; }
# The log speaks of bakers.build; a step's own output is shown only when that step fails.
# $on_fail, when set, runs before the failure is reported.
step() {
  out=$("$DRUSH" "$@" 2>&1) || { printf '%s\n' "$out" >&2; ${on_fail:-true}; fail "$what failed — see the output above"; }
}
# Best effort: the failure being reported is the step's, not this one's.
uninstall_devel() { "$DRUSH" -y pm:uninstall devel_entity_updates devel >/dev/null 2>&1 || true; }

# The stack's database has no TLS, and drush's --defaults-file hides the image's my.cnf.d opt-out.
query() { "$DRUSH" sql:query --extra=--skip-ssl "$1"; }
# Stderr stays out of the counts; on failure the query runs once more so its error is shown.
unreachable() { query "$1" >&2 2>&1 || true; fail "database unreachable — nothing changed"; }
tables=$(query "$count" 2>/dev/null) || unreachable "$count"
has_config=$(query "$count AND table_name = 'config'" 2>/dev/null) || unreachable "$count AND table_name = 'config'"

if [ "$has_config" = 1 ]; then
  say "updating bakers.build"
  what="update"
  step -y deploy
  # Code-defined entity schema changes are not created by config:import: enable the tool
  # just in time, apply, then re-import config so it is uninstalled again.
  # devel must never stay on a live site, also when one of these fails.
  on_fail=uninstall_devel
  step -y pm:install devel_entity_updates
  step -y devel-entity-updates
  step -y config:import
  on_fail=
  say "bakers.build is up to date"
elif [ "$tables" = 0 ]; then
  [ -n "${ADMIN_EMAIL:-}" ] || fail "empty database: set ADMIN_EMAIL to install bakers.build"
  say "empty database: installing bakers.build"
  what="install"
  # Drush's generated password stays in the hidden output: the administrator signs in by email link.
  step -y site:install --existing-config --account-mail="$ADMIN_EMAIL"
  step -y deploy:hook
  say "bakers.build installed — sign in at https://${DOMAIN:-<DOMAIN>}/user/login with $ADMIN_EMAIL"
else
  fail "the database has $tables tables but no bakers.build — refusing to install over it"
fi

what="creating the sign-in keys"
mkdir -p "$OAUTH_KEYS"
[ -f "$OAUTH_KEYS/private.key" ] || step simple-oauth:generate-keys "$OAUTH_KEYS"
