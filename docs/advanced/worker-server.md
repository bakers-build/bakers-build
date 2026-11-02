# Set up a worker server

Add a remote worker when you need more capacity. This Ubuntu 24.04 arm64 example uses herdr, DDEV and Claude Code; choose your own tooling with [Prepare a machine](/advanced/cli/prepare-machine). On a Coder deployment, the `bakers-ddev` template does this setup for you: [Set up a Coder workspace](/advanced/coder-workspace).

**You need:** root over SSH, a bakers.build account with a workspace rank, the control-plane URL and a Claude Code account.

1. Create a non-root worker user; DDEV cannot run as root.

   ```sh
   useradd -m -s /bin/bash bakers
   ```

2. Install the tools chosen for this example: [Node.js ≥ 20.19 with npm](https://nodejs.org/en/download), [Docker](https://docs.docker.com/engine/install/ubuntu/) and [DDEV](https://docs.ddev.com/en/stable/users/install/) using their vendor guides. Grant Docker access, then switch users:

   ```sh
   usermod -aG docker bakers
   su - bakers
   ```

3. Install bakers.build into a user prefix. Put its PATH in `~/.profile`: Ubuntu's `~/.bashrc` returns early in non-interactive shells.

   ```sh
   npm config set prefix ~/.npm-global
   echo 'export PATH=$HOME/.npm-global/bin:$HOME/.local/bin:$PATH' >> ~/.profile
   . ~/.profile
   npm install -g @bakers-build/bakers
   ```

4. Install [herdr](https://herdr.dev/) and [Claude Code](https://docs.claude.com/en/docs/claude-code/setup). Start herdr's default headless session; a named session uses a different socket. Sign Claude in through the displayed URL.

   ```sh
   nohup herdr server > ~/herdr-server.log 2>&1 &
   claude auth login
   ```

5. Register and sign in:

   ```sh
   bakers init --scope all --machine-id <name> --user-id <operator> --base-url <server-url> --client-id bakers-cli --yes
   bakers auth login
   ```

   Device code suffices for this check, but the measured session expired after five minutes without refresh. For unattended operation, have an operator provision a machine consumer and use `--auth-type client_credentials --secret-env <NAME>` ([connections](/advanced/connections)). Keep only installed harnesses in `addons` of `~/.bakers/machine.config.js` ([machines](/advanced/machines)).

6. Verify as the worker user:

   ```sh
   docker info
   ddev version
   herdr workspace list
   bakers config check --scope connection --online
   bakers info
   ```

**Done when:** all checks succeed, the online check has no findings and `bakers info` lists a workspace. Continue with [Conductors](/advanced/conductors).

After reboot, a service manager must start `herdr server` as the worker user before `bakers oven start --foreground`; bakers.build ships no service unit.
