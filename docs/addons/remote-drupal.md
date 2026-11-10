# bakers.build server remote

**Connects a conductor to the bakers.build server, where tickets and runs live.**

For every project conductor that works tickets from a bakers.build server.

## Enable it

Add the package to `addons` in the project's `.bakers/project.config.js`.

```js
addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
```

It uses the conductor’s resolved, signed-in [connection](/configuration/connection), so it needs no addon settings. The account must have access to the configured project.

## Options

No options.

## Check it works

The online check confirms project access. After starting the conductor, verify that it is online for the expected project; existing tickets alone do not prove that it connected.

::: details Per CLI
```sh
bakers config check --scope project --online
```
:::

More: [Project config](/configuration/project), [Connections](/configuration/connection).

Package source in a checkout: `bakers-cli/addons/remote-drupal`.
