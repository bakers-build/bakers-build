# Work from your AI chat

**Create and plan bakers.build tickets in any chat that supports MCP, with nothing to install.**

| In the chat you can | For the rest |
|---|---|
| Create feature and chore tickets, check for duplicates, qualify them and take them to `plan` | Follow, answer, accept: the bakers.build web UI ([Work in the browser](/get-started/work-in-the-browser)) |
| Search and read tickets, comments and projects | Bug tickets, coding, review, merge: your team's agents |

**You need:** a bakers.build account with access to the workspace, and an MCP client with OAuth support, for example claude.ai, Claude Desktop, ChatGPT or Cursor.

## 1. Add the connector

1. Add a custom MCP connector in your client. In claude.ai: **Settings → Connectors → Add custom connector**.
2. **URL:** your bakers.build server address plus `/mcp`, for example `https://app.bakers.build/mcp`.
3. Leave client ID and secret empty. Your client registers itself with bakers.build automatically.
4. Save, sign in with **your own** bakers.build account and approve. Everything you do runs with your own permissions.

On a claude.ai Team or Enterprise plan an organization owner can add the connector once for everyone; each person still signs in.

## 2. Create a Project (claude.ai)

1. Create a **Project** in Claude.
2. Paste the [project instructions](/advanced/configuration/claude-project-instructions) into its instructions. They teach Claude bakers.build's ticket rules.
3. Enable the bakers.build connector for the Project.

## 3. Start working

```text
Create a bakers.build ticket for <what you need and why>.
```

Claude searches for similar tickets, asks what is missing and qualifies the ticket. It asks you to confirm at each important point: a similar ticket, the qualification and the move to `plan`.

**Done when:** your ticket appears in bakers.build in state `plan`.

## If it stops working

1. **A tool call fails with a permission message:** your account lacks that right. Ask your workspace lead.
2. **Tools fail or disappear without a clear reason:** in your client's connector settings, disconnect the bakers.build connector and connect it again. That renews your sign-in.
3. **Claude cannot find a label or ticket type it needs:** a workspace contributor or lead adds it under the workspace's settings, on the Labels or Types tab; qualification continues afterwards.
4. **Still stuck:** [claude.ai limits and errors](/advanced/configuration/claude-connector-limits) lists every known case.
