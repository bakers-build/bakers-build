# Get started

bakers.build is a ticket-driven AI software factory: coding agents work every ticket on your machine or remote workers, and a person decides at [every station](/get-started/first-ticket#how-it-works). Open source, hosted or [self-hosted](/self-hosting/), free.

## Quick start {#quick-start}

One skill run, without sandbox or `sudo`, ending in a running test ticket.

**You need:** a [bakers.build account](https://app.bakers.build/), [Node.js ≥20.19](https://nodejs.org/en/download), Git, and [Claude Code](/addons/claude#setup) or [Codex](/addons/codex#setup) signed in.

1. <span id="install-the-skills"></span>**Install the skills** one command at a time, then `/reload-plugins` (Codex: new session):

   ::: code-group

   ```text [Claude Code]
   /plugin marketplace add https://bakers.build/marketplace.json
   ```

   ```sh [Codex]
   codex plugin marketplace add https://github.com/bakers-build/bakers-build.git --ref main
   ```

   :::

   ::: code-group

   ```text [Claude Code]
   /plugin install bakers@bakers
   ```

   ```sh [Codex]
   codex plugin add bakers@bakers
   ```

   :::

2. **Run** it (alias `bb-quick-start`):

   ::: code-group

   ```text [Claude Code]
   /bakers:bb-get-started
   ```

   ```text [Codex]
   Use bakers:bb-get-started to set up a quick start.
   ```

   :::

It asks one question: your Git project's path (re-asked unless a Git repository) or the demo [northside-shop](https://github.com/bakers-build/northside-shop) (cloned to `~/projects/northside-shop`). Then it:

- installs a missing CLI and [herdr-core](/addons/herdr-core) (`hc`) and signs you in with a code in the browser,
- lets agents run unsandboxed: `permissions.mode: 'system'` in `~/.bakers/machine.config.js`, only if unset,
- creates or reuses the server project, named after your folder, in the group **Quick start**,
- writes the [setup files](/get-started/connect-a-project#what-setup-writes); for your own project without `WORKFLOW.md` on its default branch, it commits and pushes them there,
- starts the conductor and creates a test ticket labelled `human-review`.

::: warning
Agents run unsandboxed, with all your rights. For confined agents, use the [Advanced setup](#advanced-setup).
:::

## Advanced setup {#advanced-setup}

With a sandbox, where you may install packages.

<span id="before-you-start"></span>

### 1. Set up your computer (once) {#set-up-your-computer}

Web-only ticket writers skip this.

1. **Linux only, before you start the agent:** install the sandbox tools; the agent has no `sudo`. Other distributions: same packages.

   ```sh
   sudo apt install bubblewrap socat
   ```

2. **CLI** ([Node.js ≥20.19](https://nodejs.org/en/download)):

   ```sh
   npm install -g @bakers-build/bakers
   ```

3. **Skills:** [install and reload them](#install-the-skills).

4. **Sign in.** Ask your agent:

   ::: code-group

   ```text [Claude Code]
   /bakers:bb-init
   ```

   ```text [Codex]
   Use bakers:bb-init to set up this computer.
   ```

   :::

**Done when:** `bakers conductor check` prints `sandbox ok`. Remote or manual setup: [Choose where agents run](/provision/machine).

### 2. Set up your project (once) {#set-up-your-project}

Connect your repository with one skill call: [Prepare your project](/get-started/connect-a-project).

### 3. Create a ticket {#create-a-ticket}

Describe a small change with its expected result: [Create a ticket](/get-started/daily-work/create-a-ticket).

### 4. Run a ticket {#run-a-ticket}

Start your agents and read the first result: [Run the first ticket](/get-started/first-ticket).

<span id="after-your-first-ticket"></span>

## Next steps

<DocQuickLinks aria-label="Next steps" :items="[
  { label: 'Use your client', text: 'Choose the terminal, desktop app or chat through which you observe, discuss and act on tickets.', link: '/get-started/use-your-client' },
  { label: 'Follow a ticket', text: 'Read progress updates and answer questions during a run.', link: '/get-started/daily-work/follow-a-ticket' },
  { label: 'Accept results', text: 'Check the outcome and decide what happens next.', link: '/skills-and-workflows/accept-results' },
  { label: 'Agents', text: 'Choose the agents and models that work on tickets.', link: '/agents/' }
]" />
