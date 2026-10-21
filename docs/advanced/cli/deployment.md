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

The `prepare-deployment` skill runs it during the deployment workflow and writes `resolved[].uuid` to the deployment ticket's `referenced_tickets`, recording any `unresolved` identifiers in its summary. The `bb_deployment` workflow itself is described in [Workflows and states](/skills-and-workflows/workflows-and-states).
