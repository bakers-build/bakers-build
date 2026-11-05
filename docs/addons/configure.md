# Configure addons

**Enable an addon by naming it in the right configuration file. This page covers the rules every addon shares.**

Which addons exist, and what each one needs, is on its own page in the [catalog](/addons/).

## AI first

```text
Read https://bakers.build/addons/configure.
Read this addon’s canonical bakers.build documentation and my current
configuration. Explain its role and owning config file, propose the smallest
change, then verify it. Keep client/workspace pairs together and environment
hooks separate.
```


## Which file takes `addons`

The machine file `~/.bakers/machine.config.js` and the project file `.bakers/conductor.config.js` each carry one `addons` list, read the same way. **The addon decides where it may be listed**; its catalog page says which files it allows.

| Addons | Machine | Project | Why |
|---|---|---|---|
| Agent harnesses: claude, codex, grok, kimi, opencode, pi | yes | no | Agents are per machine. |
| herdr, remote-drupal, workspace-git | no | yes | The engine wiring of one project; hook listeners never run for every project. |
| ports, bakers-ui-artifacts | yes | yes | Usable on either level. |
| An addon that declares nothing (third-party) | yes | yes | Allowed in both. |

An entry in a file its addon does not allow is not loaded and warns with the allowed file; `bakers config check --online` reports it as an error.

**Both files, the machine wins.** The same addon (same package and `alias`) listed in both becomes one entry. If the machine entry has a `with`, it replaces the project `with` as a whole; otherwise the project `with` is used. An addon may merge differently; its page says so. Settings live only in the entry's `with`: no configured addon, no addon behaviour.

A connection file (`bakers.config.js` or `connections/<id>.js`) has its own `addons` for connection plugins and UI addons; an unresolvable entry there is an error. An unresolvable machine entry is skipped with a warning naming the package and file; an unresolvable conductor entry fails the conductor load.

Tabs appear in the order machine, connection, conductor. The conductor level is read from the project whose `.bakers/` holds the selected connection, else from the project you run `bakers ui` in. Addons are not installed by configuration: a package must already resolve where the CLI runs. The entry forms (`use`, `with`) and the `scopes` declaration are in [Addon contracts](/addons/build/contracts).

Machine files written before this rule carry `agents.addons` or a top-level `ports`. Both are retired: loading fails with the exact replacement to paste into `addons`.

Fragment for a connection or conductor `addons` list; append to what is there:

```js
addons: [
  '@bakers-build/addon-bakers-ui-artifacts',
],
```

## Check

::: details Per CLI
```sh
bakers config check --scope machine --online
```
:::

::: tip Ask your AI
"Add the Artifacts addon to my machine config's `addons`, add the ports addon with a transport there too, then run the checks."
:::
