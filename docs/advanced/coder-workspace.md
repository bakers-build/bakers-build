---
title: Set up a Coder workspace
description: "Give each person a long-lived Coder workspace that is a bakers.build worker, from the bakers-ddev template: prerequisites, /bb-init, sign-in, machine config per transport and restarting conductors."
---

# Set up a Coder workspace

Give each person a Coder workspace that works like a developer's own machine: Docker, DDEV, bakers.build, herdr, the agent CLIs and the tunnel clients are ready, and you sign in once.

The `bakers-ddev` template provides one long-lived workspace per person. It starts without projects. Inside it, `/bb-init` signs you in, checks out your projects and starts one conductor per checkout. For a plain server instead, see [Set up a worker server](/advanced/worker-server).

**You need:** a Coder deployment whose Docker host runs the Sysbox runtime on amd64 and can pull the workspace image, permission to push templates, a bakers.build account with a workspace rank, the control-plane URL, and Claude Code and Codex accounts.

1. Push the template from the `coder/bakers-ddev` directory of the [bakers.build repository](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/coder/bakers-ddev). Its default image is not public: pass your own with `--variable image=<image>`. The template has no registry credentials, so the Docker host must be able to pull the image itself. The README lists the image requirements and the variables.

   ```sh
   coder templates push bakers-ddev -d coder/bakers-ddev
   ```

2. Create your workspace and open a terminal in it.

   ```sh
   coder create <name> --template bakers-ddev
   coder ssh <name>
   ```

   The first start installs `bakers`, `herdr`, `claude`, `codex`, `cursor-agent`, `gh`, `glab`, `cloudflared`, `frpc` and `ss` into your home volume, and starts `herdr server`. The log is `/tmp/coder-startup-script.log`.

3. Sign in to Claude Code, add the bakers.build plugin and run `/bb-init`. Claude prints a URL to open in your own browser.

   ```sh
   claude auth login
   claude plugin marketplace add https://git.key-tec.de/bakers-build/bakers-build.git
   claude plugin install bakers@bakers
   mkdir -p ~/projects && cd ~/projects && claude
   ```

   Trust the folder when Claude asks, so the worktrees below it are trusted too; otherwise the first agent run waits at that question in its herdr pane. Then type `/bb-init`. It walks you through steps 4 to 9 one at a time, checks each one and writes configuration only after you confirm. The steps below are what it does, for reference or to do by hand.

4. Sign in to bakers.build. An unattended conductor needs a machine consumer that an operator issues ([connections](/advanced/connections)); give its secret to this command only. `bakers init` writes it into a private file under `~/.bakers`.

   ```sh
   BB_CLIENT_SECRET='<issued secret>' bakers init --scope all --machine-id <name> --user-id <operator> \
     --base-url <server-url> --auth-type client_credentials --client-id <id> --secret-env BB_CLIENT_SECRET --yes
   bakers dropsh auth login
   ```

   Keep only the installed harnesses, `@bakers-build/addon-claude` and `@bakers-build/addon-codex`, in `addons` of `~/.bakers/machine.config.js` ([machines](/advanced/machines)), and set both to `security: 'custom'`. The default `sandbox` cannot start in the workspace: its `bwrap` needs unprivileged user namespaces, which a Docker host on Ubuntu 23.10 or later restricts. The container is the boundary instead, so a run can still read everything in your home, including your sign-ins and SSH key ([Run security](/advanced/run-security)).

   ```js
   {
     use: '@bakers-build/addon-claude',
     with: {
       security: 'custom',
       config: {
         permissions: { defaultMode: 'dontAsk', allow: ['Bash', 'Edit(./**)'], deny: ['Read(~/.ssh/**)', 'Read(~/.bakers/**)'] },
         disableClaudeAiConnectors: true,
       },
     },
   },
   {
     use: '@bakers-build/addon-codex',
     with: { security: 'custom', config: { sandbox_mode: 'danger-full-access', approval_policy: 'never' } },
   },
   ```

   `dontAsk` denies what `allow` does not list instead of asking, so an unattended run never waits at a question. The `deny` rules cover Claude's Read tool only, not shell commands.

5. Sign in to Codex. It prints a URL to open in your own browser.

   ```sh
   codex login --device-auth
   ```

6. Sign in to GitHub and GitLab. Both CLIs show a one-time code and a URL to open in your own browser; one sign-in covers every repository on that host.

   ```sh
   gh auth login --git-protocol https
   gh auth setup-git
   ```

   On your own GitLab, `glab` signs in through an OAuth application of that instance. An administrator creates it once under Admin > Applications: redirect URI `http://localhost:7171/auth/redirect`, **Confidential** off, **Device authorization grant** on, scopes `openid`, `profile`, `read_user`, `write_repository` and `api`. Its application ID is the `client_id`:

   ```sh
   glab config set client_id <application-id> -g --host <host>
   glab auth login --hostname <host> --device --git-protocol ssh
   ```

   Without the OAuth application, `glab auth login --hostname <host>` with a personal access token works too.

