import type { TabMetadata } from './route.js';

/** Resolve relative placement while retaining the default tabs' stable order. */
export function orderTabs(tabs: readonly TabMetadata[]): TabMetadata[] {
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const edges = new Map(tabs.map((tab) => [tab.id, new Set<string>()]));
  const degree = new Map(tabs.map((tab) => [tab.id, 0]));
  const connect = (from: string, to: string) => {
    if (!edges.get(from)?.has(to)) {
      edges.get(from)?.add(to);
      degree.set(to, (degree.get(to) ?? 0) + 1);
    }
  };
  const defaults = tabs
    .filter((tab) => !tab.before && !tab.after)
    .sort((a, b) => (a.weight ?? Infinity) - (b.weight ?? Infinity));
  for (let i = 1; i < defaults.length; i++) {
    const previous = defaults[i - 1];
    const current = defaults[i];
    if (previous && current) connect(previous.id, current.id);
  }
  for (const tab of tabs) {
    for (const anchor of [tab.before, tab.after]) {
      if (anchor !== undefined && !byId.has(anchor))
        throw new Error(
          `unknown tab anchor: ${tab.scope}/${anchor} (from ${tab.id})`,
        );
    }
    if (tab.before) connect(tab.id, tab.before);
    if (tab.after) connect(tab.after, tab.id);
  }
  // An anchored tab stays near its anchor instead of drifting behind later defaults.
  const rank = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return Infinity;
    seen.add(id);
    const tab = byId.get(id);
    if (!tab) return Infinity;
    const anchor = tab.after ?? tab.before;
    return anchor ? rank(anchor, seen) : defaults.indexOf(tab);
  };
  const priority = new Map(tabs.map((tab) => [tab.id, rank(tab.id)]));
  const remaining = [...tabs].sort(
    (a, b) =>
      (priority.get(a.id) ?? Infinity) - (priority.get(b.id) ?? Infinity),
  );
  const result: TabMetadata[] = [];
  while (remaining.length) {
    const index = remaining.findIndex((tab) => degree.get(tab.id) === 0);
    if (index < 0)
      throw new Error(
        `cyclic tab placement in ${remaining[0]?.scope}: ${remaining.map((tab) => tab.id).join(', ')}`,
      );
    const tab = remaining.splice(index, 1)[0];
    if (!tab) break;
    result.push(tab);
    for (const target of edges.get(tab.id) ?? [])
      degree.set(target, (degree.get(target) ?? 0) - 1);
  }
  return result;
}
