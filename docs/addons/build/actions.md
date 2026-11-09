# Messages

<span id="write-an-addon-with-inbox-messages"></span>

Let a person request an addon operation from a ticket and receive a Markdown answer. Start with [Extend the control panel](/addons/build/control-panel) to add an **Is dirty?** button to a ticket. This reference is for authors extending that example.

## Extend the control panel

Use the preset's `inbox` export to add controls to a ticket's **message card** in the web control panel. You describe the operation and its inputs; Bakers builds the interface from that definition.

| You declare | The user gets |
|---|---|
| Addon `label` | The addon's name; when several addons are available, a tab in the ticket card. |
| A message `label`, with no `input` | A button to request that operation. |
| A message `input` | A form: text fields, choices, numbers or booleans, followed by a submit action. |
| A tool binding or a handler | Work performed by the conductor when the request is processed. |
| A Markdown result | An answer below the controls, with the request's status. |

The conductor sends the **definition** to the server when registering the addon. Handler functions remain on the conductor's machine. The browser submits input to the server, the conductor processes the request in the ticket's worktree, and the UI retrieves its status and answer. This is why loading an addon with only `tools` does not create a control-panel button: add `inbox` to describe the human-facing action.

The message API supplies this existing card and its supported inputs and Markdown output. It does not load your JavaScript into the browser or provide arbitrary web pages, layouts or components. Custom tabs for the **terminal** client are a separate [extension API](/addons/bakers-ui/tabs).

## Write the addon

Export `inbox` from the same preset as your tool. A message uses either a tool binding or a direct handler, never both. It needs a conductor with the addon loaded and a ticket worktree on that machine.

```ts
import type { Preset } from '@bakers-build/conductor/contract';

// Assumes the tutorial's tools export is in this module.
export const inbox: Preset['inbox'] = {
  contract: 2,
  label: 'Worktree',
  messages: {
    is_dirty: {
      label: 'Is dirty?',
      access: 'view',
    },
  },
  bindings: { is_dirty: { tool: 'git_is_dirty' } },
};
```

The binding passes the message payload as tool arguments. It returns the tool's `text` as `{ markdown }`. To pass fixed arguments, set `args` on the binding and omit the message's `input`. Fixed arguments replace the payload; they are not merged.

## How it fits together

The server checks the sender's ticket access and validates the payload before the conductor runs the operation. The UI renders that person's latest request and result.

These are separate entry points: an agent can call a tool directly; a person can send a message bound to that tool. Messages may also have their own handlers. A message's `access` setting does not restrict direct tool calls.

## Where it shows up

- **Web:** the ticket's message card in the right column. Multiple addons appear as tabs; each message has a button or input form. Switching tabs does not send a request.
- **Terminal:** the ticket's Overview pane has a message card. Select it with `↓`/`j`, then `Enter` to open the send/poll screen. `←`/`→` selects the addon; `Esc` returns.

The visible result belongs to the signed-in requester. It does not show another person's newest request.

## Reference

| Export field | Contract |
|---|---|
| `contract` | Required literal `2`. |
| `label`, `icon` | Optional display label and inline SVG (at most 8,192 characters). |
| `messages` | Map from message key to definition: required `label`, optional `access` and `input`. |
| `access` | `update` by default; `view` allows someone who can read the ticket. |
| `handlers(options)` | Optional async factory receiving the addon's `with`; returns handlers keyed by message. |
| `bindings` | Optional map to `{ tool, args? }`; the named tool must be loaded. |

Each declared key needs exactly one handler or binding. Undeclared handlers/bindings, unknown tools, fixed arguments with an input form, or a contract other than 2 fail loading.

For a direct handler, import `InboxMessageHandler` from `@bakers-build/conductor/contract`. Its request contains:

| Field | Meaning |
|---|---|
| `id`, `messageType`, `addonVersion` | Request UUID, `<addon>.<message>` and the loaded addon's version. |
| `requestedBy`, `ticket` | Sender ID and resolved ticket. |
| `payload` | Optional input values. |
| `worktreePath`, `env` | Ticket worktree and runtime environment; never log credentials. |
| `logger`, `signal` | Conductor logger and cancellation signal. |
| `callTool?` | Calls another tool with the same ticket/worktree; absent when tools are unavailable. |

Return exactly `{ markdown: string }`, at most 1,048,576 Unicode characters; an empty string is allowed. Throw to report failure. Honour `signal` and cancel any child work: the conductor times out the answer after 60 seconds, but arbitrary handler side effects need your own cancellation handling.

Validate resource identifiers against your configured allowlist before accessing them. Ticket access alone does not authorize arbitrary files, network destinations or credentials.

## Contract 2

Types `MessageDefinition`, `MessageInput`, `MessageField` and `MessageResult`, plus `validateMessageDefinition`, `validateArgs` and `validateResult`, are exported by `@bakers-build/message`.

An input is a flat object with `properties` and optional `required`. Field types are `string`, `integer`, `number` or `boolean`. Fields may carry `title`, `description`, `default`, `enum`, numeric bounds, string length bounds, `pattern`, and string `format` (`uri` or `multiline`). Nested objects, arrays, `oneOf` and `$ref` are unsupported.

Defaults and enum values must match their field type; numeric constraints apply only to numbers, string constraints only to strings, and required keys must exist in `properties`. Extra or mistyped payload keys are rejected. Defaults guide the form; API callers must supply required arguments.

No `input` means a single button with no payload. Strings render as text fields, multiline strings as a web textarea, enums as choices, numbers with numeric validation, and booleans as a checkbox on web or yes/no choice in the terminal.

`loadInbox` and `validateRequestPayload` are exported by `@bakers-build/conductor/contract` for local contract checks. Load bindings with the set of available tool names; calling a direct handler yourself does not automatically validate its payload.

## Lifecycle

1. On start, the conductor registers the definition. Package name and version come from `package.json`; `@bakers-build/addon-ports` becomes `ports`.
2. Registration is unique per workspace, name and version. A different definition at the same version is ignored: bump the version when changing it.
3. Sending creates a pending request. The conductor marks it running, then done or failed. Both outcomes carry a Markdown answer.
4. The UI polls pending/running requests and shows the requester's newest answer. A late result from an older request does not replace it.
5. History remains when the ticket is done or cancelled.

The send-time version is recorded, but execution uses the addon's currently loaded version. A missing local worktree produces a failed answer.

## Examples

The [control-panel tutorial](/addons/build/control-panel) owns the complete dirty-check example. Clean and dirty are successful answers; Git failures are failed answers. Shipped [Ports](/addons/ports) uses the same pattern: **Share tunnels** binds `tunnel` to `ports_up` with fixed `args: {}`, sharing all eligible services.

For sensitive operations, prefer `update` access, validate targets inside the handler and return secrets only where the server's access model permits. Do not infer that a private result removes the need for authorization.

## Migrating a contract-1 addon

The old `actions`, views, rows and refresh contract is retired. Move each operation to an inbox message, return `{ markdown }` instead of table/view data, and bump the package version. Existing message history is retained.

Source: `bakers-cli/conductor/src/plugins/message.ts`, `src/core/inbox-runtime.ts` and `bakers-cli/message/src/schema.ts`. See the [shared API reference](/addons/build/contracts) for packaging and scopes.
