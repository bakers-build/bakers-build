#!/bin/bash
## Verifies recipes/bakers installs a minimal, node-free bakers.build control-plane.
## Run inside ddev: ddev exec bash /var/www/html/recipes/bakers/tests/verify-install.sh
set -euo pipefail
cd /var/www/html

drush site:install /var/www/html/recipes/bakers -y

fail=0

# Required modules present.
for m in bb_core bb_connector simple_oauth jsonapi_resources; do
  if ! drush pm:list --status=enabled --type=module --format=list | grep -qx "$m"; then
    echo "FAIL: module $m not enabled"; fail=1
  fi
done

# bb_import was retired (BB-554) and the module has been removed.
if drush pm:list --status=enabled --type=module --format=list | grep -qx bb_import; then
  echo "FAIL: bb_import is installed; it was retired."; fail=1
fi

# Must stay node/media free (the whole point of the taxonomy decoupling).
for m in node media taxonomy; do
  if drush pm:list --status=enabled --type=module --format=list | grep -qx "$m"; then
    echo "FAIL: $m must NOT be enabled (minimal control-plane)"; fail=1
  fi
done

# gin is the admin theme.
if [ "$(drush config:get system.theme admin --format=string)" != "gin" ]; then
  echo "FAIL: admin theme is not gin"; fail=1
fi

# Vocabulary bundles ship as bb_vocabulary config (recipes/bakers/config).
for v in type recipe label; do
  got="$(drush ev "print \Drupal::entityTypeManager()->getStorage('bb_vocabulary')->load('$v') ? 'yes' : 'no';")"
  if [ "$got" != "yes" ]; then
    echo "FAIL: bb_vocabulary '$v' missing"; fail=1
  fi
done

if [ "$fail" = "0" ]; then
  echo "PASS: bakers recipe install verified (node-free)"
else
  exit 1
fi
