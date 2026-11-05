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

| Exit | Meaning | Next |
|---|---|---|
| 0 | success; the tool's text on stdout | use the result |
| 1 | the tool refused; the message names the cause | report it; correct only arguments the message shows wrong |
| 3 | run token rejected | report it |
| 4 | no conductor tools in this shell, unknown tool or unreadable `--data`; no call made | from the listing: take the step's path without them; else fix against `bakers oven tools <tool> --schema` |
| 5 | HTTP or protocol error | report it; a write may have happened, reconcile with a read |

The run token stays in the environment; pass no token yourself.
