# bakers.build Inbox

Point-to-point messages from the server to one conductor. A person sends a
message about a ticket; the ticket's conductor picks it up in its tick,
executes it and answers with a status and a JSON result.

The inbox transports and owns the message contract, but knows no senders: a
message carries a `message_id` (for example `ports.up`), and the subscriber
of `InboxMessageEvent` that handles that id is responsible for it.

## Entity

`bb_inbox_message`: `ticket_id`, `conductor_id` (captured from the ticket at
send time), `message_id`, `version` (the responsible handler's version,
recorded, not enforced), `payload`, `status` (`pending` → `running` →
`done`/`failed`), `result`, `requested_by`, `owner_user_id` (the conductor's
owner).

## Resources

| Route | Who | What |
|---|---|---|
| `POST /jsonapi/bakers/inbox/send` | any signed-in user | `{ticket, message_id, payload}`; 201, 403 when the handler denies, 422 on veto or no handler |
| `GET /jsonapi/bakers/inbox/{conductor}` (conductor UUID) | the conductor's owner | pending messages with their worktree path, plus the conductor's open worktrees |
| `POST /jsonapi/bakers/inbox/{message}/result` | the conductor's owner | `{status, result}`; 422 on a backward status or a handler veto |

## Message contract

`schemas/` holds byte-identical copies of `bakers-cli/message/schemas/`
(`message-definition.v2`, `message-result.v2`, JSON Schema draft-07);
`MessageContractValidatorTest` fails when they drift.
`MessageContractValidator` (`bb_inbox.message_contract_validator`) mirrors
`@bakers-build/message`: `validateDefinition()` (one message, plus the type
checks JSON Schema cannot express), `validateArgs()` (a payload against the
message's `input`, closed to extra keys) and `validateResult()`. The entity
constraint validates every `done` and `failed` result against
`message-result.v2` (exactly `{markdown}`), whoever handles the message.
Payload validation is the handler's job, since only it knows the message
definition (`bb_addon` does it for addon messages).
