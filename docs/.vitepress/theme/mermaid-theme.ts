// Mermaid theme variables for the docs' diagrams: Mermaid 11's "neo" look
// (soft shadow, rounded nodes, thin edges) on the `base` theme, coloured from
// the landing's tokens — paper nodes with ink borders, butter accents, ink
// text, edge labels on the diagram box's own surface so they read as text,
// not as boxes. The site is light only, so there is one set.
// Values are literals because Mermaid paints them into the SVG.
export const MERMAID_THEME = {
  fontFamily: "'Spline Sans', ui-sans-serif, system-ui, sans-serif",
  fontSize: '15px',
  primaryColor: '#fffdf8', // node fill (paper)
  primaryBorderColor: '#2b2116', // ink
  primaryTextColor: '#2b2116',
  textColor: '#2b2116',
  lineColor: '#6e5d49', // edges, arrowheads
  secondaryColor: '#e6f3c6',
  tertiaryColor: '#fbefc2',
  background: '#fffdf8', // = --vp-c-bg-alt, the diagram box
  edgeLabelBackground: '#fffdf8',
  clusterBkg: '#f5ebda',
  clusterBorder: '#cdbda6',
  // sequence diagrams
  actorBkg: '#f3ce3a',
  actorBorder: '#2b2116',
  actorTextColor: '#2b2116',
  actorLineColor: '#b3a28a',
  signalColor: '#5a4a38',
  signalTextColor: '#2b2116',
  sequenceNumberColor: '#fffdf8',
  noteBkgColor: '#fbefc2',
  noteBorderColor: '#b8692e',
  noteTextColor: '#2b2116',
  activationBkgColor: '#f5ebda',
  activationBorderColor: '#2b2116',
}
