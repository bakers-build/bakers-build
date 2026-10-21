import { BoxRenderable, h, type VNode } from '@opentui/core';
import { Badge } from '../../../Component/badge/index.js';
import { FOREGROUND, paragraphNode, plainRun } from '../../../lib/vnode.js';
import { StatisticsFigures } from '../../../Statistics/figures.js';
import { STATISTIC_EXAMPLES } from './demo-statistics.js';

export { STATISTIC_EXAMPLES } from './demo-statistics.js';

export interface DemoStatisticsProps {
  readonly id: string;
  readonly scenario: number;
  /** The figure grid's last measured width, and where a new one is reported. */
  readonly width: number;
  readonly onResize: (width: number) => void;
}

/**
 * The demo's chart area: a labelled local scenario painted through the same
 * `StatisticsFigures` the production Stats screens use.
 */
export function DemoStatistics({
  id,
  scenario,
  width,
  onResize,
}: DemoStatisticsProps): VNode {
  const example = STATISTIC_EXAMPLES[scenario] ?? STATISTIC_EXAMPLES[0];
  return h(
    BoxRenderable,
    { id, flexDirection: 'column', gap: 1 },
    h(
      BoxRenderable,
      { id: `${id}-label`, flexDirection: 'row', gap: 2 },
      Badge({ id: `${id}-badge`, label: 'Example data', variant: 'info' }),
      paragraphNode({
        id: `${id}-scenario`,
        runs: [plainRun(`${example?.name ?? ''} · n: next scenario`)],
        fg: FOREGROUND,
      }),
    ),
    StatisticsFigures({
      id: `${id}-grid`,
      groups: example?.groups ?? [],
      width,
      onResize,
    }),
  );
}
