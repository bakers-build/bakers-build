// The Conventional Commits preset `commit-and-tag-version` releases with (`.versionrc.cjs`), with
// one change to the bump: below 1.0 a breaking change bumps minor and a feature still bumps minor.
// The tool's own pre-1.0 rule shifts every level down, so a feature would only bump the patch.
// The tool runs in the repository root, where it also resolves VERSION.
import { readFileSync } from 'node:fs';
import createPreset from 'conventional-changelog-conventionalcommits';

export default function createReleasePreset(config) {
  const preset = createPreset(config);
  const whatBump = preset.whatBump;
  preset.whatBump = (commits) => {
    const bump = whatBump(commits);
    const major = Number(readFileSync('VERSION', 'utf8').trim().split('.')[0]);
    if (bump?.level === 0 && major === 0) bump.level = 1;
    return bump;
  };
  return preset;
}
