import type { SectionLine } from '../section-list/index.js';

export type WorkloadCounter = readonly [label: string, value: number];

export function workloadSummaryRows(
  counters: readonly WorkloadCounter[],
): SectionLine[] {
  return [
    {
      cells: counters.map(([label, value]) => ({
        text: `${label} ${value}`,
        width: 16,
        min: 8,
        grow: 1,
      })),
    },
  ];
}
