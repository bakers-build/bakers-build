import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { dataKey, type SessionStore } from '../../../Data/session-store.js';
import type { ContextBag } from '../../../Routing/context.js';
import type {
  JsonApiResource,
  RendererServices,
  TicketDetailDocument,
} from '../../../types.js';
import { loadTicketDetail } from './detail.js';
import { ticketDetailInputContext } from './input.js';

/** The data adapter accepts dependencies; it does not depend on screens. */
interface TicketDataContext {
  readonly store?: SessionStore;
  readonly params?: Readonly<Record<string, string>>;
  readonly contexts?: ContextBag;
  readonly services?: Pick<RendererServices, 'client'>;
  readonly isActive: () => boolean;
}

const ticketKey = (id: string) => dataKey<TicketDetailDocument>(`ticket/${id}`);
/**
 * Every relationship a supplied document is credited with (BB-416).
 *
 * `loadTicketView` seeds the store with a caller-supplied document under this
 * list (`store.set(key, supplied, allIncludes)`); an include a controller
 * requests but this list omits is always "missing", so the store retries a
 * fetch for it on every `enter()` even though the supplied document already
 * has nothing more to give. That retry does not merely waste a round trip:
 * `TicketContentScreen.enter()`'s `watchTicket` subscription and the
 * retry's own `start()` both react to the same store write and race to bump
 * `this.revision`, and whichever loses leaves `AsyncScreen.busy` stuck TRUE
 * forever — measured as `renderPipe`'s `settledActive` spinning until the
 * test's own timeout, when `owner_user_id` joined `TicketDetailScreen`'s own
 * `includes` (`ticket-detail.ts:23`) without joining this list. Every include
 * a screen's `includes` can name belongs here too.
 */
// What the header box reads on every tab (labels, and BAKERS-17's type and
// recipe), so every ticket view loads it whatever its own includes.
const headerIncludes = ['labels', 'ticket_type', 'recipe'];

const allIncludes = [
  ...headerIncludes,
  'parent_id',
  'blocked_by',
  'conductor_id',
  'assignee_user_id',
  'comments',
  'sub_tickets',
  'referenced_tickets',
  'runs',
  'owner_user_id',
  'reviewers',
  'pending_reviews',
];
const ids = (data: { id: string } | { id: string }[] | null | undefined) =>
  (Array.isArray(data) ? data : data ? [data] : []).map((item) => item.id);

/** Preserve omitted fields; explicit relationship replacement removes old rows. */
export function mergeTicketDocuments(
  previous: TicketDetailDocument | undefined,
  next: TicketDetailDocument,
): TicketDetailDocument {
  if (!previous?.data || previous.data.id !== next.data?.id) return next;
  const data = {
    ...previous.data,
    ...next.data,
    attributes: { ...previous.data.attributes, ...next.data?.attributes },
    relationships: {
      ...previous.data.relationships,
      ...next.data?.relationships,
    },
  };
  const removed = new Set<string>();
  for (const [field, relation] of Object.entries(
    next.data?.relationships ?? {},
  )) {
    if (relation?.data === undefined) continue;
    const kept = new Set(ids(relation.data));
    for (const id of ids(previous.data.relationships?.[field]?.data))
      if (!kept.has(id)) removed.add(id);
  }
  // A resource can still be used by another relationship (e.g. parent + blocker).
  for (const relation of Object.values(data.relationships))
    for (const id of ids(relation?.data)) removed.delete(id);
  const included = new Map<string, JsonApiResource>();
  for (const resource of [
    ...(previous.included ?? []),
    ...(next.included ?? []),
  ]) {
    if (resource.id && removed.has(resource.id)) continue;
    const key = `${resource.type}/${resource.id}`;
    const old = included.get(key);
    included.set(key, {
      ...old,
      ...resource,
      attributes: { ...old?.attributes, ...resource.attributes },
      relationships: { ...old?.relationships, ...resource.relationships },
    });
  }
  return { ...previous, ...next, data, included: [...included.values()] };
}

export function readTicket(
  context: TicketDataContext,
  fallback: TicketDetailDocument = {},
): TicketDetailDocument {
  const id = context.params?.ticketId;
  return (
    (id ? context.store?.get(ticketKey(id)) : undefined) ??
    (context.contexts?.has(ticketDetailInputContext)
      ? context.contexts.get(ticketDetailInputContext).document
      : undefined) ??
    fallback
  );
}

export function ticketLoaded(
  context: TicketDataContext,
  includes: readonly string[],
): boolean {
  const id = context.params?.ticketId;
  return (
    !!id &&
    (context.store?.has(ticketKey(id), [...includes, ...headerIncludes]) ??
      true)
  );
}

export function loadTicketView(
  context: TicketDataContext,
  includes: readonly string[],
): Promise<TicketDetailDocument> {
  const supplied = context.contexts?.has(ticketDetailInputContext)
    ? context.contexts.get(ticketDetailInputContext).document
    : undefined;
  const id = context.params?.ticketId;
  if (!context.store) {
    if (supplied) return Promise.resolve(supplied);
    if (!context.services || !id)
      throw Error('Ticket view requires ticketId and services');
    return loadTicketDetail(context.services.client, id, includes);
  }
  if (!id) throw Error('Ticket view requires ticketId');
  const store = context.store;
  const key = ticketKey(id);
  if (supplied && !store.get(key)) store.set(key, supplied, allIncludes);
  return store.load(
    key,
    [...includes, ...headerIncludes],
    async (missing) => {
      if (!context.services) {
        if (supplied) return supplied;
        throw Error('Ticket view requires services');
      }
      const params = new DrupalJsonApiParams().addInclude([...missing]);
      return (await context.services.client.get(
        `bb_ticket/bb_ticket/${id}`,
        params,
      )) as TicketDetailDocument;
    },
    mergeTicketDocuments,
  );
}

export function refreshTicket(context: TicketDataContext): void {
  const id = context.params?.ticketId;
  if (id) context.store?.invalidate(ticketKey(id));
}

export function saveTicket(
  context: TicketDataContext,
  document: TicketDetailDocument,
): TicketDetailDocument {
  const id = document.data?.id ?? context.params?.ticketId;
  if (!id || !context.store) return document;
  const key = ticketKey(id);
  const merged = mergeTicketDocuments(context.store.get(key), document);
  // The mutation response is immediately visible; dependent queries load again.
  context.store.set(key, merged);
  return merged;
}

export function watchTicket(
  context: TicketDataContext,
  listener: (document: TicketDetailDocument) => void,
): () => void {
  const id = context.params?.ticketId;
  return (
    (id &&
      context.store?.subscribe(ticketKey(id), (document) => {
        if (document && context.isActive()) listener(document);
      })) ||
    (() => {})
  );
}
