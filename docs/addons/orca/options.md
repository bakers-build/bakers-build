# Orca options

Optional `with` values for the [Orca addon](/addons/orca). Setup and its minimal configuration live on that page.

<!-- @options @bakers-build/addon-orca -->

The agent terminal title is set as the terminal's manual name (`orca terminal rename`). The agent can still change the title shown for the terminal itself; the run's terminal is found again by the renamed tab title in the Orca app, or by the terminal title with `orca serve`.

## Worktree lifecycle

Git creates the exact ticket branch; Orca adopts the worktree after the addon registers the repository. The executor registers it too, so it adopts a worktree from any workspace ([Conductor slots](/addons/slots)). `stopRun` does nothing; cleanup closes the terminal, including after an Orca restart. Removal uses `orca worktree rm`, falling back to Git when Orca does not know the worktree.
