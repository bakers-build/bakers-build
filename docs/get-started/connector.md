# Set up a connector

Create and plan tickets through chat, then follow and accept work in the web UI. Your team's workers do the building; this path needs no developer machine setup.

**You need:** your server address, your own bakers.build account with workspace access, and a chat client supporting remote MCP, OAuth and dynamic client registration. Check your client's connector requirements before starting.

## AI first: ask your chat to guide you

```text
Guide me through https://bakers.build/get-started/connector for this
chat client. Help me find its MCP settings; I will enter my server URL
and complete my own sign-in. Then verify access to my project.
```

Your chat can explain the steps; you enable the connector and authorize access yourself. Local setup skills are for developer agents and are not required for this chat-only path.

## What happens in the background

The client registers with your server and receives access for your account. It can use tools within your permissions; it installs no worker or project environment.

## Connect your account

1. Open your client's custom MCP connector settings; menu names vary by client.
2. Enter your server's `/mcp` endpoint, for example `https://app.bakers.build/mcp`.
3. Use dynamic registration rather than a shared client secret. Save, sign in with **your own account**, and approve access. Never borrow a teammate's credentials.
4. Enable the connector in your conversation. For claude.ai Projects, add the [project instructions](/configuration/guides/project-instructions). Shared connector configuration still needs each person's own authorization.

## Verify

Ask your chat:

```text
Use the bakers.build connector to search for a ticket in my project,
then read that ticket and its comments. Tell me which project it belongs to.
```

**Done when:** the tools return a ticket you can also open on your team's bakers.build website, in the intended workspace. If the project has no tickets, ask the connector to confirm accessible projects before creating one. A permission failure means missing access: ask your workspace lead. It is not a reason to share credentials.

## Start working

```text
Create a bakers.build ticket for <what I need and why>.
```

Confirm the scope when asked. The supplied chat instructions stop feature and chore intake at `plan`; your team's coding agents handle diagnosis and implementation. This is an instruction policy, not a server restriction. Open the ticket to read summaries; [Follow a ticket](/get-started/daily-work/follow-a-ticket#where-you-answer) explains where to answer during a run.

## Continue with tickets

Use your connected chat to start a request, then follow the work and review its result.

<DocQuickLinks aria-label="Continue with tickets" :items="[
  { label: 'Create a ticket', text: 'Describe the work and agree its scope.', link: '/get-started/daily-work/create-a-ticket' },
  { label: 'Follow a ticket', text: 'Read updates and find where to answer questions.', link: '/get-started/daily-work/follow-a-ticket' },
  { label: 'Review results', text: 'Check the outcome and record your verdict.', link: '/skills-and-workflows/accept-results' }
]" />

## Connection problems

Use these guides if chat access fails. The CLI connection file is a separate setup.

<DocQuickLinks aria-label="Connection problems" :items="[
  { label: 'Connector configuration', text: 'Check which connection settings belong to your client.', link: '/configuration/connection' },
  { label: 'Client limits and errors', text: 'Understand supported operations and recover from sign-in errors.', link: '/configuration/guides/connector-limits' }
]" />
