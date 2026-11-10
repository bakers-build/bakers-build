---
title: API keys and service accounts
description: Create personal keys or workspace service accounts for automation and verify their access.
---

# API keys and service accounts

Use your signed-in account to create a personal key for scripts, or ask a workspace administrator for a service account. A key acts with its account’s current permissions. The generated machine UUID identifies a host; it is not an authentication credential.

## Personal API keys

Every signed-in user creates, lists and revokes their own keys under **Account → API keys**. No administrator is involved.

| Fact | Value |
|---|---|
| Acts as | You, with your current ranks and permissions; a rank change applies on the next request |
| Sign-in type | Client credentials with the `bb:session` scope; tokens live 300 seconds; the client obtains another using the key |
| Lifetime | 90 days by default, at most 365 |
| Secret | Shown once, at creation; store it in an environment variable, never in a repository |
| Revocation | Immediate; every token issued for the key stops working in the same request |

After creation the dialog offers two ready snippets that reference the secret's environment variable: a prompt for your agent, and the CLI connection setup.

::: details Per CLI
```sh
export BAKERS_CONSUMER_SECRET=<the secret>
bakers config init --scope connection --auth-type client_credentials --client-id <client id> --secret-env BAKERS_CONSUMER_SECRET
```
:::

Use a personal key for CI jobs and scripts that should act as you. Revoke keys you no longer need and remove their copies from CI secrets. Leaving a team changes access on the next request but does not delete the key.

### Use a key as bearer on `/mcp`

A client that can only send a fixed header and cannot refresh a token, such as a bot reading its settings from an env file, may send the key itself to the MCP endpoint:

```http
POST /mcp
Authorization: Bearer <client id>:<secret>
```

The client id and secret are the two values the key dialog shows, joined by one `:`. A service account's key works the same way.

| Fact | Value |
|---|---|
| Acts as | The key's owner with their current permissions, exactly like a token from the key |
| Lifetime | The key's own: until it is revoked or disabled, its expiry date passes, or its owner is blocked. There is no 300-second token limit |
| Refused | Every such case, a wrong secret and an unknown key get `401` with `error="invalid_token"`; nothing falls back to anonymous access |
| Where | `/mcp` only. JSON:API and every other path still need an exchanged token |
| Token exchange | Unchanged; clients that refresh tokens keep doing so |

Every request checks the key again, so revoking it cuts the client off on its next call. Keep the header value as secret as the secret itself.

## Machine identities

For automation managed by a workspace, an authorized workspace administrator can open **Service accounts** in workspace settings, create an account bound to that workspace and one team, and issue its key. The supported workspace ranks are Guest or Contributor, and team roles Member or Reporter. These accounts cannot sign in through the human login flow. Manage or disable them through the browser; a bearer key cannot administer identities. Disabling the account invalidates its access. A Reporter can create tickets in its team's projects without broader ticket-edit rights.

**Verify:** use the issued credentials for a read in the intended project and confirm an unrelated project is denied. Never test with an administrator's credentials in their place.

A conductor on a server can use a client-credentials connection issued by the instance operator. Keep this identity separate from the host's generated `machine_id`. Its permissions depend on the account and token configuration; a secret does not grant unrestricted access.

| | Personal key | Service account |
|---|---|---|
| Created by | The user, self-service | An authorized workspace administrator |
| Acts as | That user | An account bound to one workspace and team |
| Typical use | CI, scripts, a second agent | Unattended conductor on a worker server |
| Where configured | Your CI secrets, `~/.bakers/connections/<id>.js` | The worker's connection file |

