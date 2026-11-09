---
title: Set up a Coder workspace
description: "Give each person a long-lived Coder workspace that is a bakers.build worker, from the bakers-ddev template: prerequisites, /bb-init, sign-in, machine config per transport and restarting conductors."
---

# Set up a Coder workspace

Coder is optional and runs the client/workspace, not the [server](/self-hosting/server). You can use a local workstation without Coder or preview tunnels.

Give each person a Coder workspace that works like a developer's own machine: Docker, the template's development runtime, bakers.build, herdr, the agent CLIs and the tunnel clients are ready, and you sign in once.

The `bakers-ddev` template provides one long-lived workspace per person. It starts without projects. Inside it, `/bb-init` signs you in, checks out your projects and starts one conductor per checkout. For a plain server instead, see [Set up a worker server](/provision/worker-server).

::: tip Using a team workspace?
You need access to the team's Coder template, your bakers.build account and your agent account. Start with the [existing-workspace steps](#ai-first-inside-an-existing-workspace). Your operator handles template and image setup.
:::

**Operator prerequisites:** a Coder deployment whose Docker host runs the Sysbox runtime on amd64 and can pull the workspace image, permission to push templates, the control-plane URL, and the accounts needed by the template.

## AI first inside an existing workspace

If your operator already provides the template, create/open your workspace (step 2), sign in to your agent, and [install the bakers skills](/skills-and-workflows/skills). Ask:

```text
Use bakers:bb-init inside this Coder workspace. Reuse the installed tools,
explain the container's security boundary, guide my own sign-ins, and
help me select existing projects. Use bb-init-project per checkout;
preserve its client and environment. Show checks before starting conductors.
```

The image supplies tools; your private home stores identity, credentials and checkouts. Skills guide the remaining choices. An operator handles template/image provisioning; the following reference explains each step and the files it affects.

## Template, sign-in and project reference

1. Push the template from `coder/bakers-ddev` in your operator-provided bakers.build source checkout. See the [operator prerequisites](/self-hosting/server). There is no default image: supply a compatible prebuilt image with `--variable image=<image>`. The template has no registry credentials, so the Docker host must be able to pull it itself. No public workspace image is published, and the server images cannot be used as workspace images. The README lists the image requirements and the variables.

   ```sh
   coder templates push bakers-ddev -d coder/bakers-ddev --variable image=<workspace-image:version>
   ```

2. Create your workspace and open a terminal in it.

   ```sh
   coder create <name> --template bakers-ddev
   coder ssh <name>
   ```

   The first start installs `bakers`, `herdr`, `claude`, `codex`, `cursor-agent`, `gh`, `glab` and `ss` into your home volume, and starts `herdr server`. The log is `/tmp/coder-startup-script.log`.

3. Sign in to your chosen agent and follow [skill installation](/skills-and-workflows/skills) for the bakers plugin. Open the agent from `~/projects`, answer its trust question for that folder and run `/bb-init`. Conductor runs of Claude Code trust their own ticket worktree, so a new ticket does not wait at the trust dialog. The wizard guides the remaining steps and confirms configuration writes.

4. Sign in to bakers.build. An unattended conductor needs a machine consumer that an operator issues ([connections](/configuration/connector/connections)); give its secret to this command only. `bakers init` writes it into a private file under `~/.bakers`.

   ```sh
   BB_CLIENT_SECRET='<issued secret>' bakers init --scope all --label <name> \
     --base-url <server-url> --auth-type client_credentials --client-id <id> --secret-env BB_CLIENT_SECRET --yes
   bakers auth login
   ```

   Configure the [Coder container boundary](/provision/security/execution#coder-container-boundary) before dispatch. This replaces the default nested OS sandbox with the container boundary; all credentials in that home remain exposed to shell commands.

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

8. Optionally choose a preview transport (skip this step for local-only work) with the workspace parameter `preview_transport`: `none` (default), `cloudflare-quick`, `cloudflare` or `frp`. Set it in the workspace form or with `coder update <workspace> --parameter preview_transport=<value>`; it applies on the next start. Public URLs expose the running application; review [Security](/provision/security/access-and-data#public-previews-and-ports) first.

   **Coder lifecycle:** [Cloudflare Quick](/addons/ports-cloudflare-quick) needs nothing else. [Named Cloudflare](/addons/ports-cloudflare) and [frp](/addons/ports-frp) need your account values; the template README's *Optional previews* section names the files to create and says what each value installs, writes and starts. For frp, create the directory referenced by `includes` and set `loginFailExit: false`: nothing restarts a client that exits when the server is unavailable.

9. Check out your projects and start their conductors. One conductor serves one checkout ([Conductors](/configuration/project/conductors)). `/bb-init` lists your projects, clones each chosen one from its repository at its default branch into `~/projects/<key>`, configures it with `bb-init-project` and, after you confirm, starts its conductor as a background process. By hand:

   ```sh
   git clone --branch <default-branch> <repository-url> ~/projects/<key>
   cd ~/projects/<key>
   bakers oven start
   ```

10. Verify.

    ```sh
    herdr workspace list
    bakers config check --scope connection --online
    bakers oven status
    ```

**Done when:** `herdr workspace list` succeeds, the online check has no findings and each conductor shows `online`. Continue with [your first ticket](/get-started/first-ticket). For another repository, start at [project setup](/get-started/connect-a-project) inside this workspace.

## See the workspace in your own herdr

Add it as a saved machine on your own computer: `herdr machine add <name>.coder --label <name>`. herdr verifies SSH host keys strictly, while `coder config-ssh` sends the keys of `*.coder` hosts to `/dev/null`, so pin the workspace's key first with a block above Coder's managed section in `~/.ssh/config`. The key stays the same across workspace restarts.

```
Host <name>.coder
  UserKnownHostsFile ~/.ssh/known_hosts
  StrictHostKeyChecking accept-new
```

## After a workspace restart

Everything under your home survives: the tools, the sign-ins, the machine config and your projects. The container is new, so the start log shows every tool as skipped, and the workspace starts `herdr server` and the connector `preview_transport` selects, when its config file exists. Project runtimes do not come back by themselves, and conductors only with the workspace parameter `conductor_autostart` on (the template README's *Conductor autostart*). Otherwise run `bakers oven start` again in each checkout. Start each project's runtime where you need it, and share a preview again with `bakers ports up`.

## Update a tool

A tool that is already installed is skipped, so a new version in the template reaches a workspace only when the tool is missing. Update one yourself with its own updater, for example `claude update` or `bakers update`, or delete it (`rm "$(command -v <tool>)"`) and restart the workspace.
