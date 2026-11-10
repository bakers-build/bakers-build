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
#   - the standalone operator file (docker/compose/) renders from its .env.example,
#     requires its inputs and is the one the self-hosting docs show
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
  COMPOSE_PROJECT_NAME=bakers-contract DOMAIN=dummy.example.test \
  STACK_NAME=dummy-stack \
  DB_NAME=dummy DB_USER=dummy DB_PASSWORD=dummy-pw DB_ROOT_PASSWORD=dummy-root-pw \
  DRUPAL_HASH_SALT=dummy-salt \
  REGISTRY_IMAGE_PHP=dummy/php:dummy REGISTRY_IMAGE_NGINX=dummy/nginx:dummy \
  REGISTRY_IMAGE_E2E=dummy/e2e:dummy REGISTRY_IMAGE_DOCS=dummy/docs:dummy \
  DOCS_DOMAIN=docs.example.test DOCS_ALIAS_DOMAIN=www.docs.example.test \
    docker compose -f docker-compose.yml -f "$overlay" "$@" config ${RENDER_FORMAT:+--format=$RENDER_FORMAT}
}

# Run-log storage: SaaS pins the flag off even when the shell sets it.
flag_of() {
  RENDER_FORMAT=json "$@" | python3 -c '
import json, sys
s = json.load(sys.stdin)["services"]
print(" ".join(sorted({s[n]["environment"].get("FEATURE_FLAG_RUN_LOG_STORAGE", "unset") for n in ("php", "cron", "deploy", "install") if n in s})))
'
}
[ "$(FEATURE_FLAG_RUN_LOG_STORAGE=1 flag_of render docker-compose.traefik.yml)" = "0" ] \
  || fail "SaaS stack does not pin FEATURE_FLAG_RUN_LOG_STORAGE=0 on php, cron and deploy"
[ "$(FEATURE_FLAG_RUN_LOG_STORAGE=1 flag_of render docker-compose.traefik.yml --profile install)" = "0" ] \
  || fail "SaaS install service does not pin the run-log flag off"
pass "run-log storage flag is pinned off in SaaS"

# The operator compose file (docker/compose/) is standalone: it renders from its own
# filled .env.example alone, with no ambient environment and no other compose file.
RENDER_FORMAT=json render docker-compose.traefik.yml --profile install > "${TMPDIR:-/tmp}/bakers-base.json"
BASE_JSON="${TMPDIR:-/tmp}/bakers-base.json" python3 <<'PYTEST'
import json, os, re, shutil, subprocess, tempfile
src = "docker/compose"
required = dict(BAKERS_VERSION="1.2.3", DOMAIN="app.example.test", ADMIN_EMAIL="admin@example.test",
    DB_PASSWORD="dummy-pw", DB_ROOT_PASSWORD="dummy-root-pw", HASH_SALT="dummy-salt",
    MAIL_SMTP_DSN="smtp://smtp.example.test:587", MAIL_FROM_ADDRESS="sender@example.test")
example = open(f"{src}/.env.example").read()
keys = re.findall(r"^([A-Z_][A-Z0-9_]*)=", example, re.M)
assert set(required) <= set(keys), f"missing in .env.example: {set(required) - set(keys)}"
work = tempfile.mkdtemp()
shutil.copy(f"{src}/docker-compose.yml", work)
shutil.copy(f"{src}/traefik.yml", work)

def run(values, *args, files=("docker-compose.yml",)):
    lines = [l for l in example.splitlines() if not re.match(r"^[A-Z_][A-Z0-9_]*=", l) or l.split("=")[0] not in values]
    lines += [f"{k}={v}" for k, v in values.items()]
    open(f"{work}/.env", "w").write("\n".join(lines) + "\n")
    cmd = ["docker", "compose", "--project-name", "bakers-operator"]
    for f in files:
        cmd += ["-f", f]
    env = {"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", work)}
    return subprocess.run(cmd + list(args), cwd=work, env=env, capture_output=True, text=True)

