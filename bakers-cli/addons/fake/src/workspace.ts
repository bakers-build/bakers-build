// BB-224 (Finding 6, decision 8): the fake workspace — formerly
// `@bakers-build/core`'s `plugins/workspace/fake.ts` — folded into the fake fixture
// addon next to its paired executor, retiring the addon's old
// `@bakers-build/core/plugins` import.
import type {
  BbWorkspace,
  ConductorFileConfig,
  EnsuredWorkspace,
  WorkspacePlugin,
} from '@bakers-build/conductor/contract';

export class FakeWorkspace implements BbWorkspace {
  async ensure(identifier: string, _title?: string): Promise<EnsuredWorkspace> {
    return { path: `/fake/${identifier}`, instructions: null, created: true };
  }
}

export function fakeWorkspace(): WorkspacePlugin {
  const workspace = new FakeWorkspace();
  return {
    kind: 'workspace',
    id: 'fake',
    requiredModules: [],
    async createWorkspace(_config: ConductorFileConfig) {
      return workspace;
    },
  };
}
