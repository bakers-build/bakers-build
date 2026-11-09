# Environment examples

DDEV, Docker Compose and Node.js illustrate how to prepare independent ticket environments. Reuse your project's existing tools; these are examples, not an exhaustive list of supported environments.

## DDEV

DDEV runs a project's application and services in containers. Give each worktree its own DDEV project name and database, and check any fixed ports or external services for conflicts.

The [DDEV setup example](/addons/ddev/setup) shows preparation, cleanup and a `provision_up` script. Starting DDEV alone does not install your application or import its data; the project's script handles those steps and checks readiness.

The [DDEV addon](/addons/ddev#agent-tools) owns the tool catalog for inspecting, starting and executing commands inside that environment.

Enable the addon in the machine or project configuration. It also supplies service discovery for Ports when configured as a claimer. The addon provides tools and discovery; your project owns application setup. [Tools and integrations](/provision/tools) explains how callers reach these functions.

## Docker Compose

Reuse the repository's Compose services with a different Compose project name for each worktree. Ordinary containers, networks and volumes follow that name; fixed container names, external resources and host ports need separate handling.

The [Docker Compose example](/provision/docker-compose) shows setup, readiness and cleanup that affect only one ticket's environment. Use a project script behind `provision_up` when the agent should start or prepare services on demand. The [Compose discovery addon](/addons/docker-compose) finds services; it does not provision them.

## Node.js

A Node.js application can run directly on the machine. Install its locked dependencies in each worktree, give concurrent servers different ports and keep writable application data separate.

The [Node.js project example](/provision/node-project) uses the repository's package manager and scripts. A project-specific `provision_up` command can prepare and check a running application when needed. No container runtime or Node provisioning addon is required. The Node.js installation needed by the bakers.build CLI is a separate [machine prerequisite](/provision/node).

## Use another environment

Apply the same [worktree requirements](/provision/guide#make-the-project-worktree-compatible) to your own stack. Provide repeatable setup, a readiness check and cleanup scoped to one ticket. Add an addon only when you need additional tools or integration.

**Verify:** prepare two worktrees, repeat setup, and check both applications. Cleaning up one must leave the other working. Choose [security boundaries](/provision/security/) for the agent as well as for the application.

**Next:** return to [project preparation](/provision/guide#check-tools-and-access) to review access and verify independence, then connect the checkout.
