#!/usr/bin/env bash
# Clones the workspace's projects (README › Projects): each HTTPS URL in BOX_PROJECTS (separated by
# spaces, commas or newlines) that has no ~/projects/<repo-name> yet. An existing checkout is never
# pulled or reset. Runs after git-setup.sh, so the service accounts' credential helpers apply.
# It never fails the workspace start.
set -uo pipefail
set -f # the URL list is split unquoted; no globbing
BOX_PROJECTS="${BOX_PROJECTS:-}"

for url in ${BOX_PROJECTS//,/ }; do
  # A token in the URL would land in .git/config and the log; the URL itself is not printed.
  if [[ $url == *://*@* ]]; then
    echo "projects: skipped a URL with credentials; the github_token and gitlab_token parameters sign git in"
    continue
  fi
  if [[ $url != https://* ]]; then
    echo "projects: skipped $url (not an https:// URL)"
    continue
  fi
  name=$(basename "${url%/}" .git)
  dest="$HOME/projects/$name"
  if [ -e "$dest" ]; then
    echo "projects: kept $dest"
  elif mkdir -p "$HOME/projects" && GIT_TERMINAL_PROMPT=0 git clone --quiet "$url" "$dest" </dev/null; then
    echo "projects: cloned $dest"
  else
    echo "projects: failed $url"
  fi
done
exit 0
