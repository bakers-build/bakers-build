import { BoxRenderable, h, type VNode } from '@opentui/core';
import { Markdown } from '../../../Component/markdown/index.js';
import { FOREGROUND, paragraphNode, plainRun } from '../../../lib/vnode.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import {
  AsyncScreen,
  type FullScreenChrome,
} from '../../../Screen/async-screen.js';
import type { ScreenContext } from '../../../Screen/screen.js';
import {
  ticketHeaderTree,
  ticketTitleOf,
} from '../Component/ticket-detail/index.js';
import { ticketInputContext } from '../Data/input.js';
import { readTicket } from '../Data/store.js';

const ID = 'ticket-markdown-demo';

function ticketDescription(context: ScreenContext): string {
  const description = readTicket(context).data?.attributes?.description;
  if (typeof description === 'string') return description;
  if (
    description &&
    typeof description === 'object' &&
    'value' in description &&
    typeof description.value === 'string'
  )
    return description.value;
  return 'No ticket description.';
}

const EXAMPLE = [
  '# Example document',
  '',
  'This is a **Markdown showcase**, not additional ticket content. Scroll with the mouse wheel or ↑/↓ (j/k).',
  '',
  '> The native ticket header and tabs stay visible while the document scrolls.',
  '',
  '- **Strong emphasis**, *italic text* and `inline code`.',
  '- A [documentation link](https://example.test/docs) remains visible with its destination.',
  '',
  '```ts',
  'const screen = "NativeScreen";',
  'render({ statistics: true, markdown: true });',
  '```',
  '',
  ...Array.from({ length: 18 }, (_, index) =>
    [
      `## Example section ${index + 1}`,
      '',
      'A longer paragraph checks wrapping at narrow terminal widths. Inline **formatting** must remain part of the same text flow, so the words continue naturally after resizing the window.',
      '',
      '- Inspect layout and readable spacing.',
      '- Switch between Statistics, Markdown and the native ticket tabs.',
      '',
    ].join('\n'),
  ),
  '## End of Markdown example',
  '',
  'You reached the bottom. Scroll back up to the actual ticket description.',
].join('\n');

/** A separate document screen using the kernel's existing scrolling viewport. */
export class TicketReactMarkdownScreen extends AsyncScreen<true> {
  static readonly route = {
    id: 'ticket.react-markdown',
    path: '/tickets/:ticketId/react-markdown',
    parent: 'project.tickets',
    tab: {
      id: 'react-markdown',
      label: 'Markdown',
      scope: 'ticket',
      weight: 110,
    },
    fallback: { routeId: 'my.work' },
    context: ticketInputContext,
  } satisfies RouteMetadata;
  readonly id = TicketReactMarkdownScreen.route.id;
  readonly frameId = 'ticket';

  protected load(): Promise<true> {
    return Promise.resolve(true);
  }
  override enter(context: ScreenContext): void {
    super.enter(context);
    // The document is the ticket already in context: ready at once.
    if (this.state !== 'ready') {
      this.replaceReady(true);
      context.requestDraw();
    }
  }
  protected renderLoading(): string[] {
    return ['Loading Markdown preview…'];
  }
  protected override flushBody(): boolean {
    return false;
  }

  protected renderReady(_data: true, context: ScreenContext): VNode {
    const width = context.terminalColumns ?? 80;
    return h(
      BoxRenderable,
      { id: ID, flexDirection: 'column', gap: 1 },
      paragraphNode({
        id: `${ID}-hint`,
        runs: [plainRun('Markdown preview · ↑↓ / j,k / mouse wheel: scroll')],
        fg: FOREGROUND,
      }),
      Markdown({
        id: `${ID}-document`,
        width: Math.max(16, width - 12),
        source: `# Ticket description\n\n${ticketDescription(context)}\n\n---\n\n${EXAMPLE}`,
      }),
    );
  }

  protected chrome(context: ScreenContext): FullScreenChrome {
    const document = readTicket(context);
    const { identifier, title } = ticketTitleOf(document);
    return {
      title: `${identifier} · ${title}`,
      header: ticketHeaderTree(document, identifier, title, []),
    };
  }

  renderNonInteractive(context: ScreenContext) {
    return [
      'Markdown preview',
      ticketDescription(context),
      'The interactive tab also includes a labeled scrolling example.',
    ];
  }
}
