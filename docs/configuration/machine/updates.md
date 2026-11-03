# Update bakers.build

Move a workstation to a newer bakers.build release: the CLI first, then your configuration files, then the shared project files.

**You need:** npm and permission to install global packages, your usual connection signed in, and for shared files a project checkout where you can open a branch.

## AI first

```text
Check my CLI and bakers skills versions. Guide their updates using
https://bakers.build/configuration/machine/updates. Preview configuration
migration with --dry-run and show the effects before applying it.
Use bb-upgrade-project for shared project files in a branch.
```

Refresh [skills](/configuration/agents/skills#updates) separately from the CLI. They guide the update but do not replace your tools automatically. The exact CLI/configuration sequence follows.

## Manual sequence and background

1. Record where you start, then update the CLI:

   ```sh
   bakers --version
   bakers update
   bakers --version
   ```

   `bakers update` runs `npm install -g @bakers-build/bakers@latest` and prints `<before> → <after>`. To pin a release instead, run `npm install -g @bakers-build/bakers@<version>`. An interactive `bakers oven start` can run that install and the all-scope migration for you: Enter accepts, then the process exits so you can rerun start; `n` continues on the current release. Failures stop this start and leave a running conductor untouched. `bakers ui`, foreground, CI and non-TTY starts only print a notice. `--no-update-check` skips the lookup. Manual update and the dry-run path below still work.

2. Preview the configuration migration. Add `--connection <id>` if you use a named connection.

   ```sh
   bakers config upgrade --scope all --dry-run
   ```

   The preview parses your files without running them and writes nothing. It shows each file's schema change and a redacted diff. Resolve blocking findings first: computed values it cannot move, conflicting destinations, a future schema version, or a missing identity input. [Configuration migration](/configuration/project/migration) explains each finding.

3. Apply it, check it, and confirm nothing is left:

   ```sh
   bakers config upgrade --scope all
   bakers config check --scope all --online
   bakers config upgrade --scope all --dry-run
   ```

   Apply rechecks the files, writes a private backup `<file>.bakers.bak` next to each changed file, and replaces the file atomically. Do not commit the backups. The last preview must show no change; a remaining `unknown_value` warning about a computed `conductor_id` is not a change. An offline `ok` proves only the file shape; `--online` proves sign-in and project access, and "online skipped" is not a pass.

4. Update the shared project files in a branch, never on the default branch. Ask your AI to run the `bb-upgrade-project` skill, which keeps the repository's `WORKFLOW.md` policy, moves an old `## Loaded skills` layout to the entry line and phase sections, and confirms that every skill the file names is installed. Review the diff.

   Run a small test ticket in a disposable project, then submit the branch for review. Teammates update their own tools; your merge does not do it for them.

5. A server update is an operator task: follow [Server](/configuration/project/server).

**Done when:** `bakers --version` shows the release you meant to install, the final dry run reports no change, the online check passes, and a small test ticket runs as expected.

## Who updates what

| Layer | Owner | Step |
|---|---|---|
| CLI | Each user | 1 |
| Machine and connection files | The machine owner | 2 and 3 |
| Shared project files | A project developer, through review | 4 |
| Server | The operator | 5 |

Updating the CLI alone migrates neither your files nor the project, and deploys nothing. Automatic migration from an accepted start prompt uses the same all-scope planner, may touch selected project files, keeps backups and conflict protections, and deploys nothing. The cache is `~/.bakers/update-check.json` (or `$BB_HOME/update-check.json`); a decline lasts until that original check expires, not until 24 hours after you answer. A failed cache write is reported and does not claim suppression. Enter accepts; EOF or Ctrl-C cancels without installing or declining. The running process does not become the new release, and a source checkout or PATH shim may still run source after a global install. Keep the failing command, its key and the file path when you ask for help, and never paste secret values.
