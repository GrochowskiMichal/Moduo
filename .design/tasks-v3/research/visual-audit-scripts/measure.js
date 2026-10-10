(() => {
  const root = document.querySelector('#storybook-root') || document.body;
  const sel = 'button, a, input, textarea, [role], h1, h2, h3, svg, [class*="text-"], [data-task-row], li, td, th';
  const nodes = Array.from(root.querySelectorAll(sel)).slice(0, 900);
  const seen = new Set();
  const out = [];
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    const txt = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 48);
    const key = el.tagName + '|' + Math.round(r.x) + '|' + Math.round(r.y) + '|' + Math.round(r.width) + '|' + Math.round(r.height) + '|' + txt;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || undefined,
      aria: el.getAttribute('aria-label') || undefined,
      txt,
      cls: (el.getAttribute('class') || '').slice(0, 220),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
      fs: cs.fontSize, fw: cs.fontWeight, ff: cs.fontFamily.split(',')[0], lh: cs.lineHeight,
      color: cs.color, bg: cs.backgroundColor, br: cs.borderRadius, pad: cs.padding, op: cs.opacity,
      bw: cs.borderWidth, bc: cs.borderColor, gap: cs.gap, tt: cs.textTransform, ls: cs.letterSpacing,
    });
  }
  return out;
})()