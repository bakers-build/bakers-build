export const runtime = { read_only: ['.ddev'] };

// The ddev addon on the conductor surface: agent tools for the run's own
// DDEV project (the worktree is its approot). Listed in a conductor's
// `addons[]`, the conductor serves them through its MCP server.

export const tools = {
  contract: 1 as const,
  prepare: async (binding: {
    worktreePath: string;
    protectedPaths?: readonly string[];
  }) => {
    const { prepareDdevProtection } = await import('./tools.js');
    await prepareDdevProtection(binding);
  },
  tools: {
    ddev_status: {
      description:
        "Summary of this worktree's DDEV project: status, primary URL, services.",
    },
    ddev_start: {
      description: "Start this worktree's DDEV project (up to 10 minutes).",
    },
    ddev_exec: {
      description:
        "Run a shell command in the web container of this worktree's DDEV project, e.g. a project command by path (`.ddev/commands/web/<cmd>`). Returns the exit code and the output tail.",
      input: {
        type: 'object' as const,
        required: ['command'],
        properties: { command: { type: 'string' as const, minLength: 1 } },
      },
    },
  },
  handlers: () => import('./tools.js').then((m) => m.ddevTools(m.nodeDdevRun)),
};
