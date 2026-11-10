# Sandboxed runs deliver through forge tools, not trusted CLIs

- **Status:** Approved by the owner 2026-11-10
- **Scope:** agent runs in `sandbox` mode, their delivery (fetch, push, PR/MR, checks, merge), and the credentials this needs

## Decision

A sandboxed run gets no global tools. It does not trust `git`, `gh` or `glab`. Whatever it needs
beyond its worktree comes through conductor tools that an addon serves, as with `ports`, `ddev` and
`provision_up`. For delivery, a future `forge` interface addon provides the tools, with one
backend per hosting service: `forge-github` and `forge-gitlab`. Its layout follows `ports` with
`ports-frp` and `ports-cloudflare`.

The agent commits on its own, locally in the sandbox, with repository hooks running as usual. It
holds no key and no token. Every operation that needs the network or a credential is a tool call:

| Tool | Does | Limits enforced by the tool |
|---|---|---|
| `forge_fetch` | Fetches the parents into the local clone: the ticket's `base_branch` and the branches of parent-linked tickets. The agent then rebases or pulls locally with `git`, offline. | Read only. |
| `forge_push` | Pushes an owned branch. | Owned branches only. Hooks and repository config are disabled. `--force-with-lease` is allowed, bare `--force` never. |
| `forge_pr_upsert` | Creates the PR/MR, or updates its title and description. | Rejects a title that is not a Conventional Commits subject right away. |
| `forge_checks` | Reads the status of checks and pipelines. | Read only. |
| `forge_merge` | Merges the PR/MR of an owned branch into its `base_branch`, or a variant branch into the ticket branch. | Owned branches only, and only with green required checks. |

**Owned branches** are the ticket's `branch_name` and `<branch_name>-<suffix>` (variants). The tool
refuses every other name. Neither GitHub nor GitLab can limit a token to a branch pattern, so the
tool enforces this pattern.

Human approval before a merge stays a workflow rule (the merge gate), not a tool gate.

**Backends.** `forge-github` uses a GitHub App installation token. `forge-gitlab` uses a Project
Access Token with role Developer and an expiry date. The tokens live only with the conductor.

## Until the forge addon exists

A sandboxed run that has to push or open a PR/MR needs explicit trusted commands on the project
or machine layer, for example `trusted_commands: ['bakers', 'git', 'gh']` (or `glab`). This
repository pins `bakers` and `git` in `.bakers/project.config.js`. Every such entry runs outside
the sandbox with the operator's full rights; see [Run security](/provision/security/execution).

The addons now exist: [Forge](/addons/forge) with [Forge for GitHub](/addons/forge-github) or
[Forge for GitLab](/addons/forge-gitlab). With them configured, no trusted `git`, `gh` or `glab` is
needed for delivery; this section stays the fallback for a project without them.

## The key is `permissions`, not `security`

The mode key (`sandbox`, `system`, `yolo`, `custom`) chooses the rights a harness starts with. It
is not a security level: harness sandboxes differ in strength, and none of them is a boundary for
the host. With `system` as the default, bakers.build sets no flag and promises nothing, so the key
is named `permissions` on agent entries and in the machine and project blocks, e.g.
`permissions: { mode: 'sandbox', sandbox: { trusted_commands: ['bakers', 'git'] } }`. `security`
fails loading with a message that names `permissions`. There is no alias, because two keys for
one setting would need a precedence rule.

## Network

`network: ['*']` stays the sandbox default. Without a credential in the sandbox, open egress can
neither push nor authenticate to the hosting service. Narrowing egress is a follow-up once forge
tools cover delivery.

## Secrets and Vault

No separate Vault addon for now. Forge backends read their token from the conductor's config or
environment. A `secrets` interface with a Vault backend comes only when a second addon needs
credentials. Then it can serve both without changing the tools.

## Rejected alternative

Trusting `gh` or `glab` in the sandbox. A trusted CLI runs outside the sandbox with the operator's
full credentials, and it can reach any branch and any repository those credentials reach. One
prompt injection in ticket content is then enough to push to `main` or to another project.

## Follow-ups

1. Build the `forge`, `forge-github` and `forge-gitlab` addons.
2. Switch the delivery and merge references to the forge tools.
3. Then remove `git` from this repository's trusted commands.
4. Narrow the sandbox's `network` default.

## Related

BAKERS-154 (this decision), BAKERS-28 (trusted commands in Codex), BAKERS-103 (shared sandbox
settings), BAKERS-77, BAKERS-80, BAKERS-98 (conductor tools for ports and DDEV).
