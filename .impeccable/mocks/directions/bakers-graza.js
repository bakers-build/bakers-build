// Graza-style illustrations: baked goods as agents (gb-*) and reworked bakers (gp-*).
(function(){
const INK='currentColor';
// side-glance eyes: white ovals, pupils pushed toward (dx,dy), focused brows
const eyes=(x1,x2,y,dx=2,dy=0,brow=true)=>`
 <ellipse cx="${x1}" cy="${y}" rx="5.2" ry="6.4" fill="#fff" stroke="${INK}" stroke-width="2"/>
 <ellipse cx="${x2}" cy="${y}" rx="5.2" ry="6.4" fill="#fff" stroke="${INK}" stroke-width="2"/>
 <circle cx="${x1+dx}" cy="${y+dy}" r="2.7" fill="${INK}"/><circle cx="${x2+dx}" cy="${y+dy}" r="2.7" fill="${INK}"/>
 ${brow?`<path d="M${x1-6} ${y-10} q 6 -3 11 0 M${x2-5} ${y-10} q 5 -3 11 0" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`:''}`;
const S='fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';
const clip=(x,y,r=8)=>`<g transform="rotate(${r} ${x+12} ${y+16})"><rect x="${x}" y="${y}" width="24" height="32" rx="2" fill="#fff" stroke="${INK}" stroke-width="2.6"/><path d="M${x+5} ${y+9} h14 M${x+5} ${y+15} h14 M${x+5} ${y+21} h9" stroke="${INK}" stroke-width="2"/></g>`;
const lap=(x,y)=>`<path d="M${x} ${y+22} H ${x+48} L ${x+54} ${y+32} H ${x-6} Z" fill="#fff" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/><path d="M${x+3} ${y+22} L ${x+6} ${y} H ${x+42} L ${x+45} ${y+22}" fill="${INK}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/><path d="M${x+15} ${y+7} l5 4 -5 4 M${x+24} ${y+16} h8" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
const lens=(x,y)=>`<circle cx="${x}" cy="${y}" r="11" fill="rgba(255,255,255,.7)" stroke="${INK}" stroke-width="3"/><path d="M${x-7} ${y+9} L ${x-15} ${y+21}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M${x-5} ${y-4} q 4 -3 8 0" stroke="${INK}" stroke-width="2" fill="none"/>`;
const crust='var(--bake,#C9843F)', dough='var(--dough,#F3D9A4)';
const g = {
 // Laib (loaf) — Spec
 'gb-spec':`<g filter="url(#wobg)">
  <path d="M22 70 C 22 42 40 32 70 32 C 100 32 118 42 118 70 L 116 112 C 116 120 110 124 102 124 H 38 C 30 124 24 120 24 112 Z" fill="${crust}" stroke="${INK}" stroke-width="3"/>
  <path d="M40 46 l 12 14 M62 42 l 12 14 M84 42 l 12 14" stroke="${dough}" stroke-width="5" stroke-linecap="round"/>
  ${eyes(58,82,84,-2,1)}
  <path d="M24 98 C 12 100 10 112 18 118" ${S}/><path d="M116 96 C 126 98 130 106 128 112" ${S}/>
  ${clip(112,92,10)}
  <path d="M50 124 v10 h-6 M90 124 v10 h6" ${S}/></g>`,
 // Croissant — Coding
 'gb-coding':`<g filter="url(#wobg)">
  <path d="M8 100 C 4 68 36 38 70 38 C 104 38 136 68 132 100 C 126 106 116 104 110 96 C 100 100 88 102 70 102 C 52 102 40 100 30 96 C 24 104 14 106 8 100 Z" fill="${crust}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M30 96 C 26 78 32 60 46 48 M110 96 C 114 78 108 60 94 48" stroke="${INK}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  <path d="M54 52 q 8 -6 16 -6" stroke="${dough}" stroke-width="4" fill="none" stroke-linecap="round"/>
  ${eyes(60,80,74,0,3)}
  <path d="M34 98 C 34 108 38 114 46 118 M106 98 C 106 108 102 114 94 118" ${S}/>
  ${lap(46,104)}</g>`,
 // Brötchen (Semmel) — Review
 'gb-review':`<g filter="url(#wobg)">
  <path d="M18 92 C 16 56 42 34 70 34 C 98 34 124 56 122 92 C 122 110 100 120 70 120 C 40 120 18 110 18 92 Z" fill="${crust}" stroke="${INK}" stroke-width="3"/>
  <path d="M46 46 C 58 60 82 60 94 46" stroke="${dough}" stroke-width="5" fill="none" stroke-linecap="round"/>
  ${eyes(58,82,80,3,0)}
  <path d="M20 96 C 10 100 10 110 16 114" ${S}/><path d="M120 90 C 128 84 128 76 124 70" ${S}/>
  ${lens(122,58)}
  <path d="M54 120 v10 h-6 M86 120 v10 h6" ${S}/></g>`,
};
// reworked people: smaller toque, no mouth/cheeks, graza eyes, solid ink coat
const person=(prop,apron)=>`<g filter="url(#wobg)">
 <path d="M44 34 C 36 33 33 25 39 21 C 37 12 49 8 54 14 C 58 6 72 6 75 14 C 81 9 93 13 90 22 C 96 26 93 34 86 34 Z" fill="#fff" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
 <path d="M46 34 H 84 V 42 H 46 Z" fill="#fff" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
 <path d="M44 42 C 40 60 46 74 65 74 C 84 74 90 60 86 42 Z" fill="${dough}" stroke="${INK}" stroke-width="3"/>
 ${eyes(57,73,55,2,1,false)}
 <path d="M34 84 C 46 76 84 76 96 84 L 102 168 H 28 Z" fill="${INK}"/>
 <path d="M50 96 H 80 L 84 168 H 46 Z" fill="${apron}"/>
 ${prop}</g>`;
g['gp-spec']=person(clip(78,104,8)+`<path d="M38 92 C 44 110 60 118 80 116" ${S}/>`, 'var(--apron,#F3CE3A)');
g['gp-coding']=person(lap(41,110)+'', 'var(--apron,#BFE07A)');
g['gp-review']=person(lens(104,96)+`<path d="M92 90 C 96 96 96 104 96 108" ${S}/>`, 'var(--apron,#F4AFC0)');
const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width','0');svg.setAttribute('height','0');svg.style.position='absolute';
let h=`<defs><filter id="wobg"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="11"/><feDisplacementMap in="SourceGraphic" scale="2"/></filter></defs>`;
for(const [k,v] of Object.entries(g)) h+=`<symbol id="${k}" viewBox="0 0 140 ${k.startsWith("gb")?146:176}">${v}</symbol>`;
svg.innerHTML=h;document.body.prepend(svg);
})();
