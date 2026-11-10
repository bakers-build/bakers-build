# Forge for GitHub

**A [Forge](/addons/forge) backend that authenticates with a GitHub App installation token scoped to one repository, or with the conductor's `gh` login.**

For GitHub repositories. The conductor mints a short-lived installation token for the configured repository only and renews it shortly before it expires.

## Enable it

Create a GitHub App in the organization or account that owns the repository and install it on that repository only. Give it these repository permissions:

| Permission | Access |
|---|---|
| Contents | Read and write |
| Pull requests | Read and write |
| Checks | Read |
| Commit statuses | Read |
| Metadata | Read |

Generate a private key for the App and keep it on the conductor's machine. Then set the backend of the [Forge](/addons/forge) entry, usually in `~/.bakers/machine.config.js`:

```js
backend: {
  use: '@bakers-build/addon-forge-github',
  with: {
    repository: 'acme/shop',
    app_id: 123456,
    installation_id: 7890123,
    private_key_env: 'BB_FORGE_GITHUB_KEY',
  },
},
```

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `repository` | string | required | `owner/repo`; the only repository the token reaches. |
| `app_id` | number | required | The App's ID. |
| `installation_id` | number | required | The App's installation on that repository. |
| `private_key_env` | string | — | Environment variable holding the App's PEM private key. |
| `private_key` | string | — | The PEM key itself; only in `~/.bakers/machine.config.js`. |

| `auth` | `'gh'` | — | Use the conductor's `gh` login instead of a GitHub App. |

With `auth: 'gh'` no App option is needed. Otherwise `app_id`, `installation_id` and one of `private_key_env` or `private_key` are required.

### With your gh login

Without a GitHub App, the conductor can use its own `gh` login. Run `gh auth login` on the conductor's machine, then set:

```js
backend: {
  use: '@bakers-build/addon-forge-github',
  with: { repository: 'acme/shop', auth: 'gh' },
},
```

The conductor reads the token with `gh auth token` and reads it again after five minutes. Runs still get only the forge tools, never the token. The login reaches every repository your account can, so the tools' ownership rules are the only limit.

## Check it works

Start the conductor and let a run call `forge_checks` with `ref: 'main'`: it lists the checks of `main` without writing anything.

## Good to know

- Required checks come from the base branch's rulesets and its branch protection; a required check that has not reported yet counts as `missing`, which blocks the merge.
- The source branch is deleted after a verified merge, and only when the merge rule asks for it and no open PR targets it.

Package source in a checkout: `bakers-cli/addons/forge-github`.
