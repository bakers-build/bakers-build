# HTTP Basic sign-in

**Signs requests to the bakers.build server in with a fixed HTTP Basic token.**

For test instances only: a production bakers.build server does not enable HTTP Basic, because it signs in without passwords. Everyone else uses an [OAuth sign-in profile](/configuration/connection#sign-in-profiles) instead.

## Enable it

Add the package to `addons` in your connection config (`~/.bakers/connections/default.js`, `connections/<id>.js` or `.bakers/connection.config.js`).

```js
addons: [
  { use: '@bakers-build/addon-auth-basic', with: { basic: '<base64 user:password>' } },
],
```

## Options

<!-- @options @bakers-build/addon-auth-basic -->

## Check it works

Run `bakers config check --scope connection --online`. A server read succeeds instead of answering 401; the local auth status alone does not test the credentials.

## Good to know

- The token is a secret, not encryption. Use HTTPS and keep the private connection file out of Git.
- Sign-in and sign-out are not supported; the token is always treated as signed in.

More: [Connections](/configuration/connection).

Package source in a checkout: `bakers-cli/addons/auth-basic`.
