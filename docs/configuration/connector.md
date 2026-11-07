# Connector

A chat connector grants your MCP client access to bakers.build tools. A CLI connection file selects the server and sign-in profile for terminal commands. They use your account's permissions but have different owners.

## Chat settings

**Owner:** your chat client's connector settings, not the project repository.

| Value | Required? | Example |
|---|---|---|
| Server endpoint | Yes | `https://app.bakers.build/mcp` |
| Account authorization | Yes, your own account with workspace access | Sign in when the client opens the server |
| Client ID/secret | Leave empty for dynamic registration | No shared secret |
| Project instructions | Optional, useful in claude.ai Projects | [Canonical instructions](/configuration/connector/project-instructions) |

Follow [Set up a connector](/get-started/connector) for the one-time connection. To verify after a change, ask the connector to search for and read a known project ticket, then compare it with the web UI. An empty workspace or permission error needs a workspace lead's help; never substitute someone else's login.

To renew authorization, disconnect and reconnect in the client. [Limits and errors](/configuration/connector/limits) covers client-specific failures; [notifications](/configuration/connector/notifications) covers email preferences.

## CLI connection

**Owner:** private `~/.bakers/bakers.config.js` or `~/.bakers/connections/<id>.js`. A checkout may select a named connection in its ignored `.bakers/connection.config.local.js`:

```js
export default { connection: 'team' };
```

The server URL and plugins are required; workspace picker defaults and additional addons are optional. [Connections](/configuration/connector/connections) is the canonical field, precedence and authentication-profile reference, with complete minimal examples.

```sh
bakers auth status
bakers config check --scope connection --online
```

The selected server must be correct and authentication must pass. [Credentials](/provision/security/credentials) explains keys and service accounts; [Security](/provision/security/access-and-data) covers access boundaries.
