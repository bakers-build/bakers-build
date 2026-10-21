/** Tab rendering is independent of registration and routing. */
export interface TopTab {
  id: string;
  label: string;
}

export interface TabLocation {
  level: string;
  tab: string;
  tabs: readonly TopTab[];
}

export interface TabBarPart<Id extends string = string> {
  readonly tab?: Id;
  readonly text: string;
}

export const tabsOfLocation = (location: TabLocation): readonly TopTab[] =>
  location.tabs;

export function tabPartsFor(location: TabLocation): TabBarPart[] {
  return location.tabs.flatMap((tab, index) => {
    const part = {
      tab: tab.id,
      text: tab.id === location.tab ? `[${tab.label}]` : ` ${tab.label} `,
    };
    return index === 0 ? [part] : [{ text: '  ' }, part];
  });
}

export function tabBarFor(location: TabLocation): string {
  return tabPartsFor(location)
    .map((part) => part.text)
    .join('');
}
