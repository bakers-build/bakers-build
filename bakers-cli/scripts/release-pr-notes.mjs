// The release PR body's hand-written sections that the `release` job appends to the GitHub
// release notes, in this order.
export const PR_SECTIONS = ['Upgrade notes', 'Known open issues'];

// Each present PR_SECTIONS section of a Markdown PR body, verbatim from its `### <name>` heading
// up to the next level 1–3 heading outside a code fence, joined by a blank line; '' when none.
export function prSections(body) {
  const lines = (body ?? '').replaceAll('\r\n', '\n').split('\n');
  const found = new Map();
  let current;
  let fenced = false;
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && /^#{1,3} /.test(line)) {
      const name = /^### (.+?)\s*$/.exec(line)?.[1].toLowerCase();
      current = PR_SECTIONS.find(section => section.toLowerCase() === name && !found.has(section));
      if (current) found.set(current, []);
    }
    if (current) found.get(current).push(line);
  }
  return PR_SECTIONS.filter(section => found.has(section))
    .map(section => found.get(section).join('\n').replace(/\s+$/, ''))
    .join('\n\n');
}
