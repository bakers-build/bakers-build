#!/usr/bin/env bash
# Only metadata changes; the tested filesystem must remain byte-for-byte identical.
set -euo pipefail
: "${CI_SOURCE_SHA:?}"
[[ "$CI_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]
version=${CI_RELEASE_VERSION:-}
[[ -z "$version" || "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]
timestamp=$(git show -s --format=%ct "$CI_SOURCE_SHA")
[[ "$timestamp" =~ ^[0-9]+$ ]]
labels=(--label "org.opencontainers.image.revision=$CI_SOURCE_SHA")
if [ -n "$version" ]; then labels+=(--label "org.opencontainers.image.version=$version"); fi
for image in php nginx docs; do
  docker tag "bakers-gate/$image:local" "bakers-verified/$image:source"
  printf 'FROM bakers-verified/%s:source\n' "$image" | \
    docker build --network=none --pull=false --provenance=false --sbom=false --build-arg "SOURCE_DATE_EPOCH=$timestamp" \
      "${labels[@]}" -t "bakers-gate/$image:local" -
  docker image inspect "bakers-gate/$image:local" > "gate-reports/$image.json"
  jq -e --slurpfile expected "verified-images/$image.json" --arg revision "$CI_SOURCE_SHA" --arg version "$version" \
    '.[0].RootFS.Layers == $expected[0][0].RootFS.Layers and
     .[0].Config.Labels["org.opencontainers.image.revision"] == $revision and
     ($version == "" or .[0].Config.Labels["org.opencontainers.image.version"] == $version)' \
    "gate-reports/$image.json" > /dev/null
done
