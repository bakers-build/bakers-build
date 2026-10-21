import type { ScreenClass } from '../Routing/route.js';

export interface ContributionApi {
  add(screen: ScreenClass): void;
}

// Entry imports collect classes; the kernel drains once before building routes.
const collected: ScreenClass[] = [];
export function register(
  id: string,
  setup: (api: ContributionApi) => void,
): void {
  setup({
    add(screen) {
      if (!screen.route?.tab)
        throw new Error(`ui contribution '${id}' requires route.tab`);
      if (collected.some((candidate) => candidate.route.id === screen.route.id))
        throw new Error(
          `ui contribution '${screen.route.id}' is already registered (from '${id}')`,
        );
      collected.push(screen);
    },
  });
}
export function drainContributions(): readonly ScreenClass[] {
  return collected.splice(0, collected.length);
}
export function resetCollector(): void {
  collected.length = 0;
}
