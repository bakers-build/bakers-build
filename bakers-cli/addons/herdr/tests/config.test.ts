import { describe, expect, it } from 'vitest';
import {
  assertTabLabelTemplate,
  BUILTIN_DEFAULTS,
  renderTemplate,
  resolveStateConfig,
} from '../src/config.js';

describe('renderTemplate', () => {
  it('substitutes known placeholders', () => {
    expect(
      renderTemplate('{identifier} · {sessionRef}', {
        identifier: 'GL-7',
        sessionRef: 'bakers:r-7',
      }),
    ).toBe('GL-7 · bakers:r-7');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(renderTemplate('{missing}', { identifier: 'GL-7' })).toBe(
      '{missing}',
    );
  });
});

describe('resolveStateConfig', () => {
  it('returns built-in defaults when options are empty', () => {
    expect(resolveStateConfig({}, 'coding')).toEqual(BUILTIN_DEFAULTS);
  });

  // BB-374: state root pane label defaults to the ticket title.
  it("exposes default panelLabel: '{title}'", () => {
    expect(BUILTIN_DEFAULTS.panelLabel).toBe('{title}');
    expect(resolveStateConfig({}, 'coding').panelLabel).toBe('{title}');
  });

  it('default block overrides built-ins', () => {
    const out = resolveStateConfig(
      { default: { workspaceLabel: '{repoName}-ws' } },
      'coding',
    );
    expect(out.workspaceLabel).toBe('{repoName}-ws');
    expect(out.tabLabel).toBe(BUILTIN_DEFAULTS.tabLabel);
    expect(out.panelLabel).toBe(BUILTIN_DEFAULTS.panelLabel);
  });

  it('state entry overrides default field-by-field', () => {
    const out = resolveStateConfig(
      {
        default: { tabLabel: '{identifier} · {sessionRef}', panes: [] },
        states: {
          review: {
            panes: [
              { direction: 'right', command: 'git -C {workspacePath} diff' },
            ],
          },
        },
      },
      'review',
    );
    expect(out.panes).toEqual([
      { direction: 'right', command: 'git -C {workspacePath} diff' },
    ]);
    expect(out.tabLabel).toBe('{identifier} · {sessionRef}');
  });

  it('merges panelLabel from default and state overrides', () => {
    const fromDefault = resolveStateConfig(
      { default: { panelLabel: 'Default · {title}' } },
      'coding',
    );
    expect(fromDefault.panelLabel).toBe('Default · {title}');

    const fromState = resolveStateConfig(
      {
        default: { panelLabel: 'Default · {title}' },
        states: { coding: { panelLabel: 'Coding · {title}' } },
      },
      'coding',
    );
    expect(fromState.panelLabel).toBe('Coding · {title}');
  });

  it('replaces panes (no concatenation)', () => {
    const out = resolveStateConfig(
      {
        default: { panes: [{ direction: 'down', command: 'base' }] },
        states: {
          review: { panes: [{ direction: 'right', command: 'only' }] },
        },
      },
      'review',
    );
    expect(out.panes).toEqual([{ direction: 'right', command: 'only' }]);
  });

  it('unknown state falls back to default', () => {
    const out = resolveStateConfig(
      { default: { tabLabel: '{sessionRef}-x' } },
      'totally-unknown',
    );
    expect(out.tabLabel).toBe('{sessionRef}-x');
  });
});

describe('assertTabLabelTemplate', () => {
  it('accepts a label containing {identifier}', () => {
    expect(() =>
      assertTabLabelTemplate('{identifier} · {titleSlug}'),
    ).not.toThrow();
  });

  it('throws when {identifier} is missing', () => {
    expect(() => assertTabLabelTemplate('{titleSlug}')).toThrow(/identifier/);
  });
});
