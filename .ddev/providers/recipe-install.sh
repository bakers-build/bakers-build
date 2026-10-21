#!/bin/bash
# Shared recipe-as-installer body for the `recipe` and `recipe-test` DDEV providers (BB-142).
# Extracted so the PROFILE-resolution + logging scaffold lives in ONE place (review finding #4:
# the block was byte-identical in recipe.yaml and recipe-test.yaml — a drift risk). A `.sh` file
# under .ddev/providers/ is ignored by DDEV's provider discovery (it reads only *.yaml), and the
# whole project root is mounted into the web container, so this is invokable in-container at
# /var/www/html/.ddev/providers/recipe-install.sh (same as the bakers-init-* commands the providers
# already call). Project-owned (no addon marker) — `ddev add-on get` never touches it.
#
# Runs IN the web container (invoked from each provider's db_import_command). Args:
#   $1 = provider label (used for the log filename + header line): "recipe" | "recipe-test"
#   $2 = absolute path to the in-container seed command (bakers-init-playground | bakers-init-test)
#
# PROFILE resolution: prefer INIT_PROFILE (surfaced from .keytec-ai.yml by the addon's
# config.keytec.yaml pre-start hook via `keytec-ai config to-env`), but that hook needs `npx` on
# the HOST — which the CI runner image (ddev-gitlab-ci) lacks, so INIT_PROFILE arrives unset there.
# Rather than silently install the wrong `minimal` profile (not a recipe; fails the private-files
# requirements check that recipe-as-installer defers), fall back to reading init.profile straight
# from .keytec-ai.yml in the container — the same self-contained read the former local init did,
# with no keytec-ai/npx dependency.
#
# DDEV swallows db_import_command output in non-interactive mode (CI), so a failing drush step is
# invisible in the job trace ("Pull failed: exit status 1" with no cause). We therefore tee the
# whole import to .ddev/.bakers-test/init-<label>.log — an uploaded CI artifact — and re-emit it.
set -u

LABEL="${1:?provider label required}"
SEED_CMD="${2:?seed command path required}"

LOG="/var/www/html/.ddev/.bakers-test/init-${LABEL}.log"
mkdir -p /var/www/html/.ddev/.bakers-test

URI_ARG=""
if [ -n "${KEYTEC_AI_SITE:-}" ] && [ "${KEYTEC_AI_SITE}" != "default" ]; then
  URI_ARG="--uri=${KEYTEC_AI_SITE}"
fi

PROFILE="${INIT_PROFILE:-}"
if [ -z "${PROFILE}" ]; then
  PROFILE="$(awk '/^init:/{f=1;next} /^[^[:space:]#]/{f=0} f&&$1=="profile:"{print $2;exit}' /var/www/html/.keytec-ai.yml 2>/dev/null || true)"
fi
PROFILE="${PROFILE:-minimal}"

# `web/sites/default` is read-only on a fresh CI checkout (settings.php is mode
# 444, disable_settings_management), so an install that writes under the public
# files dir — a fresh public://simpletest, an .htaccess, or (since BB-507's
# `user_picture` field) a recipe default_content image landing under
# public://pictures/ — fails with a permission error instead of creating the
# directory. `sudo` is required: a plain `mkdir` under a read-only parent is
# `Permission denied`, and the web container carries passwordless sudo.
# Provision it before the install writes anything there.
sudo mkdir -p /var/www/html/web/sites/default/files
sudo chmod -R 0777 /var/www/html/web/sites/default/files

{
  echo "=== ${LABEL} db_import ==="
  echo "INIT_PROFILE=${INIT_PROFILE:-<unset>} resolved PROFILE=${PROFILE} KEYTEC_AI_SITE=${KEYTEC_AI_SITE:-<unset>}"
  echo "PWD=$(pwd) whoami=$(whoami) drush=$(command -v drush || echo MISSING)"
  set -ex
  # shellcheck disable=SC2086  # URI_ARG is an intentional optional single token
  drush ${URI_ARG} site:install "${PROFILE}" -y
  bash "${SEED_CMD}"
} >"${LOG}" 2>&1 && rc=0 || rc=$?
cat "${LOG}" || true
exit "${rc}"
