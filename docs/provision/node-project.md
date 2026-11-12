# Prepare a Node.js application

Run the application directly in each ticket worktree using the repository's existing tools. Each worktree needs its own dependencies, ports and writable data.

::: info Part of project preparation
Use this example for an existing Node.js application. Installing [Node.js for the bakers.build CLI](/provision/node) is a separate machine prerequisite.
:::

## Keep the project's setup

Keep the project's version, package manager and scripts. [Lifecycle hooks](/provision/hooks) can run its dependency setup in each ticket worktree; `WORKFLOW.md` owns required checks.

A Node.js project does not need Docker or another container runtime unless your project chooses them.

## Example: npm project hooks

**For a repository with `package-lock.json`.** Merge this entry into `hooks` in `.bakers/project.config.js`, keeping the rest of your configuration:

```js
hooks: {
  after_create: 'npm ci',
},
```

- **When preparation is needed:** install locked dependencies in the ticket worktree. A successfully prepared worktree is reused without rerunning `after_create`.
- **Other package manager?** Use your project's existing locked-install command instead.
- **Build and test:** put required commands such as `npm test` in `WORKFLOW.md`; a failing hook does not block dispatch.
- **Long-running dev server?** Keep it out of this blocking hook. Give concurrent worktrees separate ports when you start previews.
- **Application data?** Keep databases, uploads and other writable data separate for each worktree. Cleanup must affect only that worktree's processes and data.
- **Agents need the running app?** Configure [`provision_up`](/configuration/project/hooks#provision-on-an-agent-s-request) with a command that follows its contract.

**Done when:** dependencies install in each worktree, required checks pass, and running or cleaning up one application leaves the other unchanged.

**Next:** return to [project preparation](/provision/guide#check-tools-and-access) to review tool access and verify independence before connecting the checkout.
