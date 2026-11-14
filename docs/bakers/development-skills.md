# Development skill dependencies

This is the dependency and adoption ledger for contributors to this repository. No mandatory
skill needs the private keytec marketplace: retained upstream skills come from public, pinned
sources, and the former keytec QA and Drupal skills are repository-owned project skills under
`.claude/skills/`. A successful public download is not evidence that an agent discovers or loads a skill.

## Current scope

The Bakers skill bundle contains generic workflow/runtime instructions only. Domain-specific
procedures belong to the project: project skills under `.claude/skills/<name>/` (`testing`,
`drupal-developer`, `drupal-update`), reached through `WORKFLOW.md`, and project documentation.
They are discovered natively in this repository and do not ship with the Bakers bundle; no
`bb-drupal-update` skill exists. The existing DDEV adapter now takes its provider,
testing and login methods from the project; its login commands moved to `ddev-logins.md`,
and its duplicate test guidance was removed in favor of `testing.md`.

The maintainer removed the full native Claude/Codex discovery and real-worker scenarios and
the local docs-site/theme gates from this ticket's completion requirements. Their earlier
observations remain evidence, and untested compatibility remains unverified. Core/lint,
static references, plugin version, permission/profile tests and source-rights review remain
required. This ticket-specific waiver changes no repository-wide or CI policy.

## Inventory and disposition

The consumer inventory below covers the repository at
`5ecdb230c17412aed85d2021d5eb5ffea3365bb2`. A fresh check of `origin/develop` at
`426cc9b07d3aa3ca41d691b771ea5ed5c254bb3a` found the same private prerequisites;
the intervening Grok and brand changes do not implement this migration.

