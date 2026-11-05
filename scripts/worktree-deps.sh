#!/bin/bash
# before_run hook: install pnpm dependencies outside the agent sandbox. pnpm 12 takes
# its store lock under $XDG_RUNTIME_DIR (fallback /tmp), which a sandboxed run cannot
# write, so `pnpm install` fails there even with a writable store. bakers-cli always;
# other pnpm packages only once they have been installed. Not frozen: a dependency an
# agent added to package.json is installed, and the lockfile updated, before the next
# run. Up to date this is a few milliseconds. A failure warns and never blocks the run.
# `--all` (the `provision_up('deps')` profile) also installs packages not yet installed.
set -uo pipefail

all=false
[ "${1:-}" = "--all" ] && all=true

install_deps() {
  local dir="$1"
  [ -f "${dir}/pnpm-lock.yaml" ] && [ -f "${dir}/package.json" ] || return 0
  if ! (cd "${dir}" && pnpm install --config.minimumReleaseAge=0); then
    echo "WARN: pnpm install failed in ${dir}; agent runs cannot install inside the sandbox" >&2
  fi
}

if ! command -v pnpm >/dev/null 2>&1; then
  echo "WARN: pnpm not found; dependencies not installed" >&2
  exit 0
fi
install_deps bakers-cli
for dir in web/themes/custom/bb_theme website; do
  if [ "${all}" = true ] || [ -d "${dir}/node_modules" ]; then
    install_deps "${dir}"
  fi
done
exit 0
