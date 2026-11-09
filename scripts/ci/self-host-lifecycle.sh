#!/usr/bin/env bash
# Runs the documented self-host lifecycle (docs/self-hosting/server.md, proxy.md)
# against the public release images: install, restart, backup, update, restore.
# Both versions run the operator compose file of <to-version>; only the image changes.
# <from-version> must contain scripts/deploy/site-deploy.sh (the first `up` installs).
#
# usage: scripts/ci/self-host-lifecycle.sh <from-version> <to-version> <workdir>
#   version: vX.Y.Z (release) or a full 40-character commit SHA on `next`/`main`.
#
# The only deviations from the operator guide live in a generated test overlay:
# Pebble replaces Let's Encrypt, Mailpit replaces the SMTP provider and the host
# ports move to loopback. Everything is pulled anonymously (empty DOCKER_CONFIG).
set -euo pipefail

FROM=${1:?from-version}
TO=${2:?to-version}
WORK=$(mkdir -p "${3:?workdir}" && cd "$3" && pwd)

REPO=bakers-build/bakers-build
FILES=(docker-compose.yml .env.example traefik.yml)
PEBBLE_IMAGE=ghcr.io/letsencrypt/pebble:2.7.0
MAILPIT_IMAGE=axllent/mailpit:v1.27.10
USER_MAIL=lifecycle@selfhost.test

export DOCKER_CONFIG="$WORK/docker-config"
mkdir -p "$DOCKER_CONFIG" "$WORK/evidence"
EVIDENCE="$WORK/evidence/lifecycle.md"
: > "$EVIDENCE"

log() { printf '\n== %s\n' "$*" >&2; }
pass() { printf -- '- PASS %s\n' "$*" | tee -a "$EVIDENCE" >&2; }
fail() { printf -- '- FAIL %s\n' "$*" | tee -a "$EVIDENCE" >&2; exit 1; }
record() { printf -- '- %s\n' "$*" >> "$EVIDENCE"; }

# Release version -> git ref and image tag.
git_ref() { [[ $1 =~ ^v?([0-9]+\.[0-9]+\.[0-9]+)$ ]] && echo "v${BASH_REMATCH[1]}" && return; [[ $1 =~ ^[0-9a-f]{40}$ ]] && echo "$1" && return; echo "unsupported version: $1" >&2; return 1; }
image_tag() { [[ $1 =~ ^v?([0-9]+\.[0-9]+\.[0-9]+)$ ]] && echo "${BASH_REMATCH[1]}" || echo "$1"; }

fetch_release() { # dir version
  local ref; ref=$(git_ref "$2")
  for f in "${FILES[@]}"; do
    curl -fsSL --create-dirs -o "$1/$f" "https://raw.githubusercontent.com/$REPO/$ref/docker/compose/$f"
  done
}

set_env() { # key value (in ./.env)
  awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; done=1; next} {print} END{if(!done) print k "=" v}' .env > .env.tmp && mv .env.tmp .env
}

# The guide's compose file and Traefik example, plus the test overlay.
dc() {
  docker compose --env-file .env -f docker-compose.yml -f traefik.yml -f lifecycle.yml "$@"
}

write_overlay() { # https http mailpit pebble-management
  local command
  # Two instances share the Docker host: each Traefik watches only its own project.
  command=$(docker compose --env-file .env -f docker-compose.yml -f traefik.yml config --format json \
    | jq -c --arg p "$(sed -n 's/^COMPOSE_PROJECT_NAME=//p' .env)" '.services.traefik.command + ["--certificatesresolvers.le.acme.caserver=https://pebble:14000/dir", "--providers.docker.constraints=Label(`com.docker.compose.project`,`\($p)`)"]')
  docker create --name "pebble-ca-$$" "$PEBBLE_IMAGE" >/dev/null
  docker cp "pebble-ca-$$:/test/certs/pebble.minica.pem" pebble.minica.pem >/dev/null
  docker rm "pebble-ca-$$" >/dev/null
  cat > lifecycle.yml <<EOF
services:
  traefik:
    command: $command
    environment:
      LEGO_CA_CERTIFICATES: /pebble/pebble.minica.pem
    volumes:
      - ./pebble.minica.pem:/pebble/pebble.minica.pem:ro
    ports: !override
      - "127.0.0.1:$2:80"
      - "127.0.0.1:$1:443"
    depends_on: [pebble]
  pebble:
    image: $PEBBLE_IMAGE
    environment:
      PEBBLE_VA_ALWAYS_VALID: "1"
      PEBBLE_VA_NOSLEEP: "1"
    ports: ["127.0.0.1:$4:15000"]
    networks: [internal]
  mailpit:
    image: $MAILPIT_IMAGE
    ports: ["127.0.0.1:$3:8025"]
    networks: [internal]
EOF
}

