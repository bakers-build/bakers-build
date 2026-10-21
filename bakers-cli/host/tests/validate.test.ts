import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatReport,
  registerValidate,
  runValidate,
} from '../src/validate.js';

// BB-436: `bakers validate` is the step contract's only production entry point.
// Every contract RULE it enforces is asserted in
// `core/tests/workflow/step-contract.test.ts`; what this file owns is the host
// layer around them — where the loader document and the skill roots are found,
// which root wins, what the report says, and the exit code the shell sees.

/** A `SKILL.md` whose `when` covers every claimable triple exactly once. */
const universal = (name: string, extraInput?: string) =>
  [
    '---',
    `name: ${name}`,
    'description: covers every claimable step of every workflow, for a green load.',
    'when:',
    '  workflow: "*"',
    '  step: "*"',
    ...(extraInput === undefined
      ? []
      : [
          'inputs:',
          `  ${extraInput}:`,
          '    description: an input this skill declares',
          '    default: the default',
        ]),
    '---',
    '',
    `# ${name}`,
  ].join('\n');

/** A `SKILL.md` that owns `coding` only — green on its own is impossible. */
const codingOnly = (name: string) =>
  [
    '---',
    `name: ${name}`,
    'description: owns coding only, so a load carrying just this one has gaps.',
    'when:',
    '  workflow: "*"',
    '  step: [coding]',
    '---',
    '',
    `# ${name}`,
  ].join('\n');

const loader = (...bullets: string[]) =>
  ['# Project', '', '## Loaded skills', '', ...bullets, ''].join('\n');

/** Write `SKILL.md` for `name` under `<root>/<plugin>/skills/<name>/`. */
const writeSkill = (root: string, name: string, body: string): void => {
  const dir = join(root, 'plug', 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), body);
};

