# Agent skill loading: define a skill once

Date: 2026-11-09. Scope: BAKERS-131. Status: **proposed**, awaiting the owner's acceptance. This maintainer record is excluded from the public manual by `SRC_EXCLUDE`.

The approved scope is the ticket's spec `5fa2cbe2-0646-4a36-956b-2ff19af2a894`, plan `bdf5f162-5f4d-4b3d-9115-9b7e8fe71b9c` and test `eb5760e1-40bc-4deb-bd0e-46627648d223`. Execution results and the final revision are in the typed coding handoff on the ticket.

## Decision

Build on the agents' **native skill loading**. Do not build our own loading mechanism, and do not run `npx skills` inside runs.

- A project or machine declares each skill collection **once**, as a pinned Git source (`repo` + `ref`), in a new top-level `skills` list of `conductor.config.js` or `machine.config.js`.
- The conductor resolves each entry once per machine to a read-only checkout keyed by the resolved commit. Before each run it places that checkout's skills where the run's agent looks natively:
  - `.agents/skills/<name>` in the worktree serves Codex, pi, OpenCode, Grok and Kimi.
  - `.claude/skills/<name>` serves Claude Code.
- An agent addon may choose a **plugin-native** route instead when the collection ships that agent's plugin manifest and the plugin logic matters (hooks, namespaced names). Examples: Claude `--plugin-dir <checkout>`, pi `-e <extension>`.
- The bar is **skill parity**: the same `SKILL.md` set under the same names in every agent. Hooks, MCP entries and settings stay native where an agent supports them and are listed as gaps elsewhere.

