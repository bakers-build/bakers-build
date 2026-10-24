#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Compose-rendering contract for the BB-658 Task 3 MCP service.
#
#   bash tests/contract/mcp-compose.sh
#
# Renders docker-compose.yml + the Traefik ingress overlay with dummy
# environment values (`docker compose config`, no real secrets, nothing
# started) and asserts:
#   - the mcp service is present
#   - no plaintext secret leaks into the rendered output
#   - the mcp service exposes no host port (ingress-only, like nginx)
#   - the `install` profile (site:install, DROPS the DB) is not active on a
#     normal render
#   - Traefik is the only ingress overlay, and no removed keytec variable
#     (content recipe, per-user consumer secrets, GitLab token) renders
#   - `/oauth/register` is rate-limited in the baked nginx config
#
# The entity/operation allowlist itself lives in docker/mcp/dropsh.config.js,
# baked into the image — see docker/mcp/README.md for why it is a documented
# superset, not an exact-matrix claim, and why the real boundary is Drupal
# permissions, not this config layer.
#
# A real `docker build` + container smoke test (does the image actually
# resolve its plugins and answer `initialize`?) is a separate, slower step:
# run `bash tests/contract/mcp-image-smoke.sh` when `docker/mcp/**` changes.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

render() {
  local overlay="$1"
  DOMAIN=dummy.example.test \
  STACK_NAME=dummy-stack \
  DB_NAME=dummy DB_USER=dummy DB_PASSWORD=dummy-pw DB_ROOT_PASSWORD=dummy-root-pw \
  DRUPAL_HASH_SALT=dummy-salt \
  REGISTRY_IMAGE_PHP=dummy/php:dummy REGISTRY_IMAGE_NGINX=dummy/nginx:dummy \
  REGISTRY_IMAGE_MCP=dummy/mcp:dummy \
    docker compose -f docker-compose.yml -f "$overlay" config
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
    || fail "$overlay: rendered config has no mcp service"

  # No secret-bearing line renders without the injected dummy value.
  if echo "$out" | grep -E 'DB_PASSWORD|DB_ROOT_PASSWORD|DRUPAL_HASH_SALT' \
       | grep -Ev 'dummy'; then
    fail "$overlay: a secret-bearing line rendered without the injected dummy value"
  fi

  # No host port bypassing ingress — the mcp service must not publish ports.
  mcp_block="$(echo "$out" | awk '/^  mcp:/{f=1} f && /^  [a-z]/ && !/^  mcp:/{f=0} f')"
  echo "$mcp_block" | grep -q 'ports:' \
    && fail "$overlay: mcp service publishes a host port"

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

  pass "$overlay renders mcp service with no host port and no leaked secret"
done

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

pass "mcp-compose.sh"
