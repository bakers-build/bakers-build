# Use your client

Clients are windows onto the production line. A ticket carries work through workflow states; agents work on it, and you observe progress, discuss decisions or act through the client suited to your role.

| Client | Use it for | You need |
|---|---|---|
| [herdr-cli](#herdr-cli) | Ticket workspaces and interactive agent tabs in a terminal | herdr's default session and a prepared project |
| [herdr-app](#herdr-app) | Agent terminals in the desktop app | The app, its herdr-core host and a workspace provider |
| [Orca](#orca) | Ticket worktrees and agent terminals in Orca | A running personal Orca runtime on the conductor's machine |
| [Hermes](#hermes) | Request clarification, ticket updates and answers in Slack | Access to a configured bot's permitted channels |

Clients can complement each other: discuss a request in Hermes while a developer follows its run locally. They have different capabilities. herdr-cli and herdr-app use separate terminal hosts; clients do not share one terminal session. Your [executor configuration](/addons/slots) determines where agents run, not a per-ticket client choice.

## herdr-cli

Follow the [herdr addon setup](/addons/herdr), then [run a first ticket](/get-started/first-ticket). Open its worktree in herdr and select the run tab labelled with its ticket, state and run number. Read output and answer the agent there. Return to the overview tab for ticket progress; layouts are configurable. The default herdr session must remain available.

## herdr-app

Follow the [herdr-core setup](/addons/herdr-core) with a workspace provider. Start a ticket, find its labelled run with `hc ls`, then open that terminal in the app to follow the agent's output. herdr-core is the integration behind the app, not another client choice. Run terminals are removed when finalized; use the ticket's summary for the recorded outcome.

## Orca

Follow the [Orca addon setup](/addons/orca), then start a ticket. Open its adopted worktree and agent terminal to read output and respond during work. Return to that worktree for subsequent runs. Start Orca before dispatch; this integration supports one user on the conductor's machine.

## Hermes

Hermes is an experimental Slack bot that uses bakers.build through MCP. Mention the bot in its main channel; follow the public request channel it opens and clarify your request. Later, ask for status or answer a relayed question there. It acts with a service account and offers no execution terminal or project-file editing. There is no Hermes addon.

You can also [follow tickets on the website](/get-started/daily-work/follow-a-ticket), [connect another chat](/get-started/connector), or use the [bakers ui cockpit](/addons/bakers-ui/usage).
