# Resolve a missing target environment

Load only when the deployment's `environments` relationship is empty or its environment returns 404.

1. Parse the ticket description's fenced `env` block line by line as `key: value`, splitting
   on the first `:` only so URLs remain intact. Require nonempty `name`, `branch`, `base_url`.
   Optional `tier` accepts `production`, `staging`, `development`, `other`; default `other`.
   Missing block/keys or invalid tier → publish an honest `summary` identifying the defect and
   STOP without freeze, merge, gather or transition.
2. Search the deployment's own project for an environment with that name. Matching branch →
   reuse its UUID and stored values, including `base_url` even if the briefing differs.
   Different branch → summary naming both branches and STOP; do not create a duplicate.
   No name match → create from the block.
3. Attach the resolved/created UUID to the deployment's `environments`; continue with its
   `branch` and `base_url`.