7. Create an SSH key, add its public key to your Git host and record the host's key. Project repositories with SSH URLs, and an `after_create` that clones over SSH, need both: an unattended clone cannot accept an unknown host key.

   ```sh
   ssh-keygen -t ed25519
   cat ~/.ssh/id_ed25519.pub
   ssh-keyscan <git-host> >> ~/.ssh/known_hosts
   ```

8. Choose a transport for previews: add the `@bakers-build/addon-ports` entry to `addons` in `~/.bakers/machine.config.js` and keep the file's other fields ([Shared service tunnels](/advanced/machines#shared-service-tunnels-bakers-ports)). The settings are described on the transport pages: [Cloudflare Quick](/addons/ports-cloudflare-quick), [Named Cloudflare](/addons/ports-cloudflare) and [frp](/addons/ports-frp).

   Cloudflare Quick needs nothing else:

   ```js
   { use: '@bakers-build/addon-ports', with: { transport: { use: '@bakers-build/addon-ports-cloudflare-quick' } } },
   ```

   Named Cloudflare needs the connector token in `~/.cloudflared/tunnel-token`. The workspace runs `cloudflared tunnel run` on every start while that file exists:

   ```js
   {
     use: '@bakers-build/addon-ports',
     with: {
       transport: {
         use: '@bakers-build/addon-ports-cloudflare',
         with: {
           zone: 'preview.example.org',
           accountId: '<account id>',
           tunnelId: '<tunnel id>',
           zoneId: '<zone id>',
           apiToken: '<api token>',
         },
       },
     },
   },
   ```

   frp needs the client config in `~/.config/frp/frpc.json`. The workspace runs `frpc` on every start while that file exists. Create the directory of its `includes` entry first, or `frpc` refuses to start, and keep `loginFailExit` false: nothing restarts `frpc`, and by default it ends for good when the server is unreachable at start.

   ```sh
   mkdir -p ~/.bakers/frp ~/.config/frp
   ```

   ```json
   {
     "serverAddr": "frps.example.org",
     "serverPort": 7000,
     "user": "bakers-<name>",
     "loginFailExit": false,
     "auth": { "method": "token", "token": "<frps token>" },
     "transport": { "tls": { "enable": true, "trustedCaFile": "/home/coder/.config/frp/ca.pem", "serverName": "frps.example.org" } },
     "webServer": { "addr": "127.0.0.1", "port": 7400, "user": "bakers", "password": "<admin password>" },
     "includes": ["/home/coder/.bakers/frp/routes.json"]
   }
   ```

   ```js
   {
     use: '@bakers-build/addon-ports',
     with: {
       transport: {
         use: '@bakers-build/addon-ports-frp',
         with: {
           zone: 'preview.example.org',
           clientConfigPath: '/home/coder/.config/frp/frpc.json',
           adminPort: 7400,
           adminUser: 'bakers',
           adminPassword: '<admin password>',
         },
       },
     },
   },
   ```

   Restart the workspace once so the connector starts, or start it by hand, for example `nohup frpc -c ~/.config/frp/frpc.json >/tmp/frpc.log 2>&1 &`. The secrets in this file stay in your home volume.

9. Check out your projects and start their conductors. One conductor serves one checkout ([Conductors](/advanced/conductors)). `/bb-init` lists your projects, clones each chosen one from its repository at its default branch into `~/projects/<key>`, configures it with `bb-init-project` and, after you confirm, starts its conductor in its own herdr tab. By hand:

   ```sh
   git clone --branch <default-branch> <repository-url> ~/projects/<key>
   cd ~/projects/<key>
   bakers oven start --foreground
   ```

10. Verify.

    ```sh
    herdr workspace list
    bakers config check --scope connection --online
    bakers oven status
    ```

**Done when:** `herdr workspace list` succeeds, the online check has no findings and each conductor shows `online`. Continue with [Conductors](/advanced/conductors).

## See the workspace in your own herdr

Add it as a saved machine on your own computer: `herdr machine add <name>.coder --label <name>`. herdr verifies SSH host keys strictly, while `coder config-ssh` sends the keys of `*.coder` hosts to `/dev/null`, so pin the workspace's key first with a block above Coder's managed section in `~/.ssh/config`. The key stays the same across workspace restarts.

```
Host <name>.coder
  UserKnownHostsFile ~/.ssh/known_hosts
  StrictHostKeyChecking accept-new
```

## After a workspace restart

Everything under your home survives: the tools, the sign-ins, the machine config and your projects. The container is new, so the start log shows every tool as skipped, and the workspace starts `herdr server` and any connector whose config file exists. Conductors and DDEV projects do not come back by themselves. Run `ddev start` and `bakers oven start --foreground` again in each checkout, in a herdr tab, and share a preview again with `bakers ports up`.

## Update a tool

A tool that is already installed is skipped, so a new version in the template reaches a workspace only when the tool is missing. Update one yourself with its own updater, for example `claude update` or `bakers update`, or delete it (`rm "$(command -v <tool>)"`) and restart the workspace.
