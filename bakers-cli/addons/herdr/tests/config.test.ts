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
      { default: { workspace_label: '{repo_name}-ws' } },
      'coding',
    );
    expect(out.workspaceLabel).toBe('{repo_name}-ws');
    expect(out.tabLabel).toBe(BUILTIN_DEFAULTS.tabLabel);
    expect(out.panelLabel).toBe(BUILTIN_DEFAULTS.panelLabel);
  });

  it('state entry overrides default field-by-field', () => {
    const out = resolveStateConfig(
      {
        default: { tab_label: '{identifier} · {sessionRef}', panes: [] },
        states: {
          review: {
            panes: [
              { direction: 'right', command: 'git -C {workspace_path} diff' },
            ],
          },
        },
      },
      'review',
    );
    expect(out.panes).toEqual([
      { direction: 'right', command: 'git -C {workspace_path} diff' },
    ]);
    expect(out.tabLabel).toBe('{identifier} · {sessionRef}');
  });

  it('merges panelLabel from default and state overrides', () => {
    const fromDefault = resolveStateConfig(
      { default: { panel_label: 'Default · {title}' } },
      'coding',
    );
    expect(fromDefault.panelLabel).toBe('Default · {title}');

    const fromState = resolveStateConfig(
      {
        default: { panel_label: 'Default · {title}' },
        states: { coding: { panel_label: 'Coding · {title}' } },
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
      { default: { tab_label: '{sessionRef}-x' } },
      'totally-unknown',
    );
    expect(out.tabLabel).toBe('{sessionRef}-x');
  });
});

describe('assertTabLabelTemplate', () => {
  it('accepts a label containing {identifier}', () => {
    expect(() =>
      assertTabLabelTemplate('{identifier} · {title_slug}'),
    ).not.toThrow();
  });

  it('throws when {identifier} is missing', () => {
    expect(() => assertTabLabelTemplate('{title_slug}')).toThrow(/identifier/);
  });
});
