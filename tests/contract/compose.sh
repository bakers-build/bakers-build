#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Compose-rendering contract for the deployed stack.
#
#   bash tests/contract/compose.sh
#
# Renders docker-compose.yml + the Traefik ingress overlay with dummy
# environment values (`docker compose config`, no real secrets, nothing
# started) and asserts:
#   - no plaintext secret leaks into the rendered output
#   - no separate mcp service renders; /mcp is Drupal's mcp_server
#   - the `install` profile (site:install, DROPS the DB) is not active on a
#     normal render
#   - Traefik is the only ingress overlay, and no removed keytec variable
#     (content recipe, per-user consumer secrets, GitLab token) renders
#   - `/oauth/register` is rate-limited in the baked nginx config
#   - the merge gate's e2e overlay (docker/e2e/compose.yml) renders, publishes
#     no port, keeps config/sync out of its recipe world and leaks no secret
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

render() {
  local overlay="$1"; shift
  DOMAIN=dummy.example.test \
  STACK_NAME=dummy-stack \
  DB_NAME=dummy DB_USER=dummy DB_PASSWORD=dummy-pw DB_ROOT_PASSWORD=dummy-root-pw \
  DRUPAL_HASH_SALT=dummy-salt \
  REGISTRY_IMAGE_PHP=dummy/php:dummy REGISTRY_IMAGE_NGINX=dummy/nginx:dummy \
  REGISTRY_IMAGE_E2E=dummy/e2e:dummy REGISTRY_IMAGE_DOCS=dummy/docs:dummy \
  DOCS_DOMAIN=docs.example.test DOCS_ALIAS_DOMAIN=www.docs.example.test \
    docker compose -f docker-compose.yml -f "$overlay" "$@" config
}

# Both stacks use the same Traefik overlay; a second ingress overlay is drift.
overlays="$(ls docker-compose.*.yml)"
[ "$overlays" = "docker-compose.traefik.yml" ] \
  || fail "expected docker-compose.traefik.yml as the only ingress overlay, found: $overlays"
[ "$(grep -oE 'docker-compose\.[a-z]+\.yml' komodo/bakers.toml | sort -u)" = "docker-compose.traefik.yml" ] \
  || fail "komodo/bakers.toml must name docker-compose.traefik.yml as its only ingress overlay"

for overlay in docker-compose.traefik.yml; do
  out="$(render "$overlay")"

  echo "$out" | grep -q '^  mcp:' \
    && fail "$overlay: a separate mcp service renders; /mcp belongs to Drupal"

  # No secret-bearing line renders without the injected dummy value.
  if echo "$out" | grep -E 'DB_PASSWORD|DB_ROOT_PASSWORD|DRUPAL_HASH_SALT' \
       | grep -Ev 'dummy'; then
    fail "$overlay: a secret-bearing line rendered without the injected dummy value"
  fi

  # install profile (site:install, DROPS the DB) must never be implicitly
  # active: a normal render (no --profile install) must not include it.
  echo "$out" | grep -q '^  install:' \
    && fail "$overlay: 'install' service is active on a normal render (profile gate broken)"

  # BB-688: nginx must wire the OAuth discovery extra-conf, or
  # /.well-known/oauth-* 404s through Komodo even though Drupal serves it.
  nginx_block="$(echo "$out" | awk '/^  nginx:/{f=1} f && /^  [a-z]/ && !/^  nginx:/{f=0} f')"
  echo "$nginx_block" | grep -q 'NGINX_SERVER_EXTRA_CONF_FILEPATH: /etc/nginx/oauth-discovery.conf' \
    || fail "$overlay: nginx service is missing NGINX_SERVER_EXTRA_CONF_FILEPATH for OAuth discovery"

  # Removed keytec leftovers must not come back through compose or the stacks.
  removed='DEPLOY_CONTENT_RECIPE|BB_CONSUMER_SECRET_|BB_GITLAB_TOKEN_KEYTEC|ensure-oauth'
  if echo "$out" | grep -E "$removed" || grep -E "$removed" komodo/bakers.toml; then
    fail "$overlay: a removed variable or the consumer seed is still wired"
  fi

  pass "$overlay renders with no mcp service and no leaked secret"

  # The public docs host is opt-in by profile: only stacks that set COMPOSE_PROFILES=docs run it.
  echo "$out" | grep -q '^  docs:' && fail "$overlay: 'docs' service is active without the docs profile"
  out="$(render "$overlay" --profile docs)"
  docs_block="$(echo "$out" | awk '/^  docs:/{f=1} f && /^  [a-z]/ && !/^  docs:/{f=0} f')"
  echo "$docs_block" | grep -q 'image: dummy/docs:dummy' || fail "$overlay: docs service does not run REGISTRY_IMAGE_DOCS"
  echo "$docs_block" | grep -q 'DOCS_DOMAIN: docs.example.test' || fail "$overlay: docs container does not get DOCS_DOMAIN"
  echo "$docs_block" | grep -qF 'Host(`docs.example.test`) || Host(`www.docs.example.test`)' \
    || fail "$overlay: docs router does not match DOCS_DOMAIN and DOCS_ALIAS_DOMAIN"
  echo "$docs_block" | grep -qF 'redirectregex.permanent: "true"' || fail "$overlay: docs router has no permanent www redirect"
  echo "$docs_block" | grep -qF 'traefik_proxy' || fail "$overlay: docs service is not on traefik_proxy"
  pass "$overlay renders the docs host only under the docs profile"
