#!/bin/bash
# Seed the e2e/test content (bb_e2e recipe) on an installed `bakers` recipe site.
#
# Runs wherever `drush` reaches the site: the DDEV web container (`ddev bakers-init-test`)
# and the CI php image (`e2e` job). It lives outside .ddev/ because the image excludes
# that directory. Writes `fixtures.json` and the `env` file the conductor integration
# suite sources into ARTIFACT_DIR.
#   ARTIFACT_DIR  where the fixture files go (required)
#   BASE_URL      the site URL the suites use (required)
#
# --dates-only re-applies only the relative timestamps (closed dates and the
# statistics demo's tickets and runs) to an already seeded site, so "today"
# and "yesterday" follow the calendar. It needs neither variable and writes no
# fixture files:  ddev exec bash scripts/e2e/seed-test-world.sh --dates-only

set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$PWD/vendor/bin:$PATH"

if [ "${1:-}" = "--dates-only" ]; then
  drush status --fields=bootstrap --format=string 2>/dev/null | grep -q Successful \
    || { echo "ERROR: site not installed." >&2; exit 1; }
  BB_E2E_DATES_MODE=dates-only drush php:script "$PWD/scripts/e2e/relative-dates.php"
  echo "Relative fixture dates refreshed."
  exit 0
fi
: "${ARTIFACT_DIR:?}" "${BASE_URL:?}"

# Single-site: the e2e/test world is seeded onto the one (default) site — there
# is no separate `test` multisite anymore. All drush calls target the default
# site (no --uri).
URI=""
mkdir -p "${ARTIFACT_DIR}"

[ -d vendor ] || { echo "ERROR: vendor/ missing — run 'ddev composer install'." >&2; exit 1; }
drush ${URI} status --fields=bootstrap --format=string 2>/dev/null | grep -q Successful \
  || { echo "ERROR: site not installed — run 'ddev init --recipe --test' first." >&2; exit 1; }

echo "==> Applying bb_e2e recipe"
drush ${URI} recipe "$PWD/recipes/bb_e2e" -y

# The default workspace exists before the recipe runs (bb_core_install()), and
# recipe content import skips an existing uuid, so its e2e name is set here.
drush ${URI} ev '
$ws = \Drupal::entityTypeManager()->getStorage("bb_workspace")->loadByProperties(["uuid" => \Drupal\bb_core\Entity\BbWorkspace::DEFAULT_UUID]);
reset($ws)->set("name", "Northside Bakery")->save();
'

echo "==> Enabling HTTP Basic auth + JSON:API write"
drush ${URI} pm:install basic_auth -y >/dev/null
drush ${URI} config:set jsonapi.settings read_only 0 -y >/dev/null
drush ${URI} cr >/dev/null

# Every project needs a resolvable billing account before workers start:
# account_id is required on Worklog and is resolved from the ticket's linked
# account, else the project default. The recipe seeds defaults for the
# projects its worklog fixtures use; this pass creates the default for every
# project that still has none.
drush ${URI} ev '
$types = \Drupal::entityTypeManager();
\Drupal::currentUser()->setAccount($types->getStorage("user")->load(1));
$assignments = \Drupal::service("bb_track.assignments");
foreach ($types->getStorage("bb_project")->loadMultiple() as $project) {
  $assignments->createDefaultAccount($project);
}
'

# Historical approved evidence predates week snapshots. Seed it only here;
# ordinary entity writes must never be able to manufacture an approval.
drush ${URI} ev '
\Drupal::database()->update("bb_track_worklog")
  ->fields(["state" => "approved"])
  ->condition("uuid", "612a0000-0000-4000-8000-000000000021")->execute();
\Drupal::entityTypeManager()->getStorage("bb_track_worklog")->resetCache();
'

# The designbook-mirrored fixtures cannot carry their state_machine `state` in
# default_content (the importer sets the field's value property directly,
# bypassing StateItem::setValue, so validation rejects the null->X transition).
# Apply the intended states from the recipe's fixture-states.yml here instead;
# Entity::set() routes through StateItem::setValue and is accepted. The same
# Relative dates follow in relative-dates.php.
echo "==> Applying fixture states"
drush ${URI} ev '
$map = \Symfony\Component\Yaml\Yaml::parseFile(DRUPAL_ROOT . "/../recipes/bb_e2e/fixture-states.yml");
$etm = \Drupal::entityTypeManager();
$ts = $etm->getStorage("bb_ticket");
foreach (($map["bb_ticket"] ?? []) as $ident => $state) {
  foreach ($ts->loadByProperties(["identifier" => $ident]) as $t) { $t->set("state", $state)->save(); }
}
$rs = $etm->getStorage("bb_run");
foreach (($map["bb_run"] ?? []) as $uuid => $state) {
  $runs = $rs->loadByProperties(["uuid" => $uuid]);
  if ($runs) { $r = reset($runs); $r->set("state", $state)->save(); }
}
' >/dev/null

