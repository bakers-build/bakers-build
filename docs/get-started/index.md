# Get started

bakers.build is a ticket-driven AI software factory. Coding agents work every ticket on your development machine or on remote workers, and a person decides at every station. Open source, self-hosted or hosted, both free.

**You need:** a bakers.build account (hosted at [app.bakers.build](https://app.bakers.build/) or [self-hosted](/self-hosting/)), [Claude Code](/addons/claude#setup) or [Codex](/addons/codex#setup) signed in, and a local Git checkout.

<span id="before-you-start"></span>

## Choose where to start

<DocTiles :tiles="[
  { title: 'Your team already runs tickets', text: 'The project is prepared and a conductor serves it. Run a small ticket and read its result.', link: '/get-started/first-ticket', icon: 'ticket', meta: 'Run the first ticket →' },
  { title: 'Try it on your own repository', text: 'You are evaluating bakers.build alone, or setting it up for your team. Connect a repository on your computer, check its tools and workflow, then run the first ticket.', link: '/get-started/connect-a-project', icon: 'code', meta: 'Prepare your project →' }
]" />

<span id="run-agents-for-a-project"></span>

<span id="from-ticket-to-result"></span>

## How it works

The path of one ticket:

1. You write a **ticket**, a request with checkable acceptance criteria, in a **project** of your **workspace**. Workspace and project live on the bakers.build server, hosted or self-hosted; the workspace holds your team's projects and access.
2. A **conductor**, bound to your project checkout on a **worker machine** (your computer or a remote worker), claims an eligible ticket: in a state it serves, not frozen or blocked, with machine capacity free. See [which tickets it takes](/configuration/project/conductors#which-tickets-it-takes) and [where agents run](/provision/machine).
3. The conductor starts a coding **agent**, Claude Code or Codex under your own sign-in ([Agents](/agents/)).
4. The agent writes a spec and plan into the ticket and waits for your approval before implementing ([Workflows and states](/skills-and-workflows/states)).
5. Each attempt is a **run** in its own **worktree**, a separate Git checkout. The agent implements and checks the change within the permissions set in [Run agents securely](/provision/security/).
6. An agent reviews the change, then you review the result: a summary in the ticket and a merge request ([Accept results](/skills-and-workflows/accept-results)).
7. You authorize the merge.

Environments and tools for your stack are prepared under [Provision](/provision/).

<span id="after-your-first-ticket"></span>

## Next steps

<DocQuickLinks aria-label="Next steps" :items="[
  { label: 'Use your client', text: 'Choose the terminal, desktop app or chat through which you observe, discuss and act on tickets.', link: '/get-started/use-your-client' },
  { label: 'Follow a ticket', text: 'Read progress updates and answer questions during a run.', link: '/get-started/daily-work/follow-a-ticket' },
  { label: 'Accept results', text: 'Check the outcome and decide what happens next.', link: '/skills-and-workflows/accept-results' },
  { label: 'Agents', text: 'Choose the agents and models that work on tickets.', link: '/agents/' }
]" />
