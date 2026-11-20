import type { TicketDetailDocument } from '../types.js';

/** One link shown at the top of the ticket and run detail. */
export interface TopLink {
  readonly key: string;
  readonly href: string;
  readonly pullRequest: boolean;
}

const PR_URL = /\/pull\/\d+(?:[/?#]|$)/;
const MR_URL = /\/merge_requests\/\d+(?:[/?#]|$)/;

export function isPullRequest(title: string, url: string): boolean {
  return (
    PR_URL.test(url) ||
    MR_URL.test(url) ||
    /^(PR|MR)\b|pull request|merge request/i.test(title)
  );
}

/** The served ticket URL first (when present), then PR/MR links, then the rest in stored order. */
export function ticketTopLinks(document: TicketDetailDocument): TopLink[] {
  const attributes = document.data?.attributes ?? {};
  const stored: unknown[] = Array.isArray(attributes.links)
    ? attributes.links
    : [];
  const links: TopLink[] = stored.flatMap((item) => {
    const link = item as { title?: unknown; uri?: unknown; url?: unknown };
    const href = link.uri ?? link.url;
    if (typeof href !== 'string' || href === '') return [];
    const title = typeof link.title === 'string' ? link.title.trim() : '';
    return [
      {
        key: title === '' ? 'link' : title,
        href,
        pullRequest: isPullRequest(title, href),
      },
    ];
  });
  const ordered = [
    ...links.filter((link) => link.pullRequest),
    ...links.filter((link) => !link.pullRequest),
  ];
  const href = attributes.url;
  if (typeof href !== 'string' || href === '') return ordered;
  return [
    {
      key: 'ticket',
      href,
      pullRequest: false,
    },
    ...ordered,
  ];
}
