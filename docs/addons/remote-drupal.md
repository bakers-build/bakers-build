# bakers.build server remote

**Connects a conductor to the bakers.build server, where tickets and runs live.**

For every project conductor that works tickets from a bakers.build server.

## Enable it

Add the package to `addons` in the project's `.bakers/conductor.config.js`.

```js
addons: ['@bakers-build/addon-remote-drupal', '@bakers-build/addon-herdr'],
```

It uses the connection that the conductor config resolves, so it needs no settings of its own.

## Options

No options.

## Check it works

The conductor starts and its tickets appear in the web UI and in `bakers ui`.

::: details Per CLI
```sh
bakers config check
```
:::

More: [Conductor config](/advanced/conductor-config), [Connections](/advanced/connections).

Source: [`bakers-cli/addons/remote-drupal`](https://git.key-tec.de/bakers-build/bakers-build/-/tree/develop/bakers-cli/addons/remote-drupal)
