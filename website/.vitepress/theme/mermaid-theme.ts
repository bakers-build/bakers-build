// Mermaid theme variables for the docs' diagrams (BB-427 D7): Mermaid 11's
// "neo" look (soft shadow, rounded nodes, thin edges) on the `base` theme,
// coloured from the docs tokens — violet nodes, slate text, quiet grey edges,
// edge labels on the diagram box's own surface so they read as text, not as
// boxes. One set per colour scheme; BbMermaid.vue picks by `html.dark`.
// Values are literals because Mermaid paints them into the SVG.
const font = "'Nunito Sans', 'Inter', ui-sans-serif, system-ui, sans-serif"

const shared = {
  fontFamily: font,
  fontSize: '15px',
}

export const MERMAID_LIGHT = {
  ...shared,
  primaryColor: '#efe9ff', // node fill
  primaryBorderColor: '#8f68ff',
  primaryTextColor: '#2e3438',
  textColor: '#2e3438',
  lineColor: '#8d8aa6', // edges, arrowheads
  secondaryColor: '#e6f7f0',
  tertiaryColor: '#fff4e0',
  background: '#f7f8fa', // = --vp-c-bg-alt, the diagram box
  edgeLabelBackground: '#f7f8fa',
  clusterBkg: '#f3f4f7',
  clusterBorder: '#e6e8ec',
  // sequence diagrams
  actorBkg: '#efe9ff',
  actorBorder: '#8f68ff',
  actorTextColor: '#2e3438',
  actorLineColor: '#b9b6cc',
  signalColor: '#5c6870',
  signalTextColor: '#2e3438',
  sequenceNumberColor: '#ffffff',
  noteBkgColor: '#fff4e0',
  noteBorderColor: '#f0c674',
  noteTextColor: '#2e3438',
  activationBkgColor: '#e6e1fb',
  activationBorderColor: '#8f68ff',
}

export const MERMAID_DARK = {
  ...shared,
  darkMode: true,
  primaryColor: '#241b45',
  primaryBorderColor: '#8f68ff',
  primaryTextColor: '#ecebf5',
  textColor: '#ecebf5',
  lineColor: '#8e8ba3',
  secondaryColor: '#12352a',
  tertiaryColor: '#3a2d12',
  background: '#0b0816', // = dark --vp-c-bg-alt
  mainBkg: '#241b45',
  edgeLabelBackground: '#0b0816',
  clusterBkg: '#181329',
  clusterBorder: '#2a2440',
  // sequence diagrams
  actorBkg: '#241b45',
  actorBorder: '#8f68ff',
  actorTextColor: '#ecebf5',
  actorLineColor: '#5a5675',
  signalColor: '#a3a1b8',
  signalTextColor: '#ecebf5',
  sequenceNumberColor: '#100c1d',
  noteBkgColor: '#3a2d12',
  noteBorderColor: '#8a6a1f',
  noteTextColor: '#ecebf5',
  activationBkgColor: '#2f2560',
  activationBorderColor: '#8f68ff',
}
