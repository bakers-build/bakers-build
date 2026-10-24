#!/bin/bash
# Run the conductor Vitest integration suite against a seeded bb_e2e site.
#
# Runs wherever `drush` reaches the site and bakers-cli is built: the DDEV web container
# (`ddev bakers-test-integration`) and the CI e2e runner image. It mutates the pristine
# seed, so it runs after the browser suite. Usage: run-integration.sh <env file>
# (the `env` file scripts/e2e/seed-test-world.sh wrote).

set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE="${1:?env file required}"
# Single-site: the e2e fixtures live on the one (default) site — no multisite.
TEST_URI=""

set -a
source "${ENV_FILE}"
set +a

echo "==> Resolving dispatchable conductor fixture"
BB_E2E_CONDUCTOR_TICKET_UUID="$(drush ${TEST_URI} ev '
$etm = \Drupal::entityTypeManager();
$ticket_storage = $etm->getStorage("bb_ticket");
$tickets = $ticket_storage->loadByProperties(["identifier" => "GL-E2E-CONDUCTOR"]);
if (!$tickets) {
  fwrite(STDERR, "ERROR: GL-E2E-CONDUCTOR ticket not found — apply bb_e2e recipe first.\n");
  exit(1);
}
$ticket = reset($tickets);

// Delete any existing runs so the conductor can claim a fresh one.
$run_storage = $etm->getStorage("bb_run");
$run_ids = $run_storage->getQuery()
  ->accessCheck(FALSE)
  ->condition("ticket_id", $ticket->id())
  ->execute();
foreach ($run_storage->loadMultiple($run_ids) as $run) {
  $run->delete();
}

// Reset ticket to claimable state.
$ticket->set("state", "coding");
$ticket->save();
print $ticket->uuid();
' 2>/dev/null)"
export BB_E2E_CONDUCTOR_TICKET_UUID

echo "==> Resolving waiting_for_input fixture"
BB_E2E_WFI_RUN_UUID="$(drush ${TEST_URI} ev '
$etm = \Drupal::entityTypeManager();

$ticket_storage = $etm->getStorage("bb_ticket");
$tickets = $ticket_storage->loadByProperties(["identifier" => "GL-E2E-WFI"]);
if (!$tickets) {
  fwrite(STDERR, "ERROR: GL-E2E-WFI ticket not found — apply bb_e2e recipe first.\n");
  exit(1);
}
$ticket = reset($tickets);

$run_storage = $etm->getStorage("bb_run");
$run_ids = $run_storage->getQuery()
  ->accessCheck(FALSE)
  ->condition("ticket_id", $ticket->id())
  ->execute();
$runs = $run_storage->loadMultiple($run_ids);
if (!$runs) {
  fwrite(STDERR, "ERROR: No bb_run found for GL-E2E-WFI — apply bb_e2e recipe first.\n");
  exit(1);
}

$run = reset($runs);
// Ensure run is in the expected initial state for the test.
if ($run->get("state")->value !== "running") {
  $run->set("state", "running");
  $run->save();
}
print $run->uuid();
' 2>/dev/null)"
export BB_E2E_WFI_RUN_UUID

echo "==> Running bakers.build Vitest integration suite"
(
  cd bakers-cli
  CI=true npx --yes pnpm run test:integration
)

echo "bakers.build conductor integration E2E passed."
