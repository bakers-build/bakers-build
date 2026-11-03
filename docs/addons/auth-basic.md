# HTTP Basic sign-in

**Signs requests to the bakers.build server in with a fixed HTTP Basic token.**

For servers that are set up for HTTP Basic, such as test instances. Most users sign in with a sign-in profile instead.

## Enable it

Add the package to `addons` in your connection config (`bakers.config.js` or `connections/<id>.js`).

```js
addons: [
  { use: '@bakers-build/addon-auth-basic', with: { basic: '<base64 user:password>' } },
],
```

## Options

| Option | Type | Default | Effect |
|---|---|---|---|
| `basic` | string | none | Base64 of `user:password`, sent as `Authorization: Basic …` on every request. Without it the addon adds nothing. |

## Check it works

A read through the connection succeeds instead of answering 401.

## Good to know

- The token is a secret. Keep it out of committed files.
- Sign-in and sign-out are not supported; the token is always treated as signed in.

More: [Connections](/configuration/connector/connections).

Package source in a checkout: `bakers-cli/addons/auth-basic`.
