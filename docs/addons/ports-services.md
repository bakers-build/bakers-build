# Shared processes

**Decides which processes of a ticket's worktree [Ports](/addons/ports) may share, such as a docs or app dev server.**

DDEV services need nothing here; [DDEV discovery](/addons/ddev) claims them.

## Enable it

Add `services` to the `with` of the `@bakers-build/addon-ports` entry, in the project's `.bakers/conductor.config.js` or in `~/.bakers/machine.config.js`:

```js
addons: [
  {
    use: '@bakers-build/addon-ports',
    with: { services: [{ key: 'docs', match: 'vitepress' }] },
  },
],
```

## Options

| Option | Meaning |
|---|---|
| `services[].key` | The service key: lowercase letters, digits and `-`. |
| `services[].match` | Text the process's command line contains, compared without case. The port is read from the running process. |
| `all_node` | `true` also shares every other Node application as `node-<port>`. Off by default. |

Storybook is a built-in entry (`key: 'storybook'`, `match: 'storybook'`, plus a static build found by its `index.json`); your own `storybook` entry replaces it. Several processes matching one entry get `<key>`, then `<key>-<port>`.

With the entry in both files, the machine wins: `services` merge per key, `transport` and `all_node` come whole from the machine when it sets them. A project `all_node: true` applies to everyone in the repository unless their machine sets `all_node: false`.

## Check it works

```sh
bakers ports list          # docs  process  http://127.0.0.1:5173
bakers ports up docs
bakers config check --scope project --online
```

A malformed setting is never ignored: `bakers ports` names the file and the key, and `config check --online` reports `addon_with_invalid`.

## Good to know

- A Node inspector port is not shared: port 9229, a port named by an `--inspect…` flag, or one answering as an inspector. A public inspector would let anyone run code on your machine.
- `all_node` skips a process that gives no HTTP answer. A `services` entry does not: it claims a matching process even when the inspector check gets no answer, so match only the dev servers you mean.
- Order: `services`, then DDEV, then `all_node`. DDEV keys never change; a process entry reusing one becomes `<key>-<port>`.

::: tip Ask your AI
"Share my worktree's dev server with a ports `services` entry, then run `bakers ports list`."
:::

Source: [`bakers-cli/addons/ports`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/ports)
