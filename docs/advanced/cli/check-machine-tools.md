# Check your machine tools

Verify only the tools your machine will use. [Choose your setup first](/advanced/cli/prepare-machine).

**You need:** your tooling choices, a terminal on the worker, and permission to install missing tools using the linked vendor guides.

1. **Runtime on every machine:** [set up Node.js with npm](/advanced/cli/node), install [git](https://git-scm.com/downloads), then [install bakers.build](/advanced/cli/install).

   ```sh
   git --version
   bakers --version
   ```

   Machines that only create and follow tickets need no worker tooling.

2. **Workspace manager:** follow [Set up herdr](/advanced/cli/herdr) for the supported integration. Other managers need a compatible bakers.build integration; environment hooks do not replace it. The tuios integration is coming soon.

3. **Development environment:** follow the guide for your choice:

   - [DDEV](/advanced/cli/ddev): Docker access, DDEV and worktree setup.
   - [Node.js project](/advanced/cli/node#node-js-projects): your project's version and scripts.
   - [Docker only](https://docs.docker.com/engine/install/): Docker must answer without `sudo`.
   - **Custom tooling:** use your project's documented setup and checks. A missing check remains outstanding.

   [Lifecycle hooks](/advanced/configuration/hooks) connect local or remote environments. Hook failures do not stop dispatch; required readiness checks belong in `WORKFLOW.md`.

4. Choose and sign in to an **agent harness** as the worker user. Supported CLIs and their installation guides: [Claude Code](https://docs.claude.com/en/docs/claude-code/setup) (`claude`), [Codex](https://github.com/openai/codex) (`codex`), [Grok](https://github.com/xai-org/grok-build) (`grok`), [Kimi](https://github.com/MoonshotAI/kimi-code) (`kimi`), [OpenCode](https://opencode.ai/docs/) (`opencode`), [Pi](https://pi.dev/docs/latest/quickstart) (`pi`). Check each chosen CLI is present and authenticated. Keep the [machine's harness list](/advanced/configuration/agents-and-models) aligned with what is installed.

5. If you enable preview tunnels, install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and check its version. The [machine configuration](/advanced/machines#preview-link-tunnels) owns this choice.

**Done when:** the runtime and every chosen tool pass their checks as the worker user. Continue with [Install and sign in](/advanced/cli/install).

