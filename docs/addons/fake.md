# Fake conductor fixture

**A deterministic server, executor, worktree and message set for bakers.build's own tests.**

It is for bakers.build's own tests and end-to-end runs only. It is private, is not published, and never talks to a real server or agent.

## Enable it

Nothing to enable in a real project. bakers.build's tests list it once in a conductor `addons` array to wire a complete fake conductor.

```js
addons: ['@bakers-build/addon-fake'],
```

## Options

Test-only settings; users need none.

<!-- @options @bakers-build/addon-fake -->

## Check it works

bakers.build's conductor tests pass with it.

Package source in a checkout: `bakers-cli/addons/fake`.
