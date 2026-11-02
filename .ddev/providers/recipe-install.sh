#!/bin/bash
# Run inside DDEV. Keep failing install output visible even when DDEV hides import output.
set -u
LABEL="${1:?provider label required}"
SEED_CMD="${2:?seed command path required}"
LOG="/var/www/html/.ddev/.bakers-test/init-${LABEL}.log"
mkdir -p /var/www/html/.ddev/.bakers-test
(
  set -ex
  # Fresh checkouts can have a read-only sites/default directory.
  sudo mkdir -p /var/www/html/web/sites/default/files
  sudo chmod -R 0777 /var/www/html/web/sites/default/files
  drush site:install /var/www/html/recipes/bakers -y
  bash "${SEED_CMD}"
) >"${LOG}" 2>&1
rc=$?
cat "${LOG}" || true
exit "${rc}"
