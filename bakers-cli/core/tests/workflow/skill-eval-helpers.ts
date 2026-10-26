import { readFileSync } from 'node:fs';
import { sha256 } from '../../../../tests/skill-eval/artifacts.mjs';
import { sourcePaths } from '../../../../tests/skill-eval/validation.mjs';

export function savedAttempt(
  selected: { skill: string; references: string[] },
  output: string,
  toolTrace?: Array<{ tool: string; arguments: unknown; result: unknown }>,
) {
  const fixtureSource = JSON.stringify(selected);
  const sources = sourcePaths(selected).map((path) => {
    const content = readFileSync(
      new URL(
        `../../../../.claude/skills/bakers-build/skills/${path}`,
        import.meta.url,
      ),
      'utf8',
    );
    return {
      path: `.claude/skills/bakers-build/skills/${path}`,
      content,
      sha256: sha256(content),
    };
  });
  return {
    version: 1,
    output,
    output_sha256: sha256(output),
    ...(toolTrace
      ? {
          tool_trace: toolTrace,
          tool_trace_sha256: sha256(JSON.stringify(toolTrace)),
        }
      : {}),
    generation: {
      ...(toolTrace
        ? {
            tool_trace: structuredClone(toolTrace),
            tool_trace_source: JSON.stringify(toolTrace),
            tool_trace_sha256: sha256(JSON.stringify(toolTrace)),
          }
        : {}),
      status: 'generated',
      fixture: selected,
      fixture_source: fixtureSource,
      fixture_sha256: sha256(fixtureSource),
      sources,
      prompt: 'synthetic test prompt',
      prompt_sha256: sha256('synthetic test prompt'),
      worker: {
        model: 'test-model',
        isolation_confirmed: true,
        ...(toolTrace
          ? {
              tool_calls: toolTrace.map((row) => ({
                tool: row.tool,
                arguments: row.arguments,
              })),
            }
          : {}),
      },
      revision: 'a'.repeat(40),
      output,
      output_sha256: sha256(output),
    },
  };
}
