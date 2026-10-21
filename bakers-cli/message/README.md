# @bakers-build/message

The `InboxMessageHandler` contract: a message type's definition (label, access, optional input
schema) and its handler's one-Markdown result (`InboxMessageRequest` in, `{ markdown }` out).

This package owns only the message shape — label, access, optional input/payload validation, and
the Markdown result envelope — independent of addon, workspace or conductor concepts. `@bakers-build/conductor`
and the fake, bakers-ui and remote-drupal addons depend on it; it depends on nothing under `@bakers-build/*` (see
`scripts/assert-acyclic.mjs`, which treats it as the base layer beneath the kernel).

## Exports

- `MessageDefinition`, `MessageField`, `MessageInput`, `MessageResult`
- `validateMessageDefinition`, `validateArgs`, `validateResult`, `payloadSchema`
- `MESSAGE_CONTRACT_VERSION`

`InboxMessageRequest` and `InboxMessageHandler` are not yet exported from here — they currently
live in `@bakers-build/conductor` (see amendment v3 on BB-661, still open as a follow-up move).

The published Node floor is `>=20.19`, matching every other `@bakers-build/*` package — see
`core/tests/packaging/bb-326-runtime.test.ts`, which asserts no published package raises it.
