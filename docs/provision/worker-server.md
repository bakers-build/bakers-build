# Set up a worker server

Add a remote worker when you need more capacity. This Ubuntu 24.04 arm64 example uses herdr, Docker and Claude Code; prepare the host with [machine setup](/provision/machine) and choose tooling per [project](/get-started/connect-a-project). On a Coder deployment, a workspace template does this setup for you: [Set up a Coder workspace](/provision/coder-workspace).

**You need:** root over SSH, a bakers.build account with a workspace rank, the control-plane URL and a Claude Code account.

## AI first

On the server, open your signed-in agent and [install its bakers skills](/skills-and-workflows/skills), then ask:

```text
Use bakers:bb-init for this remote worker. Follow the worker-server
reference, preserve existing tools and guide my own authentication.
Use my existing projects' client/environment requirements. Explain
privileged steps for the operator and hand project setup to bb-init-project.
```

If the host has no agent yet, an operator first creates the worker user and installs/signs in to one. The AI cannot perform an interactive browser login for you. Host preparation creates reusable tooling and private identity; each [project](/get-started/connect-a-project) still owns its client and environment.

## Manual example: herdr and Docker

This example assumes a project already chose herdr and a Docker-based runtime. Other projects keep their own stack; these are not requirements for every machine.

1. Create a non-root worker user.

   ```sh
   useradd -m -s /bin/bash bakers
   ```

2. Install the tools chosen for this example: [Node.js ≥ 20.19 with npm](https://nodejs.org/en/download), [Docker](https://docs.docker.com/engine/install/ubuntu/) and your project's runtime using their vendor guides. Grant Docker access, then switch users:

   ```sh
   usermod -aG docker bakers
   su - bakers
   ```

3. Use [machine setup](/provision/machine#install-and-sign-in) to install bakers.build into a user prefix. Put its PATH in `~/.profile`: Ubuntu's `~/.bashrc` returns early in non-interactive shells.

   ```sh
   npm config set prefix ~/.npm-global
   echo 'export PATH=$HOME/.npm-global/bin:$HOME/.local/bin:$PATH' >> ~/.profile
   . ~/.profile

   ```

4. Follow [herdr setup](/addons/herdr) and your [agent addon](/addons/claude) installation instructions. Start herdr's default headless session; a named session uses a different socket. Sign Claude in through the displayed URL.

   ```sh
   nohup herdr server > ~/herdr-server.log 2>&1 &
   claude auth login
   ```

5. Register and sign in:

   ```sh
   bakers init --scope all --label <name> --base-url <server-url> --client-id bakers-cli --yes
   bakers auth login
   ```

   Device code suffices for this check, but the measured session expired after five minutes without refresh. For unattended operation, have an operator provision a machine consumer and use `--auth-type client_credentials --secret-env <NAME>` ([connections](/configuration/connector/connections)). Keep only installed harnesses in `addons` of `~/.bakers/machine.config.js` ([machines](/configuration/machine)).

6. Verify as the worker user:

   ```sh
   docker info
   herdr workspace list
   bakers config check --scope connection --online
   bakers info
   ```

**Done when:** all checks succeed, the online check has no findings and `bakers info` lists a workspace. Continue with [project setup](/get-started/connect-a-project) on this server. If the checkout is already configured, go to [your first ticket](/get-started/first-ticket).

After reboot, a service manager must start `herdr server` as the worker user before `bakers oven start --foreground`; bakers.build ships no service unit.
