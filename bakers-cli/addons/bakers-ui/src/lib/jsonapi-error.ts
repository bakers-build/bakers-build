// Turn a rejected JSON:API write into the one line the operator should read
// (BB-233 AC-5). Pure, no imports — a rejection is the only thing standing
// between a refused write and a UI that silently pretends it worked.
//
// Why a ladder and not `caught.message`: dropsh's `HttpError.message` is the
// literal string `HTTP 403` / `HTTP 422`. The server's own words — "Assigning a
// conductor requires the \"assign bakers conductor\" permission." — are in
// `err.body.errors[]`, and JSON:API makes each member's `detail` OPTIONAL, so
// `title` is a real rung and not a paranoid one.

interface JsonApiErrorMember {
  title?: unknown;
  detail?: unknown;
}

const text = (v: unknown): string =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : '';

/** `errors[]` off an unknown throw, or [] when the shape is anything else. */
function errorMembers(caught: unknown): JsonApiErrorMember[] {
  if (typeof caught !== 'object' || caught === null) return [];
  const body = (caught as { body?: unknown }).body;
  if (typeof body !== 'object' || body === null) return [];
  const errors = (body as { errors?: unknown }).errors;
  return Array.isArray(errors) ? (errors as JsonApiErrorMember[]) : [];
}

/**
 * The server's own message for a rejected write:
 * `errors[].detail` → `errors[].title` → `HTTP <status>` → the throw itself.
 * Several `errors[]` entries (a 422 can carry one per field violation) are
 * joined with a space, so nothing the server said is dropped.
 */
export function serverMessage(caught: unknown): string {
  const messages = errorMembers(caught)
    .map((e) => text(e.detail) || text(e.title))
    .filter((m) => m !== '');
  if (messages.length > 0) return messages.join(' ');

  const status =
    typeof caught === 'object' && caught !== null
      ? (caught as { status?: unknown }).status
      : undefined;
  if (typeof status === 'number') return `HTTP ${status}`;

  // Last rung: an ordinary throw (a socket error, a thrown string). `.message`
  // rather than String(err) so an Error renders "socket hang up", not
  // "Error: socket hang up" — for an HttpError it yields the same `HTTP <n>`
  // the rung above would have produced, so the ladder stays consistent.
  return caught instanceof Error ? caught.message : String(caught);
}
