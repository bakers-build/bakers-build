#!/bin/sh
# Fill this environment's host into the marketplace's archive URL, so one image serves every
# environment with the same zip and sha256 (docs/scripts/marketplace.mjs).
set -eu
: "${DOCS_DOMAIN:?DOCS_DOMAIN is not set}"
sed -i "s|\${DOCS_DOMAIN}|$DOCS_DOMAIN|g" /usr/share/nginx/html/marketplace.json
