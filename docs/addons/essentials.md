# Essentials

**Brings the Markdown renderer, the JSON:API schema and name resolution to a connection.**

For every connection config. Keep it.

## Enable it

It is already in the `plugins` list that a generated connection config contains. You can also name it in `addons`.

```js
plugins: [{ plugin: '@bakers-build/addon-essentials' }],
```

It adds three plugins: the Markdown renderer, the authoritative JSON:API schema, and [Name references](/addons/name-refs).

## Options

No options.

## Check it works

The connection check passes.

::: details Per CLI
```sh
bakers config check
```
:::

More: [Connections](/advanced/connections).

Source: [`bakers-cli/addons/essentials`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/essentials)
