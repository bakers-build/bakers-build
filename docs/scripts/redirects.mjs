// A `/old#anchor` key sends that anchor elsewhere; any other anchor is kept.
export const redirectPage = (to, anchors = {}) =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page moved</title>' +
  `<meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${to}">` +
  `<script>location.replace(${JSON.stringify(anchors)}[location.hash] || ${JSON.stringify(to)}${to.includes('#') ? '' : ' + location.hash'})</script>` +
  `<link rel="canonical" href="${to}"></head><body><p>This page moved to <a href="${to}">${to}</a>.</p></body></html>\n`
