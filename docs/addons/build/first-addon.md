# Build your first addon

Add a **Check patch** action to your tickets. An agent can use it before handing back a change; a teammate can run the same check from the ticket without opening a terminal.

The addon runs `git diff --check` in **that ticket's worktree**. It reports whitespace errors and conflict markers in tracked changes. It changes no project files. This is a small Git check, not a replacement for your project's tests.

## What an addon is

An addon extends an application through an API that the application provides. In bakers.build, it is an ordinary **JavaScript package**: a directory containing `package.json` and JavaScript modules. It can live inside your project, as this example does, or be an installed package. Publishing it to npm is optional.

Three pieces connect your code to Bakers:

| Piece | Role in this example |
|---|---|
| `package.json` | Gives the package a name and version, and points to the module Bakers should load. |
| `preset.js` | A JavaScript module whose named exports describe the addon's capabilities and supply their implementations. Bakers calls this module a **preset**. |
| The project's `addons` entry | Tells the conductor to load this package. Creating the files alone does not enable it. |

JavaScript's `export` makes a value available to the module's importer. Here, the conductor imports your preset and reads exports such as `tools` and `inbox`. Their names and structure follow the Bakers API; exporting an arbitrary function does not automatically make it a tool or a button.

## What you will build

You will build one operation and expose it twice:

1. **Tool:** the agent calls `patch_check`, choosing unstaged or staged changes.
2. **Message:** the ticket's control panel offers the same choice and displays the result.

**Unstaged** means changes in tracked files that are not yet in the Git index; **staged** means changes prepared for the next commit.

The conductor supplies the worktree and runs your handler. Callers provide the choice, never a filesystem path or shell command.

**Before you start:** use a disposable ticket in a working conductor project. Git and Node.js must be available on the conductor's machine. You need permission to edit the project configuration and restart the conductor.

## Create two files

Create `.bakers/addons/patch-check/package.json`:

```json
{
  "name": "example-patch-check",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./preset.js",
  "exports": { ".": "./preset.js", "./preset": "./preset.js" }
}
```

`"type": "module"` enables JavaScript's `import` and `export` syntax for these files. The `"./preset"` entry exposes `preset.js` at the package's preset entry point; the filename itself is your choice.

Create `.bakers/addons/patch-check/preset.js`:

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const scopes = ['project'];