A playground proof ran Claude Code and Codex through the conductor with superpowers v7.0.0 declared once ([Proof](#proof)).

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
- **Names.** In Claude a plugin skill is `plugin:skill`. A skill placed in a skill directory is bare in every agent. A body reference such as `superpowers:brainstorming` therefore names nothing literally outside a Claude or Codex plugin install. The agent maps it by description. The Codex proof run shows this mapping for bare names ([Proof](#proof)). No surveyed tool rewrites such references. Two rules keep names stable:
  - Write cross-references bare (`brainstorming`), as mattpocock-skills and our recipes already do.
  - Keep a collection's skill names unique across collections, because a bare install has no namespace to separate them.
  - The three `bakers:` references in our own bundle are follow-up work.
- **`npx skills`** carries plain skills only. It does carry pinning (`owner/repo@ref` plus `skills-lock.json`). It does not carry the namespace, hooks, MCP or settings.

## Existing cross-agent tools

| Tool | Agents | Carries | Pinning | Status | Fit |
|---|---|---|---|---|---|
| [`npx skills`](https://github.com/vercel-labs/skills) (vercel-labs) | about 79, including all six | `SKILL.md` folders; reads `.claude-plugin` manifests for discovery | `@ref`, `skills-lock.json` | 38.6k stars, v1.7.6 (2026-11-03), MIT | Good for humans installing skills; in a run it needs npm and network and writes into agent folders. Its layout (`.agents/skills` + symlinks) is the one we adopt. |
| [dotagents](https://github.com/getsentry/dotagents) (Sentry) | Claude, Cursor, Codex, Copilot, Grok, VS Code, OpenCode, pi | skills, MCP, subagents, whole plugins (Agent Plugins v1); hooks only for Claude, Cursor, VS Code | `agents.toml` + `agents.lock` | 261 stars, 3.4.0 (2026-10-20), MIT | The only tool that carries plugins across agents with a lockfile; worth a follow-up evaluation as the resolver behind our `skills` list. |
| [rulesync](https://github.com/dyoshikawa/rulesync) | dozens | rules, MCP, commands, subagents, skills, hooks per tool | none | 1.6k stars, very active, MIT | Generator of committed per-tool files; heavier than we need. |
| [ruler](https://github.com/intellectronica/ruler) | about 30 | rules, MCP, experimental skills | none | 3.0k stars, beta, MIT | Rules focus. |
| [openskills](https://github.com/numman-ali/openskills) | AGENTS.md readers | skills plus an AGENTS.md index | none | 10.8k stars, idle since January | Superseded by native loading. |
| [skillport](https://github.com/gotalab/skillport) | MCP clients | skills served over MCP | none | 421 stars | Is option 3 as a product. |
| [acplugin](https://github.com/TokenRollAI/acplugin) | Claude plugin → Codex, OpenCode, Cursor, pi | one-shot conversion; hooks native only on Codex | none | 58 stars, no releases | One-shot, no update path. |
| [agentskills.io](https://agentskills.io) | spec | the `SKILL.md` format only | — | — | The shared format every agent reads. |

Superpowers, ponytail and mattpocock-skills use no sync tool: each upstream ships a native manifest per agent. Their docs send every other agent to `npx skills`.

## Options

| | 1. Native placement per agent | 2. One shared native location | 3. Own conductor-served mechanism |
|---|---|---|---|
| Shape | Conductor places each declared collection where the run's agent looks (`.agents/skills`, `.claude/skills`, `--skill`, `--plugin-dir`) | Only `.agents/skills`, with adapters where an agent does not read it | Skill index in the run prompt and a "load skill" tool on the conductor's MCP server |
| Coverage | all six | five; Claude Code needs an adapter, pi needs trust or `--skill` | every agent with MCP; the skill is not a native skill |
| Sandbox | links in the worktree, read-only targets; no new grants | same | none; served by the tool server |
| Update path | change `ref`, restart the conductor; next run uses it | same | same |
| Versioning | pinned `ref`, resolved commit recorded per run | same | same |
| Plugin logic | native per agent where the addon picks the plugin route | lost unless adapters add it | lost: no hooks, no description-based auto-trigger, no Skill-tool semantics |
| What breaks | pi project skills without trust (solved by `--skill`); `plugin:skill` references outside plugins | Claude Code sees nothing without the adapter | progressive disclosure is reimplemented; agents load by our tool instead of their own; every agent's skill UI shows nothing |

Option 2 is option 1 with one placement for most agents. The recommendation keeps that placement as the default, so 1 and 2 merge. Option 3 duplicates what all six agents already do natively and loses auto-triggering and plugin logic.

## Recommendation

**Option 1 with option 2's shared directory as the default placement.** It builds on the agents' native skill and plugin systems, not on `npx skills`. It adopts `npx skills`' canonical layout (`.agents/skills` plus links) and its pin-by-ref idea. dotagents is the candidate to evaluate as the resolver later.

### Addon sketch

Declaration, once per project (or per machine in `machine.config.js`, merged with the project's list):

```js
// .bakers/conductor.config.js
export default {
  skills: [
    { repo: 'https://github.com/obra/superpowers.git', ref: 'v7.0.0' },
    { repo: 'https://github.com/mattpocock/skills.git', ref: 'v1.3.2' },
  ],
};
```

Conductor core (a `skills` slot, one addon):

1. On start, resolve each entry to `~/.bakers/skills/<host>/<owner>/<repo>@<sha>` (shallow fetch, read-only), and record the resolved commit. Skill directories are every directory under the checkout that holds a `SKILL.md`; a `skills` path may narrow it.
2. Before each run (after `after_create`), hand the agent addon the resolved list. Collisions between collections fail the run start with both names.
3. Write the resolved commits into the run record, so a run's skill set is traceable.

Each agent addon implements one optional method, `placeSkills(collections, worktree) → { links, args }`:

| Addon | Placement |
|---|---|
| claude | links into `.claude/skills/`; or `--plugin-dir <checkout>` when the checkout carries `.claude-plugin/plugin.json` and hooks or the namespace matter |
| codex | links into `.agents/skills/` |
| pi | `--skill <dir>` per skill (bypasses project trust); optional `-e <extension>` when upstream ships a pi extension |
| opencode, grok, kimi | links into `.agents/skills/` |

Links go into `info/exclude`, as the playground's `after_create` already does for `.claude/skills`. A project that already declares a collection natively, such as this repository's `.claude/settings.json` marketplaces, keeps working; the `skills` list adds the other agents.

### Follow-up tickets

1. Conductor `skills` slot: declaration in both config files, resolver and cache, run-record commit, collision check.
2. `placeSkills` in the claude, codex and pi addons, with the pi `--skill` route.
3. `placeSkills` in the opencode, grok and kimi addons.
4. Replace the three `bakers:` references in the `bakers` bundle with bare names.
5. Evaluate dotagents as the resolver and plugin projector, especially for hooks.
6. Install docs: `docs/skills-and-workflows/skills.md` names the `skills` list and adds the missing pi path.
7. Repeat the proof on pi once its addon is enabled on a conductor machine, using the `--skill` route (not proven here).

## Proof

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
- **Same-name duplicates appear in Codex.** When a collection is both a global plugin and a placed directory, Codex lists both. The `skills` slot should be the single source per machine; a global plugin install of the same collection is redundant.
- **Folder trust blocks a fresh worktree.** Both agents stopped at their folder-trust prompt (Claude "Is this a project you trust?"; Codex "Trust this folder?", saved for the repository root) until the owner confirmed it in the herdr pane. This gates the run itself, not only its skills, and predates this spike. The skills slot does not change it, but a new worktree root needs a trust grant once per agent.
- **Claude's Skill tool strips the frontmatter.** Claude opened the file separately to read `name`; the skill body itself loaded through the native tool.
