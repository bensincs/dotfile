// Architecture diagram engine. Runs inside the recorded page.
//   createDiagram(svg, { theme }) -> { load(def), apply(op, ms), reset(), ready }
// def: { title, subtitle, nodes: { id: { icon (data URI), label, sub, at: [col, row] } },
//        groups: { id: { kind, label, icon, contains: [ids] } }, edges: [{ id, from, to, label, style, both }] }
// op:  { show, hide, flow, focus, highlight, note, mark, title } - see references/diagram.md.
// Layout is on a grid: nodes sit at [col, row]; groups wrap what they contain; edges route at right
// angles between node sides. The camera frames everything, or zooms to a focus.
window.createDiagram = (svg, { theme }) => {
  const NS = 'http://www.w3.org/2000/svg';
  const CW = 230, RH = 172;             // grid cell, in diagram units
  const ICON = 64;                      // icon size
  const PAD = 16, LABEL = 28;           // group padding, and room for a group's label
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
    if (parent) parent.append(n);
    return n;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const C = theme.colors;
  const layers = {
    groups: el('g', { class: 'groups' }, svg), edges: el('g', { class: 'edges' }, svg), nodes: el('g', { class: 'nodes' }, svg),
    packets: el('g', { class: 'packets' }, svg), notes: el('g', { class: 'notes' }, svg),
  };
  el('defs', {}, svg).innerHTML = `
    <marker id="arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker>
    <filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="lift" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="3" stdDeviation="5" flood-opacity="${theme.dark ? 0.5 : 0.12}"/></filter>`;

  let D = null;         // the loaded diagram: { nodes, groups, edges, home }
  let view = { x: 0, y: 0, w: 1600, h: 900 };
  const setView = v => { view = v; svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); };

  // ---------- text ----------
  function wrap(text, max = 18) {
    const words = String(text).split(/\s+/);
    const lines = [''];
    for (const w of words) {
      if ((lines.at(-1) + ' ' + w).trim().length > max && lines.at(-1)) lines.push(w);
      else lines[lines.length - 1] = (lines.at(-1) + ' ' + w).trim();
    }
    return lines.slice(0, 3);
  }
  function textBlock(parent, lines, x, y, { size = 17, weight = 600, fill = C.text, anchor = 'middle', lh = 1.22 } = {}) {
    const t = el('text', { x, y, 'font-size': size, 'font-weight': weight, fill, 'text-anchor': anchor, 'dominant-baseline': 'hanging' }, parent);
    lines.forEach((line, i) => { const s = el('tspan', { x, dy: i ? size * lh : 0 }, t); s.textContent = line; });
    return t;
  }

  // ---------- layout ----------
  function layout(def) {
    const nodes = new Map();
    for (const [id, n] of Object.entries(def.nodes)) {
      const [col, row] = n.at;
      const cx = col * CW, cy = row * RH;
      const g = el('g', { class: 'node', 'data-id': id, opacity: 0 }, layers.nodes);
      const inner = el('g', {}, g);
      const iconY = cy - ICON / 2 - 14;
      if (n.icon) el('image', { href: n.icon, x: cx - ICON / 2, y: iconY, width: ICON, height: ICON }, inner);
      else el('rect', { x: cx - ICON / 2, y: iconY, width: ICON, height: ICON, rx: 14, fill: C.box, stroke: C.edge, 'stroke-width': 2 }, inner);
      const lines = wrap(n.label ?? id);
      const label = textBlock(inner, lines, cx, iconY + ICON + 10);
      let bottom = iconY + ICON + 10 + lines.length * 17 * 1.22;
      if (n.sub) {
        const sub = wrap(n.sub, 24);
        textBlock(inner, sub, cx, bottom + 3, { size: 13.5, weight: 500, fill: C.sub });
        bottom += 3 + sub.length * 13.5 * 1.22;
      }
      const width = Math.max(ICON + 24, label.getBBox().width + 16, ...[...inner.querySelectorAll('text')].map(t => t.getBBox().width + 16));
      nodes.set(id, {
        id, def: n, g, inner, cx, cy, iconY,
        icon: { x: cx - ICON / 2, y: iconY, w: ICON, h: ICON },
        box: { x: cx - width / 2, y: iconY - 6, w: width, h: bottom - iconY + 12 },
        visible: false, mark: null,
      });
    }

    // Groups wrap their members (nodes or other groups), innermost first.
    const groups = new Map();
    const depthOf = (id, seen = new Set()) => {
      const g = def.groups[id];
      if (seen.has(id)) throw new Error(`diagram: group "${id}" contains itself`);
      seen.add(id);
      return 1 + Math.max(0, ...g.contains.filter(c => def.groups[c]).map(c => depthOf(c, new Set(seen))));
    };
    const order = Object.keys(def.groups || {}).sort((a, b) => depthOf(a) - depthOf(b));
    for (const id of order) {
      const gdef = def.groups[id];
      const boxes = gdef.contains.map(c => (nodes.get(c) || groups.get(c))?.box).filter(Boolean);
      if (!boxes.length) throw new Error(`diagram: group "${id}" contains nothing that exists`);
      let x0 = Math.min(...boxes.map(b => b.x)) - PAD, y0 = Math.min(...boxes.map(b => b.y)) - PAD - LABEL;
      let x1 = Math.max(...boxes.map(b => b.x + b.w)) + PAD, y1 = Math.max(...boxes.map(b => b.y + b.h)) + PAD;
      const style = theme.groups[gdef.kind] || theme.groups.group;
      // Outer groups go behind inner ones, so their tint never covers what they hold.
      const g = el('g', { class: 'group', 'data-id': id, opacity: 0 });
      layers.groups.prepend(g);
      const rect = el('rect', { rx: style.radius ?? 12, fill: style.fill, stroke: style.stroke, 'stroke-width': style.width ?? 2, 'stroke-dasharray': style.dash || null }, g);
      const icon = gdef.icon ? el('image', { href: gdef.icon, width: 20, height: 20 }, g) : null;
      const label = textBlock(g, [gdef.label ?? id], 0, y0 + 9, { size: 14.5, weight: 650, fill: style.text || C.text, anchor: 'start' });
      // Wide enough for its label: grow evenly on both sides.
      const need = label.getBBox().width + (icon ? 27 : 0) + 26;
      if (x1 - x0 < need) { const grow = (need - (x1 - x0)) / 2; x0 -= grow; x1 += grow; }
      Object.entries({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }).forEach(([k, v]) => rect.setAttribute(k, v));
      let lx = x0 + 12;
      if (icon) { icon.setAttribute('x', lx); icon.setAttribute('y', y0 + 6); lx += 27; }
      label.setAttribute('x', lx);
      label.querySelectorAll('tspan').forEach(t => t.setAttribute('x', lx));
      groups.set(id, { id, def: gdef, g, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, visible: false, depth: depthOf(id) });
    }
    // Which groups hold each node (directly or through other groups), so showing a node shows its frames.
    const parents = new Map();
    const holders = id => order.filter(gid => def.groups[gid].contains.includes(id));
    const ancestors = id => holders(id).flatMap(gid => [gid, ...ancestors(gid)]);
    for (const id of [...nodes.keys(), ...groups.keys()]) parents.set(id, [...new Set(ancestors(id))]);

    // Edges: right-angled routes between node sides, with ports spread when several share a side.
    const edges = new Map();
    const sides = new Map(); // `${node}:${side}` -> [edge ids]
    const sideOf = (a, b) => {
      const dx = b.cx - a.cx, dy = b.cy - a.cy;
      return Math.abs(dx) >= Math.abs(dy) * 0.9 ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
    };
    const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
    for (const e of def.edges) {
      const a = nodes.get(e.from), b = nodes.get(e.to);
      const s1 = e.fromSide || sideOf(a, b), s2 = e.toSide || opposite[s1];
      edges.set(e.id, { id: e.id, def: e, a, b, s1, s2, visible: false });
    }
    // An edge leaving a side where another edge arrives would run alongside it. If it heads down to
    // a node below, it leaves from the bottom instead (when that's free): from under the label, into
    // the top of the icon below.
    const uses = (n, side) => [...edges.values()].flatMap(e => [e.a === n && e.s1 === side ? 'out' : null, e.b === n && e.s2 === side ? 'in' : null]).filter(Boolean);
    for (const e of edges.values()) {
      if (e.def.fromSide || e.def.toSide || !(e.s1 === 'left' || e.s1 === 'right')) continue;
      const dy = e.b.cy - e.a.cy;
      if (dy < RH * 0.4) continue;
      const mixed = uses(e.a, e.s1).includes('in') || uses(e.b, e.s2).includes('out');
      if (mixed && !uses(e.a, 'bottom').length && !uses(e.b, 'top').length) { e.s1 = 'bottom'; e.s2 = 'top'; }
    }
    for (const e of edges.values()) {
      for (const [n, s] of [[e.a, e.s1], [e.b, e.s2]]) {
        const key = `${n.id}:${s}`;
        sides.set(key, [...(sides.get(key) || []), e.id]);
      }
    }
    const port = (n, side, eid) => {
      const list = sides.get(`${n.id}:${side}`);
      const other = id => { const e = edges.get(id); return e.a === n ? e.b : e.a; };
      const sorted = [...list].sort((p, q) => (side === 'left' || side === 'right' ? other(p).cy - other(q).cy : other(p).cx - other(q).cx));
      const k = sorted.indexOf(eid) - (sorted.length - 1) / 2;
      const gap = 6, spread = 14;
      const ic = n.icon;
      if (side === 'right') return { x: ic.x + ic.w + gap, y: ic.y + ic.h / 2 + k * spread };
      if (side === 'left') return { x: ic.x - gap, y: ic.y + ic.h / 2 + k * spread };
      if (side === 'top') return { x: n.cx + k * spread, y: ic.y - gap };
      return { x: n.cx + k * spread, y: n.box.y + n.box.h + gap }; // below the label
    };
    for (const e of edges.values()) {
      const p = port(e.a, e.s1, e.id), q = port(e.b, e.s2, e.id);
      const horizontal = e.s1 === 'left' || e.s1 === 'right';
      let pts;
      if (horizontal) pts = Math.abs(p.y - q.y) < 2 ? [p, q] : [p, { x: (p.x + q.x) / 2, y: p.y }, { x: (p.x + q.x) / 2, y: q.y }, q];
      else pts = Math.abs(p.x - q.x) < 2 ? [p, q] : [p, { x: p.x, y: (p.y + q.y) / 2 }, { x: q.x, y: (p.y + q.y) / 2 }, q];
      const d = rounded(pts, 12);
      const g = el('g', { class: 'edge', 'data-id': e.id, opacity: 0 }, layers.edges);
      const path = el('path', {
        d, fill: 'none', stroke: C.edge, 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'stroke-dasharray': e.def.style === 'dashed' ? '7 7' : null, 'marker-end': 'url(#arrow)', 'marker-start': e.def.both ? 'url(#arrow)' : null,
      }, g);
      if (e.def.label) {
        const mid = pts.length === 2 ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } : { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 };
        const lg = el('g', { class: 'edge-label' }, g);
        const t = textBlock(lg, [e.def.label], mid.x, mid.y - 9, { size: 13.5, weight: 600, fill: C.sub });
        const b = t.getBBox();
        lg.insertBefore(el('rect', { x: b.x - 7, y: b.y - 3, width: b.width + 14, height: b.height + 6, rx: 9, fill: C.labelBg, stroke: C.labelLine }), t);
      }
      Object.assign(e, { g, path, length: path.getTotalLength() });
    }
    return { nodes, groups, edges, parents, home: frame([...nodes.values(), ...groups.values()].map(x => x.box), { home: true }), warnings: collisions(nodes, groups, parents) };
  }
  // Layout problems worth fixing in the spec: things on top of each other, or crossing a frame.
  function collisions(nodes, groups, parents) {
    const hit = (a, b, m = 2) => a.x + m < b.x + b.w && b.x + m < a.x + a.w && a.y + m < b.y + b.h && b.y + m < a.y + a.h;
    const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
    const out = [];
    const list = [...nodes.values()];
    list.forEach((a, i) => list.slice(i + 1).forEach(b => { if (hit(a.box, b.box)) out.push(`nodes "${a.id}" and "${b.id}" overlap: move one (at: [col, row])`); }));
    for (const n of list) {
      for (const g of groups.values()) {
        if (!parents.get(n.id).includes(g.id) && hit(n.box, g.box) && !inside(g.box, n.box)) {
          out.push(`node "${n.id}" crosses group "${g.id}" without being in it: move it, or add it to the group`);
        }
      }
    }
    const gl = [...groups.values()];
    gl.forEach((a, i) => gl.slice(i + 1).forEach(b => {
      if (hit(a.box, b.box) && !inside(a.box, b.box) && !inside(b.box, a.box)) out.push(`groups "${a.id}" and "${b.id}" overlap: space their members further apart`);
    }));
    return out;
  }
  function rounded(pts, r) {
    let d = `M${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const r1 = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
      const u = { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) }, v = { x: Math.sign(c.x - b.x), y: Math.sign(c.y - b.y) };
      d += ` L${b.x - u.x * r1} ${b.y - u.y * r1} Q${b.x} ${b.y} ${b.x + v.x * r1} ${b.y + v.y * r1}`;
    }
    const z = pts.at(-1);
    return `${d} L${z.x} ${z.y}`;
  }

  // ---------- camera ----------
  // Fits boxes into a 16:9 view, leaving room for the title above and captions below.
  function frame(boxes, { home = false } = {}) {
    if (home && svg.dataset.title === 'true') {
      // The title sits in the top-left corner. If the diagram, framed as large as it can be, stays
      // clear of that corner, use the full height; otherwise leave a band for the title above it.
      const big = framed(boxes, { home: false, least: 900 });
      const title = document.getElementById('title').getBoundingClientRect();
      const left = (Math.min(...boxes.map(b => b.x)) - big.x) / big.w;
      const top = (Math.min(...boxes.map(b => b.y)) - big.y) / big.h;
      if (left > (title.right + 24) / innerWidth || top > (title.bottom + 16) / innerHeight) return big;
    }
    return framed(boxes, { home: home && svg.dataset.title === 'true', least: home ? 900 : null });
  }
  function framed(boxes, { home, least }) {
    const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y));
    const x1 = Math.max(...boxes.map(b => b.x + b.w)), y1 = Math.max(...boxes.map(b => b.y + b.h));
    // Room for the title above the whole diagram, and for captions below; close-ups hide the title.
    const top = home ? 0.15 : 0.06, bottom = 0.13, side = 0.05;
    const w = x1 - x0, h = y1 - y0;
    // Close-ups zoom at most 2x, so labels stay in proportion.
    const vw = Math.max(w / (1 - 2 * side), (h / (1 - top - bottom)) * (16 / 9), least ?? Math.max(640, (D?.home?.w ?? 1800) * 0.5));
    const vh = (vw * 9) / 16;
    // Centred in the band between the title and the captions.
    return { x: x0 + w / 2 - vw / 2, y: y0 - top * vh - ((1 - top - bottom) * vh - h) / 2, w: vw, h: vh };
  }
  let cameraAnim = 0;
  async function moveCamera(to, ms) {
    const from = { ...view };
    const id = ++cameraAnim;
    if (ms <= 0) return setView(to);
    const start = performance.now();
    await new Promise(resolve => {
      const tick = now => {
        if (id !== cameraAnim) return resolve();
        const k = ease(Math.min(1, (now - start) / ms));
        setView({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, w: from.w + (to.w - from.w) * k, h: from.h + (to.h - from.h) * k });
        k < 1 ? requestAnimationFrame(tick) : resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  // ---------- revealing things ----------
  const fade = (node, to, ms, extra = []) => (ms <= 0 ? (node.setAttribute('opacity', to), Promise.resolve())
    : node.animate([{ opacity: node.getAttribute('opacity') ?? 1 }, { opacity: to }, ...extra], { duration: ms, easing: 'ease-out', fill: 'forwards' })
      .finished.then(() => node.setAttribute('opacity', to)));
  const find = id => {
    const x = D.nodes.get(id) || D.groups.get(id) || D.edges.get(id) || D.edges.get(id.replace(/\s/g, ''));
    if (!x) throw new Error(`diagram: nothing called "${id}"`);
    return x;
  };
  async function reveal(x, ms) {
    if (x.visible) return;
    x.visible = true;
    if (D.edges.get(x.id) === x) {
      x.g.setAttribute('opacity', 1);
      const { path } = x;
      const label = x.g.querySelector('.edge-label');
      if (label) label.setAttribute('opacity', 0);
      if (ms > 0) {
        path.style.strokeDasharray = `${x.length} ${x.length}`;
        path.style.strokeDashoffset = `${x.length}`;
        path.removeAttribute('marker-end');
        await path.animate([{ strokeDashoffset: x.length }, { strokeDashoffset: 0 }], { duration: ms * 0.8, easing: 'ease-in-out', fill: 'forwards' }).finished;
        path.style.strokeDasharray = x.def.style === 'dashed' ? '7 7' : '';
        path.getAnimations().forEach(a => a.cancel());
        path.style.strokeDashoffset = '';
      }
      path.setAttribute('marker-end', 'url(#arrow)');
      if (label) await fade(label, 1, ms * 0.2);
      return;
    }
    const isNode = D.nodes.get(x.id) === x;
    if (ms <= 0) return x.g.setAttribute('opacity', 1);
    if (!isNode) {
      // A group draws its frame around the space, then its tint and label fade in.
      const rect = x.g.querySelector('rect');
      const dash = rect.getAttribute('stroke-dasharray');
      const length = 2 * (x.box.w + x.box.h);
      x.g.setAttribute('opacity', 1);
      rect.style.fillOpacity = '0';
      [...x.g.children].filter(c => c !== rect).forEach(c => c.setAttribute('opacity', 0));
      rect.setAttribute('stroke-dasharray', `${length} ${length}`);
      await rect.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], { duration: ms * 0.75, easing: 'ease-in-out' }).finished;
      dash ? rect.setAttribute('stroke-dasharray', dash) : rect.removeAttribute('stroke-dasharray');
      await Promise.all([
        rect.animate([{ fillOpacity: 0 }, { fillOpacity: 1 }], { duration: ms * 0.25, fill: 'forwards' }).finished.then(() => { rect.style.fillOpacity = ''; }),
        ...[...x.g.children].filter(c => c !== rect).map(c => fade(c, 1, ms * 0.25)),
      ]);
      return;
    }
    const target = isNode ? x.inner : x.g;
    const cx = isNode ? x.cx : x.box.x + x.box.w / 2, cy = isNode ? x.cy : x.box.y + x.box.h / 2;
    target.style.transformOrigin = `${cx}px ${cy}px`;
    target.style.transformBox = 'view-box';
    x.g.setAttribute('opacity', 1);
    await target.animate(isNode
      ? [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1.06)', offset: 0.7 }, { opacity: 1, transform: 'scale(1)' }]
      : [{ opacity: 0, transform: 'scale(0.985)' }, { opacity: 1, transform: 'scale(1)' }], { duration: ms, easing: 'ease-out' }).finished;
  }
  // Everything a list needs on screen first: a node's groups, an edge's ends.
  function expand(ids) {
    const out = [];
    const add = id => {
      const x = find(id);
      if (out.includes(x)) return;
      if (D.edges.get(x.id) === x) { add(x.a.id); add(x.b.id); }
      else for (const gid of [...D.parents.get(x.id)].reverse()) add(gid);
      out.push(x);
    };
    ids.forEach(add);
    return out;
  }
  const everything = () => [
    ...[...D.groups.values()].sort((a, b) => b.depth - a.depth).map(g => g.id),
    ...[...D.nodes.values()].sort((a, b) => a.def.at[0] - b.def.at[0] || a.def.at[1] - b.def.at[1]).map(n => n.id),
    ...D.edges.keys(),
  ];
  async function show(ids, ms) {
    const list = expand(ids === 'all' ? everything() : [].concat(ids)).filter(x => !x.visible);
    if (!list.length) return;
    if (ms <= 0) { for (const x of list) await reveal(x, 0); return; }
    // Stagger: each thing starts a little after the last, all finishing within the time.
    const each = Math.min(700, Math.max(260, (ms * 0.55) / Math.sqrt(list.length)));
    const step = list.length > 1 ? Math.max(0, (ms - each) / (list.length - 1)) : 0;
    await Promise.all(list.map((x, i) => sleep(i * Math.min(step, 650)).then(() => reveal(x, each))));
  }
  async function hide(ids, ms) {
    await Promise.all([].concat(ids).map(id => {
      const x = find(id);
      x.visible = false;
      return fade(x.g, 0, Math.min(ms, 500));
    }));
  }

  // ---------- packets along a path ----------
  function hops(spec) {
    const ids = String(spec).split('->').map(s => s.trim());
    const out = [];
    for (let i = 0; i < ids.length - 1; i++) {
      const fwd = D.edges.get(`${ids[i]}->${ids[i + 1]}`), back = D.edges.get(`${ids[i + 1]}->${ids[i]}`);
      if (!fwd && !back) throw new Error(`diagram: flow "${spec}": no edge between ${ids[i]} and ${ids[i + 1]}`);
      out.push({ edge: fwd || back, reverse: !fwd });
    }
    return out;
  }
  async function flow(specs, ms, opts = {}) {
    const paths = [].concat(specs).map(hops);
    const all = paths.flat().map(h => h.edge);
    await show(all.map(e => e.id), 0);
    const colour = opts.color || C.accent;
    for (const e of all) { e.path.setAttribute('stroke', colour); e.path.setAttribute('stroke-width', 3.2); }
    const runs = paths.map(path => {
      const total = path.reduce((s, h) => s + h.edge.length, 0);
      const at = d => { // a point at distance d along the whole path
        for (const h of path) {
          if (d <= h.edge.length) return h.edge.path.getPointAtLength(h.reverse ? h.edge.length - d : d);
          d -= h.edge.length;
        }
        const last = path.at(-1);
        return last.edge.path.getPointAtLength(last.reverse ? 0 : last.edge.length);
      };
      const count = opts.packets ?? 3;
      const travel = Math.max(700, ms * 0.62);
      return Promise.all(Array.from({ length: count }, (_, i) => {
        const dot = el('circle', { r: 7.5, fill: colour, filter: 'url(#glow)', opacity: 0 }, layers.packets);
        const delay = count > 1 ? (i * (ms - travel)) / (count - 1) : 0;
        return sleep(Math.max(0, delay)).then(() => new Promise(resolve => {
          const start = performance.now();
          const tick = now => {
            const k = Math.min(1, (now - start) / travel);
            const p = at(ease(k) * total);
            dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
            dot.setAttribute('opacity', Math.min(1, k * 8, (1 - k) * 8));
            k < 1 ? requestAnimationFrame(tick) : (dot.remove(), resolve());
          };
          requestAnimationFrame(tick);
        }));
      }));
    });
    await Promise.all(runs);
    for (const e of all) { e.path.setAttribute('stroke', C.edge); e.path.setAttribute('stroke-width', 2.4); }
  }

  // ---------- focus, highlight, notes, marks ----------
  let focused = null;
  async function focus(ids, ms, extra = []) {
    const all = !ids || ids === 'all';
    focused = all ? null : expand([].concat(ids)).filter(x => !D.edges.has(x.id) || [].concat(ids).includes(x.id));
    const keep = new Set();
    if (focused) {
      for (const x of focused) { keep.add(x); if (D.parents.has(x.id)) D.parents.get(x.id).forEach(g => keep.add(D.groups.get(g))); }
      for (const e of D.edges.values()) if (keep.has(e.a) && keep.has(e.b)) keep.add(e);
    }
    const dim = x => (focused && !keep.has(x) ? 0.18 : 1);
    const fades = [...D.nodes.values(), ...D.groups.values(), ...D.edges.values()].filter(x => x.visible).map(x => fade(x.g, dim(x), Math.min(ms, 700)));
    // The camera frames what was asked for (and notes beside it), not the groups around it.
    const asked = focused ? [].concat(ids).map(find).filter(x => x.box) : [];
    const target = asked.length ? frame([...asked.map(x => x.box), ...extra]) : D.home;
    const title = document.getElementById('title');
    title.animate([{ opacity: getComputedStyle(title).opacity }, { opacity: asked.length ? 0 : 1 }], { duration: Math.min(ms, 600) || 1, fill: 'forwards' });
    await Promise.all([...fades, moveCamera(target, Math.min(ms, 1100))]);
  }
  async function highlight(ids, ms) {
    await Promise.all([].concat(ids).map(id => {
      const n = find(id);
      const ring = el('circle', { cx: n.cx, cy: n.iconY + ICON / 2, r: ICON * 0.72, fill: 'none', stroke: C.accent, 'stroke-width': 4, opacity: 0 }, layers.packets);
      ring.style.transformOrigin = `${n.cx}px ${n.iconY + ICON / 2}px`;
      ring.style.transformBox = 'view-box';
      return ring.animate([{ opacity: 0, transform: 'scale(0.8)' }, { opacity: 1, transform: 'scale(1)', offset: 0.25 },
        { opacity: 0.85, transform: 'scale(1.08)', offset: 0.6 }, { opacity: 0, transform: 'scale(1.25)' }],
      { duration: Math.max(900, ms), easing: 'ease-out', iterations: 1 }).finished.then(() => ring.remove());
    }));
  }
  const MARKS = { ok: ['#107c10', 'M-5 0l3.5 3.5L5-4'], error: ['#d13438', 'M-4.5-4.5l9 9M4.5-4.5l-9 9'], warn: ['#f7a700', 'M0-5v5.5M0 4.2v.3'] };
  function mark(map, ms) {
    for (const [id, kind] of Object.entries(map)) {
      const n = find(id);
      n.g.querySelector('.mark')?.remove();
      if (!kind) continue;
      const g = el('g', { class: 'mark', opacity: 0 }, n.g);
      const x = n.icon.x + n.icon.w - 2, y = n.icon.y + 4;
      if (MARKS[kind]) {
        el('circle', { cx: x, cy: y, r: 13, fill: MARKS[kind][0], stroke: C.bg, 'stroke-width': 3 }, g);
        el('path', { d: MARKS[kind][1], transform: `translate(${x} ${y})`, fill: 'none', stroke: '#fff', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      } else {
        const t = textBlock(g, [String(kind)], x, y - 9, { size: 13, weight: 700, fill: '#fff' });
        const b = t.getBBox();
        g.insertBefore(el('rect', { x: b.x - 8, y: b.y - 3, width: b.width + 16, height: b.height + 6, rx: 11, fill: C.accent, stroke: C.bg, 'stroke-width': 2 }), t);
      }
      fade(g, 1, Math.min(ms, 400));
    }
  }
  let notes = [];
  // Notes are built first (hidden) so a focus in the same step can frame them, then fade in.
  function buildNotes(list) {
    return [].concat(list).map(nt => {
      const n = find(nt.at);
      const side = nt.side || 'right';
      const g = el('g', { class: 'note', opacity: 0 }, layers.notes);
      const lines = wrap(nt.text, 30);
      const t = textBlock(g, lines, 0, 0, { size: 15.5, weight: 550, fill: C.text, anchor: 'start' });
      const b = t.getBBox();
      const w = b.width + 30, h = b.height + 20;
      const box = n.box || n.icon;
      const gap = 26;
      const pos = {
        right: { x: box.x + box.w + gap, y: (n.iconY ?? box.y) + ICON / 2 - h / 2 },
        left: { x: box.x - gap - w, y: (n.iconY ?? box.y) + ICON / 2 - h / 2 },
        top: { x: (n.cx ?? box.x + box.w / 2) - w / 2, y: box.y - gap - h },
        bottom: { x: (n.cx ?? box.x + box.w / 2) - w / 2, y: box.y + box.h + gap },
      }[side];
      t.setAttribute('transform', `translate(${pos.x + 18} ${pos.y + 10})`);
      g.insertBefore(el('rect', { x: pos.x, y: pos.y, width: w, height: h, rx: 10, fill: C.noteBg, stroke: C.noteLine, filter: 'url(#lift)' }), t);
      g.insertBefore(el('rect', { x: pos.x, y: pos.y + 8, width: 4, height: h - 16, rx: 2, fill: nt.color || C.accent }), t);
      notes.push(g);
      return { g, box: { x: pos.x, y: pos.y, w, h } };
    });
  }
  const revealNotes = (built, ms) => Promise.all(built.map(({ g }, i) => sleep(i * 250).then(() => fade(g, 1, Math.min(ms, 450)))));
  const clearNotes = ms => { const old = notes; notes = []; return Promise.all(old.map(g => fade(g, 0, ms).then(() => g.remove()))); };

  // ---------- the API ----------
  function reset() {
    for (const layer of Object.values(layers)) layer.replaceChildren();
    notes = [];
    focused = null;
    D = null;
  }
  return {
    ready: document.fonts.load('600 17px Inter').then(() => document.fonts.ready).then(() => true),
    load(def) {
      reset();
      const title = document.getElementById('title');
      title.querySelector('h1').textContent = def.title || '';
      title.querySelector('p').textContent = def.subtitle || '';
      svg.dataset.title = def.title ? 'true' : 'false';
      D = layout(def);
      setView(D.home);
      return { warnings: D.warnings };
    },
    /** Applies a step: notes from the last step clear, then everything runs within ms (0: instantly). */
    async apply(op, ms = 0) {
      if (!D) throw new Error('diagram: nothing loaded');
      if (!op.keepNotes) await clearNotes(ms > 0 ? 250 : 0);
      if (op.title !== undefined) document.querySelector('#title h1').textContent = op.title;
      const work = [];
      const built = ms > 0 && op.note ? buildNotes(op.note) : [];
      if (op.focus !== undefined) work.push(focus(op.focus, ms, built.map(b => b.box)));
      if (op.hide) work.push(hide(op.hide, ms));
      if (op.show) await show(op.show, op.flow || op.note ? ms * 0.6 : ms);
      if (op.mark) mark(op.mark, ms);
      // Packets, rings and notes are moments, not state: replaying earlier steps instantly skips them.
      if (ms > 0 && op.highlight) work.push(highlight(op.highlight, ms * 0.9));
      if (ms > 0 && op.flow) work.push(flow(op.flow, op.show ? ms * 0.4 : ms, op.flowOptions || {}));
      if (built.length) work.push(sleep(op.focus !== undefined ? Math.min(ms * 0.4, 700) : 0).then(() => revealNotes(built, ms)));
      await Promise.all(work);
    },
    reset,
  };
};
