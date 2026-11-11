---
prev:
  text: Provision
  link: /provision/
next:
  text: Prepare your project
  link: /get-started/connect-a-project
---

<span id="prepare-your-project"></span>

# Prepare a worktree environment

<span id="provisioning"></span>

Use your project's existing development tools to give each ticket a working application environment. Any environment can fit, provided it supports independent Git worktrees and repeatable setup.

**You need:** a ready [execution environment](/provision/machine) and the repository. Use this guide during [project setup](/get-started/connect-a-project) when its environment still needs worktree support. It helps you choose and check commands before applying them.

::: tip The project already supports ticket worktrees?
Keep its existing scripts and configuration. Continue with [connecting this checkout](/get-started/connect-a-project).
:::

## Make the project worktree-compatible

A Git worktree is a separate working directory for a branch of the same repository. Tickets use these directories to work in parallel. Separate source files alone do not separate running services or data.

Your project must support:

- **Fresh directories:** install dependencies and prepare configuration without relying on files from your main checkout. Git metadata may be a `.git` file pointing elsewhere, rather than a directory.
- **Parallel instances:** use distinct application names, ports, databases and writable data where tickets must not affect each other.
- **Repeatable setup:** reuse a ready environment and safely start or prepare one that is missing.
- **Scoped cleanup:** stop or remove only the resources belonging to that worktree. Preserve or export data you need.

<span id="ownership-and-values"></span>

## Choose the missing settings

The setup follows the guides below. Reuse explicit answers and existing configuration; ask one missing decision at a time and wait for the answer. Installed tooling alone does not select a client or authorize a shared configuration change.

| When | Decision and guide | Where the result belongs |
|---|---|---|
| No client has been selected | Ask which [client](../get-started/use-your-client.md) to use; follow its guide for the [executor and worktree](../addons/slots.md). | Project configuration, respecting any machine executor override. |
| The application needs preparation or cleanup | Ask separately for exact [lifecycle commands](../provision/hooks.md), including whether work is needed before each run. Reuse repository scripts and explain their effects. | The project's `hooks`; an explicitly empty answer means no hook. |
| Tests or previews need a running environment | Ask for [provisioning profiles](../configuration/project/hooks.md#provision-on-an-agent-s-request), commands and readiness checks. Distinguish on-demand preparation from lifecycle hooks. | `hooks.provision_up` and the corresponding `WORKFLOW.md` phase hints. |
| Workflow skills or recipes are needed | Check what is installed, then select the required plugins and pinned sources using [project marketplaces](../configuration/project.md#agent-plugins) and [skill installation](../skills-and-workflows/skills.md). | Project `marketplaces`; preserve unrelated registrations. |
| Permissions are not decided | Explain [execution security](../provision/security/execution.md) and [shared settings](../provision/security/shared-settings.md); ask for the mode and necessary access. | Authorized project/machine settings; verify the effective mode and its source with `bakers agents`. |
| Agents need repository delivery | Resolve [Forge](../addons/forge.md), its hosting backend, repository, authentication method and merge policy. Sandbox mode alone does not provide delivery tools. | Forge addon in its supported scope; credentials stay private on the conductor's machine. |
| A preview is needed | Ask whether URLs stay local or are shared publicly. If public, select a [Ports transport](../addons/ports.md) and [services](../addons/ports-services.md), and explain cleanup. | Project service declarations; reuse or authorize machine [tunnel policy and transport](../configuration/machine.md#preview-link-tunnels). `tunnel: true` alone does not configure a transport. |

Use [addon ownership](../addons/configure.md) when writing these settings: harnesses belong to the machine, Essentials and authentication to the connection, and project integrations to the project. Add only the selected integrations and their documented dependencies. Essentials already supplies its constituent plugins. A server adapter such as `remote-drupal` currently belongs to the project and uses the connection's authentication.

`bakers config init` creates or repairs the supported base configuration. Its defaults are not answers to these questions. Read back the result, preserve custom values and reconcile it with the selected client and current documentation. For settings without CLI flags, edit the documented fields directly in the authorized files. If a choice cannot be saved safely, name the field and remaining action; do not report complete setup. Do not copy another repository's commands or addons wholesale.

## Connect the project's setup

Repository scripts prepare the application. Identify the commands to put in `.bakers/project.config.js`. The next step, [connecting the checkout](/get-started/connect-a-project), applies these choices and verifies the configuration.

[Lifecycle hooks](/provision/hooks) connect setup and cleanup commands to ticket work. The [Node.js](/provision/node-project) and [Compose](/provision/docker-compose) examples show stack-specific commands. The [Configuration reference](/configuration/project/hooks) owns timing, environment and failure rules.

## Prepare the application on demand

If a task or its checks need a running application, configure the [`provision_up` tool](/provision/tools#prepare-an-environment-with-provision-up) to prepare or reuse it on demand. If they only need source files and installed dependencies, application services can stay stopped. The project script owns installation, readiness checks and the resulting URL.

Runtime addons can add tools or discover services, but enabling an addon alone does not install your application. Need a concrete pattern? Follow the [example matching your project](/provision/examples), then return to the check below.

## Check tools and access

Review the [available tools](/provision/tools) and [security context](/provision/security/) before the first run. `provision_up` and addon tools can execute outside the agent sandbox; their scripts and permissions must be trusted. Neither application containers nor worktrees automatically isolate the agent.

<span id="verify-and-isolate"></span>

## Verify independent operation

Test the setup with two disposable worktrees before using it for parallel tickets. Run preparation twice, check both applications, then clean up one and confirm the other still works.

Lifecycle hook failures are logged and work continues; put mandatory checks in `WORKFLOW.md`. A failed `provision_up` call returns an error to the agent. Configuration validation follows when you connect the project.

**Done when:** you know the preparation, readiness and cleanup commands, and have checked that they keep worktrees independent.

**Next:** [Connect your project](/get-started/connect-a-project) to apply these choices and run the configuration checks.
