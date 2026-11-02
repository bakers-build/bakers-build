// Monoline doodles (Graza line style): black outline, white fill, action marks.
(function(){
const L='fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"';
const W='fill="#fff" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"';
// bulging eyes sitting on the outline; pupils look toward (dx,dy); r1/r2 sizes
const eyes=(x,y,dx,dy,r1=8,r2=6.5)=>`<circle cx="${x}" cy="${y}" r="${r1}" ${W}/><circle cx="${x+r1+r2-1}" cy="${y+1}" r="${r2}" ${W}/>
 <circle cx="${x+dx}" cy="${y+dy}" r="2.8" fill="currentColor"/><circle cx="${x+r1+r2-1+dx*.8}" cy="${y+1+dy*.8}" r="2.4" fill="currentColor"/>`;
const sparks=(x,y,s=1)=>`<g transform="translate(${x} ${y}) scale(${s})" ${L}><path d="M0 -12 V -4 M-10 -6 l5 4 M10 -6 l-5 4"/></g>`;
const steam=(x,y)=>`<g ${L} stroke-width="3"><path d="M${x} ${y} c -5 -6 5 -10 0 -16"/><path d="M${x+12} ${y-2} c -5 -6 5 -10 0 -16"/></g>`;
const bang=(x,y,ch)=>`<g><circle cx="${x}" cy="${y}" r="11" ${W}/><text x="${x}" y="${y+5.5}" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="16" fill="currentColor">${ch}</text></g>`;
const s={
 // Laib + pencil, writing the plan
 spec:`<g filter="url(#wobl)">
  <path d="M24 66 C 24 44 40 36 64 36 C 88 36 104 44 104 66 L 102 116 H 26 Z" ${W}/>
  <path d="M42 50 l9 10 M60 46 l9 10" ${L}/>
  ${eyes(54,72,3,2)}
  <path d="M60 94 q 5 3 10 0" ${L}/>
  <path d="M104 92 C 112 92 116 98 116 104" ${L}/>
  <path d="M104 118 l 22 -26 l 6 5 l -22 26 l -9 3 Z" ${W}/>
  <path d="M86 132 H 128" ${L}/><path d="M92 126 c 4 -4 8 4 12 0" ${L} stroke-width="2.6"/>
  ${sparks(118,30,.9)}</g>`,
 // Brezel at a laptop, steaming
 coding:`<g filter="url(#wobl)">
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
   <path id="bz" d="M66 44 C 40 24 6 40 12 72 C 16 96 40 106 66 106 C 92 106 116 96 120 72 C 126 40 92 24 66 44" stroke="currentColor" stroke-width="17"/>
   <path d="M66 44 C 40 24 6 40 12 72 C 16 96 40 106 66 106 C 92 106 116 96 120 72 C 126 40 92 24 66 44" stroke="#fff" stroke-width="10"/>
   <path d="M76 50 C 66 64 54 80 42 102" stroke="currentColor" stroke-width="17"/><path d="M76 50 C 66 64 54 80 42 102" stroke="#fff" stroke-width="10"/>
   <path d="M56 50 C 66 64 78 80 90 102" stroke="currentColor" stroke-width="17"/><path d="M56 50 C 66 64 78 80 90 102" stroke="#fff" stroke-width="10"/>
  </g>
  ${eyes(55,60,2,4,7.5,6)}
  <path d="M30 128 H 102 L 108 136 H 24 Z" ${W}/><path d="M36 128 L 40 108 H 92 L 96 128" ${W}/>
  <path d="M52 114 l6 5 -6 5 M64 124 h 10" ${L} stroke-width="3"/>
  ${steam(58,22)}</g>`,
 // Brötchen with magnifier, alarmed "!"
 review:`<g filter="url(#wobl)">
  <path d="M18 92 C 16 62 38 44 64 44 C 90 44 112 62 110 92 C 110 110 90 118 64 118 C 38 118 18 110 18 92 Z" ${W}/>
  <path d="M42 56 C 54 66 74 66 86 56" ${L}/>
  ${eyes(48,76,4,0)}
  <ellipse cx="62" cy="98" rx="3.4" ry="4.4" ${L} stroke-width="3"/>
  <circle cx="110" cy="64" r="13" ${W}/><path d="M101 74 L 90 88" ${L} stroke-width="5"/>
  ${bang(24,34,'!')}${sparks(124,40,.8)}</g>`,

 // Waage — qualification: weighs the ticket
 scale:`<g filter="url(#wobl)">
  <rect x="20" y="62" width="100" height="10" rx="4" ${W}/><path d="M60 72 v 4 M80 72 v 4" ${L}/>
  <path d="M26 74 H 114 L 108 122 H 32 Z" ${W}/>
  ${eyes(52,92,3,0,8,6.5)}
  <path d="M84 98 a 10 10 0 1 1 0.1 0" ${L} stroke-width="3"/><path d="M90 98 l 5 -6" ${L} stroke-width="3"/>
  <path d="M46 62 L 50 34 L 92 30 L 94 62" ${W}/><path d="M56 42 h 28 M57 50 h 20" ${L} stroke-width="2.6"/>
  ${sparks(110,32,.8)}</g>`,
 // Teigschaber — spec: cuts the work into pieces
 scraper:`<g filter="url(#wobl)">
  <path d="M32 40 H 100 C 104 40 106 44 104 48 L 100 58 H 36 L 30 48 C 28 44 30 40 32 40 Z" ${W}/>
  <path d="M36 58 H 100 V 102 L 104 108 H 32 L 36 102 Z" ${W}/>
  ${eyes(54,78,2,4,8,6.5)}
  <path d="M62 96 h 10" ${L}/>
  <rect x="14" y="116" width="26" height="16" rx="5" ${W}/><rect x="56" y="116" width="26" height="16" rx="5" ${W}/><rect x="98" y="116" width="26" height="16" rx="5" ${W}/>
  <path d="M46 112 v 22 M90 112 v 22" ${L} stroke-width="2.6" stroke-dasharray="3 5"/></g>`,
 // Nudelholz — coding: does the rolling
 pin:`<g filter="url(#wobl)">
  <rect x="6" y="58" width="22" height="12" rx="6" ${W}/><rect x="112" y="58" width="22" height="12" rx="6" ${W}/>
  <rect x="26" y="46" width="88" height="36" rx="10" ${W}/>
  ${eyes(57,63,4,0,8,6.5)}
  <path d="M34 54 v 20 M106 54 v 20" ${L} stroke-width="2.4"/>
  <path d="M14 104 C 30 96 110 96 126 104 C 122 112 18 112 14 104 Z" ${W}/>
  <path d="M8 40 h 12 M4 50 h 10 M120 40 h 12 M126 50 h 10" ${L} stroke-width="2.8"/></g>`,
 // Ofen — coding: where the work actually happens
 oven:`<g filter="url(#wobl)">
  <rect x="18" y="30" width="104" height="96" rx="8" ${W}/>
  <path d="M18 54 H 122" ${L}/>
  ${eyes(30,42,3,1,7,5.5)}
  <circle cx="92" cy="42" r="5" ${W} stroke-width="3"/><circle cx="108" cy="42" r="5" ${W} stroke-width="3"/>
  <rect x="32" y="66" width="76" height="46" rx="6" ${W}/>
  <path d="M46 102 C 46 88 56 82 70 82 C 84 82 94 88 94 102 Z" ${W} stroke-width="3"/>
  <path d="M60 88 l 4 6 M72 86 l 4 6" ${L} stroke-width="2.4"/>
  <path d="M40 74 h 60" ${L} stroke-width="2.4" stroke-dasharray="4 6"/>
  <path d="M30 126 v 6 M110 126 v 6" ${L}/>
  <g ${L} stroke-width="3"><path d="M46 22 c -4 -5 4 -8 0 -13"/><path d="M70 20 c -4 -5 4 -8 0 -13"/><path d="M94 22 c -4 -5 4 -8 0 -13"/></g></g>`,
 // Backpinsel — review: the finishing touch
 brush:`<g filter="url(#wobl)">
  <path d="M86 20 L 100 28 L 70 82 L 56 74 Z" ${W}/>
  <path d="M56 74 L 70 82 L 64 94 L 48 86 Z" ${W}/>
  <path d="M48 86 L 64 94 L 62 104 C 56 116 40 126 26 124 C 26 110 32 96 40 90 Z" ${W}/>
  <path d="M52 98 L 36 116 M58 100 L 44 120 M46 94 L 30 110" ${L} stroke-width="2.4"/>
  ${eyes(70,46,-3,3,7.5,6)}
  <path d="M14 132 q 4 -10 8 0 a 4 4 0 0 1 -8 0 Z" ${W} stroke-width="2.8"/>
  ${sparks(112,56,.9)}</g>`,
};
const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width','0');svg.setAttribute('height','0');svg.style.position='absolute';
let h=`<defs><filter id="wobl"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="5"/><feDisplacementMap in="SourceGraphic" scale="1.8"/></filter></defs>`;
for(const [k,v] of Object.entries(s)) h+=`<symbol id="ln-${k}" viewBox="0 0 140 140">${v}</symbol>`;
svg.innerHTML=h;document.body.prepend(svg);
})();