| Dependency | Direct consumers and transitive edges | Disposition and adoption status |
|---|---|---|
| `keytec-qa:keytec-testing` 3.0.1 | `WORKFLOW.md`; `tests/playwright/README.md` | Adopted as project skill `testing`. The private `@key-tec/playwright-core` prescription became "the suite's existing fixtures and steps"; the separate test-library migration owns library removal. |
| `keytec-drupal:keytec-drupal-developer` 1.4.3 | `WORKFLOW.md`; workflow-authoring example; root Claude settings; three `bakers-cli/addons/claude/measure/keytec-{plan,coding,review}.json` profiles | Adopted unchanged in substance as project skill `drupal-developer`. Settings and profiles no longer enable `keytec-drupal@keytec`. |
| `keytec-drupal-update` in the same Drupal bundle | Disabled monthly template `recipes/bb_ticket_templates/templates/bd9e5a3c-7f21-4c68-9a04-2d1e6b8c5f30.yml`, its README and `TicketTemplateAccessTest.php` | Adopted as project skill `drupal-update` with `verification.md`, `patches.md`, `major.md`; the private lifecycle adapter and Doctor assumptions were dropped. The template ships disabled, enters qualification and finishes through mandatory ticket review. |
| Update skill's private lifecycle adapter | `method-context`, `workflow-step`, `read-ticket`, `ensure-qualification`, `publish-comment`, `resolve-environment`, `scope-change`, `verify-tests` | Removed. The Bakers lifecycle owns plan, approval, scope change and review; `bb-workflow/references/ticket-writes.md` owns comment publication. |
| `keytec-drupal-doctor` | Update skill provisioning assumption; root and playground DDEV helper hints; private `keytec-ddev-addon` | Removed as a prerequisite: hints now name the `ddev init` host command. Addon removal belongs to the DDEV cleanup change. |
| `keytec-drupal-deploy` 2.12.0 → `keytec-server-provision` | `docs/advanced/server.md` | Removed as a prerequisite: the server guide carries the add-an-installation steps for the existing Komodo stack. The `keytec-ai` deployer CLI it already documents is infrastructure, outside this skill change. |
| Matt `grilling`, `diagnosing-bugs`, `tdd`, `code-review` | `bb-recipe-matt`; root settings; measurement profiles. TDD conditionally reaches `codebase-design`, its `DEEPENING.md` and `DESIGN-IT-TWICE.md`; TDD also needs `tests.md` and `mocking.md`. Code review has conditional user setup via `setup-matt-pocock-skills`. | Already public upstream: complete `mattpocock/skills` v1.3.2. Root settings already declare it; measurement profiles now declare the same source instead of the private repackaging. |
| Matt `writing-for-agents` | `WORKFLOW.md` for skill/manifest work; `SKILL-MECHANICS.md` when writing skills | Same complete public Matt bundle; no renamed copy. |
| Superpowers | Optional `bb-recipe-superpowers`; measurement profiles. Direct skills: `brainstorming`, `writing-plans`, `systematic-debugging`, `executing-plans` or `subagent-driven-development`, `test-driven-development`, `requesting-code-review`, `verification-before-completion`. Transitives include `using-git-worktrees`, `finishing-a-development-branch`, test guidance, reviewer/implementer prompts and execution references. | Already public upstream: retain the complete bundle. Root settings and all three development profiles register v7.0.0 from `obra/superpowers`; profiles select `superpowers@superpowers-dev` and disable the alternate unpinned registration. Native compatibility is unverified and its integration check is waived. |
| Designbook component/screen/shell/entity/tokens | `WORKFLOW.md`, `conventions.md`, root settings and coding profile; CLI intake → task composition → `execute-workflow`; shared schemas, rules, resources and task files | Already public upstream: retain complete core bundle and matching extensions. Public candidate revision below; native nested-skill discovery remains unverified. |
| Designbook Drupal, Tailwind and Figma extensions | `web/themes/custom/bb_theme/designbook.config.yml`; coding profile enables Drupal/Tailwind. Figma capture → `extract-reference`, `resources/capture.md`, `tasks/observe-figma.md`, `rules/capture-observations.md`; requires host Figma tools and file access | Already public upstream: retain all three. Committed Figma observations under the theme's `designbook/references/` demonstrate use. Missing Figma capability must remain an explicit failure. Public Figma files exist, but installation compatibility is unresolved. |
| Ponytail; existing `bb-verdict` derivative | `WORKFLOW.md`; root settings; `bb-verdict` attribution | Already public upstream: keep Ponytail and the derivative's existing notice. No optional webhook is configured by this change. Correct public tag revision below; do not use a warm cache as version evidence. |
| Seventeen Bakers skills | `bb-create-project`, `bb-create-ticket`, `bb-init`, `bb-init-project`, `bb-label-auto`, `bb-label-auto-accept`, `bb-label-auto-review`, `bb-label-ticket-question`, `bb-prepare-time`, `bb-recipe-deploy-and-release`, `bb-recipe-matt`, `bb-recipe-superpowers`, `bb-recipe-verify`, `bb-scope-change`, `bb-upgrade-project`, `bb-verdict`, `bb-workflow` | Repository-owned canonical bundle at `.claude/skills/bakers-build/skills/`. Retain generic references/templates and MIT metadata. The unattended-label skill bumped the bundle to 0.52.0; `bb-create-ticket`'s specify path bumps it to 0.53.0; its rename to `bb-label-auto`, loaded by the frame from the label in every state, bumps it to 0.55.0; the conductor tool paths in the DDEV runtime guide, provision and preview links bump it to 0.56.0; choosing their transport only in `tools.md` (MCP or `bakers oven tools`) bumps it to 0.57.0; replacing that guide and the provision reference with the frame's `provision_up` rule bumps it to 0.58.0; the deploy-and-release stamping step naming `bakers_ticket_update`'s `environments_add` and `referenced_tickets_add` bumps it to 0.59.0; serving the site's ticket tools on the run's `bakers` MCP server, with `tools.md` naming that tool first and `bakers tools` (which picks the run or site route itself) as the only fallback, replaces the 0.57.0 transport and bumps it to 0.60.0. Renaming the unattended label to `auto` (`bb-label-auto`), choosing the recipe at qualification from every installed recipe loaded completely, with no default, and runtime-neutral conductor and preview text bump it to 0.61.0; pointing `bb-init` and `bb-init-project` at the restructured manual's Provision pages bumps it to 0.61.1; the browser reference sending a sandboxed agent's `playwright-cli` through a runtime tool that runs outside the sandbox bumps it to 0.61.2; splitting the ticket question and freeze out of `bb-label-auto` into `bb-label-ticket-question` bumps it to 0.62.0; `tools.md` listing the `url` that `bakers_ticket_create` returns bumps it to 0.63.0; `tools.md` naming its `assignee_email` input and `assignee` output bumps it to 0.63.1. The `bb-recipe-matt` and `bb-recipe-superpowers` frontmatter `metadata.requires` (and `requires-bug`), which a conductor checks before each run, bumps it to 0.64.0. `tools-lookup.md` listing the `error_log` of `bakers_ticket_runs_list` bumps it to 0.65.1. Routing every fetch, push, MR write, check read and merge through the forge tools of `bb-workflow`'s `references/forge.md` bumps it to 0.66.0. Dropping `error_log` from `bakers_ticket_runs_list` in `tools-lookup.md` again, with the conductor's restart resume reverted, bumps it to 0.66.1. `bb-init` no longer linking the removed Coder workspace guide bumps it to 0.66.2. `tools.md` naming `bakers_run_cancel`'s `machine_id` input bumps it to 0.67.0. `tools.md` naming `bakers_ticket_create`'s `reviewer_emails` input and `reviewers` output bumps it to 0.68.0. `bb-recipe-deploy-and-release` delivering through the forge tools into the ticket's `target_branch` bumps it to 0.69.0. `tools.md` › Transport loading a tool that is not listed yet through the host's tool search before falling back to `bakers tools`, with *Cancel runs* moved to `tools-lookup.md`, bumps it to 0.69.1. `tools-conductor.md` saying that the first `provision_up` on a new worktree can take minutes bumps it to 0.69.2. `bb-init-project` checking worktree compatibility first and resolving its setup decision matrix one decision per turn from the online guides, with `bb-init` handing a remote worker over to it, bumps it to 0.69.3. Reviewer/link maintenance in the write and transition references bumps the bundle to 0.70.0. Named gates (`bb-workflow`'s `references/gates.md`, `## bb-gates` in every recipe) with the labels `auto-review` and `auto-accept` bump it to 0.71.0. Project-specific runtime instructions now live outside the bundle. |

