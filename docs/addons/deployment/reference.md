# bakers deployment

`bakers deployment` holds release helpers; today it has one subcommand, `tickets`, which lists the tickets a git range delivers so a deployment can record its release batch.

## Synopsis

```
bakers deployment tickets --since <ref> --to <ref>
```

| Option | Meaning |
|---|---|
| `--since <ref>` | The environment's currently deployed ref, the start of the git range (required) |
| `--to <ref>` | The post-merge environment branch tip, the end of the range (required) |

```sh
bakers deployment tickets --since v1.4.0 --to develop
```

Run it inside the project's checkout: it reads `git log` for `<since>..<to>` in the working directory and resolves each identifier it finds against the control plane, using the project named by the checkout's conductor config and the connection that config resolves.

## What it prints

One line of JSON: the range, the tickets that resolved and the identifiers that did not.

```json
{"range":"v1.4.0..develop","resolved":[{"identifier":"SHOP-42","uuid":"<uuid>","title":"Add checkout"}],"unresolved":["SHOP-7"]}
```

Identifiers are de-duplicated and kept in first-seen order. An identifier that does not resolve is reported under `unresolved` and never fails the command. The command only reads: it writes nothing to the control plane.

## Which identifiers it finds

An identifier is a project key plus a number, such as `SHOP-42`; the parse accepts any project key, not only `bakers.build`. Prose such as `AC-1` or `UTF-8` has the same shape, so a key counts only once it appears in one of three positions:

- a `ref:` trailer, as in `ref:SHOP-42`;
- a conventional-commit scope, as in `feat(SHOP-42): add checkout`;
- the head of a commit subject, as in `SHOP-42: add checkout`.

Every identifier in the log whose key was admitted that way is then collected, including one that sits bare in a commit body. A key that appears only mid-prose and in none of the three positions yields nothing, and a commit with no identifier at all is invisible to the command, silently. That is why the commit convention puts `ref:<identifier>` on the squash commit.

## Where it is used

A deployment is a ticket of type `deployment` with the recipe `deploy-and-release`; it runs the one workflow `bb_work` like every other ticket. Its `plan` step runs `bakers deployment tickets` from the environment's deployed ref to the frozen SHA and records `resolved[].uuid` in the ticket's `referenced_tickets`, listing any `unresolved` identifiers in the plan comment.

## Release

A deployment to the environment whose branch is `main` is the release; CLI and server share its one version. It follows Conventional Commits and SemVer. The version lives only in the `v*` tag and the changelog only in the GitLab release; no commit carries either.

1. **Version and notes from the merge request titles.** Every squash subject on `develop` is a Conventional Commits subject (the `mr_title` CI job and the merge step check it). `release:version` derives the next version from the commits between the last reachable `v*` tag and a ref: `fix` bumps the patch, `feat` the minor, a `!` or `BREAKING CHANGE:` footer the major, and below 1.0 a breaking change bumps the minor. It prints nothing when no `feat`, `fix` or breaking commit lies in the range. The `plan` step shows its dry run on the frozen SHA, the version first, then the release notes:

   ```sh
   pnpm --dir bakers-cli run release:version <frozen SHA> --notes -
   ```

2. **Release branch.** The `working` step resets the ticket branch `release/<identifier>` to the frozen SHA and pushes it with no commit of its own, so later merges to `develop` stay out of the release.
3. **Into `main`.** One merge request from the release branch into `main`, titled `chore(release): x.y.z` (the `mr_title` job refuses any other title), with its gate played, merged with a merge commit, never squashed (the merge API with `squash=false`; the `mr_main_merge_commit` job fails a merge request into `main` that has squash on). The `main` pipeline promotes the gate-built images and deploys prod. The `release` job then runs the same computation on the merge's second parent, the frozen `develop` commit, tags it `vx.y.z` and creates the GitLab release with the generated notes. A second parent already in a `v*` tag, or a range with nothing to release, releases nothing; a `main` push that is not a merge commit fails the job. The tag pipeline publishes `@bakers-build/bakers@x.y.z` as `latest` and tags the images `:x.y.z`.

Nothing merges back into `develop`: it already contains the tagged commit, so the next release ranges from that tag. `main` is never merged into `develop`. `CHANGELOG.md` keeps the history up to 0.3.0; later releases use the generated release notes; [updates](/configuration/machine/updates) explains choosing and verifying the installed version.

A breaking server change needs a raised `min_client_version` in the same batch; the raise is an ordinary merge request on `develop`, followed by a new freeze.

## Roll back

Roll back by version: point the prod stack's images at the last good `:<version>` and redeploy, then revert through a merge request ([Komodo server › Roll back](/configuration/project/server-komodo#roll-back)). A version tag is never moved or reused; the fix ships as the next version.
