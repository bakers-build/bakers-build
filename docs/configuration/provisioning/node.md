# Set up Node.js

**Node.js runs the bakers.build CLI.** Install it on each machine where you run bakers.build, independently of the project's development environment.

## AI first

```text
Read https://bakers.build/configuration/provisioning/node.
Check Node and npm on the conductor host first. If this is a Node
application, separately read its version and lockfile. Explain missing setup
and propose its existing locked-install and readiness commands; preserve
working tools.
```

The reference below explains the commands and configuration changes.

**You need:** a terminal and permission to install Node.js for the user running bakers.build.

1. **Install Node.js with npm** from the [official download page](https://nodejs.org/en/download), or use your existing version manager. Choose a supported LTS release that meets bakers.build's minimum of **20.19**.

2. **Check both commands** in the terminal that will run bakers.build:

   ```sh
   node --version
   npm --version
   ```

   Node.js must report 20.19 or later; npm must report a version. If either command is missing, fix the installation or `PATH`, then open a new terminal.

3. **Check the worker's context.** A Node.js installation inside a project container does not provide Node.js to a conductor running on the host. On a remote worker, repeat the checks on that server as its worker user.

**Done when:** Node.js and npm are available in bakers.build's execution environment. Continue with [Install bakers.build and sign in](/get-started/machine).

## Node.js projects

**Your application's Node.js setup is a separate choice.** Keep the project's version, package manager and scripts. [Lifecycle hooks](/configuration/provisioning/hooks) can run its dependency setup in each ticket worktree; `WORKFLOW.md` owns required checks.

A Node.js project does not need Docker or DDEV unless your project chooses them.

## Example: npm project hooks

**For a repository with `package-lock.json`.** Merge this entry into `hooks` in `.bakers/conductor.config.js`, keeping the rest of your configuration:

```js
hooks: {
  after_create: 'npm ci',
},
```

- **Every dispatch:** install locked dependencies in the ticket worktree, including reused worktrees.
- **Other package manager?** Use your project's existing locked-install command instead.
- **Build and test:** put required commands such as `npm test` in `WORKFLOW.md`; a failing hook does not block dispatch.
- **Long-running dev server?** Keep it out of this blocking hook. Give concurrent worktrees separate ports when you start previews.

[Hook lifecycle and environment →](/configuration/provisioning/hooks)
