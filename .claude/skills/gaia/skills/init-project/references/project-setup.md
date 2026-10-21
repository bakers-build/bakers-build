# Project setup

Apply only for `project` or `all` initialization, before writing configuration that names a project.

1. Search the control plane for the requested project name. Reuse a hit and report its UUID;
   otherwise invoke `@gaia/create-project`. Use the returned entity's own name for `--project`:
   `gaia config init` records a name without verifying it.
2. Ask the operator for each lifecycle hook; an empty answer means none. Pass their exact commands
   with `--after-create <command>` / `--after-done <command>`. Never infer/probe a provisioning tool
   or command. Omitting both writes no `hooks` key. Unattended: write no hooks and report this.
3. Preserve existing `WORKFLOW.md` and additions; create an absent file from
   [WORKFLOW.template.md](WORKFLOW.template.md). Ask which skill sets to use. Enumerate every
   installed `@gaia/method-context` set under **Selecting the skill set**, showing name, `> ` blurb
   and availability checked under **Loading the selected skills**. Mark unresolvable sets unavailable
   with their install command. Offer multi-select with first enumerated set as default; write
   exactly the chosen one or more `Skill set` entries, chosen default first. Unattended: select
   the first available set and report it.
4. Fill `Skills`, `Checks`, `Setup` from repository requirements. Verify selected required skills
   and commands through the agent environment's installation/discovery facilities; report missing
   skills by name.
5. Ensure `.gitignore` contains `/assets-ai/` with a short explanatory comment
   (`@gaia/essential-skills`' transient root); prove it with `git check-ignore -v assets-ai/probe`.
   Ignore `.gaia/conductor.config.local.js` and generated secret-bearing local overrides; verify
   every applicable path with `git check-ignore -v`.
