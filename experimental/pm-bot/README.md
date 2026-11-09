# The PM bot

For Hermes's place on the production line and a requester's first action, see [Use your client](https://bakers.build/get-started/use-your-client#hermes). This experimental integration has no dedicated Bakers addon.

The PM bot is a project manager for one bakers.build project in Slack, built on [Hermes Agent](https://github.com/NousResearch/hermes-agent). A mention in its main Slack channel opens a public channel for that request. There it runs bakers.build's `bb-create-ticket` skill to specify the request with its requester as a ticket, answers status questions, posts the ticket's state changes, relays agent questions and passes the answers back. The channel is renamed after its ticket and archived when the ticket is finished.

It runs as one container from the image this folder builds, in a `bakers-ddev` Coder workspace configured by workspace parameters. To set it up and run it, follow [the template's README › PM bot](../../coder/bakers-ddev/README.md#pm-bot).

| Part | What it is |
|---|---|
| `Dockerfile` | The bot's image: the official Hermes image at v0.22.5, pinned by digest, with this folder's content in `/opt/pm-bot` and the shipped skills in `/opt/pm-bot/skills` |
| `build/collect-skills.mjs` | At build time, copies `bb-create-ticket`, `bb-recipe-superpowers` and `bb-recipe-matt` with every bundle file their links reach; refuses a link that leaves the bundle, reaches another skill or is broken |
| `entrypoint.sh` | The container's start, as the `hermes` user: checks the env, renders the configuration, puts the persona and the shipped skills into Hermes' home, runs the poller and the gateway |
| `render.mjs` | Fills the `${…}` placeholders of the configuration and the persona from the env; refuses an unset value or one that could change the YAML |
| `config.template.yaml` | Hermes configuration: Slack, toolsets, approvals, the `clone-reader` MCP server and bakers.build's `/mcp` as the `bakers` server |
| `SOUL.template.md` | The persona, rendered into `SOUL.md`: the host context `bb-create-ticket` takes (project, workflow, conductor, the requester from Hermes' sender prefix, the channel's link), status answers and passing answers back |
| `plugins/bot-channels/` | A Hermes plugin: turns a mention in the main channel into a request channel, admits only the bot's own open channels, and tells the model each channel's ID, link and ticket |
| `poller/` | Posts state changes, status updates between them and open questions into each ticket's channel; renames, archives and reopens the bot's channels; no LLM |
| `lib/bakers-client.mjs` | The poller's bakers tool calls on `/mcp`, with the API key as bearer |
| `slack-app-manifest.yaml` | The Slack app, created in one step |
| `.env.example` | The keys the container reads from its env file, which the Coder template writes |

The bot's reach is limited by its tools and its container. It has no terminal, file, browser or web toolset; a filesystem MCP server that sees only a read-only, secret-free clone of the project's code; and eight of bakers.build's own tools (ticket create, read, search, update, transition and classify, comment publish and user read), with the rights of its service account. They serve exactly the steps of `bb-create-ticket`, status reads and the answer path. Make that account a member of the bot's project's team only: the bot acts on its project, and the account's membership is what bakers.build enforces. The container sees only Hermes' home and that clone, has no Docker socket and runs with almost every capability dropped.

## How it works

- **One container, two processes.** The image keeps Hermes' own start: its bootstrap runs as root, maps the `hermes` user to the workspace user's UID and prepares `/opt/data`, then drops to `hermes`. `entrypoint.sh` then renders `config.yaml` and `SOUL.md`, replaces the shipped skills in `/opt/data/skills` and the plugin in `/opt/data/plugins/bot-channels`, removes the retired `project-manager` skill, and runs `node poller/poller.mjs` and `hermes gateway run` side by side. When either exits, the container exits and Docker restarts it.
- **What survives a start.** `/opt/data` is on the workspace's home volume. Sessions, memories, skills the bot learned, the poller's state and the plugin's list of request channels stay; the configuration, the persona and the shipped skills come from the image every time.
- **The skills ship in the image.** `bb-create-ticket` and the recipes `bb-recipe-superpowers` and `bb-recipe-matt` come from this repository's skill bundle at the image's build revision, with every bundle file their links reach; their method skills `brainstorming` and `writing-plans` (superpowers `v7.0.0`) and `grilling` (mattpocock/skills `v1.3.2`) come unchanged from their pinned commits. Check mode prints the bundle version (`bakers skills <version>`) and the shipped skills.
- **A channel per request, no threads.** A mention of the bot at the top of its main channel (`SLACK_ALLOWED_CHANNELS`) never starts a conversation there. The `bot-channels` plugin, a Bolt middleware in Hermes' Slack app, opens a public channel `req-<first words>`, invites the sender, posts a fixed acknowledgement there that mentions them (no model call), replies flat in the main channel with a link to it, records it in `/opt/data/bot-channels.json` and hands the message on to Hermes as if it had been written in the new channel. If handing it on fails, the plugin asks the requester there to repeat the request. Hermes runs with `reply_in_thread: false`, so each channel is one flat conversation, and in the bot's own channels it answers without a mention. Each message from a served user in an open channel gets an `eyes` reaction while Hermes works on it, removed when it is done; no ✅ or ❌ stays behind. The plugin's fixed texts live in one table, `TEXTS` in `plugins/bot-channels/channels.py`.
- **Only its own channels.** Before each message Hermes asks the plugin which channels it serves: the main channel and the bot's open channels (the request channels in `bot-channels.json` and the poller's reopen channels in `poller-state.json`, minus the archived ones). In any other channel, even one the bot was invited to, it does not answer. Each open channel gets a trusted line before the conversation with its ID, its link and its ticket, which the model cannot see otherwise.
- **The bot hosts the skill.** `SOUL.md` gives `bb-create-ticket` the project, workflow and conductor, the requester's name and Slack user ID from the prefix Hermes puts on each message, the channel's link from its trusted line as the conversation link, and the wish to specify every request with its requester. Only the requester's "yes" hands the ticket over.
- **The ticket's channel is a link.** A ticket created from Slack carries the channel's link (`https://<workspace>.slack.com/archives/<channel ID>`) titled *Slack channel*; bakers.build stores it as kind `chat`. The poller reads a ticket's conversation from its **newest** channel link; a ticket from before channels, with only a thread permalink, keeps getting its posts in that thread.
- **The poller keeps the channels.** Once a request channel's ticket exists, the poller renames the channel to `<identifier>-<title>` (`yf-12-comic-sans`, at most 40 characters, `-2` when the name is taken). When the ticket reaches `done` or `cancelled`, it posts the final state and then archives the channel. Slack does not let a bot unarchive, so when the ticket is reopened the poller opens a fresh channel (`yf-12-comic-sans-2`), invites the requester, posts the new state with a link to the archived channel and adds the fresh channel's link to the ticket. A request channel without a ticket that stays silent for a week gets a last message and is archived. Each step is recorded in `poller-state.json` before the next, so a failed step is retried and none is repeated.
- **Questions follow the ticket label protocol.** An agent asks by publishing a comment, adding the **Question** label to the ticket and freezing it. The open question is the newest comment that is not a `summary`, created at or before the ticket's `frozen_at`. The poller posts it into the ticket's channel once. Anyone in the channel may answer, an approval included; the bot checks the ticket is still frozen with the label, posts the answer as a comment headed *Answered in Slack by <name> (Slack user <ID>):*, removes the label and unfreezes the ticket. A reply to a ticket labelled `technical problem` is not passed on.
- **Status updates between states.** For each open ticket the poller also reads its runs and comments and posts, once each: a line when a run starts (one per starting state; starts within 5 minutes of the last posted one share its line); a line when a run ends without moving the ticket on, *paused* for a failed, expired or cancelled run and *waits for a decision* for a finished one unless a question or technical problem is open; the first one or two sentences of a new `summary` comment's *Outcome*, leaving out sentences with code, ticket, AC or run identifiers, or recipe and agent names; and a new preview link (a `.ddev.site` page or a Designbook link) with its title. While a run is running in `working` or `review` and the conversation has had no post from the poller for `PM_BOT_HEARTBEAT_INTERVAL` seconds (default 1800), it posts one *Still working on it.* line with a sentence of the newest summary since the run started. Runs, summaries and links from before the poller followed a ticket are recorded, not posted. The texts are in `poller/messages.json`.
- **Sub-tickets share their ancestor's channel.** A sub-ticket without a conversation of its own posts its states and notes into the channel of its nearest ancestor that has one, behind its identifier (`YF-13 · …`). It gets no channel and no thread.
- **One credential, no sign-in.** Hermes and the poller send the service account's API key as the bearer on bakers.build's `/mcp`; there is no token to refresh. Hermes fills the header from the env file (`${env:BAKERS_API_KEY}` in the configuration), so the key never lands in `config.yaml`.
- **Redeploys need no restart.** While bakers.build is down, a tool call fails: a poller pass fails and keeps its state file, and the next pass catches up and posts nothing twice; Hermes reconnects on its own. Hermes talks to Slack over Socket Mode, which does not depend on bakers.build.
- **It needs a bakers.build with API keys as bearer, the project ticket list tool, `bakers_user_read` and `labels_remove`** on `bakers_ticket_update`, and the service user's position and background set on its profile (the template's README › PM bot › The bot's service account).

## Develop

```sh
node --test 'experimental/pm-bot/**/*.test.mjs'     # poller, client and render, against stubs
python3 -m unittest discover -s experimental/pm-bot/plugins/bot-channels   # the plugin's pure core
bash tests/contract/pm-bot.sh          # lock-down of the configuration, the persona, the plugin, the build lines, the Slack app and the compose file
bash tests/contract/pm-bot-image.sh    # builds the image; check mode (plugin loaded, its Hermes seams, /mcp stub), then run mode (Docker)
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

On a workspace running the bot, with the service user's profile set and the Slack app reinstalled with `channels:manage` and `reactions:write`, and three people or places: the **requester**, a **second member**, and an **outsider channel** the bot was invited to but did not open. Record each step with its channel name and link and the ticket as bakers.build shows it.

1. **A channel per request.** The requester mentions the bot with a feature request in the main channel. A flat reply there links a new `#req-…` channel; the requester is in it and the bot answers there without further mentions. The main channel shows no thread.
2. **Specify and hand over.** The requester answers the bot's questions in the channel. After their "yes" the ticket carries the `spec`, `plan` and `test` comments with *Approved by <name> (Slack user <ID>)*, a type and recipe, the conductor, the labels `auto` and `ticket-question`, the state `working` and the link *Slack channel* to `…/archives/C…`. Within `PM_BOT_POLL_INTERVAL` seconds (default 15) the channel is renamed to `<identifier>-<title>`.
3. **Only the requester's yes.** On the next request, the second member joins its channel and answers "yes" to the summary first: nothing on the ticket changes. The requester's "yes" then hands it over.
4. **An answer from anyone.** Publish a `# Question` comment on the ticket, add the **Question** label and freeze it. It appears once in the channel; `docker compose -p pm-bot restart` posts no second copy. The second member answers with a plain message: the ticket gets *Answered in Slack by <name> (Slack user <ID>):* with the answer, loses the label and is unfrozen.
5. **A technical problem stays.** Publish a technical-problem note, add the label `technical problem` and freeze the ticket. The note appears once behind `The work on the "<title>" ticket is stuck on a technical problem that keytec has to solve:`, also when the ticket carries **Question** as well. Reply in the channel: nothing is written to the ticket; the bot points to the developers.
6. **Status in plain words.** Ask "how is it going?" in the channel: the bot answers with the ticket's state in plain words and two or three sentences from the latest summary. Move the ticket to `review`: the post appears once.
7. **Closing and reopening.** Move the ticket to `done`: the final post with where and how to test appears, then the channel is archived. Move it back to `working`: a channel `<identifier>-<title>-2` appears with the requester in it, a link to the archived channel and the state, and the ticket carries a second *Slack channel* link.
8. **Only its own channels.** Mention the bot in the outsider channel: no reply, and no ticket is created or changed.

Also check the limits: after a restart of the bakers.build site a new request is answered without restarting the bot. A request channel without a ticket is archived after a week of silence; that takes a week, so the poller's tests cover it against stubs.

## Approve what it learns

The bot keeps no memory and writes no skill without you. Review its proposals in a Hermes session inside the container, `docker compose -p pm-bot exec pm-bot hermes`, with `/memory pending` and `/skills pending`. A lasting change belongs in this repository: in `SOUL.template.md`, or in the bundle skills, which every start replaces with the image's.

## When something fails

| Symptom | Cause and fix |
|---|---|
| `/mcp answered 401` in the container log | The API key is wrong or revoked, or its account is blocked: create a new key and update the `pm_bot_bakers_api_key` parameter |
| `pass failed: … 503` or `ECONNREFUSED` in the container log | bakers.build is down or redeploying; the poller retries every pass on its own |
| The bot says the labels could not be added or the channel could not be linked | The service account lacks update rights in the project: fix its rank, then add the label or link by hand |
| `I could not open a channel for this request` in the main channel, `bot-channels: request channel …` in the container log | The Slack app lacks `channels:manage` or the workspace forbids creating channels: add the scope, reinstall the app |
| `rename …`, `archive …` or `reopen …` with a Slack error in the container log | The poller retries every pass; `missing_scope` means the app lacks `channels:manage` |
| No `eyes` on messages in a request channel | The Slack app lacks `reactions:write` (Hermes logs the failed `reactions.add` at debug level only): add the scope, reinstall the app |
| The bot does not answer in a channel | It answers only in its main channel and the request channels it opened and has not archived; a channel it was merely invited to stays silent |
| `pm-bot: missing: …` and the container restarting | The env file lacks a required key; check the workspace's skip line and parameters |
| `pm-bot: SLACK_ALLOWED_CHANNELS must name exactly one channel` | `pm_bot_slack_allowed_channels` lists more than one channel; the bot has one main channel |
| `render …: … may hold only …` | A parameter holds a character the configuration cannot take safely |
| A relayed question or technical problem never appears | The ticket has no `chat` link, lacks the **Question** or **technical problem** label or is not frozen; `hermes send exited …` in the container log names the Slack error |

## Cut it off

- **Stop it:** `docker compose -p pm-bot down` in the workspace, or empty its parameters so no start brings it back.
- **Cut its access:** delete the service account's API key or disable the account. The next tool call of the bot and the poller is refused.
