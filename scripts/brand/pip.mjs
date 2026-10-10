// Pip as static SVG markup (happy, stage 3 flower) with fixed colours, for icons and share images.
export const pip = (size, { mood = 'happy', flower = true } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -16 80 96" width="${size}" height="${size * 96 / 80}">
<defs>
<radialGradient id="b" cx="36%" cy="28%" r="78%"><stop offset="0" stop-color="#a3e0b6"/><stop offset=".38" stop-color="#5cbf7c"/><stop offset="1" stop-color="#3f9a5e"/></radialGradient>
<linearGradient id="l" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2f8f4e"/><stop offset="1" stop-color="#7fd49a"/></linearGradient>
<linearGradient id="y" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a3e0b6" stop-opacity="0"/><stop offset="1" stop-color="#a3e0b6" stop-opacity=".85"/></linearGradient>
</defs>
<ellipse cx="40" cy="74.5" rx="19" ry="3.2" fill="#3f9a5e" opacity=".16"/>
<path d="M40 17 C40 12 40 ${flower ? 5 : 11} 41 ${flower ? -1 : 8}" fill="none" stroke="#2f8f4e" stroke-width="2.4" stroke-linecap="round"/>
${flower ? `<path fill="url(#l)" d="M40.5 10 C46 2 56 2 60 6 C55 12 47 13 40.5 10 Z"/><path fill="url(#l)" d="M40 12 C34 5 26 5 22 8 C26 14 34 15 40 12 Z"/>
${[0,72,144,216,288].map(a=>`<circle cx="${41+5.2*Math.sin(a*Math.PI/180)}" cy="${-7-5.2*Math.cos(a*Math.PI/180)}" r="4.2" fill="#f48fb1"/>`).join('')}<circle cx="41" cy="-7" r="3" fill="#f5c542"/>`
: `<path fill="url(#l)" d="M41 9 C45 3 53 3 56 6 C52 11 46 12 41 9 Z"/><path fill="url(#l)" d="M40 11 C36 6 30 6 27 8 C30 13 36 13 40 11 Z"/>`}
<path d="M20 47 L13 55" stroke="#3f9a5e" stroke-width="7" stroke-linecap="round"/><path d="M60 40 L69 29" stroke="#3f9a5e" stroke-width="7" stroke-linecap="round"/>
<ellipse cx="30.5" cy="69.5" rx="6.5" ry="3.8" fill="#3f9a5e"/><ellipse cx="49.5" cy="69.5" rx="6.5" ry="3.8" fill="#3f9a5e"/>
<path fill="url(#b)" d="M40 16 C55 16 65 28 65.5 43 C66 58 55 70 40 70 C25 70 14 58 14.5 43 C15 28 25 16 40 16 Z"/>
<ellipse fill="url(#y)" cx="40" cy="52" rx="15.5" ry="13.5"/>
<ellipse cx="29" cy="27" rx="5.5" ry="3" fill="#fff" opacity=".55" transform="rotate(-32 29 27)"/><circle cx="36.5" cy="22.5" r="1.4" fill="#fff" opacity=".55"/>
${mood === 'happy'
  ? `<path d="M27 42 Q31.5 35.5 36 42" fill="none" stroke="#1d2939" stroke-width="2.8" stroke-linecap="round"/><path d="M44 42 Q48.5 35.5 53 42" fill="none" stroke="#1d2939" stroke-width="2.8" stroke-linecap="round"/>`
  : `<ellipse cx="31.5" cy="41" rx="3.7" ry="4.3" fill="#1d2939"/><ellipse cx="48.5" cy="41" rx="3.7" ry="4.3" fill="#1d2939"/><circle cx="33" cy="39.2" r="1.5" fill="#fff"/><circle cx="50" cy="39.2" r="1.5" fill="#fff"/><circle cx="30" cy="43" r=".7" fill="#fff"/><circle cx="47" cy="43" r=".7" fill="#fff"/>`}
<ellipse cx="24" cy="48.5" rx="4.6" ry="2.7" fill="#f6a5a0" opacity=".6"/><ellipse cx="56" cy="48.5" rx="4.6" ry="2.7" fill="#f6a5a0" opacity=".6"/>
<path d="M33.5 47.5 Q40 54.5 46.5 47.5" fill="none" stroke="#1d2939" stroke-width="2.4" stroke-linecap="round"/>
</svg>`
