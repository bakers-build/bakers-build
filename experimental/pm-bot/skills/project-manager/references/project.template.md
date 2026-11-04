# Your project

The container's entrypoint renders this file into `project.md` from the bot's env file on every start.

| Fact | Value |
|---|---|
| bakers.build server | ${BAKERS_URL} |
| Project (UUID; `project` of every tool call) | `${PM_BOT_PROJECT}` |
| Workflow of new tickets (`workflow`) | `${PM_BOT_TICKET_WORKFLOW}` |
| Conductor of new tickets (`conductor`; `none`: leave it unset) | `${PM_BOT_CONDUCTOR_TEXT}` |
| Slack channels of this project | `${SLACK_ALLOWED_CHANNELS}` |
| Slack workspace URL (for permalinks) | ${SLACK_WORKSPACE_URL} |
| The project's code, read-only (clone-reader root) | `${PM_BOT_CLONE_DIR}` |

Every request in these channels belongs to this project; `bakers_ticket_create` files it there.
