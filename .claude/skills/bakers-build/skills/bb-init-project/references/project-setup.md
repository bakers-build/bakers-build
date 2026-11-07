# Project setup

Apply only for `project` or `all` initialization, before writing configuration that names a project.

Read [Set up a project](https://bakers.build/get-started/connect-a-project), using
`docs/get-started/connect-a-project.md` in a bakers.build source checkout. Resolve the client’s
executor/workspace pair separately from the application environment; preserve explicit repository
choices. Explain proposed setup/readiness/cleanup commands, then obtain the operator’s exact hook
choices below. **Done when both choices and their owning files are understood.**

1. Search the control plane for the requested project name. Reuse a hit and report its UUID;
   otherwise invoke `@bakers-build/bb-create-project`. Use the returned entity's own name for `--project`:
   `bakers config init` records a name without verifying it.
2. Ask the operator for each lifecycle hook; an empty answer means none. Pass their exact commands
   with `--after-create <command>` / `--after-done <command>`. Never infer/probe a provisioning tool
   or command. Omitting both writes no `hooks` key. Unattended: write no hooks and report this.
   When agents need the running application, explain `hooks.provision_up`
   ([hooks](https://bakers.build/configuration/provisioning/hooks#provision-on-an-agent-s-request)):
   one command per profile that reuses a ready environment. No flag writes it; the operator adds
   it to `.bakers/conductor.config.js`.
3. Preserve existing `WORKFLOW.md` and additions; create an absent file from
   [WORKFLOW.template.md](WORKFLOW.template.md). Keep its entry line verbatim.
4. Fill the `## bb-phase-provision`, `## bb-phase-work`, `## bb-phase-validate`, `## bb-phase-deliver`
   and `## bb-phase-outtake` hints from repository
   requirements; delete a section that stays empty. `## bb-phase-transition` carries the default
   origin-label table; show it to the operator, apply their vocabulary, or delete it when the
   project writes no origin labels. Verify named skills and commands through the
   agent environment's installation/discovery facilities; report missing skills by name. Report
   the installed `bb-recipe-*` skills; recipe guidance for qualification, if the project wants any,
   goes in the `## bb-phase-work` hint.
5. Ensure `.gitignore` contains `/assets-ai/` with a short explanatory comment
   ([transient root](../../bb-workflow/references/evidence.md)); prove it with `git check-ignore -v assets-ai/probe`.
   Ignore `.bakers/conductor.config.local.js` and generated secret-bearing local overrides; verify
   every applicable path with `git check-ignore -v`.
