// Chalk drawing engine. Runs inside the recorded page.
//   createChalkboard(svg, { theme, chalk, resolve }) -> { draw, erase, clear, ready }
// The chalkboard uses a 1600 x 900 viewBox; notes over an app use the viewport's own pixels and
// can aim at page elements through `resolve(selector)`. Items draw stroke by stroke.
window.createChalkboard = (svg, { theme, chalk = null, resolve = null }) => {
  const NS = 'http://www.w3.org/2000/svg';
  const defs = svg.querySelector('defs');
  const ink = svg.querySelector('.ink');
  const ghosts = svg.querySelector('.ghosts');
  const rc = rough.svg(svg);
  const view = svg.viewBox.baseVal;
  // The chalk grain is applied per drawn item, not to the whole layer: animating one stroke then
  // re-filters only that item instead of everything on the board, which keeps drawing smooth.
  const grain = svg.querySelector('filter')?.id;
  const layer = node => {
    const g = el('g', grain ? { filter: `url(#${grain})` } : {});
    g.append(node);
    ink.append(g);
    return node;
  };
  const items = new Map(); // id -> { x, y, w, h } in board coordinates
  let seed = 11;
  let uid = 0;

  const colour = name => theme.colors[name] || name || theme.colors.white;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const el = (tag, attrs = {}) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const roughOptions = (c, extra = {}) => ({
    stroke: colour(c), strokeWidth: 2.8, roughness: 1.3, bowing: 1.1, disableMultiStroke: false, seed: seed++, ...extra,
  });

  // ---------- the chalk piece ----------
  function chalkTo(x, y) {
    if (!chalk) return;
    const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
    chalk.style.transform = `translate(${p.x}px, ${p.y}px) rotate(-38deg)`;
    chalk.style.opacity = '1';
  }
  const chalkAway = () => { if (chalk) chalk.style.opacity = '0'; };

  // ---------- primitives that animate ----------
  async function stroke(path, ms) {
    const length = path.getTotalLength();
    if (!length) return;
    path.style.strokeDasharray = `${length} ${length}`;
    path.style.strokeDashoffset = `${length}`;
    const start = performance.now();
    await new Promise(resolve => {
      const tick = now => {
        const t = Math.min(1, (now - start) / ms);
        path.style.strokeDashoffset = `${length * (1 - t)}`;
        const p = path.getPointAtLength(length * t);
        chalkTo(p.x, p.y);
        t < 1 ? requestAnimationFrame(tick) : resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  // Draws a rough.js shape: every path in it, in order, sharing the time by length.
  async function sketch(node, ms) {
    layer(node);
    const paths = [...node.querySelectorAll('path')];
    for (const p of paths) { p.style.strokeLinecap = 'round'; p.style.strokeLinejoin = 'round'; }
    const lengths = paths.map(p => p.getTotalLength());
    const total = lengths.reduce((a, b) => a + b, 0) || 1;
    for (const [i, p] of paths.entries()) await stroke(p, Math.max(60, ms * lengths[i] / total));
  }

  function textNode(str, x, y, { size = 44, c, anchor = 'middle', weight = 600, rotate = 0 } = {}) {
    const node = el('text', {
      x, y, 'font-size': size, 'font-weight': weight, 'text-anchor': anchor, 'dominant-baseline': 'central',
      fill: colour(c), 'font-family': 'Chalk, Caveat, cursive', ...(rotate ? { transform: `rotate(${rotate} ${x} ${y})` } : {}),
    });
    node.textContent = str;
    return node;
  }

  function measure(str, opts) {
    const node = textNode(str, 0, 0, opts);
    node.style.visibility = 'hidden';
    svg.append(node);
    const box = node.getBBox();
    node.remove();
    return { w: box.width, h: box.height };
  }

  // Writes text left to right behind a growing clip, the chalk riding the edge.
  async function write(str, x, y, opts, ms) {
    const node = textNode(str, x, y, opts);
    layer(node);
    const box = node.getBBox();
    const id = `clip${uid++}`;
    const rect = el('rect', { x: box.x - 4, y: box.y - 12, width: 0, height: box.height + 24 });
    const clip = el('clipPath', { id });
    clip.append(rect);
    defs.append(clip);
    node.setAttribute('clip-path', `url(#${id})`);
    const start = performance.now();
    await new Promise(resolve => {
      const tick = now => {
        const t = Math.min(1, (now - start) / ms);
        const w = (box.width + 8) * t;
        rect.setAttribute('width', w);
        chalkTo(box.x + w, box.y + box.height * (0.55 + 0.18 * Math.sin(t * Math.PI * 14)));
        t < 1 ? requestAnimationFrame(tick) : resolve();
      };
      requestAnimationFrame(tick);
    });
    node.removeAttribute('clip-path');
    clip.remove();
    return { x: box.x, y: box.y, w: box.width, h: box.height };
  }

  // ---------- geometry ----------
  const centre = r => [r.x + r.w / 2, r.y + r.h / 2];
  // An id drawn earlier, a page element (selector) when aiming at an app, or an [x, y] point.
  const at = ref => {
    if (Array.isArray(ref)) return { x: ref[0], y: ref[1], w: 0, h: 0 };
    if (items.has(ref)) return items.get(ref);
    const found = resolve && resolve(ref);
    if (found) return found;
    throw new Error(`chalk: nothing drawn with id, or visible on the page, matching "${ref}"`);
  };
  // Where to put text: a point, or beside something (`side`: right, left, above, below; or centred on it).
  function place(it, size) {
    const [dx, dy] = it.offset || [0, 0];
    if (Array.isArray(it.at)) return { x: it.at[0] + dx, y: it.at[1] + dy, anchor: null };
    const r = at(it.at); const gap = it.gap ?? 22; const [cx, cy] = centre(r);
    switch (it.side) {
      case 'right': return { x: r.x + r.w + gap + dx, y: cy + dy, anchor: 'start' };
      case 'left': return { x: r.x - gap + dx, y: cy + dy, anchor: 'end' };
      case 'above': return { x: cx + dx, y: r.y - gap - size / 2 + dy, anchor: 'middle' };
      case 'below': return { x: cx + dx, y: r.y + r.h + gap + size / 2 + dy, anchor: 'middle' };
      default: return { x: cx + dx, y: cy + dy, anchor: 'middle' };
    }
  }
  // Where the line from a rectangle's centre towards (tx, ty) leaves it, plus a gap.
  function edge(r, tx, ty, gap = 12) {
    const [cx, cy] = centre(r);
    const dx = tx - cx; const dy = ty - cy;
    if (!r.w && !r.h) return [cx, cy];
    const sx = r.w / 2 / Math.abs(dx || 1e-9); const sy = r.h / 2 / Math.abs(dy || 1e-9);
    const s = Math.min(sx, sy);
    const len = Math.hypot(dx, dy) || 1;
    return [cx + dx * s + (dx / len) * gap, cy + dy * s + (dy / len) * gap];
  }

  // ---------- items ----------
  // Each returns { weight, run(ms) }; draw() shares the line's time by weight.
  const kinds = {
    box(it) {
      const size = it.size || 46;
      const m = measure(it.box, { size });
      const w = it.w || Math.max(180, m.w + 64); const h = it.h || Math.max(84, m.h + 36);
      const [cx, cy] = it.at; const r = { x: cx - w / 2, y: cy - h / 2, w, h };
      // Arrows stop short of the label above the box, not just the box.
      if (it.id) items.set(it.id, { ...r, outer: it.label ? { x: r.x, y: r.y - 46, w, h: h + 46 } : r });
      return {
        weight: 1.8 + it.box.length * 0.03 + (it.label ? 0.4 : 0),
        async run(ms) {
          const shape = it.shape === 'ellipse' ? rc.ellipse(cx, cy, w * 1.1, h * 1.2, roughOptions(it.color))
            : rc.rectangle(r.x, r.y, w, h, roughOptions(it.color));
          await sketch(shape, ms * 0.42);
          await write(it.box, cx, cy, { size, c: it.textColor || it.color }, ms * (it.label ? 0.4 : 0.58));
          if (it.label) await write(it.label, cx, r.y - 26, { size: 28, c: it.labelColor || 'muted', weight: 600 }, ms * 0.18);
        },
      };
    },
    text(it) {
      const size = it.size || 44;
      const spot = place(it, size);
      const anchor = it.align === 'left' ? 'start' : it.align === 'right' ? 'end' : it.align === 'center' ? 'middle' : spot.anchor || 'middle';
      const opts = { size, c: it.color, anchor, rotate: it.rotate };
      const m = measure(it.text, opts);
      const { x, y } = spot;
      const left = opts.anchor === 'start' ? x : opts.anchor === 'end' ? x - m.w : x - m.w / 2;
      if (it.id) items.set(it.id, { x: left, y: y - m.h / 2, w: m.w, h: m.h });
      return { weight: 0.4 + it.text.length * 0.035, run: ms => write(it.text, x, y, opts, ms) };
    },
    title(it) {
      const t = kinds.text({ ...it, text: it.title, size: it.size || 64, at: it.at || [view.width / 2, 90], id: it.id || 'title' });
      return {
        weight: t.weight + 0.4,
        async run(ms) {
          await t.run(ms * 0.8);
          const r = items.get(it.id || 'title');
          await sketch(rc.line(r.x - 10, r.y + r.h + 10, r.x + r.w + 10, r.y + r.h + 6, roughOptions(it.underlineColor || 'accent')), ms * 0.2);
        },
      };
    },
    note(it) {
      return kinds.text({ ...it, text: it.note, size: it.size || 34, color: it.color || 'yellow', rotate: it.rotate ?? -2 });
    },
    arrow(it) {
      return {
        weight: 0.8,
        async run(ms) {
          const [a, b] = it.arrow; // each an id or an [x, y] point
          const ra = at(a).outer || at(a); const rb = at(b).outer || at(b);
          const [bx, by] = centre(rb); const [ax, ay] = centre(ra);
          const [x1, y1] = edge(ra, bx, by); const [x2, y2] = edge(rb, ax, ay);
          const angle = Math.atan2(y2 - y1, x2 - x1); const head = 20;
          const wing = d => [x2 - head * Math.cos(angle + d), y2 - head * Math.sin(angle + d)];
          const o = roughOptions(it.color);
          const shaft = it.curve ? rc.curve([[x1, y1], [(x1 + x2) / 2 + it.curve, (y1 + y2) / 2 - it.curve], [x2, y2]], o) : rc.line(x1, y1, x2, y2, o);
          await sketch(shaft, ms * 0.7);
          await sketch(rc.linearPath([wing(0.45), [x2, y2], wing(-0.45)], roughOptions(it.color)), ms * 0.3);
        },
      };
    },
    line(it) {
      const [[x1, y1], [x2, y2]] = it.line;
      return { weight: 0.6, run: ms => sketch(rc.line(x1, y1, x2, y2, roughOptions(it.color, it.dashed ? { strokeLineDash: [14, 12] } : {})), ms) };
    },
    circle(it) {
      return {
        weight: 0.9,
        run(ms) {
          if (Array.isArray(it.circle)) {
            const [cx, cy, r] = it.circle;
            return sketch(rc.ellipse(cx, cy, r * 2, r * 2, roughOptions(it.color || 'accent')), ms);
          }
          const r = at(it.circle); const [cx, cy] = centre(r);
          return sketch(rc.ellipse(cx, cy, r.w * 1.18 + 24, r.h * 1.3 + 18, roughOptions(it.color || 'accent')), ms);
        },
      };
    },
    underline(it) {
      return {
        weight: 0.5,
        run(ms) {
          const r = at(it.underline);
          return sketch(rc.line(r.x - 6, r.y + r.h + 12, r.x + r.w + 6, r.y + r.h + 8, roughOptions(it.color || 'accent')), ms);
        },
      };
    },
    tick(it) {
      const [x, y] = it.tick; const s = it.size || 28;
      return { weight: 0.4, run: ms => sketch(rc.linearPath([[x - s, y], [x - s / 3, y + s * 0.7], [x + s, y - s * 0.8]], roughOptions(it.color || 'accent')), ms) };
    },
    cross(it) {
      const [x, y] = it.cross; const s = it.size || 24;
      return {
        weight: 0.4,
        async run(ms) {
          await sketch(rc.line(x - s, y - s, x + s, y + s, roughOptions(it.color || 'red')), ms / 2);
          await sketch(rc.line(x + s, y - s, x - s, y + s, roughOptions(it.color || 'red')), ms / 2);
        },
      };
    },
  };

  function plan(item) {
    const kind = Object.keys(kinds).find(k => k in item);
    if (!kind) throw new Error(`board: unknown item ${JSON.stringify(item)}`);
    return kinds[kind](item);
  }

  async function draw(list, ms) {
    const steps = list.map(plan);
    const gaps = 140 * Math.max(0, steps.length - 1);
    const budget = Math.max(steps.length * 300, ms - gaps);
    const total = steps.reduce((a, s) => a + s.weight, 0) || 1;
    for (const [i, s] of steps.entries()) {
      await s.run(Math.max(300, budget * s.weight / total));
      if (i < steps.length - 1) await sleep(140);
    }
    chalkAway();
  }

  // Wipes the board, leaving faint smudges like a real eraser (or nothing, for notes over an app).
  async function erase(ms = 900, { smudge = true } = {}) {
    chalkAway();
    await ink.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in', fill: 'forwards' }).finished;
    for (const node of [...ink.childNodes]) smudge && ghosts ? ghosts.append(node) : node.remove();
    ink.getAnimations().forEach(a => a.cancel());
    items.clear();
  }
  const clear = (ms = 300) => erase(ms, { smudge: false });

  // fonts.ready resolves early if nothing has asked for the font yet, so ask explicitly.
  const ready = document.fonts.load('600 44px Chalk').then(() => document.fonts.ready).then(() => true);
  return { draw, erase, clear, ready };
};