done

# Only develop and prod serve the docs; every other stack leaves the profile off.
for stack in bakers-develop bakers-prod; do
  # grep without -q reads to the end: under pipefail, an early exit can SIGPIPE sed and fail.
  sed -n "/^name = \"$stack\"\$/,/^\[\[stack/p" komodo/bakers.toml \
    | grep '^COMPOSE_PROFILES=docs$' >/dev/null || fail "komodo/bakers.toml: $stack does not enable the docs profile"
done
[ "$(grep -c '^COMPOSE_PROFILES=docs$' komodo/bakers.toml)" = 2 ] \
  || fail "komodo/bakers.toml: a stack other than develop and prod enables the docs profile"
pass "komodo/bakers.toml enables the docs host on develop and prod only"

# The merge gate's e2e overlay: no host port anywhere, the recipe world never runs
# `drush deploy` (it imports config/sync), and the runner is opt-in by profile.
out="$(render docker/e2e/compose.yml --profile e2e)"
echo "$out" | grep -qE '^\s+(ports|published):' && fail "e2e overlay publishes a host port"
for service in install runner mailpit; do
  echo "$out" | grep -q "^  $service:" || fail "e2e overlay renders no $service service"
done
deploy_block="$(echo "$out" | awk '/^  deploy:/{f=1} f && /^  [a-z]/ && !/^  deploy:/{f=0} f')"
echo "$deploy_block" | grep -q 'drush' && fail "e2e overlay still runs drush deploy on the recipe world"
if echo "$out" | grep -E 'DB_PASSWORD|DB_ROOT_PASSWORD|DRUPAL_HASH_SALT' | grep -Ev 'dummy'; then
  fail "e2e overlay: a secret-bearing line rendered without the injected dummy value"
fi
render docker/e2e/compose.yml | grep -q '^  runner:' && fail "e2e runner is active without the e2e profile"
echo "$out" | grep -q '^  docs:' && fail "e2e overlay starts the docs host"
pass "docker/e2e/compose.yml renders the gate stack with no host port"

# Open dynamic client registration is rate-limited: the http-level zone is baked
# into conf.d (Wodby includes conf.d/*.conf in http{}), the server-level extra conf
# applies it to the exact /oauth/register location.
grep -q 'COPY .*docker/nginx/oauth-register-zone.conf /etc/nginx/conf.d/' Dockerfile \
  || fail "Dockerfile does not bake the /oauth/register limit zone into nginx conf.d"
grep -q 'limit_req_zone .*zone=oauth_register:' docker/nginx/oauth-register-zone.conf \
  || fail "oauth-register-zone.conf defines no oauth_register zone"
awk '/location = \/oauth\/register/{f=1} f' docker/nginx/oauth-discovery.conf | grep -q 'limit_req zone=oauth_register' \
  || fail "/oauth/register is not rate-limited in docker/nginx/oauth-discovery.conf"
pass "/oauth/register rate limit wired"

# The extra conf must parse in the pinned Wodby nginx (a syntax error is a full outage).
# Skipped when docker or the image is unavailable locally.
nginx_image="$(sed -n 's/^FROM \(wodby\/nginx:[^ ]*\).*/\1/p' Dockerfile | head -1)"
if [ -n "$nginx_image" ] && docker image inspect "$nginx_image" >/dev/null 2>&1; then
  docker run --rm --user root --add-host php:127.0.0.1 -e NGINX_BACKEND_HOST=php -e NGINX_VHOST_PRESET=drupal10 \
    -e NGINX_SERVER_EXTRA_CONF_FILEPATH=/etc/nginx/oauth-discovery.conf \
    -v "$PWD/docker/nginx/oauth-discovery.conf:/etc/nginx/oauth-discovery.conf:ro" \
    -v "$PWD/docker/nginx/oauth-register-zone.conf:/etc/nginx/conf.d/oauth-register-zone.conf:ro" \
    "$nginx_image" nginx -t >/dev/null 2>&1 \
    && pass "nginx extra conf parses ($nginx_image)" \
    || fail "nginx -t failed for docker/nginx/oauth-discovery.conf + oauth-register-zone.conf"
fi

pass "compose.sh"
