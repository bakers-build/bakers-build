import { escape } from './questions.mjs';

/** Append the backend's ticket link and stored origin to an existing message. */
export function withTicket(text, ticket, messages) {
  if (!ticket.url) return text;
  const link = (url, title) => `<${escape(url).replaceAll('|', '%7C')}|${escape(title).replaceAll('|', '¦')}>`;
  let footer = link(ticket.url, `${ticket.identifier} · ${ticket.title}`);
  if (ticket.origin) {
    const origin = /^https?:\/\//i.test(ticket.origin) ? link(ticket.origin, ticket.origin) : escape(ticket.origin);
    footer += `\n${messages.originLead} ${origin}`;
  }
  return `${text}\n\n${footer}`;
}
