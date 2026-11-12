# Local preview links

Read before sharing the URL of a local service.

1. Read the run-provided `BAKERS_TUNNEL`: `1`/`true` enables, `0`/`false` disables.
   Absent or unrecognized means policy unknown.
2. Enabled: inspect tunnels, share addon-claimed services and remove tunnels through the
   [operations table](tools-conductor.md#operations). Use only an addon-claimed service key,
   never a raw port. Use the returned public origin and preserve path/query/fragment; verify
   links and redirects. For multiple aliased hosts, use the full per-host service key.
   The project owns public-hostname login. Apply the table's fallback when tools are unavailable.
3. Disabled: share locally. Unknown policy or failure: state the reason and label the URL
   **local-only**.

Durable records identify service, worktree and reproduction command; ephemeral tunnel hostnames
are access instructions, not durable evidence.
