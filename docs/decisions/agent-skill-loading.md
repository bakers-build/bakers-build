# Agent skill loading: define a skill once

Date: 2026-11-09. Scope: BAKERS-131. Status: **proposed**, awaiting the owner's acceptance. This maintainer record is excluded from the public manual by `SRC_EXCLUDE`.

The approved scope is the ticket's spec `5fa2cbe2-0646-4a36-956b-2ff19af2a894`, plan `bdf5f162-5f4d-4b3d-9115-9b7e8fe71b9c` and test `eb5760e1-40bc-4deb-bd0e-46627648d223`. Execution results and the final revision are in the typed coding handoff on the ticket.

## Decision

Use each harness's **own plugin installation**, but into a **run-scoped agent home**, never into the user's home. Do not build our own loading mechanism, and do not run `npx skills` inside runs. It must work for every project that uses bakers.build, with whatever plugins it brings (hooks, namespaced skills, MCP), not only for our own skills.

- The **project** declares each plugin **once**, as a pinned Git source (`repo` + `ref`), in a new top-level `plugins` list of its committed `conductor.config.js`. A committed lock file, `.bakers/plugins.lock.json`, records each entry's resolved commit and content hash. There is **no machine-level declaration**: every machine that runs the project's tickets runs the same plugins at the same version. This includes the `bakers` skills.
- The conductor fetches each locked commit into a local cache and verifies it against the lock; a mismatch fails the run start.
- **Every agent addon implements `installPlugins`.** Before the run, the addon (not the model) builds an agent home for this lock state, installs the locked plugins there with the harness's own command, and starts the agent with that home. Plugin features work as the harness defines them, and the user's own installed plugins are not visible in the run.
- Where a harness cannot carry a plugin feature (for example hooks on Kimi), the run start names the gap instead of losing it silently. The plugin's skills still reach every harness through the shared `SKILL.md` format.

