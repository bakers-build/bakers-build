# Get started

bakers.build is a ticket-driven AI software factory: agents work each ticket, a person decides at [every station](/get-started/first-ticket#how-it-works). Open source, hosted or [self-hosted](/self-hosting/), free.

## Quick start {#quick-start}

**You need:** a [bakers.build account](https://app.bakers.build/), [Node.js ≥20.19](https://nodejs.org/en/download), Git, and [Claude Code](/addons/claude#setup) or [Codex](/addons/codex#setup) signed in.

1. <span id="install-the-skills"></span>**Add the marketplace:**

   ::: code-group

   ```text [Claude Code]
   /plugin marketplace add https://bakers.build/marketplace.json
   ```

   ```sh [Codex]
   codex plugin marketplace add https://github.com/bakers-build/bakers-build.git --ref main
   ```

   :::

2. **Install the skills,** then `/reload-plugins` (Codex: new session):

   ::: code-group

   ```text [Claude Code]
   /plugin install bakers@bakers
   ```

   ```sh [Codex]
   codex plugin add bakers@bakers
   ```

   :::

3. **Run** it (alias `bb-quick-start`):

   ::: code-group

   ```text [Claude Code]
   /bakers:bb-get-started
   ```

   ```text [Codex]
   Use bakers:bb-get-started to set up a quick start.
   ```

   :::

It asks for the path of an existing Git project (again if the path is no Git repository), or clones our [demo project](https://github.com/bakers-build/northside-shop) to `~/projects/northside-shop`. Then it:

- installs the `bakers` CLI and [herdr-core](/addons/herdr-core) if missing,
- signs you in,
- sets the [permission mode](/provision/security/execution#modes) `system`: agents run unsandboxed and can change anything your user can,
- connects a bakers.build project: the one linked to your repository, else a new one in group **Quick start**,
- writes the [setup files](/get-started/connect-a-project#what-setup-writes); for your own project it commits and pushes them to your default branch once,
- starts the conductor and creates a test ticket.

The Advanced setup below adds a sandbox.

## Advanced setup {#advanced-setup}

<span id="before-you-start"></span>

### 1. Set up your computer (once) {#set-up-your-computer}

Web-only ticket writers skip this.

1. **Linux only:** Claude Code's sandbox isolates commands with bubblewrap and filters network access through socat ([sandbox prerequisites](/provision/security/execution#sandbox-prerequisites)). Install both before you start the agent; it has no `sudo`. macOS needs nothing:

   ```sh
   sudo apt install bubblewrap socat
   ```

2. **CLI** ([Node.js ≥20.19](https://nodejs.org/en/download)), skip after the quick start:

   ```sh
   npm install -g @bakers-build/bakers
   ```

3. **Skills:** [install and reload them](#install-the-skills).

4. Ask your agent:

   ::: code-group

   ```text [Claude Code]
   /bakers:bb-init
   ```

   ```text [Codex]
   Use bakers:bb-init to set up this computer.
   ```

   :::

   `bb-init` signs you in, adds your agent and turns on the [sandbox](/agents/security): the agent's commands run in its OS sandbox and reach only what its rules allow.

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
