#!/usr/bin/env bash
# Fixed host entry point for the project's provision_up profiles and provision_exec keys.
#   .bakers/provision.sh <profile>
#   .bakers/provision.sh exec <key> -- <argv…>
set -euo pipefail

usage() { echo 'Usage: .bakers/provision.sh <profile> | exec <key> -- <argv…>' >&2; exit 1; }
if [ "${1:-}" = exec ]; then
  [ "$#" -ge 3 ] && [ "$3" = -- ] || usage
  key="$2"; shift 3
  case "$key" in
    # The argv runs in the web container as given: --raw keeps a shell out of it.
    web)
      [ "$#" -ge 1 ] || usage
      bash .bakers/scripts/ddev-own-project.sh
      exec ddev exec --raw -- "$@"
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
