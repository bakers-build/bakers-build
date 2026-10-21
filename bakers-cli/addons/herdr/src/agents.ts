// Herdr-backed AgentLaunchHost (BB-190) — the INTENT-level agent host. It owns
// the whole layout policy the bakers-ui plugin used to drive from the conductor:
// one durable herdr tab per group, a new agent splits off a live pane, the shown
// agent is zoomed, hiding un-zooms and returns to the caller. The caller speaks
// only launch/list/focus/hide/kill/sendText — never panes, tabs or zoom.
//
// `group` is opaque (bakers passes a project slug); it maps to one tab labelled
// `bakers-agents:<group>`, so a group's agents are listed + hidden together and
// survive a TUI restart (rediscovered from the live tab).
import { rmSync } from 'node:fs';
import type { AgentLaunchHost, HostedAgent } from './agent-host.js';
import { writeLaunchScript } from './launch-script.js';
import type { HerdrExec } from './pane-layout.js';
import {
  AGENT_SHELL_ENV,
  envArgs,
  findTabIdByLabel,
  parsePaneInfo,
  parsePanesInTab,
  parseTabCreate,
} from './panes.js';

/** The single tab that holds a group's agent panes. */
const groupTabLabel = (group: string): string => `bakers-agents:${group}`;

export function herdrAgentHost(execHerdr: HerdrExec): AgentLaunchHost {
  // The caller's home tab, returned to on hide. Captured lazily on the first
  // launch — that is when the caller is focused on its own tab (pressing `n`),
  // and it keeps construction side-effect-free. Best-effort: a probe failure
  // just leaves hide without a home to return to.
  let homeTab: string | null = null;
  const captureHome = async (): Promise<void> => {
    if (homeTab !== null) return;
    try {
      homeTab = parsePaneInfo(await execHerdr(['pane', 'current'])).tabId;
    } catch {
      // no home tab known; hide() becomes a no-op focus
    }
  };

  // Cache each group's tab id to skip the `tab list` round-trip once known.
  const tabByGroup = new Map<string, string>();

  const resolveTab = async (group: string): Promise<string | null> => {
    const cached = tabByGroup.get(group);
    if (cached) return cached;
    const found = findTabIdByLabel(
      await execHerdr(['tab', 'list']),
      groupTabLabel(group),
    );
    if (found) tabByGroup.set(group, found);
    return found;
  };

  return {
    async launch({ group, cwd, command, env, label }) {
      await captureHome();
      // Every pane this host opens holds an agent, so all of them carry the
      // agent-shell marker (BB-64) — this is the pane a `bakers ui` user actually
      // attaches to. The caller's own env wins on a key clash; the marker is
      // merged in, never substituted for it.
      const e = { ...AGENT_SHELL_ENV, ...(env ?? {}) };
      // Find the group's tab and split off a LIVE pane (newest-first; a stale
      // pane — a previous agent died/was closed — is skipped). None survive, or
      // no tab yet → create the group tab (its root pane is the agent).
      let pane: { paneId: string; tabId: string } | null = null;
      const tabId = await resolveTab(group);
      if (tabId) {
        const panes = parsePanesInTab(await execHerdr(['pane', 'list']), tabId);
        for (const p of [...panes].reverse()) {
          try {
            pane = parsePaneInfo(
              await execHerdr([
                'pane',
                'split',
                p.paneId,
                '--direction',
                'right',
                '--no-focus',
                '--cwd',
                cwd,
                ...envArgs(e),
              ]),
            );
            break;
          } catch {
            // stale pane — try the next
          }
        }
        if (!pane) tabByGroup.delete(group);
      }
      if (!pane) {
        pane = parseTabCreate(
          await execHerdr([
            'tab',
            'create',
            '--cwd',
            cwd,
            '--no-focus',
            '--label',
            groupTabLabel(group),
            ...envArgs(e),
          ]),
        );
        tabByGroup.set(group, pane.tabId);
      }
      const launch = writeLaunchScript(command);
      // ponytail: on success the wrapper's started/exit markers stay in tmp
      // (no secrets); a sweep is only worth it if they ever pile up.
      await execHerdr(['pane', 'run', pane.paneId, launch.typedCommand]).catch(
        (err) => {
          rmSync(launch.dir, { recursive: true, force: true });
          throw err;
        },
      );
      const human = label ?? 'agent';
      await execHerdr(['pane', 'rename', pane.paneId, human]).catch(() => {});
      await execHerdr(['pane', 'zoom', pane.paneId, '--on']).catch(() => {});
      return { id: pane.paneId, group, label: human };
    },

    async list(group) {
      const tabId = await resolveTab(group);
      if (!tabId) return [];
      return parsePanesInTab(await execHerdr(['pane', 'list']), tabId).map(
        (p): HostedAgent => ({ id: p.paneId, group, label: p.label }),
      );
    },

    async focus(id) {
      await execHerdr(['pane', 'zoom', id, '--on']);
    },

    async hide(group) {
      // Un-zoom the group's panes (so it reads as the tiled overview next time)
      // and return focus to the caller's home tab. The agents keep running.
      const tabId = await resolveTab(group);
      if (tabId) {
        for (const p of parsePanesInTab(
          await execHerdr(['pane', 'list']),
          tabId,
        )) {
          await execHerdr(['pane', 'zoom', p.paneId, '--off']).catch(() => {});
        }
      }
      if (homeTab) await execHerdr(['tab', 'focus', homeTab]).catch(() => {});
    },

    async kill(id) {
      await execHerdr(['pane', 'close', id]);
    },

    async sendText(id, text) {
      await execHerdr(['pane', 'send-text', id, text]);
    },
  };
}
