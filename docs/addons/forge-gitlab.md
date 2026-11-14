# Forge for GitLab

**A [Forge](/addons/forge) backend that authenticates with a GitLab Project Access Token, or with the conductor's `glab` login.**

For GitLab projects, on gitlab.com or a self-managed instance.

## Enable it

In the project, open **Settings › Access tokens** and add a Project Access Token:

| Field | Value |
|---|---|
| Role | Developer |
| Scopes | `api`, `write_repository` |
| Expiration date | required; renew the token before it passes |

The Developer role pushes branches and merges into branches that Developers may merge into. Then set the backend of the [Forge](/addons/forge) entry, usually in `~/.bakers/machine.config.js`:

```js
backend: {
  use: '@bakers-build/addon-forge-gitlab',
  with: {
    url: 'https://gitlab.example.com',
    project: 'acme/shop',
    token_env: 'BB_FORGE_GITLAB_TOKEN',
  },
},
```

## Options

<!-- @options @bakers-build/addon-forge-gitlab -->

One of `auth`, `token_env` or `token` is required.

### With your glab login

Without a Project Access Token, the conductor can use its own `glab` login. Run `glab auth login` on the conductor's machine, then set `auth: 'glab'` and no token:

```js
backend: {
  use: '@bakers-build/addon-forge-gitlab',
  with: { project: 'acme/shop', auth: 'glab' },
},
```

The conductor reads the token with `glab config get token --host <host>` and reads it again after five minutes. Runs still get only the forge tools, never the token. The login reaches every project your account can, so the tools' ownership rules are the only limit.

## Check it works

Start the conductor and let a run call `forge_checks` with `ref` set to the default branch: it lists the newest pipeline's jobs without writing anything. `run_id` is the pipeline, `job_id` the job, and `forge_job_log` reads that job's trace.

## Good to know

- Required means the head pipeline and every job without `allow_failure`; a manual job that may not fail stays `pending` until it is played.
- Every merge sends `squash` and `should_remove_source_branch`, so nothing stored on the MR decides them. A stored `force_remove_source_branch: true` on a source that must be kept blocks the merge until the branch owner clears it.
- bakers.build does not watch the token's expiry date.

Package source in a checkout: `bakers-cli/addons/forge-gitlab`.