r = run(required, "--profile", "install", "config", "--format", "json")  # no install profile: renders the same
assert r.returncode == 0, r.stderr
assert "BB_SELF_HOSTED" not in r.stdout, "the operator stack still sets a self-hosted mode switch"
c = json.loads(r.stdout)
s = c["services"]
assert set(s) == {"init-perms", "db", "deploy", "php", "nginx", "cron"}, set(s)
assert s["php"]["image"] == "ghcr.io/bakers-build/bakers-build/php:1.2.3"
assert s["nginx"]["image"] == "ghcr.io/bakers-build/bakers-build/nginx:1.2.3"
subnet = c["networks"]["internal"]["ipam"]["config"][0]["subnet"]
assert subnet == "172.30.42.0/24", subnet
for name in ("deploy", "php", "cron"):
    e = s[name]["environment"]
    # Empty by default: settings.container.php then trusts any private-network proxy.
    assert e["TRUSTED_PROXY_SUBNET"] == "", name
    assert e["DRUPAL_HASH_SALT"] == "dummy-salt", name
    assert e["DOMAIN"] == "app.example.test", name
    assert e["FEATURE_FLAG_RUN_LOG_STORAGE"] == "0", name
    assert not s[name].get("ports"), name
assert not s["db"].get("ports")
assert [(p["host_ip"], str(p["published"]), p["target"]) for p in s["nginx"]["ports"]] == [("127.0.0.1", "8080", 80)]
assert s["deploy"]["environment"]["ADMIN_EMAIL"] == "admin@example.test"
for name in ("php", "cron"):
    assert s[name]["environment"]["MAIL_SMTP_DSN"] == "smtp://smtp.example.test:587", name

base = json.load(open(os.environ["BASE_JSON"]))["services"]
script = ["/var/www/html/scripts/deploy/site-deploy.sh"]
assert s["deploy"]["command"] == script, s["deploy"]["command"]
assert base["deploy"]["command"] == script, "docker-compose.yml deploy does not run site-deploy.sh"
assert s["cron"]["command"] == ["/var/www/html/scripts/deploy/site-cron.sh"], s["cron"]["command"]
# Operators read and fill these files; they speak of bakers, not of the framework underneath.
assert "drupal" not in example.lower() and "drush" not in example.lower(), ".env.example names Drupal or Drush"
assert "drush" not in open(f"{src}/docker-compose.yml").read().lower(), "the operator compose file runs drush itself"

r = run({**required, "TRUSTED_PROXY_SUBNET": "172.18.0.0/16"}, "config", "--format", "json")
assert r.returncode == 0, r.stderr
assert {json.loads(r.stdout)["services"][n]["environment"]["TRUSTED_PROXY_SUBNET"] for n in ("php", "cron", "deploy")} == {"172.18.0.0/16"}

r = run({**required, "FEATURE_FLAG_RUN_LOG_STORAGE": "1"}, "config", "--format", "json")
assert r.returncode == 0, r.stderr
assert {json.loads(r.stdout)["services"][n]["environment"]["FEATURE_FLAG_RUN_LOG_STORAGE"] for n in ("php", "cron", "deploy")} == {"1"}

for name in required:
    r = run({**required, name: ""}, "config", "-q")
    assert r.returncode != 0, f"Missing {name} was accepted"
    assert name in r.stderr, r.stderr

r = run(required, "config", "--format", "json", files=("docker-compose.yml", "traefik.yml"))
assert r.returncode == 0, r.stderr
c = json.loads(r.stdout)
t = c["services"]["traefik"]
assert {str(p["published"]) for p in t["ports"]} == {"80", "443"}
assert "internal" in t["networks"]
assert "traefik.http.routers.bakers.rule" in c["services"]["nginx"]["labels"]

for doc, file in (("docs/self-hosting/server.md", "docker-compose.yml"), ("docs/self-hosting/server.md", ".env.example"), ("docs/self-hosting/proxy.md", "traefik.yml")):
    assert open(f"{src}/{file}").read() in open(doc).read(), f"{doc} does not show {src}/{file} verbatim"
