#!/bin/bash
# Shared helpers for bakers-init-playground / bakers-init-test (source, don't exec).
# All functions assume CWD=/var/www/html and run drush against the CURRENT site
# (callers set --uri via the drush-prefix arg when targeting a non-default site).

# Enable HTTP Basic auth transport + JSON:API write. Idempotent.
# Usage: bb_enable_write_transport "<drush-prefix>"
#   drush-prefix: "" for default site, or "--uri=http://bakers-test.ddev.site"
bb_enable_write_transport() {
  local p="${1:-}"
  echo "==> Enabling HTTP Basic auth + JSON:API write"
  drush ${p} pm:install basic_auth -y >/dev/null
  drush ${p} config:set jsonapi.settings read_only 0 -y >/dev/null
}

# Idempotent bb_project upsert.
# Usage: bb_ensure_project "<drush-prefix>" <name>
bb_ensure_project() {
  local p="${1:-}" name="${2}"
  echo "==> Ensuring project '${name}'"
  drush ${p} ev "\$s = \Drupal::entityTypeManager()->getStorage('bb_project'); \$e = \$s->loadByProperties(['name' => '${name}']); \$pr = \$e ? reset(\$e) : \$s->create(['name' => '${name}']); \$pr->save();" >/dev/null
}

# Resolve the http base_url for a site.
# Usage: bb_base_url [<site-host>]   (empty = default site primary URL)
bb_base_url() {
  local host="${1:-}"
  if [ -n "${host}" ]; then
    echo "http://${host}"
  else
    local u="${DDEV_PRIMARY_URL:-https://${DDEV_PROJECT:-bakers}.ddev.site}"
    echo "${u/#https:\/\//http://}"
  fi
}