Other affected consumers are `.claude-plugin/verify-marketplace.sh`,
`tests/contract/skill-references.py`, `.claude-plugin/README.md`, the Bakers bundle README,
`docs/skills-and-workflows/write-workflow-md.md`, `.bakers/scripts/setup-test-project.sh`, and
`tests/fixtures/bakers-playground/{WORKFLOW.md,.claude/settings.json,.ddev/commands/host/}`.
The fixture now uses `## bb-phase-validate`, covered by the existing reference contract.
Setup's Codex discovery assumptions must not be presented as verified native behavior. Keep its frozen-plugin opt-out and branch
source preference. Keep the semantic evaluator's empty plugin/skill isolation.

## Source and redistribution evidence

Private marketplace source inspected: `c1bf29f9255a31b1fff1efbde0d64d5eacef8a5e`; it has no
tracked LICENSE/COPYING/NOTICE. keytec, the owner of these skills, granted on 2026-11-02 that
`keytec-testing`, `keytec-drupal-developer` and `keytec-drupal-update` (with its references) may be
adopted into this repository under the MIT license. The adopted skills in
`.claude/skills/{testing,drupal-developer,drupal-update}` are MIT, © keytec, per that grant;
the repository's GPL-2.0 `LICENSE.txt` does not cover them. The doctor and deployment skills were
not copied.

The deployment references contain internal service addresses and commands accessing Vault;
they are dependencies to remove from contributor instructions, not commands to execute during
this inventory. No credential retrieval, infrastructure provisioning or publication is part of
this change. Existing project infrastructure and legal attribution are not removed by a
private-dependency string search.

Public refs were read on 2026-11-02 using unauthenticated HTTPS `git ls-remote`
(`GIT_TERMINAL_PROMPT=0`, empty credential helper) and raw GitHub LICENSE/marketplace files:

