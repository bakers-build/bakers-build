#!/bin/sh
# Runs the bakers.build scheduled tasks every CRON_INTERVAL seconds; a failed pass is retried next time.
export DRUSH_OPTIONS_URI="${DRUSH_OPTIONS_URI:-${DOMAIN:+https://$DOMAIN}}"
while true; do
  /var/www/html/vendor/bin/drush core:cron >/dev/null 2>&1 \
    || echo "[bakers] scheduled tasks failed; retrying in ${CRON_INTERVAL:-300}s" >&2
  sleep "${CRON_INTERVAL:-300}"
done
