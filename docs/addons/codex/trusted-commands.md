# Codex trusted commands

**Run listed commands outside the Codex sandbox, without a prompt and without editing your own Codex rules.**

`sandbox.trusted_commands` on the [Codex addon](/addons/codex#security) turns each entry into a Codex [command rule](https://learn.chatgpt.com/docs/agent-configuration/rules) that only this launch loads. A [shared `permissions` block](/provision/security/shared-settings) can set it for every agent.

```js
// ~/.bakers/machine.config.js
{ use: '@bakers-build/addon-codex', with: { permissions: 'sandbox', sandbox: { trusted_commands: ['ddev', 'git push'] } } }
```

- **Match.** Each entry is a literal command prefix of whitespace-separated words: `'ddev'` trusts `ddev init …`, `'git push'` trusts `git push origin x` but not `git commit`. Wildcards, quotes, `$`, `;`, `|` and other shell syntax fail loading; Codex matches words literally, so a Claude-style `'ddev *'` does not carry over.
- **Loading.** At each launch a Node helper creates a private Codex home beside yours (`~/.codex.bakers-<id>`). It links every entry of your home except `rules/`, copies your own rule files into its `rules/`, because Codex skips linked rule files, and adds `bakers-trusted-commands.rules`. Codex starts there with `--no-daemon`, so a running shared daemon cannot answer with another home's rules. Your `~/.codex/rules`, `config.toml`, login and MCP servers stay unchanged, and sessions, logins and config edits reach your home through the links.
- **Lifetime.** The helper removes the private home when Codex exits, fails or receives `SIGINT`, `SIGTERM` or `SIGHUP`. Every launch builds its own home from its own list, so concurrent runs never share a grant and a changed or removed list applies to the next launch. A hard kill can leave a private home behind; no later launch reads it, and you can delete it.
- **Requirements.** Codex 0.166.0 or newer and a file-backed login: with `cli_auth_credentials_store` set to `keyring` or `auto`, the launch fails, because a keyring login is tied to the home's path. Your Codex home's parent directory must be writable. A failed requirement stops the launch with `Cannot run Codex with sandbox.trusted_commands: …`, never a run without the rules.
- **Scope.** The list applies only in `sandbox` mode, and nothing is trusted by default. A trusted command runs with your user's full rights, outside the run's filesystem sandbox.
