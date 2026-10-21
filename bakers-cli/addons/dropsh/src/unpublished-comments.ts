import { type HttpClient, HttpError } from 'dropsh/plugin';

type HttpResponse = Awaited<ReturnType<HttpClient['send']>>;

interface Resource {
  type?: string;
  id?: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: unknown }>;
}

/** An unpublished bakers.build comment: a review the ticket's assignee has not accepted. */
function unpublished(resource: Resource): boolean {
  return (
    typeof resource?.type === 'string' &&
    resource.type.startsWith('bb_comment--') &&
    resource.attributes?.status === false
  );
}

/**
 * Agent reads through `bakers dropsh` never see an unpublished comment.
 *
 * Accounts cannot tell an agent from its human, so the server lets the
 * assignee read submitted reviews; the agent-facing shell filters them from
 * GET collections, single reads, includes and the linkages pointing at them.
 * A single read of one fails as dropsh's own client fails a 404.
 * ponytail: keys on `attributes.status`; a sparse fieldset without `status`
 * passes through.
 */
export function hideUnpublishedComments(http: HttpClient): HttpClient {
  return {
    async send(request) {
      const response = await http.send(request);
      return request.method === 'GET' ? filter(response) : response;
    },
  };
}

function filter(response: HttpResponse): HttpResponse {
  let document: { data?: unknown; included?: Resource[] };
  try {
    document = JSON.parse(response.body);
  } catch {
    return response;
  }
  if (!document || typeof document !== 'object' || !('data' in document)) {
    return response;
  }
  if (
    document.data &&
    !Array.isArray(document.data) &&
    unpublished(document.data as Resource)
  ) {
    const errors = [
      {
        status: '404',
        title: 'Not Found',
        detail: 'The comment is not published.',
      },
    ];
    throw new HttpError(404, 'HTTP 404', { errors });
  }
  const hidden = new Set<string>();
  const keep = (list: Resource[]) =>
    list.filter((resource) => {
      if (!unpublished(resource)) return true;
      hidden.add(`${resource.type}:${resource.id}`);
      return false;
    });
  if (Array.isArray(document.data))
    document.data = keep(document.data as Resource[]);
  if (Array.isArray(document.included))
    document.included = keep(document.included);
  if (hidden.size === 0) return response;
  const primary = Array.isArray(document.data)
    ? document.data
    : [document.data];
  for (const resource of [
    ...(primary as Resource[]),
    ...(document.included ?? []),
  ]) {
    for (const relationship of Object.values(resource?.relationships ?? {})) {
      if (Array.isArray(relationship?.data)) {
        relationship.data = (relationship.data as Resource[]).filter(
          (link) => !hidden.has(`${link.type}:${link.id}`),
        );
      }
    }
  }
  return { ...response, body: JSON.stringify(document) };
}
