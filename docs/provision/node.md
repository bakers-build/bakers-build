# Set up Node.js

**Node.js runs the bakers.build CLI.** Install it on each machine where you run bakers.build, independently of the project's development environment.

## AI first

```text
Read https://bakers.build/provision/node.
Check Node and npm on the machine that runs bakers.build. Preserve
working tools and guide me through installing missing prerequisites.
Keep the application’s Node.js setup separate.
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

**Done when:** Node.js and npm are available in bakers.build's execution environment. Continue with [Install bakers.build and sign in](/provision/machine).

<span id="node-js-projects"></span>
<span id="example-npm-project-hooks"></span>

## Preparing a Node.js application?

Follow the [Node.js application example](/provision/node-project) for per-worktree dependencies, ports and data. The application can use its own Node version and package manager.
