# Build your first addon

Give a running agent a harmless greeting tool, then expose the same operation as a ticket message. You need a working conductor project, a supported Node.js runtime and permission to change its project configuration. Use a disposable ticket with a worktree.

Addon handlers run on the worker, outside the agent's shell sandbox. This example only returns text; it reads no files or credentials.

## Create two files

Create `.bakers/addons/hello/package.json`:

```json
{
  "name": "example-hello",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./preset.js",
  "exports": { ".": "./preset.js", "./preset": "./preset.js" }
}
```

Create `.bakers/addons/hello/preset.js`:

```js
export const scopes = ['project'];

export const tools = {
  contract: 1,
  tools: {
    hello_greet: {
      description: 'Return a greeting for a name.',
      input: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80 },
        },
      },
    },
  },
  handlers: async () => ({
    hello_greet: async ({ args }) => ({ text: `Hello, ${args.name}!` }),
  }),
};
```

The **preset** declares what the package contributes. `scopes` permits it in project configuration. `tools` pairs an input declaration with a lazy handler factory. The conductor validates arguments before calling the handler; missing, mistyped and unknown fields fail. The factory receives the entry's `with` options when you need configuration.

## Enable in the project

Append `'./addons/hello'` to the existing `addons` array in `.bakers/conductor.config.js`. Keep its remote, executor, workspace and identity settings:

```js
// Add this entry inside your existing addons array:
'./addons/hello',
```

The path resolves from the configuration directory. This local JavaScript package needs no installation or compilation. Commit both files and the configuration change so ticket worktrees receive them. Do not add this project-only example to the machine configuration.

## Verify

Run:

```sh
bakers config check --scope project --online
```

Restart the conductor with its normal [start/stop procedure](/configuration/project/conductor-commands). Dispatch a disposable ticket and ask its agent to call `hello_greet` with `{"name":"Ada"}`.

From that **running agent's shell**, the equivalent calls are:

```sh
bakers tools hello_greet --schema
bakers tools hello_greet --data '{"name":"Ada"}'
bakers tools hello_greet --data '{"name":42}'
```

**Success:** the valid call returns `Hello, Ada!`; the last call reports invalid arguments. The run supplies `BB_CONDUCTOR_URL` and `BB_CONDUCTOR_TOKEN`; an ordinary operator shell instead connects to the site's tools and will not find this local tool. Do not copy or print the token.

Configuration validation does not execute the handler. If the tool is missing, check the conductor's addon-load errors and restart it after the committed change.

## Add a ticket message

A **message** lets a person request an operation from a ticket. Append this export to the same `preset.js`:

```js
export const inbox = {
  contract: 2,
  label: 'Hello',
  messages: {
    greet: {
      label: 'Greet',
      access: 'view',
      input: tools.tools.hello_greet.input,
    },
  },
  bindings: { greet: { tool: 'hello_greet' } },
};
```

Without fixed `args`, the binding passes the form payload to the tool. It uses the ticket's worktree context and turns the tool's `text` into the message's Markdown answer.

Commit the change and restart the conductor. Open the disposable ticket's message card in the web UI or `bakers ui`, select **Hello**, enter **Ada** and send **Greet**. Expect pending/running followed by `Hello, Ada!`; errors appear as a failed answer. `access: 'view'` allows readers of that ticket to send this harmless message. Use the default `update` access and additional handler checks for operations that change data.

Registration keeps the first definition for a package name and version. When changing an already registered message definition, bump the package version before restarting.

## Remove the example

Remove its `addons` entry, restart the conductor, then delete the two files. Existing message history remains. The example creates no other files.

## Extend your addon

Keep the tutorial as your starting point; use these pages for the complete contracts:

- [Tools](/addons/build/tools): input, handler context, errors and access boundaries.
- [Messages](/addons/build/actions): direct handlers, bindings and request lifecycle.
- [Addon API reference](/addons/build/contracts): exports, options, scopes and packaging.
- [Lifecycle hooks](/provision/hooks#add-a-listener-from-an-addon): project preparation and cleanup.