Two playground proofs back this ([Proof](#proof)):

1. Skills placed from one declaration reached Claude Code and Codex.
2. A plugin with a hook and namespaced cross-references, installed nowhere in user space, loaded fully:
   - **Claude Code:** from project settings.
   - **Codex:** from a run-scoped `CODEX_HOME`. Project settings alone failed.

## Survey per agent

Installed versions: Claude Code 2.1.319, Codex CLI 0.167.0, pi 1.4.0, OpenCode 2.2.5 and Grok Build 1.0.70. Kimi CLI is **not installed**, so its column comes from its documentation and is unverified locally.

| | Claude Code | Codex | pi | OpenCode | Grok Build | Kimi |
|---|---|---|---|---|---|---|
| Native project dir | `.claude/skills` | `.agents/skills` | `.pi/skills` | `.opencode/skills` | `.grok/skills` | `.kimi/skills` |
| Reads `.agents/skills` | no | yes | yes | yes | yes | yes |
| Reads `.claude/skills` | yes | no | no | yes | yes | yes |
| Walks up to the repo root | yes | yes | yes (`.agents`) | yes | yes | root only |
| Index at start, body on demand | yes, Skill tool | yes, file read | yes, file read | yes, `skill` tool | yes, preamble | yes, file read |
| Agent Skills `SKILL.md` (`name`, `description`) | yes, plus extensions | yes, plus `agents/openai.yaml` | yes, enforces the spec limits | yes, limits not enforced | yes, plus extensions | yes, plus `type: flow` |
| Plugins bundle skills, hooks and MCP | yes | yes | pi packages (extensions and skills) | JS plugins | yes | tools only |
| Installs a `.claude-plugin` marketplace | native | yes | no | no | yes, and reuses `~/.claude/plugins` | no |
| Plugin skill name | `plugin:skill` | plugin is the namespace | bare | bare | `plugin:skill` on collision | bare |
| Extra dirs or home | `--add-dir`, `--plugin-dir`, `CLAUDE_CONFIG_DIR` | `CODEX_HOME`, `[[skills.config]]` | `--skill`, `PI_CODING_AGENT_DIR` | config `skills`, `OPENCODE_CONFIG_DIR` | `[skills].paths`, `GROK_HOME`, `--add-dir` | `--skills-dir`, `extra_skill_dirs` |
| Trust gate for project skills | workspace trust | none documented | yes, `-a/--approve` | `skill` permission rules | folder trust, `--trust` | none documented |

Notes:

- **Claude Code**: personal `~/.claude/skills`, project `.claude/skills` (walks up; a linked worktree without skills falls back to the main checkout), `--add-dir` directories and plugins. It does not read `.agents/skills`. In `sandbox` and `system` mode the claude addon passes `--setting-sources project,local`. Plugins enabled only in user settings therefore do not load in a run, while project `extraKnownMarketplaces` do. Sources: [skills](https://code.claude.com/docs/en/skills), [plugin marketplaces](https://code.claude.com/docs/en/plugin-marketplaces).
- **Codex**: repo `.agents/skills` from the working directory up to the repo root, user `~/.agents/skills`, admin `/etc/codex/skills`. It follows symlinks. Same-name skills are not merged. Codex installs Claude-format marketplaces: on this machine the `designbook` and `keytec` marketplaces ship only `.claude-plugin` manifests and are installed. Sources: [skills](https://learn.chatgpt.com/docs/build-skills), [plugins](https://developers.openai.com/codex/plugins/build).
- **pi**: user `~/.pi/agent/skills`, `~/.agents/skills`, project `.pi/skills` and `.agents/skills` up to the repo root, and `--skill <path>`. Project skills require trust: `-a`, a saved grant, or `defaultProjectTrust: "always"`. Non-interactive runs skip untrusted resources, and the pi addon's `approve` option is off by default, so in a run **only `--skill` or a user directory is reliable**. Names must match `[a-z0-9-]{1,64}`. Source: the docs bundled with `@earendil-works/pi-coding-agent` 1.4.0 (`docs/skills.md`, `docs/security.md`), [pi.dev](https://pi.dev).
- **OpenCode**: `.opencode/skills`, plus compatibility reads of `.claude/skills` and `.agents/skills` (project and home), walking up. Skills load through the `skill` tool. Sources: [skills](https://opencode.ai/docs/skills/), [plugins](https://opencode.ai/docs/plugins/).
- **Grok Build** (xAI's official CLI, not the community `grok-cli`): `.grok/skills` and `.agents/skills` at each tier, plus Claude compatibility for `.claude/skills` and installed Claude plugins. `grok inspect --json` in this repository lists 156 skills, including those from `~/.claude/plugins/cache`. Project skills are behind folder trust. Source: the user guide bundled under `~/.grok/docs` (no public URL found).
- **Kimi**: `.kimi/skills`, `.claude/skills`, `.codex/skills`, then `.agents/skills` at the project root, plus user equivalents. `--skills-dir` *replaces* discovery; `extra_skill_dirs` adds to it. Plugins are executable tools only. Sources: [skills](https://moonshotai.github.io/kimi-cli/en/customization/skills.html), [plugins](https://moonshotai.github.io/kimi-cli/en/customization/plugins.html).

All six read the shared format and load progressively: the name and description at session start, the body on demand. Only the locations differ. Two directories reach every agent: `.agents/skills` (five agents) and `.claude/skills` (Claude Code).

## Plugins and plain skills

| Plugin | Skills | Plugin-only logic | Namespaced references in bodies |
|---|---|---|---|
| `bakers` 0.61.2 | 14 | none: no hooks, MCP or settings; the `bakers` MCP server comes from the CLI | 3 `bakers:` references; the recipes name matt and superpowers skills **bare** (`grilling`, `brainstorming`) |
| superpowers 7.0.0 | 15 | SessionStart hook that injects `using-superpowers` | 41 (11 distinct) `superpowers:*` |
| mattpocock-skills 1.3.2 | 27 | none | 0, bare by policy |
| designbook (`a4fea9d`) | 21 + sub-plugins | none | 1 |
| ponytail 5.3.2 | 6 | SessionStart, SubagentStart and UserPromptSubmit hooks, a Claude UI module, `userConfig` with a keychain token | 3 |

- **Plain skills** (every `SKILL.md` directory, with its references and scripts) travel to any agent through a skill directory or `npx skills`.
- **Plugin-only logic** does not: hooks, MCP entries, settings (`userConfig`, a project's `enabledPlugins` such as disabling `bakers@bakers` in this repository) and marketplace version pinning. None of our plugins ships MCP. Hooks are the real gap: superpowers and ponytail need per-agent code, and both upstreams already ship it (an OpenCode JS plugin, a pi extension, `.codex-plugin`).
- **Names.** A plugin installed through the harness's own plugin system keeps its namespace: round 2 resolved `bb-probe:probe-alpha` → `bb-probe:probe-beta` in Claude Code and in Codex ([Proof](#proof)). A skill placed as a bare folder has no namespace in any agent, so `superpowers:brainstorming` names nothing literally there and the agent can only map it by description. No surveyed tool rewrites such references. For skills that must also work on a harness without plugins:
  - Write cross-references bare (`brainstorming`), as mattpocock-skills and our recipes already do.
  - Keep skill names unique across plugins, because a bare install has no namespace to separate them.
  - The three `bakers:` references in our own bundle are follow-up work.
- **`npx skills`** carries plain skills only. It does carry pinning (`owner/repo@ref` plus `skills-lock.json`). It does not carry the namespace, hooks, MCP or settings.

## Existing cross-agent tools

| Tool | Agents | Carries | Pinning | Status | Fit |
|---|---|---|---|---|---|
| [`npx skills`](https://github.com/vercel-labs/skills) (vercel-labs) | about 79, including all six | `SKILL.md` folders; reads `.claude-plugin` manifests for discovery | `@ref`, `skills-lock.json` | 38.6k stars, v1.7.6 (2026-11-03), MIT | Good for humans installing skills; in a run it needs npm and network and writes into agent folders. Its layout (`.agents/skills` + symlinks) is the floor for harnesses without plugins. |
| [dotagents](https://github.com/getsentry/dotagents) (Sentry) | Claude, Cursor, Codex, Copilot, Grok, VS Code, OpenCode, pi | skills, MCP, subagents, whole plugins (Agent Plugins v1); hooks only for Claude, Cursor, VS Code | `agents.toml` + `agents.lock` | 261 stars, 3.4.0 (2026-10-20), MIT | The only tool that carries plugins across agents with a lockfile; worth evaluating as the per-harness projector behind `installPlugins`. |
| [rulesync](https://github.com/dyoshikawa/rulesync) | dozens | rules, MCP, commands, subagents, skills, hooks per tool | none | 1.6k stars, very active, MIT | Generator of committed per-tool files; heavier than we need. |
| [ruler](https://github.com/intellectronica/ruler) | about 30 | rules, MCP, experimental skills | none | 3.0k stars, beta, MIT | Rules focus. |
| [openskills](https://github.com/numman-ali/openskills) | AGENTS.md readers | skills plus an AGENTS.md index | none | 10.8k stars, idle since January | Superseded by native loading. |
| [skillport](https://github.com/gotalab/skillport) | MCP clients | skills served over MCP | none | 421 stars | Is option 3 as a product. |
| [acplugin](https://github.com/TokenRollAI/acplugin) | Claude plugin → Codex, OpenCode, Cursor, pi | one-shot conversion; hooks native only on Codex | none | 58 stars, no releases | One-shot, no update path. |
| [agentskills.io](https://agentskills.io) | spec | the `SKILL.md` format only | — | — | The shared format every agent reads. |

Superpowers, ponytail and mattpocock-skills use no sync tool: each upstream ships a native manifest per agent. Their docs send every other agent to `npx skills`.

## Options

| | 1. Place skill folders per agent | 2. Native plugin install into a run-scoped agent home | 3. Own conductor-served mechanism |
|---|---|---|---|
| Shape | Conductor links each declared collection's `SKILL.md` folders where the run's agent looks (`.agents/skills`, `.claude/skills`, pi `--skill`) | Each agent addon installs the declared plugins with the harness's own command into an agent home for this lock state and starts the agent with it | Skill index in the run prompt and a "load skill" tool on the conductor's MCP server |
| Coverage | skills in all six | full plugins where the harness has a plugin system (Claude, Codex, pi, OpenCode, Grok); skills only on Kimi | every agent with MCP; the skill is not a native skill |
| Plugin logic | lost: no hooks, no `plugin:skill` names, no MCP | native: hooks, namespaces and MCP as the harness defines them | lost |
| User-space plugins | visible unless hidden per agent | not visible: the run uses its own home | visible |
| Sandbox | links in the worktree | the home is written by the addon before launch, outside the agent's sandbox; the agent reads it | none |
| Update path | change `ref`, relock, commit | same; a new lock state builds a new home | same |
| Versioning | committed lock, verified per run | same | same |
| What breaks | every plugin that relies on hooks or namespaced references (superpowers, ponytail) | per-harness work: login, folder trust and transcript paths must follow the home | progressive disclosure is reimplemented; no auto-trigger; no plugin logic |

Option 1 is what `npx skills` does: it works for plain skills and fails for plugins. bakers.build projects bring arbitrary plugins, so option 1 alone is not enough. It stays the floor for harnesses without a plugin system. Option 3 duplicates what every harness already does natively.

## Recommendation

**Option 2, with option 1 as the floor.** Each agent addon implements `installPlugins`. It builds on the harnesses' own plugin systems, isolated per run, not on `npx skills`. dotagents already projects one plugin into each harness's format and is the candidate to evaluate before writing every addon's install by hand.

### Addon sketch

Declaration, once, in the project's committed config:

```js
// .bakers/conductor.config.js
export default {
  plugins: [
    { repo: 'https://github.com/bakers-build/bakers-build.git', ref: 'v0.61.2' },
    { repo: 'https://github.com/obra/superpowers.git', ref: 'v7.0.0' },
    { repo: 'https://github.com/mattpocock/skills.git', ref: 'v1.3.2' },
  ],
};
```

`bakers config plugins lock` resolves every `ref` to its commit and writes `.bakers/plugins.lock.json` (commit and content hash per entry), which is committed beside the config. A version change means changing the `ref`, relocking and committing both, through the project's normal review. The bakers.build repository declares its own bundle as a worktree path (`{ path: '.claude/skills/bakers-build' }`), so a run tests the branch's sources.

Conductor core:

1. Before each run, fetch each locked commit into a content-addressed cache (`~/.cache/bakers/plugins/<sha>`, read-only) unless it is already there, and verify it against the lock. A missing entry, a moved `ref` or a hash mismatch fails the run start.
2. Call the agent addon's `installPlugins(lockedPlugins, runHome) → { env, args }`. The conductor knows nothing else about the harness.
3. Record the locked commits in the run record.
4. Fail the run start when a skill named by `WORKFLOW.md` or the ticket's recipe is missing from the installed set.

**Every security mode.** `installPlugins` runs in every mode (`sandbox`, `system`, `custom`, `yolo`): the mode decides what the agent may do, the plugin set decides what it has, and that set is the same for every run of the project. The install runs in the addon before launch, outside the agent's sandbox, so the mode does not affect it. It can be switched off per agent (`plugins: false` in the agent's options); the agent then starts with its normal home and whatever is installed there, and the run start says so.

**Homes.** A harness writes runtime state into its home as well as plugins (the Codex run home held SQLite databases, sessions and logs), so two runs must never share a writable home. Two levels:

| Level | Path | Content | Lifetime |
|---|---|---|---|
| Plugin state, per harness and lock hash | `~/.cache/bakers/agent-homes/<harness>/<lock-hash>/` | the plugins as the harness's own install command lays them out | built once, then read-only; shared by every run with the same lock |
| Run home, per run | `<worktree>/.bakers/agent-home/<harness>/` (in `info/exclude`) | links to the plugin state, a link to the credential file in the user's real home, folder trust for this worktree, and the run's own sessions, databases and transcript | the run; removed with the worktree |

- **Parallel versions:** different lock states (two projects, or two branches of one project) have different hashes, so their plugin states sit side by side and their runs never meet.
- **Readable in the sandbox:** both levels stay outside `~/.bakers`, which the agent sandbox denies reading. Agents read skill files and run skill scripts from the sandbox (Codex read `SKILL.md` with a shell command in the proof).
- **Transcripts:** the addon reads the run's transcript from the run home at a known path (`getRunLog`, `sessionExists`), instead of scanning `~/.claude/projects` or `~/.codex/sessions`.
- **Not yet proven:** two concurrent runs at different lock states, and whether each harness accepts linked instead of copied plugin directories. Follow-ups 3 and 4 prove both per harness.

Each agent addon implements `installPlugins`. Its pieces:

- **Install:** the harness's own command into the plugin state, from the local cached checkout, with no network.
- **Login:** link only the harness's credential file from the user's real home. Nothing else from the user's home is visible.
- **Trust:** pre-grant folder trust for the run's worktree. Both harnesses stopped at a trust prompt in the proof.

**Standard tool or own code.** `installPlugins` is the abstraction, and a standard tool can sit behind it where one fits. dotagents is the closest. It installs into one home directory, which fits a run home if it honours a redirected home. It does not carry hooks to Codex, and its project mode writes project config, which Codex ignores for plugins (round 2). The harness's own install commands are proven for Codex and Claude Code. dotagents is evaluated as a backend in follow-up 6; nothing in the contract depends on it.

| Addon | Home | Install | Hooks | Proof |
|---|---|---|---|---|
| claude | `CLAUDE_CONFIG_DIR` | `extraKnownMarketplaces` + `enabledPlugins` in the run's `--settings` (or `--plugin-dir <checkout>`), with `CLAUDE_CODE_SYNC_PLUGIN_INSTALL=1` | native | **passed** from project settings (round 2); the `--settings`/`CLAUDE_CONFIG_DIR` form is still to prove |
| codex | `CODEX_HOME` | `codex plugin marketplace add <checkout>`, `codex plugin add <plugin>@<marketplace>` | need trust: `--dangerously-bypass-hook-trust`, meant for "automation that already vets hook sources", which the lock does | **passed** with a run-scoped `CODEX_HOME` (round 2); project `.codex/config.toml` alone **failed** |
| pi | `PI_CODING_AGENT_DIR` | `pi install <checkout>` for a pi package (extension + skills); `--skill <dir>` for plain skills | via the plugin's pi extension | not proven |
| opencode | `OPENCODE_CONFIG_DIR` | `opencode plugin add` / config `plugins` | via the plugin's OpenCode JS plugin | not proven |
| grok | `GROK_HOME` | `grok plugin install <checkout> --trust` (reads `.claude-plugin`) | native, trust at install | not proven |
| kimi | `--skills-dir` | plain skills only | none: named as a gap at run start | not proven |

A plugin that ships no manifest for a harness falls back to option 1 on it: its `SKILL.md` folders go into the home's skill directory, and the missing hooks or MCP are named at run start. Skills cross-reference each other by bare name where they must work everywhere; namespaced references resolve only where the harness installs the plugin.

### Follow-up tickets

1. Conductor `plugins` slot: project declaration, `plugins.lock.json` and the lock command, verified cache, run-record commit, `installPlugins` call.
2. Required-skill check: fail the run start when a skill named by `WORKFLOW.md` or the recipe is missing.
3. `installPlugins` in the claude and codex addons: plugin state and run home, credential link, trust pre-grant, transcript paths, `plugins: false`; Codex with `--dangerously-bypass-hook-trust`. Proof includes two concurrent runs at different lock states.
4. `installPlugins` in the pi, opencode, grok and kimi addons, each with the same proof.
5. Ship the `bakers` skills through the `plugins` list at a pinned version instead of the per-machine `bakers@bakers` plugin; add the manifests other harnesses need; replace its three `bakers:` references with bare names.
6. Evaluate dotagents as the per-harness projector before writing installs by hand.
7. Install docs: `docs/skills-and-workflows/skills.md` names the `plugins` list and lock and drops per-machine installs for runs.

## Proof

### Round 1: skill folders from one declaration

**Setup.** Playground conductor `cw-framework-bakers-e2e-project-conductor` (`provision_up('conductor-e2e')`), built from this branch, 2026-11-09. A throwaway spike in the playground's own `conductor.config.js`, not merged, did the following:

1. Declared one collection: superpowers `v7.0.0` (commit `bb92a77`, cloned to `workspaces/skill-sources/superpowers`).
2. Extended `after_create` to link every skill directory of that checkout into the worktree's `.agents/skills/` and `.claude/skills/`, both excluded through `info/exclude`.
3. Replaced the run prompt with a proof prompt: list the superpowers skills, load `verification-before-completion` through the agent's own skill mechanism, and report the loaded `SKILL.md` path, its frontmatter `name` and its first heading verbatim.

On this machine superpowers is also enabled globally for both agents: the Claude user plugin `superpowers@claude-plugins-official` and the Codex plugin `superpowers@superpowers-dev`. The evidence that counts is therefore the **path** each agent loaded.

| Agent | Ticket, run | Result |
|---|---|---|
| Claude Code 2.1.319 (`opus`) | GLE2E-7, run `7b184007-82dd-4e9a-a2f6-e56ed4eea67f` | **PASS**. Listed all 15 superpowers skills under bare names. Skill tool call `{"skill":"verification-before-completion"}`; the tool reported `Base directory for this skill: …/gle2e-7-skill-proof-super/.claude/skills/verification-before-completion`. The answer named the link target `…/skill-sources/superpowers/skills/verification-before-completion/SKILL.md`, `name: verification-before-completion` and `# Verification Before Completion`. |
| Codex CLI 0.167.0 (`codex`, label `agent:codex`) | GLE2E-9, run `777b2a1f-dd92-4dc0-ba48-5403139738bd` | **PASS**. Listed the 15 skills "across both listed locations" (global plugin and repo copy). It read `…/gle2e-9-skill-proof-super/.agents/skills/verification-before-completion/SKILL.md` and answered with that path, `name: verification-before-completion` and `# Verification Before Completion`. |
| pi 1.4.0 | not run | pi is not in this machine's agent catalog (`bakers agents`: `opus`, `sonnet`, five Codex aliases, `grok`). Enabling it means editing `~/.bakers/machine.config.js`, which a run cannot do. |

Findings from the proof:

- **The declared copy wins over the global plugin.** Claude's `--setting-sources project,local` keeps user plugins out of the run, so only the placed copy was visible. Codex saw both copies and chose the repository one.
- **Same-name duplicates appear in Codex.** When a collection is both a user-scope plugin and a placed directory, Codex lists both and may pick either. A run-scoped home removes the user-scope copy (round 2).
- **Folder trust blocks a fresh worktree.** Both agents stopped at their folder-trust prompt (Claude "Is this a project you trust?"; Codex "Trust this folder?", saved for the repository root) until the owner confirmed it in the herdr pane. A run-scoped home must pre-grant trust for the worktree.
- **Claude's Skill tool strips the frontmatter.** Claude opened the file separately to read `name`; the skill body itself loaded through the native tool.
- **Round 1 does not test plugin logic.** Superpowers' SessionStart hook and its `superpowers:` references were not checked, and the bare folders cannot carry them. Round 2 does.

### Round 2: a plugin installed nowhere in user space

**Fixture.** A throwaway plugin `bb-probe` 0.1.0 (local Git repo, tag `v0.1.0`, commit `43012c2`, under `workspaces/skill-sources/bb-probe`, not merged). It ships a Claude marketplace (`.claude-plugin/`) and a Codex marketplace (`.agents/plugins/`, `.codex-plugin/`), both named `bb-probe-market`. Its contents:

- A SessionStart hook that injects `BB-PROBE-HOOK-7731: the bb-probe SessionStart hook ran.` and appends a line with `CLAUDE_PLUGIN_ROOT` to `.bb-probe-hook.log` in the working directory.
- Skill `probe-alpha` (canary `ALPHA-4410`), which tells the agent to load `bb-probe:probe-beta` next.
- Skill `probe-beta` (canary `BETA-9925`).

No harness on this machine had `bb-probe` installed. The proof prompt asked for the `bb-probe` skills by their harness names, whether `BB-PROBE-HOOK` was in the session context, and to load `bb-probe:probe-alpha` and follow it.

| Harness | Route | Run | Result |
|---|---|---|---|
| Claude Code 2.1.319 | conductor run; `after_create` wrote `.claude/settings.local.json` with `extraKnownMarketplaces` (`directory` source = the pinned checkout) and `enabledPlugins` | GLE2E-10, run `e9c6e133-4bcd-4dac-b7c6-7c20c0a32293` | **PASS**. Listed `bb-probe:probe-alpha`, `bb-probe:probe-beta`. Hook text in the context as "SessionStart hook additional context"; `.bb-probe-hook.log` shows `root=…/skill-sources/bb-probe`. Skill tool `bb-probe:probe-alpha`, then `bb-probe:probe-beta`, both from `…/skill-sources/bb-probe/skills/…`; canaries `ALPHA-4410`, `BETA-9925`. No install prompt. |
| Codex CLI 0.167.0 | conductor run; `after_create` wrote a project `.codex/config.toml` with `[marketplaces.bb-probe-market]` (`source_type = "local"`) and `[plugins."bb-probe@bb-probe-market"] enabled = true` | GLE2E-11, run `f930ff8d-755c-4bc6-84bf-139e8365dab8` | **FAIL**. No `bb-probe` skills, no hook; the agent fell back to the user-scope superpowers 7.0.2. Codex loads a plugin only when it sits in `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>` **and** is enabled in `$CODEX_HOME/config.toml`, which `codex plugin add` writes. Project config and `-c …enabled=true` leave it "not installed". |
| Codex CLI 0.167.0 | `codex exec` in the GLE2E-11 worktree with a run-scoped `CODEX_HOME` (credential file linked from `~/.codex`; `codex plugin marketplace add <checkout>`; `codex plugin add bb-probe@bb-probe-market`; worktree trusted in that home) | direct harness run, 2026-11-09 | **PASS** for skills and names: listed `bb-probe:probe-alpha`, `bb-probe:probe-beta`; read both `SKILL.md` from `<CODEX_HOME>/plugins/cache/bb-probe-market/bb-probe/0.1.0/skills/…`; canaries `ALPHA-4410`, `BETA-9925`. The hook did not run: Codex requires persisted hook trust. |
| Codex CLI 0.167.0 | same, plus `--dangerously-bypass-hook-trust` | direct harness run, 2026-11-09 | **PASS** for the hook: "It appeared in a developer message in my session context: BB-PROBE-HOOK-7731: the bb-probe SessionStart hook ran."; `.bb-probe-hook.log` shows `root=<CODEX_HOME>/plugins/cache/bb-probe-market/bb-probe/0.1.0`. |

The Codex harness runs ran outside the conductor, because the codex addon cannot yet set `CODEX_HOME`; that is follow-up 3. Round 2 shows the harnesses' own plugin systems carry hooks and namespaces when the plugin is installed into the run's home with their own command. Project-level settings work for Claude and not for Codex.
