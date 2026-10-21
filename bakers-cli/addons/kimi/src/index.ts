import {
  type AgentFootprint,
  type AgentPlugin,
  type AgentRunIdentity,
  emptyAgentFootprint,
  type BbAgent,
  type KnownOptionSpec,
  resolveAgentCliOptions,
} from '@bakers-build/conductor/contract';
import { shellQuote } from '@bakers-build/core';

export interface KimiAgentOptions {
  model?: string;
  effort?: string;
  args?: string[];
}

const KIMI_RESERVED = ['-p', '--prompt', '--output-format'] as const;

const KIMI_KNOWN: readonly KnownOptionSpec[] = [
  { kind: 'model', flags: ['--model', '-m'] },
];

export class KimiAgent implements BbAgent {
  readonly id = 'kimi';
  readonly launchWarnings?: readonly string[];
  private readonly args: string[];
  private readonly model: string | undefined;
  private readonly overrides: { model: boolean; effort: boolean };

  constructor(options: KimiAgentOptions = {}) {
    const cli = resolveAgentCliOptions(options, KIMI_RESERVED, KIMI_KNOWN);
    this.args = cli.args;
    this.model = cli.model;
    this.overrides = cli.overrides;
    if (cli.effort !== undefined) {
      this.launchWarnings = ['effort is unsupported and ignored'];
    }
  }

  launchCommand(prompt: string, _run?: AgentRunIdentity): string {
    if (prompt === '') {
      return 'kimi';
    }

    const parts = ['kimi', '-p', shellQuote(prompt)];
    if (this.model !== undefined && !this.overrides.model) {
      parts.push('--model', shellQuote(this.model));
    }
    parts.push('--output-format', 'text');
    parts.push(...this.args.map(shellQuote));
    return parts.join(' ');
  }

  // Unconverted (BB-473): this addon has no run-log reader at all yet —
  // getRunLog always returns '' regardless of input, so there is nothing a
  // run identity could select between. The `run` param is accepted only for
  // structural compatibility with the widened `BbAgent` interface. No test
  // is added for this method per the ticket (no reader to select from).
  async getRunLog(
    _worktreePath: string,
    _run?: AgentRunIdentity,
  ): Promise<string> {
    return '';
  }

  parseFootprint(_log: string): AgentFootprint {
    // Kimi transcript footprint parsing is not implemented yet (getRunLog
    // returns '' too); an empty footprint is the honest result until it is.
    return emptyAgentFootprint();
  }
}

/** Config-facing factory: `kimiAgent({ model: 'moonshot-v1' })`. */
export function kimiAgent(options: KimiAgentOptions = {}): AgentPlugin {
  const agent = new KimiAgent(options);
  return {
    kind: 'agent',
    id: 'kimi',
    requiredModules: [],
    async createAgent() {
      return agent;
    },
  };
}

// Default export lets config auto-pick this factory without `export:`.
export default kimiAgent;
