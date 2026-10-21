---
title: API keys and service accounts
description: Personal API keys for pipelines and scripts, machine identities for unattended conductors, and what each may do.
---

# API keys and service accounts

**A key acts as its owner. A machine identity acts as a conductor. Neither gets more than its account has.**

## Personal API keys

Every signed-in user creates, lists and revokes their own keys under **Account → API keys**. No administrator is involved.

| Fact | Value |
|---|---|
| Acts as | You, with your current ranks and permissions; a rank change applies on the next request |
| Sign-in type | Client credentials with the `bb_session` scope; tokens live 300 seconds and refresh automatically |
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

Use a personal key for CI jobs and scripts that should act as you. When you leave a team, revoking your keys is enough: nothing else holds them.

## Machine identities

A conductor on a server has no person to approve a sign-in code, so it uses a client-credentials connection issued by the instance operator. It identifies the machine, not a user, and holds the ranks that machine's account was given.

| | Personal key | Machine identity |
|---|---|---|
| Created by | The user, self-service | The instance operator |
| Acts as | That user | The machine's own account |
| Typical use | CI, scripts, a second agent | Unattended conductor on a worker server |
| Where configured | Your CI secrets, `~/.bakers/connections/<id>.js` | The worker's connection file |

Setting up a worker with such a connection: [Set up a worker server](/advanced/worker-server) and [Connections](/advanced/connections#client-credentials).

## Scopes and permissions

Both kinds sign in with the single `bb_session` scope. What a request may do is decided by the account's workspace rank and team membership on every call ([Who sees what](/daily-work/who-sees-what)), never by the key itself.
