// BB-224: the workspace-git addon self-declares its conductor `workspace`
// contribution through the standard `./preset` export.
//
// NOTE it is deliberately NOT part of any default addon list: every executor
// addon ships its own paired workspace (herdr → herdrWorkspace, fake →
// fakeWorkspace), so listing this alongside one of those would only fight it for
// the singleton slot (a guaranteed last-wins warning). Name it when you want a
// git-only setup with no hosted session.
import type { Preset } from '@bakers-build/conductor/contract';
import { gitWorkspace } from './index.js';

export const worktrees: Preset['worktrees'] = (acc, opts) => [
  ...acc,
  gitWorkspace(opts as Parameters<typeof gitWorkspace>[0]),
];

// Conductor wiring of one project: list this addon in .bakers/project.config.js addons[].
export const scopes: Preset['scopes'] = ['project'];
