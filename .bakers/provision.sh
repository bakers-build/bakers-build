#!/usr/bin/env bash
# Fixed host entry point for the project's provision_up profiles.
set -euo pipefail

[ "$#" = 1 ] || { echo 'Usage: .bakers/provision.sh <profile>' >&2; exit 1; }
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