export const tools = {
  contract: 1,
  tools: {
    patch_check: {
      description: 'Check tracked changes for whitespace errors and conflict markers.',
      input: {
        type: 'object',
        required: ['scope'],
        properties: {
          scope: { type: 'string', enum: ['unstaged', 'staged'] },
        },
      },
    },
  },
  handlers: async () => ({
    patch_check: async ({ args, worktreePath, signal }) => {
      const flags = ['diff', '--check'];
      if (args.scope === 'staged') flags.push('--cached');
      try {
        await run('git', flags, {
          cwd: worktreePath,
          signal,
          timeout: 10_000,
          maxBuffer: 64 * 1024,
        });
      } catch (error) {
        if (error.stdout) throw new Error(`${error.message}\n${error.stdout}`);
        throw error;
      }
      return {
        text: `No whitespace errors or conflict markers in ${args.scope} changes.`,
      };
    },
  }),
};
```

Read the declaration and handler together:

- `tools.patch_check` describes the operation to the agent. Its `input` allows exactly two choices; the conductor rejects missing, unknown or mistyped arguments before running Git.
- `handlers` supplies the implementation. `worktreePath` comes from the caller's ticket binding, so the command checks that ticket's files.
- `signal` forwards cancellation to Git. The command also has a ten-second timeout and an output limit.
- A successful Git exit returns `{ text }`. Git prints check findings to standard output; the `catch` includes them in the error so a failed tool call still names the file and line.

Handlers execute on the worker, outside the agent's shell sandbox. Keep the command fixed and review the addon before enabling it. The `scope` input selects an argument; it cannot introduce another command.

## Enable in the project

Append this entry to the existing `addons` array in `.bakers/conductor.config.js`:

```js
'./addons/patch-check',
```

Keep the existing remote, executor, workspace and identity settings. The path resolves from the configuration file. This local JavaScript package needs no installation or compilation.

Commit both files and the configuration change so ticket worktrees receive them. `scopes: ['project']` means this example belongs in project configuration.

## Verify

Run:

```sh
bakers config check --scope project --online
```

Restart the conductor with its normal [start/stop procedure](/configuration/project/conductor-commands). Dispatch a disposable ticket and ask its agent: **“Check the unstaged changes with patch_check.”**

From that **running agent's shell**, the equivalent call is:

```sh
bakers tools patch_check --data '{"scope":"unstaged"}'
```

With no problems, the answer is:

```text
No whitespace errors or conflict markers in unstaged changes.
```

To see a real failure, add trailing whitespace to a changed line in a tracked file in the disposable worktree, then repeat the call. The failed answer names the file and line, for example `notes.md:2: trailing whitespace.` Remove only that deliberate edit afterwards.

Use `{"scope":"staged"}` to check the index instead. Untracked files are not included. An invalid choice such as `{"scope":"all"}` fails input validation before Git runs.

An ordinary operator shell connects to the site's tools and will not find this local operation. The running agent receives its conductor connection automatically. If the tool is missing, check addon-load errors and restart after the committed change; configuration validation alone does not execute the handler.

## Add a ticket message

The tool now gives agents an operation. To put that operation in the **web control panel**, add an `inbox` export. It describes a message that a person can send from the ticket's message card. Bakers supplies the form, submit action, progress status and answer display.

The conductor registers the message definition with the Bakers server. Your Git function stays on the conductor's machine; the browser receives the rendered controls and sends the selected input. You do not need to write a web component for this form.

Make the check available to teammates who can update the ticket. Append this export to the same `preset.js`:

```js
export const inbox = {
  contract: 2,
  label: 'Patch check',
  messages: {
    check: {
      label: 'Check patch',
      access: 'update',
      input: tools.tools.patch_check.input,
    },
  },
  bindings: { check: { tool: 'patch_check' } },
};
```

Here, `label: 'Patch check'` names the addon, `label: 'Check patch'` names its action, and the reused `scope` enum becomes an **unstaged / staged** selector. When several addons are available, the web card uses their labels as tabs. The binding connects that form to `patch_check`; it forwards the selected scope, uses the ticket's worktree and turns the tool's text into the message answer.

Commit the change and restart the conductor. On the disposable ticket, open the message card in the web UI or `bakers ui`. If several addons are offered, select **Patch check**. Choose **unstaged** and send **Check patch**.

Expect pending/running followed by the same confirmation as the agent received. With a whitespace error or conflict marker, expect a failed answer naming the affected file and line. Fix the deliberate error and run the check again to see the result change.

`access: 'update'` requires permission to update that ticket. It controls who can send this message; direct tool calls have their own run binding. See [Messages](/addons/build/actions) for access and lifecycle details.

This extension adds controls to the existing ticket card. Its answer is Markdown; `inbox` does not mount arbitrary JavaScript components or add new web pages. [Messages](/addons/build/actions#extend-the-control-panel) explains the available controls and their limits. Custom tabs in the terminal client use a [separate API](/addons/bakers-ui/tabs).

When changing an already registered message definition, bump the package version before restarting: registration keeps the first definition for a package name and version.

## Remove the example

Remove its `addons` entry, restart the conductor, then delete `.bakers/addons/patch-check/`. Existing message history remains. The check itself creates no files.

## Extend your addon

You now have the complete path: **declare an operation → run it in the bound worktree → return a result or error → offer the same operation to ticket users**.

Use a fixed, reviewed command for another quick project check. Keep the working directory supplied by the conductor and avoid accepting arbitrary commands or paths.

- [Tools](/addons/build/tools): input, handler context, errors and access boundaries.
- [Messages](/addons/build/actions): direct handlers, bindings and request lifecycle.
- [Addon API reference](/addons/build/contracts): exports, options, scopes and packaging.
- [Lifecycle hooks](/provision/hooks#add-a-listener-from-an-addon): project preparation and cleanup.
