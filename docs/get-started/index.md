# Get started

bakers.build is a ticket-driven AI software factory. Coding agents work every ticket on your development machine or on remote workers, and a person decides at [every station](#how-it-works). Open source, self-hosted or hosted, both free.

**You need:** a bakers.build account (hosted at [app.bakers.build](https://app.bakers.build/) or [self-hosted](/self-hosting/)), [Claude Code](/addons/claude#setup) or [Codex](/addons/codex#setup) signed in, a Git checkout and a computer where you may install packages.

<span id="before-you-start"></span>

## Set up your computer (once) {#set-up-your-computer}

Web-only ticket writers skip this.

1. **CLI** ([Node.js ≥20.19](/provision/node)):

   ```sh
   npm install -g @bakers-build/bakers
   ```

2. **Skills**, in Claude Code one at a time ([Codex](/skills-and-workflows/skills#codex)):

   ```text
   /plugin marketplace add https://bakers.build/marketplace.json
   ```

   ```text
   /plugin install bakers@bakers
   ```

3. **Linux only:** install the sandbox tools yourself; the agent has no `sudo`. Other distributions: same packages.

   ```sh
   sudo apt install bubblewrap socat
   ```

4. **Restart the agent session**, then ask your agent:

   ```text
   /bakers:bb-init
   ```

**Done when:** `bakers conductor check` prints `sandbox ok`. Remote or manual setup: [Choose where agents run](/provision/machine).

## Choose where to start

<DocTiles :tiles="[
  { title: 'Your team already runs tickets', text: 'The project is prepared and agents already work its tickets. Run a small ticket and read its result.', link: '/get-started/first-ticket', icon: 'ticket', meta: 'Run the first ticket →' },
  { title: 'Try it on your own repository', text: 'You are evaluating bakers.build alone, or setting it up for your team. Connect a repository on your computer, check its tools and workflow, then run the first ticket.', link: '/get-started/connect-a-project', icon: 'code', meta: 'Prepare your project →' }
]" />

<span id="run-agents-for-a-project"></span>

<span id="from-ticket-to-result"></span>

## How it works

The path of one ticket:

1. You write a **ticket** with checkable acceptance criteria in a **project** of your **workspace** on the bakers.build server.
2. A **conductor** on a **worker machine** (your computer or a remote worker) claims it: see [which tickets it takes](/configuration/project/conductors#which-tickets-it-takes) and [where agents run](/provision/machine).
3. It starts a coding **agent**, Claude Code or Codex under your own sign-in ([Agents](/agents/)).
4. The agent writes a spec and plan and waits for your approval ([Workflows and states](/skills-and-workflows/states)).
5. Each attempt is a **run** in its own **worktree**, a separate Git checkout, within [Agent permissions and isolation](/agents/security).
6. An agent reviews the change, then you review the summary and merge request ([Accept results](/skills-and-workflows/accept-results)).
7. You authorize the merge.

Stack environments: [Provision](/provision/).

<span id="after-your-first-ticket"></span>

## Next steps

<DocQuickLinks aria-label="Next steps" :items="[
  { label: 'Use your client', text: 'Choose the terminal, desktop app or chat through which you observe, discuss and act on tickets.', link: '/get-started/use-your-client' },
  { label: 'Follow a ticket', text: 'Read progress updates and answer questions during a run.', link: '/get-started/daily-work/follow-a-ticket' },
  { label: 'Accept results', text: 'Check the outcome and decide what happens next.', link: '/skills-and-workflows/accept-results' },
  { label: 'Agents', text: 'Choose the agents and models that work on tickets.', link: '/agents/' }
]" />
