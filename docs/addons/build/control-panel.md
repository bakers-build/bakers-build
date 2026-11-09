# Extend the control panel

Add an **Is dirty?** button to a ticket. Clicking it checks **that ticket's worktree** and answers whether it has uncommitted changes.

This example counts staged changes, unstaged changes and untracked files. Ignored files do not count. It reports a yes/no status, not filenames, and changes no project files. A dirty worktree is a successful check result; a Git failure is an error.

## Before you start

Use a disposable ticket in a working conductor project, with Git and Node.js on the conductor's machine. You need permission to edit project configuration and restart the conductor. The [addon basics](/addons/build/first-addon#what-an-addon-is) explain packages, presets and exports.

The preset supplies two connected capabilities: `tools` declares `git_is_dirty`, and `inbox` describes the ticket button bound to it. Bakers renders the controls and answer; the JavaScript function runs on the conductor.

## Create two files

Create `.bakers/addons/worktree-check/package.json`:

```json
{
  "name": "example-worktree-check",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./preset.js",
  "exports": { ".": "./preset.js", "./preset": "./preset.js" }
}
```

Create `.bakers/addons/worktree-check/preset.js`:

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const scopes = ['project'];

export const tools = {
  contract: 1,
  tools: {
    git_is_dirty: {
      description: 'Report whether the ticket worktree has uncommitted changes.',
    },
  },
  handlers: async () => ({
    git_is_dirty: async ({ worktreePath, signal }) => {
      const { stdout } = await run('git', [
        'status', '--porcelain=v1',
        '--untracked-files=normal', '--ignore-submodules=none',
      ], {
        cwd: worktreePath,
        signal,
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      });
      return {
        text: stdout.length > 0
          ? 'Dirty: uncommitted changes are present.'
          : 'Clean: no uncommitted changes.',
      };
    },
  }),
};

export const inbox = {
  contract: 2,
  label: 'Worktree',
  messages: {
    is_dirty: { label: 'Is dirty?', access: 'view' },
  },
  bindings: { is_dirty: { tool: 'git_is_dirty' } },
};
```

The fixed Git command uses the conductor-supplied `worktreePath`. Callers supply no path or command. Porcelain status has empty output for a clean worktree; any output means dirty. Git errors propagate instead of being mistaken for clean. Cancellation, timeout and output limits bound the command.

Handlers run outside the agent's shell sandbox. Review their code before enabling them.

## Enable in the project

Append `'./addons/worktree-check'` to the existing `addons` array in `.bakers/conductor.config.js`. Keep its other entries and identity settings. The path resolves from that configuration file; this package requires no installation or compilation.

Commit the two files and the configuration change so ticket worktrees receive them. Run:

```sh
bakers config check --scope project --online
```

Restart the conductor with its normal [start/stop procedure](/configuration/project/conductor-commands). The conductor loads the package and registers the message definition with the server; its handler stays on the worker.

## Call it from the ticket

Open a disposable ticket's message card in the web control panel, in the right column. If several addons are available, select **Worktree**. Click **Is dirty?**.

| Definition | What appears |
|---|---|
| `label: 'Worktree'` | The addon name; a tab when several addons are available. |
| `label: 'Is dirty?'`, with no `input` | A button without a form. |
| `bindings.is_dirty.tool` | The same `git_is_dirty` operation an agent can call. |
| Tool `text` | The message's Markdown answer below the controls. |

Expect pending/running followed by **Clean: no uncommitted changes.** or **Dirty: uncommitted changes are present.** Both finish as done. A missing worktree, failed Git command or timeout finishes as failed.

`access: 'view'` permits someone who can read the ticket to request this read-only status. The visible answer belongs to the requester. In `bakers ui`, select the ticket's Overview message card and open it with Enter.

The message API supplies this existing card and Markdown output. It does not load your JavaScript into the browser or add arbitrary web components. See [Messages](/addons/build/actions#extend-the-control-panel) for forms, access and lifecycle.

## Verify

Start with a committed, clean disposable worktree. Click **Is dirty?** and expect clean. Edit a tracked file, click again and expect dirty. Staging that change still reports dirty. A new untracked file also reports dirty; an ignored file alone does not.

Remove only your deliberate test changes, then repeat the check and expect clean. The check itself never commits, deletes or restores anything.

An agent can use the same tool from its running shell:

```sh
bakers tools git_is_dirty --data '{}'
```

No arguments are accepted. An ordinary operator shell uses the site's tools and does not automatically have this run-bound addon connection.

## Remove the example

Remove its configuration entry, restart the conductor, then delete the example package. Existing message history remains. When changing a registered message definition, bump the package version before restarting.

Continue with the [tool API](/addons/build/tools) and [message API](/addons/build/actions).
