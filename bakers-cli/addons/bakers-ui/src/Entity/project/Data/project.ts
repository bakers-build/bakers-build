import type { DropshClient } from '../../../types.js';

export interface ResolvedProject {
  id: string;
  name: string;
  slug: string;
}

/**
 * Thrown when a project-name lookup matches more than one `bb_project` row.
 * `bb_project.name` carries no server-side uniqueness constraint, so a name
 * alone can be ambiguous (BB-472).
 */
export class AmbiguousProjectNameError extends Error {
  override readonly name = 'AmbiguousProjectNameError';
}

/** Resolve project identity without reading any project-owned collections. */
export async function resolveProject(
  client: DropshClient,
  slug: string,
): Promise<ResolvedProject> {
  // BB-472: a plain `.first()` silently picked the first row of a name
  // match. Read up to 2 rows instead — enough to detect "more than one"
  // without paging the whole table — and fail loudly rather than guess.
  const rows = await client
    .collection('bb_project')
    .where('name', '=', slug)
    .page(2)
    .list();
  if (rows.length > 1) {
    throw new AmbiguousProjectNameError(
      `bakers project "${slug}" is ambiguous: at least ${rows.length} projects share this name. Name a workspace to disambiguate.`,
    );
  }
  const document = rows[0];
  return {
    id: document?.id ?? slug,
    name: (document?.attr('name') as string | undefined) ?? slug,
    slug,
  };
}
