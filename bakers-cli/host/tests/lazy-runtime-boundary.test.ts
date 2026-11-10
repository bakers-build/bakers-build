import { expect, it, vi } from 'vitest';

vi.mock('@bakers-build/addon-workspace', () => {
  throw new Error('eager runtime import: @bakers-build/addon-workspace');
});
vi.mock('@bakers-build/conductor', () => {
  throw new Error('eager runtime import: @bakers-build/conductor');
});
vi.mock('@bakers-build/conductor/config', () => {
  throw new Error('eager runtime import: @bakers-build/conductor/config');
});
vi.mock('@bakers-build/conductor/project-context', () => {
  throw new Error(
    'eager runtime import: @bakers-build/conductor/project-context',
  );
});

it('builds host help without loading command runtime modules', async () => {
  const { buildHostProgram } = await import('../src/host.js');
  const program = await buildHostProgram(['--help']);

  expect(program.commands.map((command) => command.name())).toContain(
    'conductor',
  );
});
