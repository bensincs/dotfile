// Mounts a transparent chalk layer over the current page so notes can be drawn on a live app.
// Needs rough.js and board.js loaded first. Items can aim at page elements by CSS selector.
window.__mountNotes = theme => {
  if (window.__notes) return;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
  Object.assign(svg.style, {
    position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: 2147483645, pointerEvents: 'none',
  });
  svg.innerHTML = `<defs><filter id="__notes_grain" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="4" result="noise"/>
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" result="rough"/>
    <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2 1.85" result="mask"/>
    <feComposite in="rough" in2="mask" operator="in"/></filter></defs>
    <g class="ink"></g>`;
  document.body.append(svg);
  // The first visible element matching a selector, in viewport pixels.
  const resolve = selector => {
    if (typeof selector !== 'string') return null;
    const known = window.__noteRects && window.__noteRects[selector]; // resolved by Playwright
    if (known) return known;
    let found;
    try { found = [...document.querySelectorAll(selector)].find(el => el.getClientRects().length); } catch { return null; }
    if (!found) return null;
    const r = found.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  window.__notes = window.createChalkboard(svg, { theme, resolve });
};
