# Set up herdr

**Keep your agent sessions together.** [herdr](https://herdr.dev/) is bakers.build's currently supported workspace manager; the tuios integration is coming soon.

- **Workspace manager:** organizes terminals and agent sessions.
- **Development environment:** remains your choice, independently of herdr.

**You need:** a terminal on the machine that runs bakers.build and its agent processes.

1. **Install herdr** using the [official installation guide](https://herdr.dev/docs/install/), then check:

   ```sh
   herdr --version
   ```

   bakers.build's setup requires version 0.7 or later. The command must be available to the user running the conductor.

2. **Start the default session** from your project directory:

   ```sh
   herdr
   ```

   Use another terminal as the same user to verify:

   ```sh
   herdr workspace list
   ```

   A named session uses a separate socket. bakers.build's standard setup expects the default session.

3. **Check the project integration.** The standard bakers.build setup uses herdr for its executor and workspace. Preserve that pairing; see [Conductor configuration](/advanced/conductor-config#herdr-options).

**Done when:** herdr is available and the default session answers as the conductor's user.

- **On a server?** Follow [Set up a worker server](/advanced/worker-server) for headless startup.
- **Ready?** Continue with [machine checks](/advanced/cli/check-machine-tools).