| Public upstream | Version/revision | License and install identity |
|---|---|---|
| [Matt](https://github.com/mattpocock/skills/tree/d1478fcb140db0b93c0c8df17bcfd311844749d0) | `v1.3.2` → `d1478fcb140db0b93c0c8df17bcfd311844749d0` | [MIT, Matt Pocock](https://github.com/mattpocock/skills/blob/d1478fcb140db0b93c0c8df17bcfd311844749d0/LICENSE); `mattpocock-skills@mattpocock` |
| [Superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3) | `v7.0.0` → `bb92a77741419a4ab5f06e711a283343f1ada0c3` | [MIT, Jesse Vincent](https://github.com/obra/superpowers/blob/bb92a77741419a4ab5f06e711a283343f1ada0c3/LICENSE); `superpowers@superpowers-dev` in this upstream marketplace |
| [Ponytail](https://github.com/DietrichGebert/ponytail/tree/16352ac229eb08a9598dcae48fe9f2b342567d86) | `v5.3.2` → `16352ac229eb08a9598dcae48fe9f2b342567d86` | [MIT, DietrichGebert](https://github.com/DietrichGebert/ponytail/blob/16352ac229eb08a9598dcae48fe9f2b342567d86/LICENSE); `ponytail@ponytail` |
| [Designbook](https://github.com/pen-drop/designbook/tree/a4fea9d7cf8d2e06321d132e6d24892d17c0a480) | `a4fea9d7cf8d2e06321d132e6d24892d17c0a480`, marketplace `0.6.0` | [MIT, Designbook Team](https://github.com/pen-drop/designbook/blob/a4fea9d7cf8d2e06321d132e6d24892d17c0a480/LICENSE); `designbook`, `designbook-drupal`, `designbook-css-tailwind`, `designbook-figma` in marketplace `designbook` |

Retain upstream license and copyright files with any redistributed package. This change
references public packages and does not vendor them. The previously inspected Ponytail cache
commit `09c434ab73ca43761c5d8b0c5d341926c2fba710` is not the observed public v5.3.2 tag.
Designbook's Figma integration documentation says it is absent from the marketplace, whereas
the marketplace at the inspected revision lists it. Neither statement establishes successful
native installation or nested-skill discovery. Those integration checks are waived; no fully verified clean path is claimed.

## Versioned public registrations

Root Claude settings declare Matt v1.3.2, Superpowers v7.0.0, Ponytail v5.3.2 and
Designbook revision `a4fea9d7cf8d2e06321d132e6d24892d17c0a480`. The three development
measurement profiles declare Matt and Superpowers themselves; the coding profile also
declares the same Designbook revision for its enabled core/Drupal/Tailwind plugins.
Their permission deny lists and the project's settings precedence are preserved.

For explicit Claude marketplace registration, these are the versioned source arguments:

```sh
claude plugin marketplace add 'https://github.com/mattpocock/skills.git#v1.3.2'
claude plugin marketplace add 'https://github.com/obra/superpowers.git#v7.0.0'
claude plugin marketplace add 'https://github.com/DietrichGebert/ponytail.git#v5.3.2'
claude plugin marketplace add 'https://github.com/pen-drop/designbook.git#a4fea9d7cf8d2e06321d132e6d24892d17c0a480'
```

Install the needed identities from the table above with `claude plugin install <identity>`.
Superpowers is needed for its optional recipe and the development measurement profiles.
Only the historical Matt installation described next was
executed; native installation/loading of the other pins remains unverified.

## Observed Matt installation

Claude Code `2.1.316` installed the public package in a fresh disposable profile, with
`CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_PLUGIN_CACHE_DIR` both pointing inside the worktree,
`CLAUDE_CODE_PLUGIN_SEED_DIR` unset and `--setting-sources user` excluding project/global
marketplace inheritance. The profile registered only `mattpocock`:

```sh
claude --setting-sources user plugin marketplace add 'https://github.com/mattpocock/skills.git#v1.3.2' --json
claude --setting-sources user plugin install mattpocock-skills@mattpocock --json
claude --setting-sources user plugin list --json
```

Registration and installation returned `outcome: ok`; the checkout HEAD was
`d1478fcb140db0b93c0c8df17bcfd311844749d0`. Listing reported version `1.3.2`, user-enabled,
and an installation path inside the disposable profile's plugin cache. It also reported
`projectEnabled: false`; no actual skill-loading or worker success is inferred from this
installation result. Supplying `extraKnownMarketplaces` through `--settings` alone to the
install subcommand had returned `not_found`; explicit registration was necessary in this probe.
The normal profile's existing registrations and cache were not used.

## Checks

`python3 tests/contract/skill-references.py` fails when `WORKFLOW.md`, settings, measurement
profiles, the ticket template, documentation, Playwright README or DDEV host commands name a
private keytec skill or marketplace, and when a project skill named in `WORKFLOW.md` is missing.
Native installation and worker discovery of the public pins remain unverified (waived for this
change); the project skills load from the checkout.
