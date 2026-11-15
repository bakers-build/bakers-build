#!/usr/bin/env bash
# Fixed host entry point for the project's provision_up profiles and provision_exec keys.
#   .bakers/provision.sh <profile>
#   .bakers/provision.sh exec <key> [-- <argv…>]
# Each key runs one fixed command in the DDEV web container; keys with `args: true` pass only
# arguments that match the safe pattern below, never one starting with `-`.
set -euo pipefail

usage() { echo 'Usage: .bakers/provision.sh <profile> | exec <key> [-- <argv…>]' >&2; exit 1; }
safe() {
  local arg
  for arg in "$@"; do
    [[ "$arg" =~ ^[A-Za-z0-9_][A-Za-z0-9_./:@%=+,-]*$ ]] || { echo "Refused argument: $arg" >&2; exit 1; }
  done
}
web() {
  bash .bakers/scripts/ddev-own-project.sh
  exec ddev exec --raw -- "$@"
}
if [ "${1:-}" = exec ]; then
  [ "$#" -ge 2 ] || usage
  key="$2"; shift 2
  if [ "$#" -gt 0 ]; then [ "$1" = -- ] || usage; shift; fi
  case "$key" in
    phpcs|phpmd|phpstan)
      [ "$#" = 0 ] || usage
      web ".ddev/commands/web/$key"
      ;;
    phpunit|phpunit-mariadb)
      # <test path>…: explicit paths, never --filter or --group (they can pass on no tests).
      [ "$#" -ge 1 ] || usage
      safe "$@"
      if [ "$key" = phpunit-mariadb ]; then
        web env SIMPLETEST_DB=mysql://db:db@db/db ./vendor/bin/phpunit --configuration=phpunit.xml "$@"
      else
        web ./vendor/bin/phpunit --configuration=phpunit.xml "$@"
      fi
      ;;
    paratest)
      # <suite> or one <path>: a value with a slash is a path.
      [ "$#" = 1 ] || usage
      safe "$1"
      if [[ "$1" == */* ]]; then
        web ./vendor/bin/paratest --configuration=phpunit.xml --processes 4 "$1"
      else
        web ./vendor/bin/paratest --configuration=phpunit.xml --processes 4 --testsuite "$1"
      fi
      ;;
    uli)
      # <persona> [<uri>]
      [ "$#" -ge 1 ] && [ "$#" -le 2 ] || usage
      safe "$@"
      web drush uli --name "$1" ${2:+--uri "$2"}
      ;;
    playwright)
      # <spec path>…, relative to tests/playwright
      safe "$@"
      web bash -c 'cd tests/playwright && npm test -- "$@"' playwright "$@"
      ;;
    playwright-cli)
      [ "$#" -ge 1 ] || usage
      safe "$@"
      web playwright-cli "$@"
      ;;
    designbook)
      # start | stop | status | check <story-id>: Designbook's Storybook daemon and story check in
      # the web container, with the image's Chromium (.ddev/web-build/Dockerfile.playwright).
      [ "$#" -ge 1 ] && [ "$#" -le 2 ] || usage
      safe "$@"
      case "$1" in
        start) [ "$#" = 1 ] || usage; set -- storybook start --port 6006 --force ;;
        stop|status) [ "$#" = 1 ] || usage; set -- storybook "$1" ;;
        check) [ "$#" = 2 ] || usage; set -- storybook check "http://localhost:6006/iframe.html?id=$2&viewMode=story" ;;
        *) usage ;;
      esac
      web env PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright bash -c 'cd web/themes/custom/bb_theme && npx storybook-addon-designbook "$@"' designbook "$@"
      ;;
    playground-ticket)
      # <conductor_id> <title> [<state>]: a title may contain spaces, so it is checked loosely.
      [ "$#" -ge 2 ] && [ "$#" -le 3 ] || usage
      safe "$1" ${3:+"$3"}
      [[ "$2" != -* ]] || usage
      web drush php:script scripts/e2e/playground-ticket.php -- "$@"
      ;;
    *) echo "Unsupported provision_exec key: $key" >&2; exit 1 ;;
  esac
fi
[ "$#" = 1 ] || usage
case "$1" in
  deps)
    bash .bakers/scripts/worktree-deps.sh --all
    ;;
  docs-preview)
    bash .bakers/scripts/worktree-deps.sh --all
    bash .bakers/scripts/docs-preview.sh
    ;;
  conductor-e2e)
    bash .bakers/scripts/worktree-deps.sh --all
    bash .bakers/scripts/ddev-own-project.sh
    ddev provision --provider recipe-test
    bash .bakers/scripts/conductor-e2e.sh
    ;;
  conductor-e2e-stop)
    bash .bakers/scripts/conductor-e2e.sh stop
    ;;
  conductor-e2e-start)
    bash .bakers/scripts/conductor-e2e.sh start
    ;;
  recipe-test)
    bash .bakers/scripts/worktree-deps.sh
    bash .bakers/scripts/ddev-own-project.sh
    ddev provision --provider recipe-test
    ;;
  existing-config)
    bash .bakers/scripts/worktree-deps.sh
    bash .bakers/scripts/ddev-own-project.sh
    ddev provision --provider existing-config
    ;;
  existing-config-fresh)
    bash .bakers/scripts/worktree-deps.sh
    bash .bakers/scripts/ddev-own-project.sh
    ddev init --provider existing-config
    ;;
  *) echo "Unsupported provision profile: $1" >&2; exit 1 ;;
esac