Setting up a worker with such a connection: [Set up a worker server](/provision/worker-server) and [Connections](/configuration/connection#client-credentials).

## Scopes and permissions

Both kinds sign in with the single `bb:session` scope. What a request may do is decided by the account's workspace rank and team membership on every call ([Who sees what](/provision/security/access-and-data#roles-and-permissions)), never by the key itself.

## Box credentials

A box is a machine that runs a conductor, and often the PM bot next to it. It holds the credentials below. The conductor checks them when it starts and every 6 hours, so an expiring credential is visible before a run or a Slack conversation fails.

| Credential | Where it lives | Lifetime | Renewed by | Without it | Expiry | Renewal |
|---|---|---|---|---|---|---|
| Claude Code login | `~/.claude/.credentials.json` on the box | Until signed out or revoked; a `claude setup-token` token (`CLAUDE_CODE_OAUTH_TOKEN`) lasts 1 year | Box operator | A run fails within minutes: `claude: not logged in (…) — run claude /login (on <box>)`; with no agent signed in the conductor stops claiming | Checked as `claude` (`claude auth status`); a setup token's date recorded as `claude` | `claude /login`, or `claude setup-token` and record the new date |
| Codex login | `~/.codex/auth.json` on the box | Until signed out or revoked | Box operator | A run fails within minutes with the same kind of reason | Checked as `codex` (`codex login status`); a date recorded as `codex` | `codex login --device-auth` |
| PM bot model credential | Coder parameter `pm_bot_anthropic_api_key` or `pm_bot_claude_oauth_token` | API key: until revoked; setup token: 1 year | Box operator | The bot answers "My model credential is not working; ask the box operator to renew it." | Recorded as `pm-bot-claude-oauth-token` (parameter `pm_bot_claude_oauth_token_expires_at`) | New key or `claude setup-token`, update the parameter |
| PM bot Slack bot and app tokens | Coder parameters `pm_bot_slack_bot_token`, `pm_bot_slack_app_token` | Until the app is uninstalled or the tokens are revoked | Slack workspace admin | The bot does not answer; the poller logs `Slack rejected SLACK_BOT_TOKEN` and waits 5 minutes between passes | Neither | Reinstall the Slack app, update both parameters |
| PM bot bakers.build client | Coder parameter `pm_bot_bakers_api_key` | The key's: 90 days by default, at most 365 | Workspace administrator | No posts, no tickets; the poller logs `bakers.build rejected BAKERS_API_KEY` and waits 5 minutes | Recorded as `pm-bot-bakers-api-key` (parameter `pm_bot_bakers_api_key_expires_at`) | New service-account key, update the parameter |
| Conductor's bakers.build client | `~/.bakers/connections/<id>.js` | The key's: 90 days by default, at most 365 | Box operator | The conductor stops claiming and retries every 5 minutes; `bakers oven status` and its log name it | Neither: a rejection is shown at once | `bakers auth login` |
| GitHub token for agents | `gh` configuration, `~/.config/gh/hosts.yml` | OAuth sign-in: until revoked; personal access token: its expiry date | Box operator | Pushes, pull requests and clones fail | Read from GitHub as `github` | `gh auth login` |
| GitLab token for agents | `glab` configuration, `~/.config/glab-cli/config.yml` | OAuth sign-in: refreshed until revoked; personal access token: at most 1 year | Box operator | Pushes, merge requests and clones fail | Read from GitLab as `gitlab` | `glab auth login` |
| PM bot registry token | Template variable `pm_bot_registry_token`, then `~/.docker/config.json` | The registry's | Template admin | `pm-bot: skipped: docker login … failed`; the bot does not start | Recorded as `pm-bot-registry-token` (parameter `pm_bot_registry_token_expires_at`) | New token, push the template |
| keytec Vault token | keytec's workspace build; it reads `secret/infrastructure/keytec-coder` | 1 year | keytec infrastructure | A workspace build gets no keytec secrets | Read from Vault as `vault` when the box has the `vault` CLI, `VAULT_ADDR` and `VAULT_TOKEN`; otherwise recorded as `keytec-vault-token` | New token in keytec's infrastructure repository |
| keytec registry deploy token | keytec's workspace build | The registry's | keytec infrastructure | Private images cannot be pulled | Recorded as `keytec-registry-deploy-token` | New deploy token in keytec's infrastructure repository |

### Record an expiry date

The conductor reads expiry dates from GitHub, GitLab and Vault itself (`github`, `gitlab`, `vault`), and checks the Claude Code and Codex sign-ins (`claude`, `codex`). Record every other dated credential in `~/.bakers/credential-expiry.yml` on the box, one line per credential:

```yaml
claude: 2027-03-31
pm-bot-claude-oauth-token: 2027-03-31
pm-bot-registry-token: 2027-01-15
```

A date under `claude` or `codex` applies to that sign-in check, for example a setup token's expiry. The recognized names are `claude`, `codex`, `pm-bot-claude-oauth-token`, `pm-bot-registry-token`, `pm-bot-bakers-api-key`, `keytec-vault-token` and `keytec-registry-deploy-token`; any other name is reported too. The Coder template writes the three `pm-bot-…` lines from its `pm_bot_…_expires_at` parameters and keeps the other lines. keytec's infrastructure repository writes its own entries.

### Warnings and errors

Each credential gets a status: **warning** from 14 days before its expiry date, **error** once it has expired or its issuer rejects it. Warnings and errors show on the conductor's page, in the conductors list, in `bakers ui`, and in the PM bot's Slack channel, where the bot posts each one when it first appears and once a day while it lasts. Renew the credential, update its recorded date, and the next check clears it.
