# Get started

bakers.build is a ticket-driven AI software factory. Coding agents work every ticket on your development machine or on remote workers, and a person decides at [every station](/get-started/first-ticket#how-it-works). Open source, self-hosted or hosted, both free.

**You need:** a bakers.build account (hosted at [app.bakers.build](https://app.bakers.build/) or [self-hosted](/self-hosting/)), [Claude Code](/addons/claude#setup) or [Codex](/addons/codex#setup) signed in, a Git checkout and a computer where you may install packages.

<span id="before-you-start"></span>

## 1. Set up your computer (once) {#set-up-your-computer}

Web-only ticket writers skip this.

1. **Linux only, before you start the agent:** install the sandbox tools; the agent has no `sudo`. Other distributions: same packages.

   ```sh
   sudo apt install bubblewrap socat
   ```

2. **CLI** ([Node.js ≥20.19 with npm](https://nodejs.org/en/download)):

   ```sh
   npm install -g @bakers-build/bakers
   ```

3. **Skills**, one command at a time:

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

4. **Reload the plugins:** `/reload-plugins` in Claude Code; in Codex, start a new session.

5. **Sign in.** Ask your agent:

   ::: code-group

   ```text [Claude Code]
   /bakers:bb-init
   ```

   ```text [Codex]
   Use bakers:bb-init to set up this computer.
   ```

   :::

**Done when:** `bakers conductor check` prints `sandbox ok`. Remote or manual setup: [Choose where agents run](/provision/machine).

## 2. Set up your project (once) {#set-up-your-project}

Connect your repository with one skill call: [Prepare your project](/get-started/connect-a-project).

## 3. Create a ticket {#create-a-ticket}

Describe a small change with its expected result: [Create a ticket](/get-started/daily-work/create-a-ticket).

## 4. Run a ticket {#run-a-ticket}

Start your agents and read the first result: [Run the first ticket](/get-started/first-ticket).

<span id="after-your-first-ticket"></span>

## Next steps

<DocQuickLinks aria-label="Next steps" :items="[
  { label: 'Use your client', text: 'Choose the terminal, desktop app or chat through which you observe, discuss and act on tickets.', link: '/get-started/use-your-client' },
  { label: 'Follow a ticket', text: 'Read progress updates and answer questions during a run.', link: '/get-started/daily-work/follow-a-ticket' },
  { label: 'Accept results', text: 'Check the outcome and decide what happens next.', link: '/skills-and-workflows/accept-results' },
  { label: 'Agents', text: 'Choose the agents and models that work on tickets.', link: '/agents/' }
]" />
