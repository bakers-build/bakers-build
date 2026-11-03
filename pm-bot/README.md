# The PM bot

The PM bot is a project manager for one bakers.build project in Slack, built on [Hermes Agent](https://github.com/NousResearch/hermes-agent). In its allowed channels it turns requests into bakers.build tickets, answers status questions, posts into a ticket's thread when its state changes, relays agent questions into that thread and passes the thread's answers back.

It runs as one container from the image this folder builds, in a `bakers-ddev` Coder workspace configured by workspace parameters. To set it up and run it, follow [the template's README › PM bot](../coder/bakers-ddev/README.md#pm-bot).

| Part | What it is |
|---|---|
| `Dockerfile` | The bot's image: the official Hermes image at v0.22.5, pinned by digest, with this folder's content in `/opt/pm-bot` |
| `entrypoint.sh` | The container's start, as the `hermes` user: checks the env, renders the configuration, puts the persona and skill into Hermes' home, runs the poller and the gateway |
| `render.mjs` | Fills the configuration's `${…}` placeholders from the env; refuses an unset value or one that could change the YAML |
| `config.template.yaml` | Hermes configuration: Slack, toolsets, approvals, the `clone-reader` and `pm-relay` MCP servers |
| `SOUL.md` | The persona |
| `skills/project-manager/` | Intake (prior art, clarify, code facts, create), status answers and answering relayed questions |
| `relay/` | `pm-relay`, a local MCP server and the bot's only way into bakers.build: `create_ticket`, `answer_question`, `ticket_read`, `ticket_search`; no LLM |
| `poller/` | Posts state changes and open questions into ticket threads and opens sub-ticket threads; no LLM |
| `lib/bakers-client.mjs` | The API-key sign-in and the JSON:API and tool calls the relay and the poller share |
| `slack-app-manifest.yaml` | The Slack app, created in one step |
| `.env.example` | The keys the container reads from its env file, which the Coder template writes |

The bot's reach is limited by its tools and its container. It has no terminal, file, browser or web toolset; a filesystem MCP server that sees only a read-only, secret-free clone of the project's code; and `pm-relay`, whose tools are fixed operations. The container sees only Hermes' home and that clone, has no Docker socket and runs with almost every capability dropped.

## How it works

- **One container, two processes.** The image keeps Hermes' own start: its bootstrap runs as root, maps the `hermes` user to the workspace user's UID and prepares `/opt/data`, then drops to `hermes`. `entrypoint.sh` then renders `config.yaml` and the skill's project reference, replaces `SOUL.md` and the `project-manager` skill in `/opt/data`, and runs `node poller/poller.mjs` and `hermes gateway run` side by side. When either exits, the container exits and Docker restarts it.
- **What survives a start.** `/opt/data` is on the workspace's home volume. Sessions, memories, skills the bot learned and the poller's state stay; the configuration, the persona and the `project-manager` skill come from the image every time.
- **The ticket's thread is a link.** A ticket created from Slack carries the thread's permalink as a link titled *Slack thread*; bakers.build stores it as kind `chat`. The bot and the poller read the channel and thread from the ticket's **first** `chat` link.
- **Questions follow the ticket label protocol.** An agent asks by publishing a comment, adding the **Question** label to the ticket and freezing it. The open question is the newest comment that is not a `summary`, created at or before the ticket's `frozen_at`. The poller posts it into the thread once. Anyone in the channel may answer, an approval included; `answer_question` posts the answer as a comment headed *Answered in Slack by <name>:*, removes the label and unfreezes the ticket.
- **Sub-tickets get their own thread.** For an open sub-ticket without a `chat` link, the poller opens a new thread in the channel of its nearest ancestor that has one, links it to the sub-ticket and posts one pointer into the parent's thread.
- **Redeploys need no restart.** The relay and the poller sign in with the API key on demand and again after a 401 or a failed connection. While bakers.build is down, a poller pass fails and keeps its state file; the next pass catches up and posts nothing twice. Hermes talks to Slack over Socket Mode and to `pm-relay` over stdio, so neither connection depends on bakers.build.
- **The relay reads the env file itself.** Hermes starts MCP servers with a filtered environment, so `pm-relay` gets the env file's path as its argument (`/opt/data/.env`).

## Develop

```sh
node --test 'pm-bot/**/*.test.mjs'     # poller, relay, client and render, against stubs
bash tests/contract/pm-bot.sh          # lock-down of the configuration, the Slack app and the compose file
bash tests/contract/pm-bot-image.sh    # builds the image and starts it in check and run mode (Docker)
```

GitHub CI runs the first two in `pm_bot` and the third in `image_gate`; the release then publishes the image to GHCR (the template's README › PM bot › The bot's version).

## Test it by hand

On a workspace running the bot:

1. Mention the bot with a request: it creates a ticket in the project, replies with the identifier, and the ticket shows the thread under **More** as a chat link.
2. Ask a question on that ticket as an agent would: a comment, then the **Question** label and the frozen flag. Within `PM_BOT_POLL_INTERVAL` seconds (default 15) it appears in the thread behind *The implementation of the "…" ticket has a question:*; `docker compose -p pm-bot restart` posts no second copy.
3. Answer it in the thread as any channel member: the ticket gets the comment *Answered in Slack by <you>:*, loses the label and is unfrozen.
4. Move the ticket on: each new state appears once in the thread. Create a sub-ticket: it gets its own thread and a pointer in the parent's.
5. Restart the bakers.build site while the bot runs, then send a new request: it is answered without restarting the bot.
6. Write to the bot in a channel it is not allowed in: no answer.

## Approve what it learns

The bot keeps no memory and writes no skill without you. Review its proposals in a Hermes session inside the container, `docker compose -p pm-bot exec pm-bot hermes`, with `/memory pending` and `/skills pending`. A lasting change belongs in this folder: every start replaces the bot's copy of the `project-manager` skill.

## When something fails

| Symptom | Cause and fix |
|---|---|
| `token request failed: 401` in the container log | The API key is wrong, expired or deleted: create a new one and update its parameters |
| `pass failed: … 503` or `ECONNREFUSED` in the container log | bakers.build is down or redeploying; the poller retries every pass on its own |
| A step after `create` reports `failed` | The service account lacks update rights in the project, or a label name is taken: fix the rank, then add the label or link by hand |
| `pm-bot: missing: …` and the container restarting | The env file lacks a required key; check the workspace's skip line and parameters |
| `render …: … may hold only …` | A parameter holds a character the configuration cannot take safely |
| A relayed question never appears | The ticket has no `chat` link, lacks the **Question** label or is not frozen; `hermes send exited …` in the container log names the Slack error |

## Cut it off

- **Stop it:** `docker compose -p pm-bot down` in the workspace, or empty its parameters so no start brings it back.
- **Cut its access:** delete the service account's API key or disable the account. The relay and the poller stop working within five minutes, the lifetime of their last token.
