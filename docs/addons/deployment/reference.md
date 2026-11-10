# bakers deployment

`bakers deployment` holds release helpers; today it has one subcommand, `tickets`, which lists the tickets a git range delivers so a deployment can record its release batch.

## Synopsis

```
bakers deployment tickets --since <ref> --to <ref> [--project <name>]
```

| Option | Meaning |
|---|---|
| `--since <ref>` | The environment's currently deployed ref, the start of the git range (required) |
| `--to <ref>` | The post-merge environment branch tip, the end of the range (required) |
| `--project <name>` | The project the identifiers belong to (optional; see below) |

```sh
bakers deployment tickets --since v1.4.0 --to HEAD
```

Run it inside the project's checkout: it reads `git log` for `<since>..<to>` in the working directory and resolves each identifier it finds against the control plane over your connection. It needs no conductor: the machine does not have to be set up to run one, and the conductor config is never loaded. The project comes from the first of these that is available:

1. `--project <name>`;
2. `bakers.project` in the checkout's `.bakers/conductor.config.js`, read without running the file;
3. the one project whose repository is the checkout's `origin` remote. If none or several match, the command fails and asks for `--project`.

## What it prints

One line of JSON: the range, the tickets that resolved and the identifiers that did not.

```json
{"range":"v1.4.0..HEAD","resolved":[{"identifier":"SHOP-42","uuid":"<uuid>","title":"Add checkout"}],"unresolved":["SHOP-7"]}
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

This command identifies a release batch; it does not choose a version, merge a branch, publish packages or deploy images. Those steps belong to your project's release workflow. Use the actual deployed ref and intended target ref rather than assuming a branch name.

For choosing and checking an installed bakers.build version, see [Updates](/configuration/machine/updates).

## Roll back

Follow your deployment's rollback procedure. For a standalone server, set the previous release and load the database dump taken before the [update](/self-hosting/server#update). Changing only an image does not undo database updates. Follow up with a revert through a merge request; a version tag is never moved or reused. Listing a previous Git range does not roll back a deployment.

Source: `bakers-cli/addons/deployment/src/deployment.ts` (`registerDeployment`, `parseIdentifiers`, `gatherBatch`).
