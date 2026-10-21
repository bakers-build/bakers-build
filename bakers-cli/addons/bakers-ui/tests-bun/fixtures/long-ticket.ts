/** Deterministic long ticket used by renderer tests and measurements. */

export const DESCRIPTION_LINE_COUNT = 500;
export const COMMENT_COUNT = 50;
export const COMMENT_SOURCE_LINES = 40;

export const DESCRIPTION_FIRST = 'DESCRIPTION-FIRST-MARKER';
export const DESCRIPTION_MIDDLE = 'DESCRIPTION-MIDDLE-MARKER';
export const DESCRIPTION_FINAL = 'DESCRIPTION-FINAL-MARKER';

const uuid = (n: number): string =>
  `019d3518-5180-7000-8000-${n.toString(16).padStart(12, '0')}`;

export const LONG_TICKET_ID = uuid(1);
export const LONG_PROJECT_ID = uuid(2);
export const LONG_USER_ID = uuid(3);
export const LONG_CONDUCTOR_ID = uuid(4);

export const commentId = (index: number): string => uuid(100 + index);

export const commentFirst = (index: number): string =>
  `COMMENT-${String(index).padStart(2, '0')}-FIRST-MARKER`;
export const commentMiddle = (index: number): string =>
  `COMMENT-${String(index).padStart(2, '0')}-MIDDLE-MARKER`;
export const commentFinal = (index: number): string =>
  `COMMENT-${String(index).padStart(2, '0')}-FINAL-MARKER`;

const FENCE_STARTS = new Set([10, 80, 160, 320, 400]);

const descriptionLine = (index: number): string => {
  if (index === 0) return `# ${DESCRIPTION_FIRST}`;
  if (index === 249) return `## ${DESCRIPTION_MIDDLE}`;
  if (index === 499) return DESCRIPTION_FINAL;
  if (FENCE_STARTS.has(index)) return '```ts';
  if (FENCE_STARTS.has(index - 1))
    return `const token_${index} = "${'x'.repeat(96)}";`;
  if (FENCE_STARTS.has(index - 2)) return '```';
  if (index % 41 === 0)
    return `- [x] task ${index} with **bold** and *italic* marks`;
  if (index % 43 === 0) return `> quoted line ${index} and ~~struck~~ text`;
  if (index % 47 === 0)
    return `[link ${index}](https://example.test/path/${'a'.repeat(72)}/${index})`;
  return `description source line ${index}`;
};

export const longDescription = (): string => {
  const lines = Array.from({ length: DESCRIPTION_LINE_COUNT }, (_line, index) =>
    descriptionLine(index),
  );
  if (lines.length !== DESCRIPTION_LINE_COUNT) {
    throw new Error('long ticket description must be 500 source lines');
  }
  return lines.join('\n');
};

const commentLine = (commentIndex: number, lineIndex: number): string => {
  if (lineIndex === 0) return `### ${commentFirst(commentIndex)}`;
  if (lineIndex === 19) return commentMiddle(commentIndex);
  if (lineIndex === 39) return commentFinal(commentIndex);
  if (lineIndex % 11 === 0)
    return `- item ${commentIndex}.${lineIndex} with \`code\``;
  if (lineIndex % 13 === 0)
    return `https://example.test/comment/${commentIndex}/${'b'.repeat(64)}`;
  return `comment ${commentIndex} source line ${lineIndex}`;
};

export const commentBody = (index: number): string =>
  Array.from({ length: COMMENT_SOURCE_LINES }, (_line, lineIndex) =>
    commentLine(index, lineIndex),
  ).join('\n');

const createdAt = (index: number): string => {
  const seconds = Date.parse('2026-08-20T23:59:59Z') / 1000 - index;
  return new Date(seconds * 1000).toISOString();
};

export const longComments = () =>
  Array.from({ length: COMMENT_COUNT }, (_item, index) => ({
    type: 'bb_comment--bb_comment',
    id: commentId(index),
    attributes: {
      drupal_internal__id: 9000 - index,
      bb_comment_type: 'comment',
      author_name: `author-${String(index).padStart(2, '0')}`,
      created: createdAt(index),
      body: { value: commentBody(index) },
    },
  }));

export const longTicketDocument = () => ({
  data: {
    id: LONG_TICKET_ID,
    type: 'bb_ticket--bb_ticket',
    attributes: {
      identifier: 'BB-518',
      title: 'Long ticket content fixture',
      state: 'coding',
      description: { value: longDescription() },
      branch_name: 'feat/a_b_c',
      base_branch: 'develop',
    },
    relationships: {
      project_id: { data: { id: LONG_PROJECT_ID } },
      assignee_user_id: { data: { id: LONG_USER_ID } },
      conductor_id: { data: { id: LONG_CONDUCTOR_ID } },
      labels: { data: [] },
    },
  },
  included: [
    ...longComments(),
    {
      id: LONG_USER_ID,
      type: 'user--user',
      attributes: { display_name: 'pat' },
    },
    {
      id: LONG_CONDUCTOR_ID,
      type: 'bb_conductor--bb_conductor',
      attributes: { label: 'runner-1' },
    },
  ],
});

export const fixtureSize = {
  descriptionSourceLines: DESCRIPTION_LINE_COUNT,
  comments: COMMENT_COUNT,
  commentSourceLines: COMMENT_SOURCE_LINES,
  commentSourceTotal: COMMENT_COUNT * COMMENT_SOURCE_LINES,
};
