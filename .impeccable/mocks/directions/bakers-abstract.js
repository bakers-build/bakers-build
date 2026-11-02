// Abstracted agent figures, three levels: line (L1), pictogram (L2), toque mark (L3).
(function(){
const toque = (x,y,s)=>`<g transform="translate(${x} ${y}) scale(${s})"><path d="M-22 14 C -30 13 -33 4 -26 -1 C -29 -11 -17 -16 -11 -10 C -7 -19 7 -19 10 -10 C 16 -16 29 -11 26 -1 C 33 4 30 13 22 14 Z"/><path d="M-21 14 H 21 V 22 H -21 Z"/></g>`;
const props = {
 spec:`<rect x="70" y="104" width="22" height="30" rx="2" transform="rotate(6 81 119)"/><path d="M75 113 h12 M75 119 h12 M75 125 h8" stroke-width="2"/>`,
 coding:`<path d="M34 128 H 86 L 92 138 H 28 Z"/><path d="M38 128 L 41 108 H 79 L 82 128"/>`,
 review:`<circle cx="88" cy="92" r="11"/><path d="M81 101 L 73 113" stroke-width="4"/>`
};
// L1 — line figure, adult proportions, no face
const L1 = k => `<g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#wob2)">
 <g fill="var(--hat,#fff)">${toque(60,22,0.82)}</g>
 <circle cx="60" cy="52" r="12" fill="var(--hat,#fff)"/>
 <path d="M60 64 V 70"/>
 <path d="M38 76 C 46 70 74 70 82 76 L 86 178 H 34 Z" fill="var(--coat,#fff)"/>
 <path d="M47 92 H 73 L 76 178 H 44 Z" fill="var(--apron,#F3CE3A)"/>
 <path d="M40 80 C 36 100 42 112 52 118"/><path d="M80 80 C 86 96 84 108 76 116"/>
 <g fill="#fff">${props[k]}</g></g>`;
// L2 — pictogram, solid ink, role colour on apron only
const L2 = k => `<g fill="currentColor" stroke="none">
 ${toque(60,22,0.82)}
 <circle cx="60" cy="52" r="12"/>
 <path d="M37 74 C 46 68 74 68 83 74 L 88 178 H 32 Z"/>
 <path d="M47 92 H 73 L 76 178 H 44 Z" fill="var(--apron,#F3CE3A)"/>
 <g fill="#fff" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${props[k]}</g></g>`;
// L3 — toque only, as a mark; role glyph on the band
const glyph = {spec:`<path d="M50 74 h20 M50 80 h20 M50 86 h12" stroke-width="3"/>`,coding:`<path d="M50 74 l7 6 -7 6 M62 86 h10" stroke-width="3"/>`,review:`<circle cx="58" cy="79" r="6" stroke-width="3"/><path d="M62 84 l6 6" stroke-width="3.4"/>`};
const L3 = k => `<g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
 <g fill="var(--hat,#fff)">${toque(60,50,1.9)}</g>
 <rect x="20" y="66" width="80" height="30" fill="var(--apron,#F3CE3A)"/>
 ${glyph[k]}</g>`;
const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width','0');svg.setAttribute('height','0');svg.style.position='absolute';
let html=`<defs><filter id="wob2"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="1.4"/></filter></defs>`;
for(const k of ['spec','coding','review']){html+=`<symbol id="l1-${k}" viewBox="0 0 120 184">${L1(k)}</symbol><symbol id="l2-${k}" viewBox="0 0 120 184">${L2(k)}</symbol><symbol id="l3-${k}" viewBox="0 0 120 110">${L3(k)}</symbol>`}
svg.innerHTML=html;document.body.prepend(svg);
})();
