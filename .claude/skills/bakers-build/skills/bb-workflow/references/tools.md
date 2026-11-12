# Call tools

Prefer listed MCP (`<tool>`/`tool_api__<tool>`); else host tool search waits for connection.
Only if not loadable: `bakers tools <tool> --data @<args.json>`, alone with literal values (chaining
sandboxes). Conductor denial: load/retry MCP, that command alone was denied. Encode JSON,
preserving Markdown; consult served schema or `bakers tools <tool> --schema`.
Exit 0: JSON success; 1: refusal, correct demonstrated bad arguments only; 3: credentials
(outside run `bakers auth status`); 4: invalid arguments/unknown tool, nothing sent, correct schema;
5: HTTP/protocol error. Errors prove no absence. Uncertain writes: [ticket writes](ticket-writes.md).

Preserve literal bodies (`jq -n --rawfile body <file.md> --arg t <ticket> '{ticket: $t, type: "plan", body: $body}'`).

## Choose an operation

Describe the needed result and search/load a suitable tool. Its served description is the source
of truth for inputs, outputs, limits and availability; follow it rather than a copied catalog.
For a count or an assertion that nothing exists, exhaust the result's pagination.

If no suitable tool can be loaded, warn and record the operation and the human's next action in
*Manual review*. Leave it unverified and perform no dependent write or claim.
