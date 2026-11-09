# Build your first addon

Add a project lifecycle listener that writes a harmless marker before each run. It demonstrates loading, project scope and the hook context without publishing a package or adding a dependency.

**You need:** an existing working conductor project, Node.js, and permission to change its committed configuration. Hooks execute on the worker outside the agent sandbox. Use a disposable ticket for verification.

## Create two files

Create `.bakers/addons/run-marker/package.json`:

```json
{
  "name": "example-run-marker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./preset.js",
  "exports": { ".": "./preset.js", "./preset": "./preset.js" }
}
```

Create `.bakers/addons/run-marker/preset.js`:

```js
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const scopes = ['project'];
export const hooks = (listeners) => [
  ...listeners,
  {
    id: 'example-run-marker',
    async before_run(ctx) {
      await writeFile(join(ctx.worktreePath, '.run-marker'), 'before_run reached\n');
    },
  },
];
```

The listener preserves earlier contributions and awaits its write. It overwrites the same small marker on retries. It never logs the environment. A write failure is reported through the conductor's best-effort [hook handling](/provision/hooks#failure-behavior), not treated as a readiness gate.

## Enable in the project

Add the local package path to the existing `addons` array in `.bakers/conductor.config.js`, keeping its engine addons and identity:

```js
export default {
  bakers: { project: 'demo', workspace: 'Engineering' },
  addons: [
    '@bakers-build/addon-remote-drupal',
    '@bakers-build/addon-herdr',
    './addons/run-marker',
  ],
};
```

The path resolves from the config directory. Discovery tries its `preset` subpath first, then the package main module, which exports the contributions above. No install or build step is needed for this local ESM package. Commit both files and the conductor change; add `.run-marker` to the repository's `.gitignore` so ticket worktrees ignore the generated artifact. Do not enable it in the machine file: its scope is project-only.

## Verify

```sh
bakers config check --scope project --online
```

Reload the conductor using its normal [start/stop procedure](/configuration/project/conductor-commands), then dispatch a disposable ticket through that conductor. In the ticket worktree:

```sh
cat .run-marker
```

**Success:** it prints `before_run reached`, and the conductor log has no `hook listener failed` for `example-run-marker`. Config validation alone does not execute the listener. A subsequent run overwrites the marker; cleanup removes it with the worktree.

Remove the addon entry, reload the conductor, then remove its two files and any remaining marker when finished.

## Extend your addon

Choose the next guide for the capability you want to add.

<DocQuickLinks aria-label="Extend your addon" :items="[
  { label: 'Addon contracts', text: 'Build a typed package or prepare an addon for publication.', link: '/addons/build/contracts#write-an-addon' },
  { label: 'Agent tools', text: 'Expose an operation that agents can call during a run.', link: '/addons/build/tools' },
  { label: 'Inbox messages', text: 'Make operations available through ticket actions and external clients.', link: '/addons/build/actions' }
]" />
