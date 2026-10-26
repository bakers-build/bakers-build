# Project setup

Apply only for `project` or `all` initialization, before writing configuration that names a project.

1. Search the control plane for the requested project name. Reuse a hit and report its UUID;
   otherwise invoke `@bakers-build/bb-create-project`. Use the returned entity's own name for `--project`:
   `bakers config init` records a name without verifying it.
2. Ask the operator for each lifecycle hook; an empty answer means none. Pass their exact commands
   with `--after-create <command>` / `--after-done <command>`. Never infer/probe a provisioning tool
   or command. Omitting both writes no `hooks` key. Unattended: write no hooks and report this.
3. Preserve existing `WORKFLOW.md` and additions; create an absent file from
   [WORKFLOW.template.md](WORKFLOW.template.md). Keep its entry line verbatim.
4. Fill the `## provision`, `## work`, `## validate` and `## deliver` hints from repository
   requirements; delete a section that stays empty. Verify named skills and commands through the
   agent environment's installation/discovery facilities; report missing skills by name. Report
   the installed `bb-recipe-*` skills and which declares itself project default.
5. Ensure `.gitignore` contains `/assets-ai/` with a short explanatory comment
   ([transient root](../../bb-workflow/references/evidence.md)); prove it with `git check-ignore -v assets-ai/probe`.
   Ignore `.bakers/conductor.config.local.js` and generated secret-bearing local overrides; verify
   every applicable path with `git check-ignore -v`.
