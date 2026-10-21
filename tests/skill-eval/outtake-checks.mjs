/** Decidable checks only; factual meaning is assessed separately against the rubric. */
const HEADINGS = ['🎯 Outcome', '✅ Success', '⚠️ Problems', '🧪 Manual review', '➡️ Next action'];

export function visibleMarkdown(output) {
  let fence;
  return output.split('\n').filter(line => {
    const match = line.match(/^\s*(`{3,}|~{3,})/);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = undefined;
      return false;
    }
    return !fence;
  }).join('\n');
}


export const check = (id, met, reason) => ({ id, met: Boolean(met), reason });

export function outtakeChecks(output) {
  const text = visibleMarkdown(output);
  const headings = [...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map(m => m[1]);
  const selected = headings.filter(h => HEADINGS.includes(h));
  const ordered = HEADINGS.filter(h => selected.includes(h));
  const next = text.split(/^#{1,6}\s+➡️ Next action\s*$/m)[1]?.trim() ?? '';
  const success = text.split(/^#{1,6}\s+✅ Success\s*$/m)[1]?.split(/^#{1,6}\s/gm)[0] ?? '';
  return [
    check('outtake-headings', selected.join('|') === ordered.join('|') &&
      [HEADINGS[0], HEADINGS[3], HEADINGS[4]].every(h => selected.includes(h)) &&
      /^#{1,6}\s+🎯 Outcome\s*\n/.test(text.trimStart()),
    'Required headings must be present, ordered, unique and outside code fences'),
    check('no-passed-ac-list', !success.split('\n').some(line =>
      /^\s*(?:[-*]\s+|\d+[.)]\s+|\|)/.test(line) && /\bAC[- ]?\d+\b/.test(line)) && !text.split('\n').some(line =>
      /^\s*(?:[-*]\s+|\d+[.)]\s+|\|)/.test(line) && /\bAC[- ]?\d+\b/.test(line) && /\bPASS(?:ED)?\b|✅/i.test(line)),
    'Passing acceptance criteria belong in typed evidence, not a visible list'),
    check('next-action', next && !/\n\s*\n|^#{1,6}\s/m.test(next) &&
      (next.match(/^\s*(?:[-*]|\d+[.)])\s/gm) ?? []).length <= 1,
    'End with exactly one nonempty action paragraph or list entry; meaning needs semantic review'),
  ];
}
