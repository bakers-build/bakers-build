# Write an addon with inbox messages

Build an addon whose messages appear in the ticket detail page's right-hand column, in an inline message card (with two or more addons, one tab each, labeled with the addon's label), and in the matching card in `bakers ui` — run on the conductor that owns the ticket's worktree. No page or tab anywhere is named "Addons"; that word stays internal/author-facing.

**You need:** a bakers.build CLI built from source (see [build from source](/configuration/project/contributing#build-from-source)), a conductor you can restart, and the package basics in [addon contracts](/addons/build/contracts#write-an-addon).

## Write the addon

The example is `@bakers-build/addon-hello` with one message, `greet`, that takes a name and answers with Markdown.

1. Create `bakers-cli/addons/hello/package.json`. The preset is the only export the conductor reads; `private` keeps the example out of the publish set.

   ```json
   {
     "name": "@bakers-build/addon-hello",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "exports": { "./preset": "./dist/src/preset.js" },
     "scripts": {
       "build": "tsc",
       "test": "vitest run --root ../.. addons/hello/tests"
     },
     "peerDependencies": {
       "@bakers-build/conductor": "workspace:^",
       "@bakers-build/message": "workspace:^"
     },
     "devDependencies": {
       "@bakers-build/conductor": "workspace:^",
       "@bakers-build/message": "workspace:^",
       "typescript": "^5.9.0",
       "vitest": "^4.1.0"
     }
   }
   ```

   Next to it, `tsconfig.json` compiles `src/` to `dist/src/`:

   ```json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": { "outDir": "dist", "rootDir": "." },
     "include": ["src/**/*.ts"]
   }
   ```

2. Export `inbox` from the preset. `messages` declares the capability — label, who may send it (`access`), and an optional flat `input` — nothing about tables, views or refresh cadence. `handlers` is a lazy import.

   ```ts
   // src/preset.ts
   import type { Preset } from '@bakers-build/conductor/contract';

   export const inbox: Preset['inbox'] = {
     contract: 2,
     label: 'Hello',
     messages: {
       greet: {
         label: 'Greet',
         access: 'view',
         input: {
           type: 'object',
           required: ['name'],
           properties: { name: { type: 'string', maxLength: 200 } },
         },
       },
     },
     handlers: () => import('./handlers.js').then((m) => m.handlers),
   };
   ```

3. Write one handler per message key. It receives the full request — its own id, the message type, who sent it, the ticket, the worktree path and the validated `payload` — and returns exactly `{ markdown }`.

   ```ts
   // src/handlers.ts
   import type { InboxMessageHandler } from '@bakers-build/conductor/contract';

   export const handlers: Record<string, InboxMessageHandler> = {
     greet: async (request) => ({
       markdown: `Hello, ${String(request.payload?.name)}!`,
     }),
   };
   ```

4. Make the package resolvable for the conductor, build, and register it. The conductor resolves `addons` from its own install, the config file's directory and the working directory, so in this workspace add `"@bakers-build/addon-hello": "workspace:^"` to the `devDependencies` of the workspace root `bakers-cli/package.json`, next to `@bakers-build/addon-fake`. That file is never published; in this pnpm workspace a dependency of `bakers-cli/host` is not visible to the conductor. Then:

   ```sh
   cd bakers-cli && pnpm install && pnpm -r run build
   ```

   List the addon in `.bakers/conductor.config.js` and restart the conductor.

   ```js
   export default {
     // …your existing keys
     addons: ['@bakers-build/addon-hello'],
   };
   ```

   On a ticket of this conductor, the inline message card shows a *Greet* form with one text field, since the message declares `input`; submitting it answers with the Markdown the handler returned, in place, below the form.

5. Test the addon without a conductor in `bakers-cli/addons/hello/tests/hello.test.ts`. `loadInbox` applies the same checks as a conductor start; `validateResult` the same check as before a result is written.

   ```ts
   import { loadInbox } from '@bakers-build/conductor/contract';
   import { validateResult } from '@bakers-build/message';
   import { expect, it } from 'vitest';
   import { inbox } from '../src/preset.js';

   it('loads and answers', async () => {
     const loaded = await loadInbox({ name: 'hello', version: '0.1.0', inbox });
     const result = await loaded.handlers.greet!({
       id: 'req-1',
       messageType: 'hello.greet',
       addonVersion: '0.1.0',
       requestedBy: 'user-1',
       ticket: {} as never,
       payload: { name: 'Ada' },
       worktreePath: '/tmp/wt',
       env: {},
       logger: console as never,
       signal: new AbortController().signal,
     });
     expect(result.markdown).toBe('Hello, Ada!');
     expect(validateResult(result)).toEqual({ ok: true });
   });
   ```

   ```sh
   cd bakers-cli/addons/hello && pnpm test
   ```

**Done when:** the test passes, and after the restart the conductor log shows no addon resolution or registration error.

## How it fits together

- **The addon package** declares its messages and ships the handlers. It ships no UI code — no tables, no views, no refresh cadence.
- **The conductor** validates the inbox export when it loads the addon, registers the definition at start, runs a handler or bound tool from its inbox in the ticket's worktree, validates its `{ markdown }` result and writes it back.
- **The server module `bb_addon`** validates the definition on register (workspace-unique by `(workspace, name, version)` — see [addon contracts](/addons/build/contracts)) and, on send, the payload against the message's `input` and the `access` check.
- **The inbox (`bb_inbox`)** owns the message contract: it transports a message type, a payload and a result, and validates every `done` and `failed` result against `{ markdown }` on write; the message's `input` is the payload schema.
- **The personal read model** selects each signed-in person's own newest request per addon (`requested_by`, newest by `created`/`id`), never another requester's. Earlier messages are a follow-up, out of scope.

Both UIs render from the message definitions and the personal result alone.

## Where it shows up

- **Web:** open a ticket; the right-hand column carries a card; with two or more message-capable addons it shows one tab per addon (label = the addon's `label`, e.g. "Ports"). Each addon stacks its `MessageForm`s, one per message type, each with a *send* button — switching tabs never sends. The requester's own latest answer renders below the forms; sending replaces it in place.
- **`bakers ui`:** **Overview** has a second card under Details/Stats/Related. `↓`/`j` reaches it (`Tab` switches panes, not this card). `Enter` opens the send/poll screen: `←`/`→` switch addon, `Enter` sends or opens a form, `l` copies a link, `Esc` returns.

## Reference

- **`name` and `version` are not written by the author.** The conductor takes them from the addon's `package.json`, `@bakers-build/addon-ports` becoming `ports`.
- **`label` and `icon` are optional.** `icon` is inline SVG markup of at most 8,192 characters; the addon overview shows it as an image only.
- **`handlers` is lazy.** It is imported only when a conductor loads the addon, never on a command-only load.
- **`bindings` answer with an [agent tool](/addons/build/tools)**, e.g. `{ tunnel: { tool: 'ports_up', args: {} } }`: the tool's text is the answer; an error or timeout answers `failed`. Without `args` the payload is passed through.
- **Each key needs exactly one handler or binding**, a binding a loaded tool, and fixed `args` no `input`; otherwise loading fails naming addon and message.
- **The request** carries `id` (the request's own UUID — never the message type), `messageType` (`<addon>.<key>`), `addonVersion`, `requestedBy`, `ticket`, an optional `payload`, `worktreePath`, `env`, `logger` and a `signal` that aborts after 60 seconds.
- **`access`** names the ticket operation a person needs to send the message: `view` (anyone who may read the ticket, a reviewer included) or `update`, the default.
- **A message with no `input`** renders as a single button; sending it carries no payload.
- **The result is exactly `{ markdown }`**, at most 1,048,576 Unicode characters, empty string allowed. No `level`, no `rows`, no `columns`, no row actions — express a status, a list or a link as Markdown text.
- **Registration is workspace-unique.** Two conductors in the same workspace registering the same `name@version` share one record; a differing definition is ignored, never overwritten. See [addon contracts](/addons/build/contracts).

## Contract 2

The two schemas are JSON Schema draft-07 in `bakers-cli/message/schemas/` (`message-definition.v2.schema.json`, `message-result.v2.schema.json`) and are exported with their TypeScript types and validators from `@bakers-build/message`. The Drupal module `bb_inbox` validates against byte-identical copies in its `schemas/` (`MessageContractValidator`); `bb_addon` keeps only a thin `addon-definition.v2.schema.json` envelope and delegates each message to it. A test fails when the copies drift.

A message's `input` is the same flat object subset contract 1 used: a field has a `type` of `string`, `integer`, `number` or `boolean`, and optionally `title`, `description`, `default`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern` and `format` (`uri` or `multiline`). Nested objects, arrays, `oneOf` and `$ref` are outside the subset. Beyond the schema, `default` and `enum` values must match the type, number keywords belong to numbers and string keywords to strings, and every `required` name must be a property. A payload with an extra or mistyped key is rejected.

Both UIs render a field the same way:

| Field | Web UI (Drupal Form API) | `bakers ui` |
|---|---|---|
| `string` | text field | text field (Enter adds a line) |
| `string` with `format: multiline` | text area | text field (Enter adds a line) |
| `string` with `format: uri` | URL field | text field, checked as a URL |
| any type with `enum` | select | select |
| `integer`, `number` | number field with its bounds | text field, checked as a number |
| `boolean` | checkbox | select yes or no |

A required field without a `default` is mandatory.

## Lifecycle

1. The conductor starts and registers its addons; the server derives the registering conductor's workspace and resolves one row per `(workspace, name, version)`.
2. A person opens the inline message card on a ticket whose conductor runs addons and sends a message; the server validates the payload and checks `access`.
3. The conductor's next tick claims the request, runs the handler in the ticket's worktree, validates the `{ markdown }` result and writes it.
4. The UI shows this person's own newest request while it polls (every 3 seconds while a message of the shown addon is pending or running) — never a newer request from someone else, and never an older request that finishes later replacing a newer one.
5. Message history remains after the ticket is done or cancelled.

A message records the handler's version at send time, but the conductor runs it whatever version it has now.

## Examples

**Ports** (shipped, `bakers-cli/addons/ports`) is the reference. Its single message, `tunnel`, is bound to `ports_up`: it shares every eligible service and answers with their URLs.

```ts
export const inbox: Preset['inbox'] = {
  contract: 2,
  label: 'Ports',
  messages: {
    tunnel: { label: 'Share tunnels', access: 'view' },
  },
  bindings: { tunnel: { tool: 'ports_up', args: {} } },
};
```

**A login link for a DDEV Drupal site** is a sketch, not a shipped addon. It shows the security rules an addon that hands out credentials follows:

- `users` is a view-access message listing only the users the addon is configured for, never the site's user table, as a Markdown list.
- `uli` has `access: update` and an `input` with one integer field, `uid`. The handler refuses any uid outside its configured options, whatever the form sent.
- The handler returns the one-time link as the result's `markdown`, addressed only to the requester — the personal read model never shows it to anyone else, including other ticket viewers.
- The link is single-use and expires after the site's `user.settings:password_reset_timeout`, 24 hours by default, so a site that runs this addon sets it to a few minutes; `access: update` together with the uid allowlist bounds who can create one and for whom.

## Migrating a contract-1 addon

Contract 1 (`actions`, `views`, row actions, `refresh`) is retired: the server rejects a contract-1 registration, and the upgrade deletes contract-1 registrations and view state while keeping `bb_inbox_message` history. Move every action to a message of the same key, dropping `confirm`, row actions and `refresh`, and return `{ markdown }` instead of `{ message, level, rows, columns }`. Bump the addon's version, because registration keeps the first definition stored for a `name@version`.
