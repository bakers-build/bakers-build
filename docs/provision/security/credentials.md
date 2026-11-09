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
export BB_CONSUMER_SECRET=<the secret>
bakers config init --scope connection --auth-type client_credentials --client-id <client id> --secret-env BB_CONSUMER_SECRET
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

Setting up a worker with such a connection: [Set up a worker server](/provision/worker-server) and [Connections](/configuration/connector/connections#client-credentials).

## Scopes and permissions

Both kinds sign in with the single `bb:session` scope. What a request may do is decided by the account's workspace rank and team membership on every call ([Who sees what](/provision/security/access-and-data#roles-and-permissions)), never by the key itself.
