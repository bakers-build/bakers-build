// Hand-drawn baker figures (agents) — shared by all direction mocks.
// Ink = currentColor, apron = var(--apron), hat = var(--hat).
(function(){
const wobble = `<filter id="wob" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="2.6"/></filter>`;
const base = (prop, arms, face='') => `
 <g filter="url(#wob)" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
  <g transform="translate(60 67) scale(.84) translate(-60 -67)">
  <path d="M33 58 C 22 57 17 44 27 37 C 22 23 40 15 48 24 C 53 11 72 11 75 23 C 84 15 100 22 95 36 C 104 41 99 57 87 57 Z" fill="var(--hat,#fff)"/>
  <path d="M35 57 L 85 57 L 84 67 L 36 67 Z" fill="var(--hat,#fff)"/>
  <path d="M56 41 C 58 47 58 52 57 56"/><path d="M66 38 C 68 45 68 51 67 56"/></g>
  <ellipse cx="60" cy="88" rx="24" ry="21" fill="var(--skin,#fff)"/>
  <circle cx="51" cy="86" r="2.6" fill="currentColor" stroke="none"/><circle cx="69" cy="86" r="2.6" fill="currentColor" stroke="none"/>
  <path d="M52 96 Q 60 103 68 96"/>${face}
  <path d="M40 92 q 3 2 6 0" stroke="var(--cheek,#e9a0a0)" stroke-width="3" opacity=".9"/><path d="M74 92 q 3 2 6 0" stroke="var(--cheek,#e9a0a0)" stroke-width="3" opacity=".9"/>
  <path d="M38 114 C 30 136 29 158 33 176 L 87 176 C 91 158 90 136 82 114 C 74 108 46 108 38 114 Z" fill="var(--coat,#fff)"/>
  <path d="M45 124 L 75 124 L 79 176 L 41 176 Z" fill="var(--apron,#f4cf3c)"/>
  <path d="M45 124 C 40 120 36 121 33 124"/><path d="M75 124 C 80 120 84 121 87 124"/>
  ${arms}
 </g>${prop}`;
const figs = {
 spec: base(`
  <g filter="url(#wob)" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
   <rect x="66" y="128" width="30" height="38" rx="3" fill="#fff" transform="rotate(8 81 147)"/>
   <path d="M74 133 h12" stroke-width="5"/><path d="M73 143 h17 M72 150 h18 M71 157 h12" stroke-width="2"/>
  </g>`, `<path d="M40 130 C 50 146 62 150 70 146"/><path d="M82 128 C 92 134 96 142 94 150"/>`,
  `<circle cx="51" cy="86" r="7" stroke-width="2.4"/><circle cx="69" cy="86" r="7" stroke-width="2.4"/><path d="M58 86 h4" stroke-width="2.4"/>`),
 coding: base(`
  <g filter="url(#wob)" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
   <path d="M28 150 L 92 150 L 98 164 L 22 164 Z" fill="#fff"/>
   <path d="M32 150 L 36 128 L 84 128 L 88 150" fill="var(--screen,#2a2a2a)"/>
   <path d="M44 136 l5 4 -5 4 M54 145 h10" stroke="var(--screen-ink,#fff)" stroke-width="2.4"/>
  </g>`, `<path d="M38 124 C 32 140 34 152 40 156"/><path d="M82 124 C 88 140 86 152 80 156"/>`,
  `<path d="M38 78 C 40 70 46 68 50 72" stroke-width="2.6"/><path d="M82 78 C 80 70 74 68 70 72" stroke-width="2.6"/>`),
 review: base(`
  <g filter="url(#wob)" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
   <circle cx="94" cy="104" r="13" fill="rgba(255,255,255,.55)"/><path d="M86 115 L 76 130" stroke-width="5"/>
   <path d="M89 99 q 4 -3 8 0" stroke-width="2"/>
  </g>`, `<path d="M40 130 C 46 146 54 152 60 150"/><path d="M82 126 C 80 130 78 132 76 132"/>`,
  `<path d="M50 93 C 54 90 58 91 60 93 C 62 91 66 90 70 93" stroke-width="3.4"/>`),
};
const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
svg.setAttribute('width','0');svg.setAttribute('height','0');svg.style.position='absolute';
svg.innerHTML = `<defs>${wobble}</defs>` + Object.entries(figs).map(([k,v])=>`<symbol id="baker-${k}" viewBox="0 0 120 184">${v}</symbol>`).join('');
document.body.prepend(svg);
// heads only (for avatars)
const head = `<symbol id="baker-head" viewBox="16 6 88 108"><g filter="url(#wob)" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M33 58 C 22 57 17 44 27 37 C 22 23 40 15 48 24 C 53 11 72 11 75 23 C 84 15 100 22 95 36 C 104 41 99 57 87 57 Z" fill="var(--hat,#fff)"/>
  <path d="M35 57 L 85 57 L 84 67 L 36 67 Z" fill="var(--hat,#fff)"/>
  <ellipse cx="60" cy="88" rx="24" ry="21" fill="var(--skin,#fff)"/>
  <circle cx="51" cy="86" r="2.8" fill="currentColor" stroke="none"/><circle cx="69" cy="86" r="2.8" fill="currentColor" stroke="none"/>
  <path d="M52 96 Q 60 103 68 96"/></g></symbol>`;
svg.innerHTML += head;
})();
