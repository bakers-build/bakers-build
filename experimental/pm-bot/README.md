# The PM bot

The PM bot is a project manager for one bakers.build project in Slack, built on [Hermes Agent](https://github.com/NousResearch/hermes-agent). In its one Slack channel it runs bakers.build's `bb-create-ticket` skill to specify each request with its requester as a ticket, answers status questions, posts into a ticket's thread when its state changes, relays agent questions into that thread and passes the thread's answers back.

It runs as one container from the image this folder builds, in a `bakers-ddev` Coder workspace configured by workspace parameters. To set it up and run it, follow [the template's README › PM bot](../../coder/bakers-ddev/README.md#pm-bot).

| Part | What it is |
|---|---|
| `Dockerfile` | The bot's image: the official Hermes image at v0.22.5, pinned by digest, with this folder's content in `/opt/pm-bot` and the shipped skills in `/opt/pm-bot/skills` |
| `build/collect-skills.mjs` | At build time, copies `bb-create-ticket`, `bb-recipe-superpowers` and `bb-recipe-matt` with every bundle file their links reach; refuses a link that leaves the bundle, reaches another skill or is broken |
| `entrypoint.sh` | The container's start, as the `hermes` user: checks the env, renders the configuration, puts the persona and the shipped skills into Hermes' home, runs the poller and the gateway |
| `render.mjs` | Fills the `${…}` placeholders of the configuration and the persona from the env; refuses an unset value or one that could change the YAML |
| `config.template.yaml` | Hermes configuration: Slack, toolsets, approvals, the `clone-reader` MCP server and bakers.build's `/mcp` as the `bakers` server |
| `SOUL.template.md` | The persona, rendered into `SOUL.md`: the host context `bb-create-ticket` takes (project, workflow, conductor, the requester from Hermes' sender prefix, the thread's permalink), status answers and passing answers back |
| `poller/` | Posts state changes and open questions into ticket threads and opens sub-ticket threads; no LLM |
| `lib/bakers-client.mjs` | The poller's bakers tool calls on `/mcp`, with the API key as bearer |
| `slack-app-manifest.yaml` | The Slack app, created in one step |
| `.env.example` | The keys the container reads from its env file, which the Coder template writes |

The bot's reach is limited by its tools and its container. It has no terminal, file, browser or web toolset; a filesystem MCP server that sees only a read-only, secret-free clone of the project's code; and eight of bakers.build's own tools (ticket create, read, search, update, transition and classify, comment publish and user read), with the rights of its service account. They serve exactly the steps of `bb-create-ticket`, status reads and the answer path. Make that account a member of the bot's project's team only: the bot acts on its project, and the account's membership is what bakers.build enforces. The container sees only Hermes' home and that clone, has no Docker socket and runs with almost every capability dropped.

## How it works

- **One container, two processes.** The image keeps Hermes' own start: its bootstrap runs as root, maps the `hermes` user to the workspace user's UID and prepares `/opt/data`, then drops to `hermes`. `entrypoint.sh` then renders `config.yaml` and `SOUL.md`, replaces the shipped skills in `/opt/data/skills`, removes the retired `project-manager` skill, and runs `node poller/poller.mjs` and `hermes gateway run` side by side. When either exits, the container exits and Docker restarts it.
- **What survives a start.** `/opt/data` is on the workspace's home volume. Sessions, memories, skills the bot learned and the poller's state stay; the configuration, the persona and the shipped skills come from the image every time.
- **The skills ship in the image.** `bb-create-ticket` and the recipes `bb-recipe-superpowers` and `bb-recipe-matt` come from this repository's skill bundle at the image's build revision, with every bundle file their links reach; their method skills `brainstorming` and `writing-plans` (superpowers `v7.0.0`) and `grilling` (mattpocock/skills `v1.3.2`) come unchanged from their pinned commits. Check mode prints the bundle version (`bakers skills <version>`) and the shipped skills.
- **The bot hosts the skill.** `SOUL.md` gives `bb-create-ticket` the project, workflow and conductor, the requester's name and Slack user ID from the prefix Hermes puts on each message, the thread's permalink (built from the one allowed channel's ID, since Hermes shows the model only the channel's name) as the conversation link, and the wish to specify every request with its requester. Only the requester's "yes" hands the ticket over.
- **The ticket's thread is a link.** A ticket created from Slack carries the thread's permalink as a link titled *Slack thread*; bakers.build stores it as kind `chat`. The bot and the poller read the channel and thread from the ticket's **first** `chat` link.
- **Questions follow the ticket label protocol.** An agent asks by publishing a comment, adding the **Question** label to the ticket and freezing it. The open question is the newest comment that is not a `summary`, created at or before the ticket's `frozen_at`. The poller posts it into the thread once. Anyone in the channel may answer, an approval included; the bot checks the ticket is still frozen with the label, posts the answer as a comment headed *Answered in Slack by <name> (Slack user <ID>):*, removes the label and unfreezes the ticket. A reply to a ticket labelled `technical problem` is not passed on.
- **Sub-tickets get their own thread.** For an open sub-ticket without a `chat` link, the poller opens a new thread in the channel of its nearest ancestor that has one, links it to the sub-ticket and posts one pointer into the parent's thread.
- **One credential, no sign-in.** Hermes and the poller send the service account's API key as the bearer on bakers.build's `/mcp`; there is no token to refresh. Hermes fills the header from the env file (`${env:BAKERS_API_KEY}` in the configuration), so the key never lands in `config.yaml`.
- **Redeploys need no restart.** While bakers.build is down, a tool call fails: a poller pass fails and keeps its state file, and the next pass catches up and posts nothing twice; Hermes reconnects on its own. Hermes talks to Slack over Socket Mode, which does not depend on bakers.build.
- **It needs a bakers.build with API keys as bearer, the project ticket list tool, `bakers_user_read` and `labels_remove`** on `bakers_ticket_update`, and the service user's position and background set on its profile (the template's README › PM bot › The bot's service account).

## Develop

```sh
node --test 'experimental/pm-bot/**/*.test.mjs'     # poller, client and render, against stubs
bash tests/contract/pm-bot.sh          # lock-down of the configuration, the persona, the build lines, the Slack app and the compose file
bash tests/contract/pm-bot-image.sh    # builds the image; check mode against a /mcp stub, then run mode (Docker)
```

Build the image from the repository root. Its skills come from three named build contexts: this repository's skill bundle and two upstream skill repositories pinned by commit (superpowers `v7.0.0`, mattpocock/skills `v1.3.2`), so building needs GitHub access:

```sh
docker build -t pm-bot:local \
  --build-context bundle=.claude/skills/bakers-build \
  --build-context superpowers=https://github.com/obra/superpowers.git#bb92a77741419a4ab5f06e711a283343f1ada0c3 \
  --build-context mattpocock=https://github.com/mattpocock/skills.git#d1478fcb140db0b93c0c8df17bcfd311844749d0 experimental/pm-bot
```

GitHub CI runs the first two in `pm_bot` and the third in `image_gate`; the release then publishes the image to GHCR (the template's README › PM bot › The bot's version).

## Test it by hand

On a workspace running the bot, with the service user's profile set, and two members of the bot's channel: the **requester** and a **second member**. Record each step with its thread permalink and the ticket as bakers.build shows it.

1. **Specify and hand over.** The requester mentions the bot with a feature request and answers its questions in the thread. The ticket linked to the thread is specified in plain words; after the requester's "yes" it carries the `spec`, `plan` and `test` comments with *Approved by <name> (Slack user <ID>)*, a type and recipe, the conductor, the label `pingpong` and the state `working`.
2. **Only the requester's yes.** On the next request, the second member answers "yes" to the summary first: nothing on the ticket changes. The requester's "yes" then hands it over.
3. **An answer from anyone.** On a ticket with a thread, publish a `# Question` comment, add the **Question** label and freeze it. Within `PM_BOT_POLL_INTERVAL` seconds (default 15) it appears in the thread; `docker compose -p pm-bot restart` posts no second copy. The second member answers: the ticket gets *Answered in Slack by <name> (Slack user <ID>):* with the answer, loses the label and is unfrozen.
4. **A technical problem stays.** Publish a technical-problem note, add the label `technical problem` and freeze the ticket; reply in the thread. Nothing is written to the ticket; the bot points to the developers.
5. **Status in plain words.** Ask "how is <identifier> going?" in the channel: the bot answers with the state in plain words and two or three sentences from the latest summary, without state names, comment types or criteria IDs.

Also check the poller and the limits: each new state appears once in the thread; a sub-ticket gets its own thread and a pointer in the parent's; after a restart of the bakers.build site a new request is answered without restarting the bot; in a channel the bot is not allowed in, it does not answer.

## Approve what it learns

The bot keeps no memory and writes no skill without you. Review its proposals in a Hermes session inside the container, `docker compose -p pm-bot exec pm-bot hermes`, with `/memory pending` and `/skills pending`. A lasting change belongs in this repository: in `SOUL.template.md`, or in the bundle skills, which every start replaces with the image's.

## When something fails

| Symptom | Cause and fix |
|---|---|
| `/mcp answered 401` in the container log | The API key is wrong or revoked, or its account is blocked: create a new key and update the `pm_bot_bakers_api_key` parameter |
| `pass failed: … 503` or `ECONNREFUSED` in the container log | bakers.build is down or redeploying; the poller retries every pass on its own |
| The bot says the labels could not be added or the thread could not be linked | The service account lacks update rights in the project: fix its rank, then add the label or link by hand |
| `pm-bot: missing: …` and the container restarting | The env file lacks a required key; check the workspace's skip line and parameters |
| `pm-bot: SLACK_ALLOWED_CHANNELS must name exactly one channel` | `pm_bot_slack_allowed_channels` lists more than one channel; the bot serves one |
| `render …: … may hold only …` | A parameter holds a character the configuration cannot take safely |
| A relayed question never appears | The ticket has no `chat` link, lacks the **Question** label or is not frozen; `hermes send exited …` in the container log names the Slack error |

## Cut it off

- **Stop it:** `docker compose -p pm-bot down` in the workspace, or empty its parameters so no start brings it back.
- **Cut its access:** delete the service account's API key or disable the account. The next tool call of the bot and the poller is refused.
