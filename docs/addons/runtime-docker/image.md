# Docker run image additions

**A project adds tools to the [Docker runtime](/addons/runtime-docker)'s run image, so no operator has to build and publish a whole agent image.**

A project declares what its runs need beyond the shipped image in
[`runtime.image`](/configuration/project) of `.bakers/project.config.js`. The runtime builds that as a
second layer on its own image, on every machine that runs the project:

```js
runtime: {
  image: {
    packages: { apt: ['jq'], npm: ['playwright@1.65.0'] },
    dockerfile: 'run.Dockerfile', // optional, relative to .bakers/
  },
},
```

- `packages.apt` installs with `apt-get install --no-install-recommends`, `packages.npm` with
  `npm install -g`.
- `playwright@<v>` or `@playwright/test@<v>` also installs Chromium and its system libraries into
  `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright`, readable under the host uid. That replaces an
  operator agent image built only to add Playwright.
- `dockerfile` is a fragment appended last, built as root with `.bakers/` as its context, so it
  may `COPY` from there. It must resolve inside `.bakers/`; `FROM` and `USER` are refused.
  `bakers config check` reports both, and every build checks again.

The base is `bakers-runtime:<version>-<agent hash>`, the layer
`bakers-runtime:<version>-<agent hash>-<additions hash>`. The hash covers the base tag, both
package lists and the fragment's text. A tag that exists is never rebuilt. A changed fragment builds
on the next run. A changed package list builds after the conductor restarts. `with.image` on the
machine skips both builds and the additions.

## Agent version

Claude's `installCommand` names the version that `claude --version` prints on the conductor's host,
so the run image carries the host's Claude. Without a readable version it installs `@latest`. Each
run logs its image tag and agent version, `unpinned` or `operator image`.
