#!/usr/bin/env bash
set -euo pipefail
: "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}"
owner=${GITHUB_REPOSITORY%%/*}
revision=${CI_SOURCE_SHA:-$GITHUB_SHA}
# Dedicated package names keep rehearsal images away from release channels.
prefix=${REGISTRY_PACKAGE_PREFIX:-bakers-rehearsal}
expected_visibility=${REGISTRY_VISIBILITY:-private}
case "$expected_visibility" in private|public) ;; *) echo 'Invalid registry visibility' >&2; exit 1 ;; esac
package_name() {
  if [ -n "${REGISTRY_PACKAGE_PREFIX:-}" ]; then printf '%s/%s' "$prefix" "$1";
  else printf '%s-%s' "$prefix" "$1"; fi
}
images=(php nginx docs)
mkdir -p gate-reports
for image in "${images[@]}"; do
  package=$(package_name "$image")
  encoded=$(jq -nr --arg value "$package" '$value|@uri')
  response=$(mktemp)
  code=$(curl -sS -o "$response" -w '%{http_code}' -H "Authorization: Bearer $GH_TOKEN" \
    "https://api.github.com/orgs/$owner/packages/container/$encoded")
  case "$code" in
    200) jq -e --arg expected "$expected_visibility" '.visibility == $expected' "$response" > /dev/null ;;
    404) [ "$expected_visibility" = private ] || { echo "Create $package and set its visibility to public first" >&2; exit 1; } ;;
    *) cat "$response" >&2; rm -f "$response"; exit 1 ;;
  esac
  rm -f "$response"
done
printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
trap 'docker logout ghcr.io > /dev/null 2>&1 || true' EXIT
for image in "${images[@]}"; do
  package=$(package_name "$image")
  encoded=$(jq -nr --arg value "$package" '$value|@uri')
  target="ghcr.io/$owner/$package:sha-$revision-run-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
  expected=$(docker image inspect "bakers-gate/$image:local" --format '{{.Id}}')
  docker tag "bakers-gate/$image:local" "$target"
  docker push "$target"
  gh api "orgs/$owner/packages/container/$encoded" --jq '.visibility' | grep -qx "$expected_visibility"
  digest=$(docker image inspect "$target" --format '{{index .RepoDigests 0}}')
  if [ "$expected_visibility" = public ]; then
    anonymous=$(mktemp -d)
    docker --config "$anonymous" pull "$digest"
    rm -rf "$anonymous"
  else
    docker pull "$digest"
  fi
  actual=$(docker image inspect "$digest" --format '{{.Id}}')
  test "$expected" = "$actual"
  printf '%s %s %s\n' "$image" "$digest" "$actual" >> gate-reports/registry.txt
done
