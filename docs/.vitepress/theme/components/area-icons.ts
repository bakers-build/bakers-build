// Coloured 18×18 icons for the documentation areas — the sidebar strip and the
// docs-home quick links (BB-427 D7, after storybook.js.org/docs, whose area
// rows carry small two-tone icons). Drawn here in the landing's palette rather
// than pulled from an icon library, so the site ships no extra dependency:
// butter and crust (Guide), sprout and ink (Reference), butter and ink
// (Contributing), rose and crust (Changelog). Each value is a complete <svg> element.
const svg = (body: string) =>
  `<svg viewBox="0 0 18 18" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`

export const AREA_ICONS: Record<string, string> = {
  // an open book — two pages
  guide: svg(
    '<path d="M8.3 3.2C6.9 2.3 5 1.8 2.7 1.7A1.9 1.9 0 0 0 .7 3.6v9.3c0 1 .8 1.9 1.8 1.9 2.2.1 4.1.6 5.8 1.7V3.2Z" fill="#F3CE3A"/>' +
      '<path d="M9.7 3.2c1.4-.9 3.3-1.4 5.6-1.5a1.9 1.9 0 0 1 2 1.9v9.3c0 1-.8 1.9-1.8 1.9-2.2.1-4.1.6-5.8 1.7V3.2Z" fill="#B8692E"/>',
  ),
  // the API pill with angle brackets
  reference: svg(
    '<rect x="0" y="1" width="18" height="16" rx="8" fill="#BFE07A"/>' +
      '<path d="M7.2 5.6 3.9 9l3.3 3.4M10.8 5.6 14.1 9l-3.3 3.4" stroke="#2B2116" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  // a plus badge
  contributing: svg(
    '<circle cx="9" cy="9" r="8" fill="#F3CE3A"/>' +
      '<path d="M9 5.2v7.6M5.2 9h7.6" stroke="#2B2116" stroke-width="2" stroke-linecap="round"/>',
  ),
  // a bolt
  changelog: svg(
    '<path d="M10.6 1 3.4 10.4h4.4L6.6 17l7.9-9.6h-4.5L10.6 1Z" fill="#F4AFC0"/>' +
      '<path d="M10.6 1 3.4 10.4h4.4l-.9 3.4 7.6-6.4h-4.5L10.6 1Z" fill="#B8692E" opacity=".6"/>',
  ),
}
