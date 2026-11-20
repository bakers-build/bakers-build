import { expect, it } from 'vitest';
import { TicketContent } from '../../../../../src/Entity/ticket/Component/ticket-content/index.js';
import {
  initialExpandedKeys,
  ticketContentModel,
} from '../../../../../src/Entity/ticket/Component/ticket-content/model.js';
import type { TicketDetailDocument } from '../../../../../src/types.js';
import { nodeById } from '../../../../render-tree.js';

const noop = () => {
  // Screen-owned callbacks; these cases inspect the tree only.
};

const doc: TicketDetailDocument = {
  data: {
    id: 'ticket-1',
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BAKERS-332',
      title: 'links on top',
      url: 'https://b.test/bakers/ticket/bakers-332',
      origin: 'legacy-tracker#16',
      links: [{ title: 'PR', uri: 'https://github.com/o/r/pull/229' }],
    },
    relationships: {},
  },
  included: [],
};

interface LinkRowProps {
  content?:
    | string
    | { chunks: readonly { text: string; link?: { url: string } }[] };
  onMouseDown?: unknown;
  onMouse?: unknown;
}

const row = (index: number): LinkRowProps | undefined => {
  const model = ticketContentModel(doc, 'overview', undefined, 0);
  const tree = TicketContent({
    id: 'ticket-content',
    model,
    tab: 'overview',
    expandedKeys: initialExpandedKeys('overview', model),
    select: noop,
    toggle: noop,
    activateProperty: noop,
    terminalColumns: 80,
    onSidebarTab: noop,
    onDocumentTab: noop,
  });
  return nodeById(tree, `ticket-content-overview-links-items-${index}`)
    ?.props as LinkRowProps | undefined;
};

const textOf = (props: LinkRowProps | undefined): string =>
  typeof props?.content === 'object'
    ? props.content.chunks.map((chunk) => chunk.text).join('')
    : (props?.content ?? '');

// AC-2/AC-7: `* <full URL>`, the URL is the chunk's OSC 8 link, and the row
// consumes no press — the terminal opens and copies it.
it('renders each link as one `* <url>` OSC 8 row without a press handler', () => {
  for (const [index, url] of [
    'https://b.test/bakers/ticket/bakers-332',
    'https://github.com/o/r/pull/229',
  ].entries()) {
    const props = row(index);
    expect(textOf(props)).toBe(`* ${url}`);
    const chunks =
      typeof props?.content === 'object' ? props.content.chunks : [];
    expect(
      chunks.filter((c) => c.link).map((c) => [c.text, c.link?.url]),
    ).toEqual([[url, url]]);
    expect(props?.onMouseDown ?? props?.onMouse).toBeUndefined();
  }
  expect(row(1)).toBeDefined();
});

it('keeps a non-web origin as one plain `origin: value` row', () => {
  const props = row(2);
  expect(textOf(props)).toBe('origin: legacy-tracker#16');
  expect(row(3)).toBeUndefined();
});