describe('bakers validate — host layer (BB-436)', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'bb-436-validate-'));
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  describe('discovery', () => {
    it('finds .claude/skills and .agents/skills under the project without being told', () => {
      writeSkill(
        join(project, '.agents/skills'),
        'from-agents',
        universal('from-agents'),
      );
      writeFileSync(
        join(project, 'WORKFLOW.md'),
        loader('- @any-namespace/from-agents'),
      );

      const report = runValidate({ path: project });

      expect(report.ok, report.error).toBe(true);
      expect(report.roots.some((r) => r.endsWith('.claude/skills'))).toBe(true);
      expect(report.roots.some((r) => r.endsWith('.agents/skills'))).toBe(true);
      expect(report.loaded?.owners).toEqual(['from-agents']);
    });

    it('resolves a directory to its WORKFLOW.md and takes a .md path as the document', () => {
      writeSkill(join(project, '.claude/skills'), 'owner', universal('owner'));
      writeFileSync(join(project, 'WORKFLOW.md'), loader('- @bakers-build/owner'));
      const elsewhere = join(project, 'OTHER.md');
      writeFileSync(elsewhere, loader('- @bakers-build/owner'));

      expect(runValidate({ path: project }).workflowPath).toBe(
        join(project, 'WORKFLOW.md'),
      );
      const direct = runValidate({ path: elsewhere, project });
      expect(direct.workflowPath).toBe(elsewhere);
      expect(direct.ok, direct.error).toBe(true);
    });

    it('names the loader document it went looking for when there is none', () => {
      const report = runValidate({ path: project });

      expect(report.ok).toBe(false);
      expect(report.error).toContain(join(project, 'WORKFLOW.md'));
    });

    it('--skills takes precedence over the in-repo roots, and the shadowed one is noted', () => {
      // Same NAME in both roots, different contracts: the `--skills` copy covers
      // every triple, the in-repo copy owns `coding` alone. A green verdict is
      // therefore only possible if the `--skills` root won.
      const extra = mkdtempSync(join(tmpdir(), 'bb-436-extra-'));
      try {
        writeSkill(extra, 'owner', universal('owner'));
        writeSkill(
          join(project, '.claude/skills'),
          'owner',
          codingOnly('owner'),
        );
        writeFileSync(join(project, 'WORKFLOW.md'), loader('- @bakers-build/owner'));

        const report = runValidate({ path: project, skills: [extra] });

        expect(report.ok, report.error).toBe(true);
        expect(
          report.index.shadowed.map((s) => s.name),
          'the in-repo copy is recorded as shadowed, not silently discarded',
        ).toEqual(['owner']);
        expect(formatReport(report).join('\n')).toContain('(ignored)');
      } finally {
        rmSync(extra, { recursive: true, force: true });
      }
    });
  });

  describe('report', () => {
    it('the green summary states the owners, the helpers and the triple count', () => {
      writeSkill(join(project, '.claude/skills'), 'owner', universal('owner'));
      writeSkill(
        join(project, '.claude/skills'),
        'helper',
        [
          '---',
          'name: helper',
          'description: declares no when, so it owns no step and routes nothing.',
          '---',
          '',
          '# helper',
        ].join('\n'),
      );
      writeFileSync(
        join(project, 'WORKFLOW.md'),
        loader('- @bakers-build/owner', '- @bakers-build/helper'),
      );

      const report = runValidate({ path: project });
      const out = formatReport(report).join('\n');

      expect(report.ok, report.error).toBe(true);
      // 4 + 4 + 4 + 2 + 2 claimable states across the five workflows.
      expect(report.tripleCount).toBe(16);
      expect(out).toContain('OK — 1 step owner(s) + 1 helper(s)');
      expect(out).toContain('cover all 16 project triple(s)');
      expect(out).toContain('owners: owner');
      expect(out).toContain('helpers: helper');
    });

    it('the failure report carries the contract message verbatim', () => {
      writeSkill(
        join(project, '.claude/skills'),
        'owner',
        universal('owner', 'validate.command'),
      );
      // The pre-BB-280 bare key: the skill declares `validate.command`.
      writeFileSync(
        join(project, 'WORKFLOW.md'),
        loader('- @bakers-build/owner', '    validate: something'),
      );

      const report = runValidate({ path: project });
      const out = formatReport(report).join('\n');

      expect(report.ok).toBe(false);
      expect(out).toContain('FAILED:');
      expect(out).toContain('`owner`');
      expect(out).toContain('`validate`');
    });

    it('an unresolved name says whether it is a discovery gap, not just a loader defect', () => {
      writeSkill(join(project, '.claude/skills'), 'owner', universal('owner'));
      writeFileSync(
        join(project, 'WORKFLOW.md'),
        loader('- @bakers-build/owner', '- @bakers-build/not-vendored-here'),
      );

      const out = formatReport(runValidate({ path: project })).join('\n');

      expect(out).toContain('loaded skill `not-vendored-here` not found.');
      expect(
        out,
        'a project that does not vendor its skills must be told to pass --skills, not left reading a loader defect',
      ).toContain('--skills');
    });

    // BB-436 review round 2 — the gap the message regex left. `formatReport`
    // used to detect a discovery gap with `/^loaded skill `…` not found\.$/`,
    // which matches only the ROOT-bullet throw site. A bundle member that cannot
    // be resolved is raised by the very same `walk()`, is just as much a "that
    // skill is not vendored here" problem, and got no remedy printed at all.
    // Branching on the error's `code` covers both, and names the member.
    it('an unresolved bundle MEMBER gets the --skills hint too', () => {
      writeSkill(join(project, '.claude/skills'), 'owner', universal('owner'));
      writeSkill(
        join(project, '.claude/skills'),
        'bundle',
        [
          '---',
          'name: bundle',
          'description: loads its members from its own body, one of them vendored nowhere.',
          '---',
          '',
          '# bundle',
          '',
          '## Loaded skills',
          '',
          '- @bakers-build/not-vendored-here',
        ].join('\n'),
      );
      writeFileSync(
        join(project, 'WORKFLOW.md'),
        loader('- @bakers-build/owner', '- @bakers-build/bundle'),
      );

      const out = formatReport(runValidate({ path: project })).join('\n');

      expect(out).toContain(
        'bundle `bundle` loads unknown skill `not-vendored-here`.',
      );
      expect(
        out,
        'an unresolvable bundle member is a discovery gap and must be told the same remedy as an unresolvable bullet',
      ).toContain('--skills');
      expect(
        out,
        'the hint must name the member that failed to resolve, not the bundle that loaded it',
      ).toContain('`not-vendored-here` is not among the');
    });

    it('reports that nothing was indexed when no skill root holds a SKILL.md', () => {
      writeFileSync(join(project, 'WORKFLOW.md'), loader('- @bakers-build/owner'));

      const out = formatReport(runValidate({ path: project })).join('\n');

      expect(out).toContain('skills indexed: 0');
      expect(out).toContain('no `SKILL.md` was found under any scanned root');
    });

    // BB-436 review round 3. `empty_loader` is raised for THREE section shapes,
    // and core's one message diagnoses only the first of them ("your list is
    // indented"). The other two wear a remedy that does not apply, which is the
    // same misdirection the code exists to end — so the host measures the section
    // and says which shape it actually found.
    //
    // A fourth shape, a document with NO `## Loaded skills` section, is
    // deliberately absent here: it never reaches `empty_loader` at all, but
    // raises `parseLoadedSection`'s own untagged message, which is already exact.
    describe('an empty loader names the shape the section actually has', () => {
      it('an indented list points at the lines and the indent they sit at', () => {
        writeSkill(
          join(project, '.claude/skills'),
          'owner',
          universal('owner'),
        );
        // Lines 5 and 6 of the document `loader()` builds.
        writeFileSync(
          join(project, 'WORKFLOW.md'),
          loader('    - @bakers-build/owner', '    - @bakers-build/other'),
        );

        const out = formatReport(runValidate({ path: project })).join('\n');

        expect(
          out,
          'the author has to find the offending lines; naming them is the whole remedy',
        ).toContain('line 5 (indent 4)');
        expect(out).toContain('line 6 (indent 4)');
        expect(out).toContain('- @bakers-build/owner');
      });

      it('a section with no address-shaped bullet is not blamed on indentation', () => {
        writeSkill(
          join(project, '.claude/skills'),
          'owner',
          universal('owner'),
        );
        // A `*` marker: address-shaped to a human, invisible to the loader.
        writeFileSync(join(project, 'WORKFLOW.md'), loader('* @bakers-build/owner'));

        const out = formatReport(runValidate({ path: project })).join('\n');

        expect(
          out,
          'nothing here is indented, so the report must say so rather than echo core message',
        ).toContain('no `- @…` bullet at any indent');
        expect(
          out
            .split('\n')
            .filter((l) => l.startsWith('  '))
            .join('\n'),
          'telling this author to de-indent sends them looking at whitespace that is already correct',
        ).not.toContain('de-indent');
      });

      it('an empty section is reported as empty rather than as mis-indented', () => {
        writeSkill(
          join(project, '.claude/skills'),
          'owner',
          universal('owner'),
        );
        writeFileSync(join(project, 'WORKFLOW.md'), loader());

        const out = formatReport(runValidate({ path: project })).join('\n');

        expect(out).toContain('section is empty');
        expect(
          out
            .split('\n')
            .filter((l) => l.startsWith('  '))
            .join('\n'),
          'there is nothing to de-indent when the section carries no line at all',
        ).not.toContain('de-indent');
      });
    });
  });

  describe('exit code', () => {
    let prevExitCode: number | string | undefined;

    beforeEach(() => {
      prevExitCode = process.exitCode;
    });
    afterEach(() => {
      process.exitCode = prevExitCode;
    });

    /** Run the registered command; return what it printed and where. */
    const run = async (
      argv: string[],
    ): Promise<{ stdout: string; stderr: string; exitCode: unknown }> => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const outSpy = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk: unknown) => {
          stdout.push(String(chunk));
          return true;
        });
      const errSpy = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: unknown) => {
          stderr.push(String(chunk));
          return true;
        });
      try {
        process.exitCode = undefined;
        const program = new Command();
        program.exitOverride();
        registerValidate(program);
        await program.parseAsync(['node', 'bakers', 'validate', ...argv]);
      } finally {
        outSpy.mockRestore();
        errSpy.mockRestore();
      }
      return {
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        exitCode: process.exitCode,
      };
    };

    it('a clean load exits 0 and reports on stdout', async () => {
      writeSkill(join(project, '.claude/skills'), 'owner', universal('owner'));
      writeFileSync(join(project, 'WORKFLOW.md'), loader('- @bakers-build/owner'));

      const { stdout, stderr, exitCode } = await run([project]);

      expect(exitCode, stderr).toBeUndefined();
      expect(stdout).toContain('OK — 1 step owner(s)');
      expect(stderr).toBe('');
    });

    it('a contract defect exits 1 and reports on stderr', async () => {
      writeSkill(join(project, '.claude/skills'), 'owner', codingOnly('owner'));
      writeFileSync(join(project, 'WORKFLOW.md'), loader('- @bakers-build/owner'));

      const { stdout, stderr, exitCode } = await run([project]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('FAILED:');
      expect(
        stderr,
        'a step no loaded owner covers is the coverage gap the contract forbids',
      ).toContain('coverage gap');
      expect(stdout).toBe('');
    });
  });
});