shutil.rmtree(work)
PYTEST
pass "operator compose file is standalone, trusts a private proxy, requires its inputs and matches the docs"

# The hosted stack, like the operator one: its own host and its own salt. The proxy sits on
# a shared host network, so settings.container.php trusts private peers, not a pinned subnet.
BASE_JSON="${TMPDIR:-/tmp}/bakers-base.json" python3 <<'PYTEST'
import json, os, subprocess
c = json.load(open(os.environ["BASE_JSON"]))
s = c["services"]
assert not c["networks"]["internal"].get("ipam", {}).get("config"), "the hosted stack pins a subnet that may clash on a shared host"
for name in ("deploy", "install", "php", "cron"):
    e = s[name]["environment"]
    assert e.get("DOMAIN") == "dummy.example.test", name
    assert "TRUSTED_PROXY_SUBNET" not in e, name
assert all("NGINX_ERROR_LOG_LEVEL" not in v.get("environment", {}) for v in s.values()), "a service sets the nginx error log level"
env = {**os.environ, "COMPOSE_PROJECT_NAME": "bakers-contract", "DOMAIN": "dummy.example.test", "STACK_NAME": "dummy-stack",
       "DB_NAME": "dummy", "DB_USER": "dummy", "DB_PASSWORD": "dummy-pw", "DB_ROOT_PASSWORD": "dummy-root-pw",
       "DRUPAL_HASH_SALT": "dummy-salt",
       "REGISTRY_IMAGE_PHP": "dummy/php:dummy", "REGISTRY_IMAGE_NGINX": "dummy/nginx:dummy"}
for name in ("DOMAIN", "DRUPAL_HASH_SALT"):
    r = subprocess.run(["docker", "compose", "-f", "docker-compose.yml", "-f", "docker-compose.traefik.yml", "--profile", "install", "config", "-q"],
                       env={**env, name: ""}, capture_output=True, text=True)
    assert r.returncode != 0, f"the hosted stack renders without {name}"
    assert name in r.stderr, r.stderr
PYTEST
pass "hosted stack requires DOMAIN and DRUPAL_HASH_SALT, pins no subnet and logs no debug"

# site-deploy.sh installs only a reachable, empty database and updates only an installed one.
python3 <<'PYTEST'
import os, subprocess, tempfile
work = tempfile.mkdtemp()
log = f"{work}/drush.log"
stub = f"{work}/drush"
open(stub, "w").write("""#!/bin/sh
echo "$*" >> "$LOG"
case "$1" in
  sql:query)
    [ "$DB_UP" = 1 ] || { echo "ERROR 2002: Can't connect to server" >&2; exit 1; }
    case "$*" in *"'config'"*) echo "$HAS_CONFIG" ;; *) echo "$TABLES" ;; esac ;;
  *)
    echo "drush output for $*"; echo " [notice] Drupal says $*" >&2
    if [ -n "$FAIL_ON" ]; then case "$*" in *"$FAIL_ON"*) exit 1 ;; esac; fi ;;
esac
""")
os.chmod(stub, 0o755)
def run(db_up, tables, has_config, admin="admin@example.test", fail_on=""):
    open(log, "w").close()
    env = {"PATH": os.environ["PATH"], "DRUSH": stub, "LOG": log, "OAUTH_KEYS": f"{work}/keys",
           "DB_UP": db_up, "TABLES": tables, "HAS_CONFIG": has_config, "ADMIN_EMAIL": admin, "DOMAIN": "app.example.test", "FAIL_ON": fail_on}
    r = subprocess.run(["sh", "scripts/deploy/site-deploy.sh"], env=env, capture_output=True, text=True)
    if r.returncode == 0:
        out = r.stdout + r.stderr
        assert all(l.startswith("[bakers] ") for l in out.splitlines()), out
        assert "drush" not in out.lower() and "drupal" not in out.lower(), out
    return r, open(log).read()
