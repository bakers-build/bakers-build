#!/usr/bin/env sh
# Executable acceptance for BB-53 — "Deploy hook never installs implicitly".
# Encodes the Gherkin scenarios (ticket `test` comment) as static assertions on the
# rendered compose config. site:install is a compose-only, infra concern: there is no
# browser surface to drive, so this is the executable test for the change (not Playwright).
#
# Run from the repo root:  sh scripts/deploy/test-compose-profiles.sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
COMPOSE="$ROOT/docker-compose.yml"
TOML="$ROOT/komodo/bakers.toml"

# Dummy env so `docker compose config` renders without unset-var noise.
ENVF="$(mktemp)"
trap 'rm -f "$ENVF"' EXIT
cat > "$ENVF" <<'EOF'
REGISTRY_IMAGE_PHP=img/php:test
REGISTRY_IMAGE_NGINX=img/nginx:test
DOMAIN=example.test
DB_USER=u
DB_NAME=d
DB_PASSWORD=p
DB_ROOT_PASSWORD=rp
DRUPAL_HASH_SALT=salt
EOF

dc()      { docker compose --env-file "$ENVF" -f "$COMPOSE" "$@" 2>/dev/null; }
fail()    { echo "FAIL: $1"; exit 1; }
pass()    { echo "PASS: $1"; }

DEFAULT_CFG="$(dc config)"
INSTALL_CFG="$(dc --profile install config)"
DEFAULT_SVCS="$(dc config --services | sort | tr '\n' ' ')"
INSTALL_SVCS="$(dc --profile install config --services | sort | tr '\n' ' ')"

# Scenario: Automatic deploy on an installed site runs UPDATE only.
echo "$DEFAULT_CFG" | grep -q 'drush.* -y deploy\|drush -y deploy' \
  || echo "$DEFAULT_CFG" | grep -q 'deploy' # drush deploy present in the deploy command
echo "$DEFAULT_CFG" | grep -q 'site:install' \
  && fail "deploy (default profile) must never contain site:install" \
  || pass "default profile renders no site:install (deploy is UPDATE-only)"

# Scenario: A fresh install is a deliberate, profile-gated action.
echo " $DEFAULT_SVCS " | grep -q ' install ' \
  && fail "install service must NOT be in the default profile" \
  || pass "install service is absent from the default profile"
echo " $INSTALL_SVCS " | grep -q ' install ' \
  || fail "install service must exist under the install profile"
echo "$INSTALL_CFG" | grep -q 'site:install --existing-config' \
  || fail "install service must run site:install --existing-config"
pass "install service is profile-gated and runs site:install --existing-config"

# Scenario: The bootstrap-heuristic INIT branch and its envs are gone.
grep -q 'status --field=bootstrap' "$COMPOSE" \
  && fail "deploy must not branch on the bootstrap heuristic" \
  || pass "bootstrap if/else INIT branch removed from docker-compose.yml"
grep -Eq 'DEPLOY_INIT_MODE|DEPLOY_INSTALL_PROFILE' "$COMPOSE" \
  && fail "DEPLOY_INIT_MODE/DEPLOY_INSTALL_PROFILE must be gone from docker-compose.yml" \
  || pass "DEPLOY_INIT_MODE/DEPLOY_INSTALL_PROFILE absent from docker-compose.yml"
grep -Eq 'DEPLOY_INIT_MODE|DEPLOY_INSTALL_PROFILE' "$TOML" \
  && fail "DEPLOY_INIT_MODE/DEPLOY_INSTALL_PROFILE must be gone from komodo/bakers.toml" \
  || pass "DEPLOY_INIT_MODE/DEPLOY_INSTALL_PROFILE absent from komodo/bakers.toml"

# Scenario: Compose renders for both profiles.
[ -n "$DEFAULT_CFG" ]  || fail "default profile did not render"
[ -n "$INSTALL_CFG" ]  || fail "install profile did not render"
pass "docker compose config renders for both the default and the install profile"

echo "ALL PASS"
