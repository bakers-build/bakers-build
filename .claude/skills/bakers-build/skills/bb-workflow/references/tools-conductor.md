# Conductor tools

Inside a conductor run, addon tools (`ddev_status`, `provision_up`, `ports_up`, …) carry their plain
name and act on the run's worktree. They are **available** when the host lists them, or when
`bakers oven tools` lists them (exit 0). Call them like every tool in [tools](tools.md):

- **The host lists the tool** (an MCP connector): call it with the step's arguments.
- **Otherwise** write the arguments to a JSON file and call it alone:

  ```bash
  bakers oven tools <tool> --data @<args.json>
  ```

  `bakers oven tools <tool> --schema` prints its arguments.

Exit codes follow [tools](tools.md) › *Results and errors*; exit 3 means the run token was
rejected. Exit 4 from the listing means this shell has no conductor tools: take the step's path
without them. The run token stays in the environment; pass no token yourself.
