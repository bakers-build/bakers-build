# Run the PM bot

The PM bot is a project manager for one bakers.build project in Slack, built on [Hermes Agent](https://github.com/NousResearch/hermes-agent). In its allowed channels it turns requests into bakers.build tickets, answers status questions, posts into a ticket's thread when its state changes, relays agent questions into that thread and passes the thread's answers back. This runbook starts it against a bakers.build server.

| Part | What it is |
|---|---|
| `config.template.yaml` | Hermes configuration: Slack, toolsets, approvals, the `clone-reader` and `pm-relay` MCP servers |
| `SOUL.md` | The persona |
| `skills/project-manager/` | Intake (prior art, clarify, code facts, create), status answers and answering relayed questions |
| `relay/` | `pm-relay`, a local MCP server and the bot's only way into bakers.build: `create_ticket`, `answer_question`, `ticket_read`, `ticket_search`; no LLM |
| `poller/` | Posts state changes and open questions into ticket threads and opens sub-ticket threads; no LLM |
| `lib/bakers-client.mjs` | The API-key sign-in and the JSON:API and tool calls the relay and the poller share |
| `bin/` | `clone`, `setup`, `start`, `stop` |
| `slack-app-manifest.yaml` | The Slack app, created in one step |
| `.env` | Everything project-specific and every secret; ignored by git. Start from `.env.example` |

Everything runs as your own user. The bot's reach is limited by its tools: no terminal, file, browser or web toolset, a filesystem MCP server that sees only a read-only, secret-free clone of the project's code, and `pm-relay`, whose tools are fixed operations.

## How it works

- **The ticket's thread is a link.** A ticket created from Slack carries the thread's permalink as a link titled *Slack thread*; bakers.build stores it as kind `chat`. The bot and the poller read the channel and thread from the ticket's **first** `chat` link.
- **Questions follow the ticket label protocol.** An agent asks by publishing a comment, adding the **Question** label to the ticket and freezing it. The open question is the newest comment that is not a `summary`, created at or before the ticket's `frozen_at`. The poller posts it into the thread once. Anyone in the channel may answer, an approval included; `answer_question` posts the answer as a comment headed *Answered in Slack by <name>:*, removes the label and unfreezes the ticket.
- **Sub-tickets get their own thread.** For an open sub-ticket without a `chat` link, the poller opens a new thread in the channel of its nearest ancestor that has one, links it to the sub-ticket and posts one pointer into the parent's thread.
- **Redeploys need no restart.** The relay and the poller sign in with the API key on demand and again after a 401 or a failed connection. While bakers.build is down, a poller pass fails and keeps its state file; the next pass catches up and posts nothing twice. Hermes talks to Slack over Socket Mode and to `pm-relay` over stdio, so neither connection depends on bakers.build.

## You need

- A bakers.build server with this version, and a workspace administrator on it.
- A Slack workspace you may install an app in, and the project's channel.
- A Claude subscription or an Anthropic API key.
- Read access to the project's repository.
- Node.js 22 or newer, `git` and `perl`.

## 1. Install Hermes

Install Hermes **v0.22.5, commit `bf0203a7`** yourself, following Hermes' own README. `bin/setup` refuses any other version; never run `hermes update`.

## 2. The bot's service account

As a workspace administrator:

1. **Workspace → Service accounts → Add**: a service account for the bot, for example `pm-bot`, with a rank that may create and update tickets, a member of the team that sees the project.
2. On that account, create an API key and copy its client id and secret into `BAKERS_CLIENT_ID` and `BAKERS_CLIENT_SECRET`. The key expires on the date you choose; make a new one before then.
3. Copy the project's UUID into `PM_BOT_PROJECT`, and, to have new tickets qualified at once, a conductor's UUID into `PM_BOT_CONDUCTOR`.

The bot registers no OAuth client of its own: the key is its only credential.

## 3. Slack app

At api.slack.com/apps, **Create New App → From a manifest**, in your workspace, and paste `slack-app-manifest.yaml`: Socket Mode, the bot scopes and the message events.

1. **Basic Information → App-Level Tokens:** generate a token with `connections:write`. That is `SLACK_APP_TOKEN` (`xapp-…`).
2. **Install App → Install to Workspace.** The bot token is `SLACK_BOT_TOKEN` (`xoxb-…`).
3. Invite the bot to the project's channels (`/invite @<bot>`) and copy their IDs into `SLACK_ALLOWED_CHANNELS`.
4. Create a private channel only the operators are in and invite the bot: Hermes' home channel (`SLACK_HOME_CHANNEL`) for its restart notices.
5. Copy the operators' member IDs into `SLACK_ADMIN_USERS` (profile → **Copy member ID**).

The bot answers every user in the allowed channels. To restrict it, list member IDs in `SLACK_ALLOWED_USERS`; messages from everyone else, and from any other channel, are ignored.

## 4. Configure

```sh
cp pm-bot/.env.example pm-bot/.env
```

Fill in every value; `.env.example` explains each. For the model, put a token from `claude setup-token` in `CLAUDE_CODE_OAUTH_TOKEN` for local tests, or an API key in `ANTHROPIC_API_KEY`; a shared bot always uses an API key. `SLACK_ADMIN_USERS` must not be empty: with no operator listed, Hermes lets everyone in the channel run every slash command.

Against a local DDEV server, Node and Hermes do not trust its certificate: build a bundle with `cat /etc/ssl/cert.pem "$(mkcert -CAROOT)/rootCA.pem" > ~/.hermes-pmbot/ca-bundle.pem` and add `SSL_CERT_FILE=${HOME}/.hermes-pmbot/ca-bundle.pem` and `NODE_EXTRA_CA_CERTS=${HOME}/.hermes-pmbot/ca-bundle.pem` to the env file.

## 5. Clone and set up

```sh
pm-bot/bin/clone    # sparse clone without .env files, settings, auth.json, .npmrc, keys and certificates
pm-bot/bin/setup    # renders config.yaml and the skill's project reference, installs pm-relay into HERMES_HOME
```

`PM_BOT_REPO_URL` must not carry a token or password: the clone keeps its URL in `.git/config`, which the bot can read. `setup` accepts only single-word values in the rendered keys, so no value can change the configuration's structure. Rerun both after a change to the env file, the configuration, the persona, the skill or the relay.

## 6. Start and stop

```sh
pm-bot/bin/start    # gateway and poller, detached
pm-bot/bin/stop
```

Logs: `$HERMES_HOME/logs/pm-bot-gateway.log` and `$HERMES_HOME/logs/pm-bot-poller.log`, or the files `PM_BOT_GATEWAY_LOG` and `PM_BOT_POLLER_LOG` name. The poller's first pass only records the current states and relays open questions; it posts state changes from the second pass on, every `PM_BOT_POLL_INTERVAL` seconds (default 15). Its progress is in `$HERMES_HOME/poller-state.json`.

Check it: mention the bot in an allowed channel with a request. It answers in the message's thread with the new ticket's identifier.

## Test it by hand

1. Mention the bot with a request: it creates a ticket in the project, replies with the identifier, and the ticket shows the thread under **More** as a chat link.
2. Ask a question on that ticket as an agent would: a comment, then the **Question** label and the frozen flag. Within `PM_BOT_POLL_INTERVAL` seconds it appears in the thread behind *The implementation of the "…" ticket has a question:*; `bin/stop` and `bin/start` post no second copy.
3. Answer it in the thread as any channel member: the ticket gets the comment *Answered in Slack by <you>:*, loses the label and is unfrozen.
4. Move the ticket on: each new state appears once in the thread. Create a sub-ticket: it gets its own thread and a pointer in the parent's.
5. Restart the bakers.build site while the bot runs, then send a new request: it is answered without restarting the bot.
6. Write to the bot in a channel it is not allowed in: no answer.

## Approve what it learns

The bot keeps no memory and writes no skill without you. Review its proposals in a Hermes session on `HERMES_HOME` (`HERMES_HOME=~/.hermes-pmbot hermes`) with `/memory pending` and `/skills pending`. A lasting change belongs in this folder: `bin/setup` overwrites the bot's copy of the skill.

## When something fails

| Symptom | Cause and fix |
|---|---|
| `token request failed: 401` in a log | The API key is wrong, expired or deleted: create a new one (step 2) and rerun `bin/setup` |
| `pass failed: … 503` or `ECONNREFUSED` in the poller log | bakers.build is down or redeploying; the poller retries every pass on its own |
| A step after `create` reports `failed` | The service account lacks update rights in the project, or a label name is taken: fix the rank, then add the label or link by hand |
| `CERTIFICATE_VERIFY_FAILED` or `self-signed certificate` | `SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS` are missing or lack the mkcert root (step 4) |
| `config migration skipped` in the log | The rendered configuration lost `_config_version`; rerun `bin/setup` |
| A relayed question never appears | The ticket has no `chat` link, lacks the **Question** label or is not frozen; `hermes send exited …` in the poller log names the Slack error |

## Cut it off

- **Stop it:** `pm-bot/bin/stop`.
- **Cut its access:** delete the service account's API key or disable the account. The relay and the poller stop working within five minutes, the lifetime of their last token.