configure() { # dir project domain subnet https http mailpit pebble-management nginx
  cd "$1"
  umask 077
  cp .env.example .env
  chmod 600 .env
  set_env COMPOSE_PROJECT_NAME "$2"; set_env BAKERS_VERSION "$(image_tag "$FROM")"
  set_env DOMAIN "$3"; set_env ADMIN_EMAIL "$USER_MAIL"; set_env INTERNAL_SUBNET "$4"; set_env HTTP_PORT "$9"
  set_env DB_PASSWORD "$(openssl rand -hex 32)"; set_env DB_ROOT_PASSWORD "$(openssl rand -hex 32)"
  set_env DRUPAL_HASH_SALT "$(openssl rand -hex 32)"
  set_env MAIL_SMTP_DSN "smtp://mailpit:1025"; set_env MAIL_FROM_ADDRESS "bakers@selfhost.test"
  write_overlay "$5" "$6" "$7" "$8"
  dc config -q
}

# --- HTTP helpers against one instance (globals: DOMAIN HTTPS HTTP MAILPIT PEBBLE ROOT) ---
use_instance() { DOMAIN=$1 HTTPS=$2 HTTP=$3 MAILPIT=$4 PEBBLE=$5 ROOT="$WORK/$1.root.pem"; }
cu() { curl -sS --cacert "$ROOT" --connect-to "$DOMAIN:443:127.0.0.1:$HTTPS" "$@"; }
drush() { dc exec -T php /var/www/html/vendor/bin/drush --uri="https://$DOMAIN" "$@"; }

wait_ready() { # waits for the Pebble-issued certificate and a served login page
  for _ in $(seq 1 90); do
    curl -fsSk "https://127.0.0.1:$PEBBLE/roots/0" > "$ROOT" 2>/dev/null \
      && cu -f -o /dev/null "https://$DOMAIN/user/login" 2>/dev/null && return 0
    sleep 4
  done
  dc ps -a >&2; dc logs --tail 60 traefik deploy php nginx >&2
  fail "$DOMAIN did not serve a trusted ACME certificate and login page"
}

