// commit-and-tag-version (`pnpm --dir bakers-cli run bump`): the version lives in VERSION, the
// section goes into CHANGELOG.md, and no tag is created; the `release` CI job tags the
// chore(release) commit once main carries it. A .cjs file, not .json: the preset is a local
// module the tool only loads by absolute path.
const { resolve } = require('node:path');

module.exports = {
  preset: resolve(__dirname, 'bakers-cli/scripts/release-preset.mjs'),
  header: '# Changelog\n\nOne version covers the CLI (`@bakers-build/bakers`) and the server.\n',
  packageFiles: [{ filename: 'VERSION', type: 'plain-text' }],
  bumpFiles: [{ filename: 'VERSION', type: 'plain-text' }],
  skip: { tag: true },
};
