#!/usr/bin/env bash
# Only for disposable CI runners: never point this at a deployment daemon.
set -euo pipefail
revision=${CI_SOURCE_SHA:-$GITHUB_SHA}
source_ref=${CI_SOURCE_REF:-$GITHUB_REF_NAME}
mkdir -p gate-reports
images=(php php-test nginx docs)
labels=()
if [ -n "${CI_RELEASE_VERSION:-}" ]; then labels+=(--label "org.opencontainers.image.version=$CI_RELEASE_VERSION"); fi
for image in "${images[@]}"; do
  docker build "${labels[@]}" --target "$image" --label "org.opencontainers.image.revision=$revision" \
    --build-arg "CI_COMMIT_REF_NAME=$source_ref" --build-arg "CI_COMMIT_SHORT_SHA=${revision:0:8}" \
    -t "bakers-gate/$image:local" .
done
docker build -f docker/e2e/Dockerfile -t bakers-gate/e2e:local .
for image in php php-test nginx docs e2e; do
  docker image inspect "bakers-gate/$image:local" > "gate-reports/$image.json"
done
printf '%s\n' "commit=$revision" "tree=$(git rev-parse 'HEAD^{tree}')" "run=$GITHUB_RUN_ID" "attempt=$GITHUB_RUN_ATTEMPT" > gate-reports/candidate.txt

docker run --name phpunit --user root -e SIMPLETEST_DB=sqlite://localhost/:memory: \
  bakers-gate/php-test:local sh -c 'cd /var/www/html && ./vendor/bin/paratest --configuration=phpunit.xml --testsuite unit-kernel --processes 8 --log-junit /tmp/junit.xml' || phpunit_status=$?
docker cp phpunit:/tmp/junit.xml gate-reports/junit-phpunit.xml
if [ "${phpunit_status:-0}" != 0 ]; then exit "$phpunit_status"; fi

export COMPOSE_PROJECT_NAME=github-recipe
export COMPOSE_FILE=docker-compose.yml:docker/e2e/compose.yml
export COMPOSE_PROFILES=e2e
cleanup() {
  docker compose logs --no-color > "gate-reports/$COMPOSE_PROJECT_NAME.log" 2>&1 || true
  docker compose down -v --remove-orphans || true
}
trap cleanup EXIT
docker compose run --rm install
docker compose up -d --no-build --wait php nginx mailpit
status=0
docker compose run --name github-browser --no-deps runner bash -c '
cd tests/playwright && npm run typecheck && npm run test:unit || exit 1
status=0
npm test -- --retries=1 --workers=4 || status=$?
bash /repo/scripts/e2e/run-integration.sh /bakers-test/env || status=1
exit $status' || status=$?
for path in tests/playwright/junit-playwright.xml tests/playwright/playwright-report tests/playwright/test-results .ddev/.bakers-test/junit-integration.xml; do
  docker cp "github-browser:/repo/$path" gate-reports/ || true
done
cleanup
if [ "$status" != 0 ]; then exit "$status"; fi
# A separate database proves config/sync without importing it into the recipe world.
export COMPOSE_PROJECT_NAME=github-config
export COMPOSE_FILE=docker-compose.yml
export COMPOSE_PROFILES=install
docker compose run --rm install
docker compose run --rm --no-deps --entrypoint /var/www/html/vendor/bin/drush php -y cim
docker compose run --rm --no-deps --entrypoint /var/www/html/vendor/bin/drush php cr
docker compose run --rm --no-deps --entrypoint /var/www/html/vendor/bin/drush php status
