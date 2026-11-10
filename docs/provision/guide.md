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
