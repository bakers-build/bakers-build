import type { TicketDetailDocument } from '../types.js';
import { ticketUrl } from './ticket-url.js';

/** One link shown at the top of the ticket and run detail. */
export interface TopLink {
  readonly key: string;
  /** Short, single-line label; the full URL is `href`. */
  readonly label: string;
  readonly href: string;
  readonly pullRequest: boolean;
}

const MAX_LABEL = 40;
const PR_URL = /\/pull\/(\d+)(?:[/?#]|$)/;
const MR_URL = /\/merge_requests\/(\d+)(?:[/?#]|$)/;

const capped = (text: string): string =>
  text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;

/** `PR #229`, `MR !12`, or `host/…/last` for any other URL. */
export function linkLabel(url: string): string {
  const pr = PR_URL.exec(url);
  if (pr) return `PR #${pr[1]}`;
  const mr = MR_URL.exec(url);
  if (mr) return `MR !${mr[1]}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'link';
  }
  // `internal:/node/1`, `mailto:` and the like parse without a host.
  if (parsed.host === '') return 'link';
  const segments = parsed.pathname.split('/').filter((part) => part !== '');
  const last = segments.at(-1);
  if (last === undefined) return capped(parsed.host);
  return capped(
    segments.length === 1
      ? `${parsed.host}/${last}`
      : `${parsed.host}/…/${last}`,
  );
}

export function isPullRequest(title: string, url: string): boolean {
  return (
    PR_URL.test(url) ||
    MR_URL.test(url) ||
    /^(PR|MR)\b|pull request|merge request/i.test(title)
  );
}

/** Ticket URL first (when a base URL is known), then PR/MR links, then the rest in stored order. */
export function ticketTopLinks(
  document: TicketDetailDocument,
  baseUrl?: string,
): TopLink[] {
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
        label: linkLabel(href),
        href,
        pullRequest: isPullRequest(title, href),
      },
    ];
  });
  const ordered = [
    ...links.filter((link) => link.pullRequest),
    ...links.filter((link) => !link.pullRequest),
  ];
  const href = ticketUrl(baseUrl, document.data?.id);
  if (href === undefined) return ordered;
  const identifier = attributes.identifier;
  return [
    {
      key: 'ticket',
      label:
        typeof identifier === 'string' && identifier !== ''
          ? identifier
          : linkLabel(href),
      href,
      pullRequest: false,
    },
    ...ordered,
  ];
}