check_edge() {
  local out
  out=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --connect-to "$DOMAIN:80:127.0.0.1:$HTTP" "http://$DOMAIN/user/login")
  [[ $out =~ ^30[178]\ https://$DOMAIN/ ]] && pass "HTTP redirects to HTTPS ($out)" || fail "HTTP redirect: $out"
  issuer=$(openssl s_client -connect "127.0.0.1:$HTTPS" -servername "$DOMAIN" </dev/null 2>/dev/null | openssl x509 -noout -issuer)
  [[ $issuer == *Pebble* ]] && pass "certificate for $DOMAIN issued through ACME ($issuer)" || fail "certificate issuer: $issuer"
  out=$(curl -sSk -o /dev/null -w '%{http_code}' --connect-to "unrelated.test:443:127.0.0.1:$HTTPS" https://unrelated.test/user/login)
  [ "$out" = 404 ] && pass "unrelated Host is not routed (404)" || fail "unrelated Host answered $out"
  out=$(cu -f -H 'X-Forwarded-Host: attacker.test' "https://$DOMAIN/user/login")
  [[ $out == *attacker.test* ]] && fail "spoofed X-Forwarded-Host reflected" || pass "spoofed X-Forwarded-Host ignored"
  cu -f "https://$DOMAIN/.well-known/oauth-authorization-server" | jq -e --arg d "https://$DOMAIN" '.issuer | startswith($d)' >/dev/null \
    && pass "OAuth discovery advertises https://$DOMAIN" || fail "OAuth discovery"
}

sign_in() { # passwordless sign-in through the mailed link
  local jar page build link id="" landing
  jar=$(mktemp)
  curl -fsS -X DELETE "http://127.0.0.1:$MAILPIT/api/v1/messages" >/dev/null
  page=$(cu -f -c "$jar" -b "$jar" "https://$DOMAIN/user/login")
  build=$(grep -o 'name="form_build_id" value="[^"]*"' <<<"$page" | head -1 | sed 's/.*value="//; s/"$//')
  cu -f -o /dev/null -c "$jar" -b "$jar" --data-urlencode "mail=$USER_MAIL" \
    --data-urlencode "form_build_id=$build" --data-urlencode form_id=bb_login_form "https://$DOMAIN/user/login"
  for _ in $(seq 1 30); do
    id=$(curl -fsS "http://127.0.0.1:$MAILPIT/api/v1/messages" | jq -r '.messages[0].ID // empty')
    [ -n "$id" ] && break; sleep 2
  done
  [ -n "$id" ] || fail "no sign-in mail delivered over SMTP"
  link=$(curl -fsS "http://127.0.0.1:$MAILPIT/api/v1/message/$id" | jq -r '.Text' | grep -o "https://[^[:space:]\"<>]*/user/reset/[^[:space:]\"<>]*" | head -1)
  [[ $link == "https://$DOMAIN/"* ]] || fail "mailed link is not canonical HTTPS on $DOMAIN: ${link%%/user/*}"
  cu -f -L -o /dev/null -c "$jar" -b "$jar" "$link"
  landing=$(cu -L -o /dev/null -w '%{url_effective}' -c "$jar" -b "$jar" "https://$DOMAIN/user")
  session=$(grep -c $'\tSSESS' "$jar" || true)
  rm -f "$jar"
  # An account without a workspace lands on onboarding, so assert the session, not a page.
  [[ $session -ge 1 && $landing != */user/login* ]] && pass "passwordless sign-in by mail on $DOMAIN ($landing)" || fail "sign-in landed on $landing"
}

snapshot() { # durable identity: user, files, OAuth key, site
  local uid
  uid=$(drush user:information --mail="$USER_MAIL" --fields=uid --format=string)
  printf 'uid=%s\n' "$uid"
  printf 'site=%s\n' "$(drush config:get system.site uuid --format=string)"
  dc exec -T php sh -c 'cd /var/www/html && sha256sum web/sites/default/files/lifecycle-public.bin private-files/lifecycle-private.bin /var/www/oauth-keys/public.key'
}

check_files() {
  local want got code
  want=$(dc exec -T php sha256sum /var/www/html/web/sites/default/files/lifecycle-public.bin | cut -d' ' -f1)
  got=$(cu -f "https://$DOMAIN/sites/default/files/lifecycle-public.bin" | sha256sum | cut -d' ' -f1)
  [ "$want" = "$got" ] && pass "public file served intact" || fail "public file checksum over HTTPS"
  # r4032login turns the anonymous 403 into a redirect to the login form.
  code=$(cu -o /dev/null -w '%{http_code} %{redirect_url}' "https://$DOMAIN/system/files/lifecycle-private.bin")
  [[ $code =~ ^(403|404)\  || $code == "302 https://$DOMAIN/user/login"* ]] && pass "private file denied anonymously ($code)" || fail "private file answered $code anonymously"
}

same_snapshot() { # label expected-file
  local now; now=$(snapshot)
  diff <(echo "$now") "$2" >&2 && pass "$1: user, site, public/private files and OAuth key unchanged" || fail "$1: identity changed"
}

# ------------------------------------------------------------------ install
log "Install $FROM"
record "from: $FROM, to: $TO"
fetch_release "$WORK/a" "$TO"
configure "$WORK/a" lifecycle-a app.selfhost.test 172.31.250.0/24 18443 18080 18025 18444 18081
use_instance app.selfhost.test 18443 18080 18025 18444
record "from image: $(grep -E '^BAKERS_VERSION=' .env | cut -d= -f2)"
[ "$(docker volume ls -q --filter label=com.docker.compose.project=lifecycle-a | wc -l)" = 0 ] || fail "test project lifecycle-a already has volumes"
dc pull
dc up -d
wait_ready
pass "anonymous install of $FROM"
check_edge
dc exec -T php sh -c 'head -c 65536 /dev/urandom > /var/www/html/web/sites/default/files/lifecycle-public.bin && head -c 65536 /dev/urandom > /var/www/html/private-files/lifecycle-private.bin'
sign_in
check_files
snapshot > "$WORK/before.txt"

# ------------------------------------------------------------------ restart
log "Restart"
dc restart php nginx cron traefik
wait_ready
same_snapshot "restart" "$WORK/before.txt"
sign_in

# ------------------------------------------------------------------ backup (guide block)
log "Backup"
backup="$(mktemp -d "$WORK/bakers-backup.XXXXXXXX")"
dc stop traefik nginx php cron
dc exec -T db sh -c 'exec mysqldump --single-transaction --routines --triggers --events -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' > "$backup/database.sql"
dc run --rm --no-deps -T --entrypoint tar php -C /var/www/html/web/sites/default/files -cf - . > "$backup/public.tar"
dc run --rm --no-deps -T --entrypoint tar php -C /var/www/html/private-files -cf - . > "$backup/private.tar"
dc run --rm --no-deps -T --entrypoint tar php -C /var/www/oauth-keys -cf - . > "$backup/oauth.tar"
dc run --rm --no-deps -T --entrypoint tar traefik -C /acme -cf - . > "$backup/acme.tar"
cp .env docker-compose.yml traefik.yml "$backup/"
dc config --images > "$backup/images.txt"
dc images --format json > "$backup/running-images.json"
(cd "$backup" && sha256sum database.sql public.tar private.tar oauth.tar acme.tar > SHA256SUMS)
touch "$backup/COMPLETE"
dc start php nginx cron traefik
wait_ready
pass "consistent backup with writers stopped"

# ------------------------------------------------------------------ update (guide block)
log "Update to $TO"
dc stop traefik nginx php cron
set_env BAKERS_VERSION "$(image_tag "$TO")"
record "to image: $(grep -E '^BAKERS_VERSION=' .env | cut -d= -f2)"
dc config -q
dc pull
dc up -d
wait_ready
same_snapshot "update $FROM -> $TO" "$WORK/before.txt"
check_edge
sign_in
check_files

# ------------------------------------------------------------------ restore (guide block)
log "Restore onto empty storage"
mkdir -p "$WORK/b"
cp "$backup/.env" "$backup/docker-compose.yml" "$backup/traefik.yml" "$WORK/b/"
cd "$WORK/b"
set_env COMPOSE_PROJECT_NAME lifecycle-b
set_env DOMAIN restore.selfhost.test; set_env INTERNAL_SUBNET 172.31.251.0/24; set_env HTTP_PORT 28081
write_overlay 28443 28080 28025 28444
use_instance restore.selfhost.test 28443 28080 28025 28444
[ "$(docker volume ls -q --filter label=com.docker.compose.project=lifecycle-b | wc -l)" = 0 ] || fail "restore target has volumes"
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
dc up -d
wait_ready
same_snapshot "restore of the $FROM backup on empty volumes" "$WORK/before.txt"
sign_in
check_files

log "Source instance intact"
cd "$WORK/a"
use_instance app.selfhost.test 18443 18080 18025 18444
same_snapshot "source after restore" "$WORK/before.txt"

log "Done"
cat "$EVIDENCE"
