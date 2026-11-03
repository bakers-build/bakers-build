import { readOwnConductor } from './Entity/conductor/Data/own-conductor.js';
import { resolveWhoCandidate } from './Entity/user/Data/users.js';
import { loadWorkspaceMemberships } from './Entity/workspace/Data/members.js';
import { resolveRoute } from './route.js';
import type { RendererServices, TuiOptions } from './types.js';

/** Options the launcher passes into the factory (a superset of the injected
 *  intent-level agent service so `bakers ui` can drive launch/list/focus/…). */
export type BbUiOptions = TuiOptions;

// The dropsh `tui` renderer plugin: a single interactive renderer that hands off
// to the TUI kernel. The conductor's plugin resolver auto-picks the default
// export, so the factory is the module default.
//
// BB-223 (spec Decision 5): `run()` is ALSO where a deep-link target is
// resolved. It is the earliest point at which a JSON:API client exists —
// `services.client` — and it is still strictly before the kernel reaches
// `input.setRawMode(true)`. A resolution failure therefore rejects out of
// `run()`, through dropsh's `parseAsync`, into `cmdUi`'s catch: no alternate
// screen, no raw mode, no screen at all — a stderr line and exit 1 (AC-3).
export default function bakersUiPlugin(options: BbUiOptions = {}) {
  return {
    id: 'bakers-ticket-renderer',
    requiredModules: [] as string[],
    renderers: [
      {
        id: 'tui',
        interactive: true,
        run: async (
          document: unknown,
          context: unknown,
          services: RendererServices,
        ) => {
          const route =
            options.initialRoute === undefined
              ? undefined
              : await resolveRoute(services.client, options.initialRoute, {
                  ...(services.baseUrl !== undefined
                    ? { baseUrl: services.baseUrl }
                    : {}),
                });
          // BB-232 (D9): the second thing resolved here, for the same reason.
          // `~/.bakers/conductors.json` used to tell the entry which project this
          // checkout belongs to and which conductor is this machine's; the
          // control plane knows both, and this is the first place a client
          // exists to ask. Only when the entry handed over a `.bakers` dir — no
          // dir, no read, so a cockpit outside any project boots as before.
          const own =
            options.bakersDir === undefined
              ? undefined
              : await readOwnConductor(services.client, options.bakersDir);
          // BB-472: the active workspace's NAME, read once here beside `own` —
          // best-effort, exactly like `machineDetails` in the Drupal remote: an
          // unreadable workspace degrades to no chrome suffix, never a boot
          // failure over a status-bar nicety.
          const workspace =
            options.workspaceId === undefined
              ? undefined
              : await services.client
                  .collection('bb_workspace')
                  .where('id', '=', options.workspaceId)
                  .first()
                  .then(
                    (r) => (r?.attr('name') as string | undefined) ?? undefined,
                  )
                  .catch(() => undefined);
          const isWorkspaceAdmin =
            options.workspaceId !== undefined &&
            options.currentUser !== undefined
              ? await resolveWhoCandidate(services.client, options.currentUser)
                  .then(async (identity) => {
                    const user = identity.rows[0];
                    if (!user) return false;
                    const memberships = await loadWorkspaceMemberships(
                      services.client,
                      options.workspaceId as string,
                    );
                    return memberships.leadIds.has(user.id);
                  })
                  .catch(() => false)
              : false;
          // BB-326: the kernel is imported HERE, not at module load. It now
          // pulls `@opentui/core`, whose native core is megabytes of Zig — and
          // this module is what addon DISCOVERY loads to read the preset.
          // Statically importing it made `discoverAddons` pay for a renderer it
          // will never run, which showed up at once as a 5 s timeout in
          // `conductor/tests/discover-addons.test.ts`.
          const { runTicketTui } = await import('./Kernel/tui-kernel.js');
          return runTicketTui(document, context, services, {
            ...options,
            // An explicit `--project` is the operator saying it outright; the
            // record is an inference, so the flag wins.
            ...(options.project === undefined && own?.project !== undefined
              ? { project: own.project }
              : {}),
            ...(options.ownConductorMachineId === undefined &&
            own?.machineId !== undefined
              ? { ownConductorMachineId: own.machineId }
              : {}),
            // Optional at every hop — omitting the key is the My work path.
            ...(route !== undefined ? { route } : {}),
            ...(workspace !== undefined ? { workspace } : {}),
            isWorkspaceAdmin,
          });
        },
      },
    ],
  };
}