r, calls = run("0", "0", "0")
assert r.returncode != 0 and "site:install" not in calls and "deploy" not in calls.replace("sql:query", ""), (r, calls)
assert "ERROR 2002: Can't connect to server" in r.stderr, "an unreachable database shows why"
r, calls = run("1", "0", "0")
assert r.returncode == 0, r.stderr
# drush hands the client a --defaults-file, so the image's my.cnf.d TLS opt-out never applies.
queries = [l for l in calls.splitlines() if l.startswith("sql:query")]
assert queries and all("--extra=--skip-ssl" in l for l in queries), calls
assert "site:install --existing-config --account-mail=admin@example.test\n" in calls, calls
assert "admin@example.test" in r.stdout and "account-pass" not in r.stdout, r.stdout
r, calls = run("1", "0", "0", admin="")
assert r.returncode != 0 and "site:install" not in calls, calls
r, calls = run("1", "57", "1")
assert r.returncode == 0, r.stderr
assert "-y deploy" in calls and "site:install" not in calls, calls
assert "sql:dump" not in calls, "the dump runs before the update, not inside it"
r, calls = run("1", "57", "1", fail_on="-y deploy")
assert r.returncode != 0 and "drush output for -y deploy" in r.stderr and "[bakers] " in r.stderr, r
# A failure while the development module is on still takes it off again.
for step in ("-y devel-entity-updates", "-y config:import"):
    r, calls = run("1", "57", "1", fail_on=step)
    assert r.returncode != 0, (step, r)
    assert calls.splitlines()[-1] == "-y pm:uninstall devel_entity_updates devel", (step, calls)
r, calls = run("1", "57", "1")
assert "pm:uninstall" not in calls, calls
r, calls = run("1", "3", "0")
assert r.returncode != 0 and "site:install" not in calls and "-y deploy" not in calls, calls
PYTEST
pass "site-deploy.sh installs only an empty database and updates only an installed site"

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

# Loading the distributed project configuration must not enable a provider: the transport
# belongs to each machine's own ports entry (~/.bakers/machine.config.js).
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const path = '.bakers/project.config.js';
assert.doesNotMatch(readFileSync(path, 'utf8'), /^\s*import\s|await import\(/m, 'the project config imports no local file');
const config = (await import(pathToFileURL(path))).default;
assert.equal(config.addons[0], '@bakers-build/addon-ddev');
const ports = config.addons.find((a) => a?.use === '@bakers-build/addon-ports');
assert.ok(ports, 'the project lists its preview services');
assert.equal(ports.with.transport, undefined, 'the committed project must not register a transport');
JS
pass "workspace preview requires explicit machine provider configuration"

# Coder startup must not download or start unselected tunnel providers.
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'bakers-coder-'));
try {
  const bin = join(dir, 'bin'); mkdirSync(bin);
  for (const tool of ['ss', 'bakers', 'herdr', 'claude', 'codex', 'cursor-agent', 'gh', 'glab', 'setsid', 'nohup']) {
    writeFileSync(join(bin, tool), '#!/bin/sh\nexit 0\n', {mode: 0o755});
  }
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho unexpected-download >&2\nexit 91\n', {mode: 0o755});
  const result = spawnSync('bash', ['coder/bakers-ddev/scripts/install.sh'], {
    encoding: 'utf8', env: {HOME: dir, TMPDIR: dir, PATH: `${bin}:/usr/bin:/bin`, FRP_VERSION: 'unused', CLOUDFLARED_VERSION: 'unused'}
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /(?:frpc|cloudflared): installing/);
  const template = readFileSync('coder/bakers-ddev/template.tf', 'utf8');
  const image = template.match(/variable "image" \{[\s\S]*?\n\}/)?.[0];
  assert.ok(image, 'image input exists');
  assert.doesNotMatch(image, /default\s*=/, 'Coder image must be explicitly supplied');
} finally { rmSync(dir, {recursive: true, force: true}); }
JS
pass "Coder requires an image and leaves tunnel providers unselected"

pass "compose.sh"
