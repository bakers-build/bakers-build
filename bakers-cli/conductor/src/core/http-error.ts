import { HttpError } from 'dropsh/plugin';

type JsonApiError = { title?: string; detail?: string };

const firstError = (err: HttpError): JsonApiError | undefined =>
  (err.body as { errors?: JsonApiError[] } | undefined)?.errors?.[0];

/** An error for the log: the HTTP status plus the server's first JSON:API error, if any. */
export function httpErrorText(err: unknown): string {
  if (!(err instanceof HttpError)) return String(err);
  const first = firstError(err);
  return first
    ? `HTTP ${err.status} ${first.title ?? ''}: ${first.detail ?? ''}`
    : `HTTP ${err.status}`;
}

/** The server's `detail` of an HTTP error, else its log text. */
export function httpErrorDetail(err: HttpError): string {
  return firstError(err)?.detail || httpErrorText(err);
}
