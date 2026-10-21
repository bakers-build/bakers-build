/** Default cap for a title slug — keeps tab labels and branch names short. */
export const DEFAULT_SLUG_MAX_LENGTH = 40;

/**
 * Turn free text (a ticket title) into a short, ref-safe slug:
 * lowercase, non-alphanumeric runs collapsed to `-`, trimmed, and capped to
 * `maxLength` characters without leaving a trailing separator. Returns `''`
 * for input that has no usable characters.
 */
export function slugify(
  text: string,
  maxLength: number = DEFAULT_SLUG_MAX_LENGTH,
): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= maxLength) {
    return slug;
  }
  return slug.slice(0, maxLength).replace(/-+$/g, '');
}