# Closed dates and the statistics demo sit on calendar days before now; the
# full seed also creates the demo project, tickets and runs when missing.
echo "==> Applying relative dates and the statistics demo"
BB_E2E_DATES_MODE=seed drush ${URI} php:script "$PWD/scripts/e2e/relative-dates.php"

echo "==> Refreshing fixture run leases (avoid wall-clock 403)"
drush ${URI} ev '
$now = \Drupal::time()->getRequestTime();
$rs = \Drupal::entityTypeManager()->getStorage("bb_run");
$ids = $rs->getQuery()->accessCheck(FALSE)->condition("state", ["claimed","running"], "IN")->execute();
foreach ($rs->loadMultiple($ids) as $r) { $r->set("claim_expires_at", $now + 3600)->save(); }
' >/dev/null

echo "==> OAuth keys"
mkdir -p /var/www/oauth-keys
if [ ! -f /var/www/oauth-keys/private.key ] || [ ! -f /var/www/oauth-keys/public.key ]; then
  drush ${URI} simple-oauth:generate-keys /var/www/oauth-keys >/dev/null
fi
drush ${URI} config:set simple_oauth.settings public_key /var/www/oauth-keys/public.key -y >/dev/null
drush ${URI} config:set simple_oauth.settings private_key /var/www/oauth-keys/private.key -y >/dev/null

# One PHP pass writes both files; the wodby image ships no jq.
drush ${URI} ev '
$etm = \Drupal::entityTypeManager();
$first = static fn(array $r) => $r ? reset($r) : null;
$user = $first($etm->getStorage("user")->loadByProperties(["name"=>"fixture-agent"]));
$ticket = $first($etm->getStorage("bb_ticket")->loadByProperties(["identifier"=>"GL-E2E-DROPSH"]));
$conductor = $first($etm->getStorage("bb_conductor")->loadByProperties(["conductor_id"=>"bakers-e2e-node"]));
$project = $first($etm->getStorage("bb_project")->loadByProperties(["name"=>"bakers-e2e-project"]));
$labels = array_values($etm->getStorage("bb_term")->loadByProperties(["vid"=>"label"]));
$runs = array_values($etm->getStorage("bb_run")->loadMultiple());
$fixture = [
  "user_uuid" => $user?->uuid(), "ticket_uuid" => $ticket?->uuid(),
  "conductor_uuid" => $conductor?->uuid(),
  "run_uuid" => $runs ? reset($runs)->uuid() : null,
  "label_uuid" => isset($labels[0]) ? $labels[0]->uuid() : null,
  "label_two_uuid" => isset($labels[1]) ? $labels[1]->uuid() : null,
  "project_uuid" => $project?->uuid(),
  "base_url" => getenv("BASE_URL"),
];
$dir = getenv("ARTIFACT_DIR");
file_put_contents("$dir/fixtures.json", json_encode($fixture, JSON_PRETTY_PRINT) . "\n") or throw new \RuntimeException("Cannot write $dir/fixtures.json");
$env = [
  "BB_E2E_BASE_URL" => $fixture["base_url"],
  "BB_E2E_BASIC" => base64_encode("fixture-agent:bakers-e2e-agent-secret"),
  "BB_E2E_TICKET_UUID" => $fixture["ticket_uuid"],
  "BB_E2E_CONDUCTOR_UUID" => $fixture["conductor_uuid"],
  "BB_E2E_USER_UUID" => $fixture["user_uuid"],
  "BB_E2E_LABEL_UUID" => $fixture["label_uuid"],
  "BB_E2E_LABEL_TWO_UUID" => $fixture["label_two_uuid"],
  "BB_E2E_PROJECT_UUID" => $fixture["project_uuid"],
];
file_put_contents("$dir/env", implode("", array_map(fn($k, $v) => "export $k=\"$v\"\n", array_keys($env), $env))) or throw new \RuntimeException("Cannot write $dir/env");
'

echo "bakers.build test content seeded; fixtures at ${ARTIFACT_DIR} (base ${BASE_URL}); no dropsh.config.js"
