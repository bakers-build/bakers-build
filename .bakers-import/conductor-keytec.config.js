import { drupalRemote, gitWorkspace } from '/home/cw/projects/bakers/.claude/worktrees/skill-workflow/conductor/dist/src/plugins/registry-exports.js';
import { herdrExecutor } from '/home/cw/projects/bakers/.claude/worktrees/skill-workflow/conductor/plugins/herdr/dist/src/index.js';
import { claudeAgent } from '/home/cw/projects/bakers/.claude/worktrees/skill-workflow/conductor/plugins/claude/dist/src/index.js';
import base from '/home/cw/projects/bakers/.claude/worktrees/skill-workflow/.bakers-import/dropsh-keytec.config.js';

export default {
  ...base,
  site: {
    base_url: 'http://bakers-wt-227bf7b.ddev.site',
    jsonapi_prefix: '/jsonapi',
  },
  project: 'playground-test',
  states: ['todo', 'diagnose', 'coding', 'review'],
  remote: drupalRemote(),
  executor: herdrExecutor(),
  agent: claudeAgent({ model: 'claude-opus-4-8' }),
  workspace: gitWorkspace(),
  ...(base.plugins ? { plugins: base.plugins } : {}),
};
