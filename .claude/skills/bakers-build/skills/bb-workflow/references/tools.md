# Call tools

Prefer listed MCP; else host tool search waits for connection.
Only if not loadable: `bakers tools <tool> --data @<args.json>`, alone with literal arguments;
chaining sandboxes. Conductor denial: load/retry MCP, that command alone was denied.
Schema: served description or `bakers tools <tool> --schema`.
Encode bodies unchanged (`jq -n --rawfile body <file.md> --arg t <ticket> '{ticket: $t, type: "plan", body: $body}'`).

Exits: 0 JSON success; 1 refusal (fix demonstrated bad arguments only); 3 credentials;
4 invalid/unknown tool (nothing sent, fix schema); 5 HTTP/protocol error.
Errors prove no absence; uncertain writes: [ticket writes](ticket-writes.md).

## Choose an operation

Search/load by result; served descriptions own inputs, outputs, limits and availability.
Counts/absence require all pages. No tool: warn, record operation and human next action in
*Manual review*, leave unverified, no dependent write or claim.
