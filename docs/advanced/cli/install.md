# Install the CLI

Install the `bakers` command, sign in and check your workspace access. Most people let the [setup wizard](/get-started/install) do this for them.

**You need:** [Node.js ≥ 20.19 with npm](/advanced/cli/node), git and your team's server URL.

1. **Install the CLI.** Use `@bakers-build/bakers@<version>` if your team pins a release.

   ```sh
   npm install -g @bakers-build/bakers
   bakers --version
   ```

2. **Confirm your account and workspace access in the browser.**
   - Sign in at `<server-url>/user/login`.
   - Create a workspace at `<server-url>/home/new-workspace` or accept an invitation at `<server-url>/home/join/<invite>`.
   - A workspace lead grants missing access; the CLI cannot create these prerequisites.

3. **Configure bakers.build.** Run outside a project checkout and follow the prompts:

   ```sh
   bakers init
   ```

   The local operator name identifies you on this machine, separately from your authenticated account. Setup writes machine/connection configuration, not project configuration. `Online: pending` means sign-in is still outstanding.

   **Already configured bakers.build?** Keep correct existing values and fill only what is missing.

4. **Sign in.** Open the displayed URL on any device and approve the code.

   ```sh
   bakers dropsh auth login
   bakers dropsh auth status
   ```

5. **Verify the connection and workspace access.**

   ```sh
   bakers config check --scope connection --online
   bakers info
   ```

   Check the selected server. Authentication must pass first; only then does an empty `workspace_ids` mean missing workspace rank. Ask a workspace lead to grant it.

**Done when:** the CLI runs, authentication passes and `bakers info` lists a workspace.

## Next

- [Prepare a machine](/advanced/cli/prepare-machine) with your workspace manager and development environment.
- **Worker on Linux?** Claude and Codex runs need their OS sandbox: install `bubblewrap` and `socat` (`sudo apt-get install -y bubblewrap socat`), then run `bakers oven check` in the connected project. See [Sandbox prerequisites](/advanced/run-security#sandbox-prerequisites).
- **Unattended server?** Use a machine connection with client credentials; see [worker servers](/advanced/worker-server) and [connections](/advanced/connections).
- **Command missing?** Check [Node.js and PATH](/advanced/cli/node), then [troubleshooting](/advanced/cli/troubleshooting).
