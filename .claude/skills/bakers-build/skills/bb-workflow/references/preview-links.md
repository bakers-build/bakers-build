# Local preview links

Read before sharing the URL of a local service.

1. Read `printenv BB_TUNNEL`: `1`/`true` enables, `0`/`false` disables. If absent, read
   `machine_policy.tunnel` using `bakers config check --scope machine --format json`.
2. Enabled: in the service worktree run `bakers ports list`, then `bakers ports up <service-key>`
   (an addon-claimed key, e.g. `web`, `mailpit` — never a raw port). A dimmed "no addon" row
   cannot be shared. Use the returned public origin, preserve path/query/fragment, verify links
   and redirects. For multiple aliased hosts, pass the full per-host key `list` shows (e.g.
   `web-admin-ddev-site`) — no `--host` flag. bakers.build shares whatever is claimed; the project owns
   public-hostname login.
3. Disabled: share locally. Unknown policy or failure: state the reason and label the URL
   **local-only**.

Durable records identify service, worktree and reproduction command; ephemeral tunnel hostnames
are access instructions, not durable evidence.
