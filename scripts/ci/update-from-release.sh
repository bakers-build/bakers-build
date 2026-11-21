#!/usr/bin/env bash
# Proves update hooks on a real old site: installs the latest release image, seeds accounts,
# swaps in this checkout's php image and deploys (updb + cim), then checks the data.
# Only for disposable Docker hosts. `--self-check` tests the version lookup without Docker.
# Env: RELEASE_VERSION (default: newest vX.Y.Z tag), BRANCH_IMAGE_PHP (default: built here),
# UPDATE_REPORT_DIR (default: assets-ai/update-from-release), COMPOSER_AUTH (optional build secret).
set -euo pipefail
repo=${GITHUB_REPOSITORY:-bakers-build/bakers-build}

# Tag names on stdin; prints the highest vX.Y.Z as X.Y.Z.
latest_release() { sed -n 's/^v\([0-9]*\.[0-9]*\.[0-9]*\)$/\1/p' | sort -V | tail -n 1; }

if [ "${1:-}" = --self-check ]; then
  got=$(printf '%s\n' v0.9.0 v0.10.2 v0.10.10 v1.0.0-rc1 main v0.2.0 | latest_release)
  [ "$got" = 0.10.10 ] || { echo "self-check failed: got '$got'" >&2; exit 1; }
  got=$(printf 'main\n' | latest_release)
  [ -z "$got" ] || { echo "self-check failed: no release expected, got '$got'" >&2; exit 1; }
  echo "self-check ok"
  exit 0
fi

cd "$(dirname "$0")/../.."
out=${UPDATE_REPORT_DIR:-assets-ai/update-from-release}
mkdir -p "$out"
exec > >(tee "$out/update-from-release.log") 2>&1
echo "+ bash scripts/ci/update-from-release.sh at $(git rev-parse HEAD)"

version=${RELEASE_VERSION:-$(git ls-remote --tags --refs "https://github.com/$repo.git" | sed 's#.*refs/tags/##' | latest_release)}
[ -n "$version" ] || { echo "no release tag found" >&2; exit 1; }
release_image="ghcr.io/$repo/php:$version"
branch_image=${BRANCH_IMAGE_PHP:-bakers-update/php:branch}
if [ -z "${BRANCH_IMAGE_PHP:-}" ]; then
  secrets=()
  if [ -n "${COMPOSER_AUTH:-}" ]; then secrets+=(--secret id=composer_auth,env=COMPOSER_AUTH); fi
  docker build "${secrets[@]}" --target php -t "$branch_image" .
fi
echo "release $release_image -> branch $branch_image"

export COMPOSE_PROJECT_NAME=update-from-release COMPOSE_FILE=docker-compose.yml COMPOSE_PROFILES=
export DOMAIN=nginx DB_NAME=db DB_USER=db DB_PASSWORD=db DB_ROOT_PASSWORD=root
export DRUPAL_HASH_SALT=update-from-release-hash-salt-not-a-secret REGISTRY_IMAGE_NGINX=unused
cleanup() {
  docker compose logs --no-color > "$out/compose.log" 2>&1 || true
  docker compose down -v --remove-orphans || true
}
trap cleanup EXIT
drush() { docker compose run --rm --no-deps --entrypoint /var/www/html/vendor/bin/drush php "$@"; }

export REGISTRY_IMAGE_PHP=$release_image
docker compose up -d --wait db
docker compose run --rm install
# Accounts as the release stores them: one member with values, one in no workspace.
drush php:eval '
$workspaces = \Drupal::entityTypeManager()->getStorage("bb_workspace")->loadMultiple();
$workspace = reset($workspaces) ?: throw new \RuntimeException("no workspace to join");
$member = \Drupal\user\Entity\User::create(["name" => "update-member", "mail" => "update-member@example.test", "status" => 1,
  "field_developer_title" => "Backend engineer", "field_bb_background" => "PHP and Drupal."]);
$member->save();
\Drupal\og\Og::createMembership($workspace, $member)->save();
\Drupal\user\Entity\User::create(["name" => "update-homeless", "mail" => "update-homeless@example.test", "status" => 1,
  "field_developer_title" => "Designer"])->save();
// Content the new displays preview: a project with a billing account where the release has one.
$types = \Drupal::entityTypeManager();
$group = $types->getStorage("bb_group")->create(["name" => "Update customer", "workspace_id" => $workspace->id(), "owner_user_id" => $member->id()]);
$group->save();
$project = $types->getStorage("bb_project")->create(["name" => "Update project", "key" => "UPD", "group_id" => $group->id(), "owner_user_id" => $member->id()]);
$project->save();
if ($types->hasDefinition("bb_track_account")) {
  $types->getStorage("bb_track_account")->create(["name" => "Update account", "project_id" => $project->id()])->save();
}
echo "seeded\n";'

export REGISTRY_IMAGE_PHP=$branch_image
# The deploy service as production runs it: drush deploy (updb, cim), entity updates, cim.
docker compose run --rm deploy 2>&1 | tee "$out/deploy.log"
# A display import that exhausts memory can still leave drush exiting 0 on some paths.
if grep -q 'Allowed memory size' "$out/deploy.log"; then echo "deploy ran out of memory" >&2; exit 1; fi
drush php:eval '
$member = user_load_by_name("update-member") ?: throw new \RuntimeException("member lost");
$profiles = \Drupal::service(\Drupal\bb_core\Profile\Profiles::class)->ofAccount((int) $member->id());
$values = array_values(array_map(fn ($p) => [$p->position(), $p->background()], $profiles));
$values === [["Backend engineer", "PHP and Drupal."]] || throw new \RuntimeException("profile values: " . json_encode($values));
foreach (["field_developer_title", "field_bb_background"] as $field) {
  \Drupal\field\Entity\FieldStorageConfig::loadByName("user", $field) === NULL || throw new \RuntimeException("$field storage remains");
  \Drupal::database()->schema()->tableExists("user__$field") && throw new \RuntimeException("user__$field table remains");
}
echo "update checks passed\n";'
