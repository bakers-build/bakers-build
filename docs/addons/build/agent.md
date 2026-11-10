# Add a new agent harness

Implement the adapter between bakers.build and an agent program that has no bakers.build integration yet. A **harness** tells bakers.build how to launch that program and collect its run transcript.

This example targets `my-agent`, a hypothetical CLI with the contract below. The adapter is complete for that contract; the agent program itself is something you provide. No Claude addon or other existing harness is loaded.

## The agent program's API

| Operation | Required behavior of `my-agent` |
|---|---|
| `my-agent --session <id> --prompt <text>` | Start an interactive session in the current working directory. Treat the prompt as one argument. |
| `my-agent` | Start without an initial prompt. |
| Transcript | Write the session's transcript to `.my-agent/<id>.log` in that working directory. Flush it before reporting the ticket step complete. |
| Existing session ID | Reopen that session rather than refusing or creating an unrelated transcript. |

Replace this command and transcript format with your program's actual API when adapting the example. Node.js and your agent executable must be available to the conductor user. Configure its model and authentication in the agent's own settings.

## The bakers.build API {#the-bakers-api}

The public interfaces are exported from `@bakers-build/conductor/contract`. JavaScript packages implement their methods directly; TypeScript authors can import `AgentPlugin`, `BbAgent`, `AgentRunIdentity` and `AgentFootprint` as types.

| Part | What bakers.build calls or reads |
|---|---|
| Preset `agents(acc)` | Return the previous candidates plus your candidate. |
| Candidate `{ alias, agent }` | Give the integration a selectable name and its plugin. |
| `AgentPlugin.createAgent(config)` | Construct a `BbAgent`. |
| `launchCommand(prompt, run?, workspacePath?, tools?, env?)` | Return the shell command; the executor starts it in the worktree. |
| `getRunLog(worktreePath, run?)` | Return only the named run's transcript; return `''` when unavailable. |
| `parseFootprint(log)` | Return usage metrics without throwing on missing or partial logs. |

The preset registers the harness; it does not start it. During dispatch, bakers.build selects the candidate, constructs the adapter and asks for a launch command. During finalization it reads the transcript and metrics.

## Create the package

Create `~/.bakers/addons/my-agent/package.json`:

```json
{
  "name": "example-my-agent",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./preset.js",
  "exports": {
    ".": "./preset.js",
    "./preset": "./preset.js"
  }
}
```

Create `~/.bakers/addons/my-agent/preset.js`:

```js
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const scopes = ['machine'];

const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

const plugin = {
  kind: 'agent',
  id: 'my-agent',
  requiredModules: [],
  async createAgent() {
    return {
      id: 'my-agent',
      launchCommand(prompt, run) {
        const args = ['my-agent'];
        if (run) {
          if (!/^[a-zA-Z0-9_-]+$/.test(run.sessionId)) {
            throw new Error('Invalid session ID');
          }
          args.push('--session', quote(run.sessionId));
        }
        if (prompt !== '') args.push('--prompt', quote(prompt));
        return args.join(' ');
      },
      async getRunLog(worktreePath, run) {
        const ids = run?.attemptFamily ?? (run ? [run.sessionId] : []);
        for (const id of [...ids].reverse()) {
          if (!/^[a-zA-Z0-9_-]+$/.test(id)) continue;
          try {
            return await readFile(join(worktreePath, '.my-agent', id + '.log'), 'utf8');
          } catch {
            // A missing or unreadable transcript must not break finalization.
          }
        }
        return '';
      },
      parseFootprint() {
        return {
          tokens: 0, duration_s: 0, agent_turns: 0,
          tool_calls: 0, user_prompts: 0, user_prompt_words: 0, active_s: 0,
        };
      },
    };
  },
};

export const agents = (acc) => [
  ...acc,
  { alias: 'my-agent', agent: plugin },
];
```

## Enable and verify

Append `'./addons/my-agent'` to `addons` in `~/.bakers/machine.config.js`. If you maintain an explicit `agents.catalog`, add `{ harness: './addons/my-agent', alias: 'my-agent' }` to it. Keep the remaining settings.

```sh
bakers config check --scope machine --online
bakers agents
```

Restart the conductor and expect the `my-agent` alias with harness ID `my-agent`. With your CLI installed, dispatch a disposable ticket labelled `agent:my-agent`: check that it receives the prompt, writes the run's transcript and completes the ticket through your normal bakers.build workflow.

## Limits and responsibilities

This adapter reports zero metrics because the example transcript API supplies no usage data. Implement `parseFootprint` for your program's format to collect them. It does not configure MCP or implement an OS sandbox: the program runs with the conductor user's access. See [run security](/provision/security/) before enabling a real harness.

The optional `tools` argument is an object with a `url` field: `tools.url` is the run's conductor MCP URL. Its bearer token is provided in `BAKERS_CONDUCTOR_TOKEN`; use your program's MCP configuration mechanism without putting tokens in command arguments or logs. A program that cannot use MCP can call `bakers tools` from its run environment.

An agent that refuses reused session IDs also implements `sessionExists(worktreePath, sessionId)`. bakers.build can then choose a new attempt identity. Transcript lookup must respect `run.attemptFamily`; selecting the newest file in a directory can attach another run's transcript.

An agent that can continue a session also implements `resumeCommand(sessionId, workspacePath?, tools?, env?, args?)`, together with `sessionExists`. After a conductor restart, bakers.build calls it for a run whose terminal is gone, with the newest session of that run, and starts the command in the same worktree. Return the launch's own flags with your program's resume option, or `undefined` when this configuration cannot resume; the run is then failed and the ticket gets a fresh run.

Remove the addon/catalog entry and restart the conductor before deleting this package.

Continue with [Add a new client](/addons/build/client) or the [preset API](/addons/build/contracts).
