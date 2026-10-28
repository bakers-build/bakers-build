import type { Resource } from '../../src/types.js';

interface IncludedDoc {
  included?: {
    id: string;
    type: string;
    attributes?: Record<string, unknown>;
  }[];
}

/**
 * The `bb_project` rows a fake `bb_conductor` document sideloads, as the
 * resources `collection('bb_project').whereIn('id', …).list()` answers.
 *
 * The Projects tab names its projects through that read, not through the
 * conductor response's `included`, so a fake serving a conductor document
 * serves its projects here too. It ignores the `whereIn` ids: every fixture
 * project is one its conductors reference.
 */
export const includedProjects = (doc: IncludedDoc): Resource[] =>
  (doc.included ?? [])
    .filter((row) => row.type === 'bb_project--bb_project')
    .map((row) => ({
      id: row.id,
      type: row.type,
      attr: (key: string) => row.attributes?.[key],
      rel: () => null,
      rels: () => [],
    }));
