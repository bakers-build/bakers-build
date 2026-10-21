import type { ScreenClass } from '../Routing/route.js';
import { drainContributions } from './store.js';

/**
 * Import every entry module, then drain the collector into one immutable list.
 *
 * The import is where a contribution's code first loads — the whole point of
 * carrying specifiers (spec D3). A failure names the specifier and rejects: the
 * kernel is reached through `runBbUi`, and `cmdUi` already turns a launcher
 * rejection into one stderr line and exit 1, before the terminal is taken.
 */
export async function loadContributions(
  entries: readonly string[],
  importer: (specifier: string) => Promise<unknown> = (specifier) =>
    import(specifier),
): Promise<readonly ScreenClass[]> {
  for (const specifier of entries) {
    try {
      await importer(specifier);
    } catch (err) {
      throw new Error(
        `bakers ui: could not load UI entry '${specifier}' ` +
          `(${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }
  return drainContributions();
}
