#!/usr/bin/env bash
# Fails when config/sync differs from what `drush cex` would write for the active site.
# Run it inside the container (ddev exec / docker compose exec php) on a site installed from config/sync.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
vendor/bin/drush config:export --destination="$tmp" -y >/dev/null
diff -ru -x .htaccess config/sync "$tmp" || { echo "ERROR: config/sync is not what drush cex exports; run 'drush cex' and commit." >&2; exit 1; }
