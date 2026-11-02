# Your project

`bin/setup` renders this file into `project.md` from the bot's env file.

| Fact | Value |
|---|---|
| bakers.build server | ${BAKERS_URL} |
| Slack channels of this project | `${SLACK_ALLOWED_CHANNELS}` |
| Slack workspace URL (for permalinks) | ${SLACK_WORKSPACE_URL} |
| The project's code, read-only (clone-reader root) | `${PM_BOT_CLONE_DIR}` |

Every request in these channels belongs to this project; `create_ticket` files it there.
