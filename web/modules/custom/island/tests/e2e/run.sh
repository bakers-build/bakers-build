#!/usr/bin/env bash
## Minimal-install browser harness for the island module.
##
## Usage (from repo root):
##   ddev exec web/modules/custom/island/tests/e2e/run.sh <evidence-dir>
##
## The evidence directory is REQUIRED, and it belongs under the calling
## ticket's transient root — `assets-ai/<ticket>/playwright/<run>`, relative to
## the repository root, or an absolute path.
##
## It used to default to a path under `issues/`, the evidence root this project
## retired. A generic harness cannot know which ticket a run belongs to, so
## inventing a default is how a dead convention outlives the ticket that wrote
## it and quietly recreates itself on every argument-less run. The caller knows;
## the caller says.
set -euo pipefail

APP=/var/www/html
MODULE_E2E="$APP/web/modules/custom/island/tests/e2e"
SITE_DIR="$APP/web/sites/island_e2e"
PORT=8973
EVIDENCE_DIR="${1:-}"
if [ -z "$EVIDENCE_DIR" ]; then
  echo "usage: run.sh <evidence-dir>" >&2
  echo "  Required. Use the calling ticket's transient root, for example" >&2
  echo "  assets-ai/<ticket>/playwright/<run-name>." >&2
  exit 64
fi
if [ "${EVIDENCE_DIR#/}" = "$EVIDENCE_DIR" ]; then
  EVIDENCE_DIR="$APP/$EVIDENCE_DIR"
fi

cd "$APP"

echo "==> Preparing minimal site (SQLite) in web/sites/island_e2e"
mkdir -p "$SITE_DIR"
cat > "$APP/web/sites/sites.php" <<'PHP'
<?php
// Drupal multisite keys are "<port>.<host>" (see example.sites.php).
$sites['8973.127.0.0.1'] = 'island_e2e';
$sites['8973.localhost'] = 'island_e2e';
PHP

# The e2e harness owns both sites.php (untracked here) and the island_e2e
# site dir; remove both on teardown, and stop the PHP server.
SERVER_PID=""
teardown() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$APP/web/sites/sites.php"
  # The installer chmods settings.php and the site dir read-only.
  chmod -R u+w "$SITE_DIR" 2>/dev/null || true
  rm -rf "$SITE_DIR"
  # Drush stores the sqlite path verbatim ('island_e2e/files/.ht.sqlite'),
  # resolved against the Drupal root at runtime — outside the site dir.
  rm -rf "$APP/web/island_e2e"
}
trap teardown EXIT

# Drush normalizes the sqlite db path by stripping the current site's
# "sites/<subdir>/" prefix; the stored path is resolved against the Drupal
# root, so the db file lands in web/island_e2e (cleaned up in teardown).
"$APP/vendor/bin/drush" site:install minimal --yes \
  --db-url="sqlite://sites/island_e2e/files/.ht.sqlite" \
  --sites-subdir=island_e2e \
  --site-name="Island E2E"

# The installer chmods settings.php read-only.
chmod u+w "$SITE_DIR" "$SITE_DIR/settings.php"

# Test modules (tests/modules/*) are not discovered by a normal site install.
cat >> "$SITE_DIR/settings.php" <<'PHP'
$settings['extension_discovery_scan_tests'] = TRUE;
PHP

# The harness theme owns the page-content container a linkToPage() link targets
# (BB-398 D2). It lives under tests/themes/, which the setting above makes
# discoverable. Enabled and made default BEFORE the modules, so that
# island_example_install() reads the theme it is actually going to render in.
"$APP/vendor/bin/drush" --uri="http://127.0.0.1:$PORT" theme:enable island_e2e --yes
"$APP/vendor/bin/drush" --uri="http://127.0.0.1:$PORT" config:set system.theme default island_e2e --yes

"$APP/vendor/bin/drush" --uri="http://127.0.0.1:$PORT" en island island_example --yes

mkdir -p "$EVIDENCE_DIR/img"
# The sqlite path in settings.php is resolved against the Drupal root, so
# serve with the docroot as cwd. Server output goes to a log file: piped
# stdout would block the single-threaded server once the pipe buffer fills.
(cd "$APP/web" && exec php -d variables_order=EGPCS -S 127.0.0.1:$PORT -t "$APP/web" "$APP/web/.ht.router.php") > "$EVIDENCE_DIR/php-server.log" 2>&1 &
SERVER_PID=$!

# Wait for the server to answer before starting the browser (any HTTP
# response counts; the target route 404s until island_example is enabled).
for i in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/island-example/tasks"; then
    break
  fi
  sleep 1
done

cd "$MODULE_E2E"
npm ci
sudo ./node_modules/.bin/playwright install-deps chromium || true
./node_modules/.bin/playwright install chromium

ISLAND_E2E_BASE_URL="http://127.0.0.1:$PORT" \
ISLAND_E2E_JUNIT="$EVIDENCE_DIR/junit-island.xml" \
  ./node_modules/.bin/playwright test

echo "Island e2e passed. JUnit: $EVIDENCE_DIR/junit-island.xml"
