// Diagram scenes: clean architecture diagrams with Azure icons that build up as the narrator speaks.
// The spec declares the diagram once (nodes on a grid, groups, edges); each step shows parts of it,
// sends packets along paths, focuses the camera, highlights, marks and adds notes.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RUNTIME, asset, dependency, die } from './common.mjs';
import { findIcon, iconData, searchIcons } from './icons.mjs';

export const DIAGRAM_VIEWPORT = { width: 1600, height: 900 };

const THEMES = {
  light: {
    dark: false,
    colors: {
      bg: '#f6f7f9', text: '#1b1f24', sub: '#5c6675', edge: '#7d8797', accent: '#0078d4', box: '#ffffff',
      labelBg: 'rgba(255,255,255,0.94)', labelLine: 'rgba(0,0,0,0.06)', noteBg: '#ffffff', noteLine: '#e1e5ea',
    },
    groups: {
      group: { fill: 'rgba(255,255,255,0.6)', stroke: '#c8ced6' },
      region: { fill: 'none', stroke: '#9aa3ae', radius: 16 },
      'management-group': { fill: 'rgba(240,242,245,0.7)', stroke: '#8a94a3', dash: '10 6' },
      subscription: { fill: 'rgba(255,248,225,0.55)', stroke: '#d0a000', dash: '10 6' },
      'resource-group': { fill: 'rgba(242,244,247,0.8)', stroke: '#9aa3ae', dash: '8 6' },
      vnet: { fill: 'rgba(232,242,252,0.75)', stroke: '#0078d4', width: 2.2 },
      subnet: { fill: 'rgba(255,255,255,0.85)', stroke: '#5ea0e6', dash: '6 5' },
      'on-premises': { fill: 'rgba(240,240,240,0.8)', stroke: '#6b7280', dash: '8 6' },
      zone: { fill: 'none', stroke: '#b4bcc6', dash: '4 5', width: 1.6 },
      cluster: { fill: 'rgba(238,233,252,0.7)', stroke: '#7a5fd1' },
    },
  },
  dark: {
    dark: true,
    colors: {
      bg: '#12161c', text: '#e9edf2', sub: '#a3adba', edge: '#76839a', accent: '#3aa0ff', box: '#1c222b',
      labelBg: 'rgba(24,30,38,0.94)', labelLine: 'rgba(255,255,255,0.08)', noteBg: '#1d242e', noteLine: '#2e3846',
    },
    groups: {
      group: { fill: 'rgba(255,255,255,0.03)', stroke: '#3a4554' },
      region: { fill: 'none', stroke: '#566273', radius: 16 },
      'management-group': { fill: 'rgba(255,255,255,0.02)', stroke: '#5c6878', dash: '10 6' },
      subscription: { fill: 'rgba(255,200,40,0.05)', stroke: '#c69a1d', dash: '10 6' },
      'resource-group': { fill: 'rgba(255,255,255,0.035)', stroke: '#5c6878', dash: '8 6' },
      vnet: { fill: 'rgba(58,160,255,0.07)', stroke: '#3aa0ff', width: 2.2 },
      subnet: { fill: 'rgba(18,22,28,0.6)', stroke: '#4f8fd6', dash: '6 5' },
      'on-premises': { fill: 'rgba(255,255,255,0.03)', stroke: '#6b7686', dash: '8 6' },
      zone: { fill: 'none', stroke: '#4a5464', dash: '4 5', width: 1.6 },
      cluster: { fill: 'rgba(140,110,240,0.08)', stroke: '#9b83ee' },
    },
  },
};
export const GROUP_KINDS = Object.keys(THEMES.light.groups);
const GROUP_ICONS = {
  subscription: 'subscriptions', 'resource-group': 'resource-groups', vnet: 'virtual-networks', subnet: 'subnet',
  'management-group': 'management-groups', 'on-premises': 'onprem', region: 'internet', cluster: 'kubernetes-services',
};

const fontCss = () => [400, 500, 600, 700].map(w => {
  const font = fs.readFileSync(dependency(`@fontsource/inter/files/inter-latin-${w}-normal.woff2`)).toString('base64');
  return `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:${w}}`;
}).join('');

/** Writes the self-contained diagram page; returns its URL. */
export function diagramPage(spec) {
  const theme = THEMES[spec.diagram?.theme || 'light'] || die(`Unknown diagram theme "${spec.diagram?.theme}". Use: light, dark`);
  const html = `<!doctype html><html data-board="true"><head><meta charset="utf-8"><title>Diagram</title>
<style>${fontCss()}</style><style>:root{--bg:${theme.colors.bg};--text:${theme.colors.text};--sub:${theme.colors.sub};--accent:${theme.colors.accent}}${asset('diagram.css')}</style></head>
<body><div id="title"><h1></h1><p></p></div><svg id="diagram" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet"></svg>
<script>${asset('diagram.js')}</script>
<script>window.diagram = createDiagram(document.getElementById('diagram'), { theme: ${JSON.stringify(theme)} });</script></body></html>`;
  const file = path.join(RUNTIME, 'diagram', 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  return pathToFileURL(file).href;
}

// ---------- the diagram definition ----------
const edgeId = (from, to) => `${from}->${to}`;
/** Edges come as ['a', 'b', 'label'] or { from, to, label, style, both }. */
function edgeOf(e) {
  const o = Array.isArray(e) ? { from: e[0], to: e[1], label: e[2] } : { ...e };
  return { ...o, id: edgeId(o.from, o.to) };
}

/** The engine's definition: icons resolved to data URIs, edges given ids. */
export function diagramDef(def) {
  return {
    title: def.title, subtitle: def.subtitle,
    nodes: Object.fromEntries(Object.entries(def.nodes || {}).map(([id, n]) => [id, {
      ...n, label: n.label ?? id, icon: n.icon === false ? null : iconData(n.icon ?? id),
    }])),
    groups: Object.fromEntries(Object.entries(def.groups || {}).map(([id, g]) => [id, {
      ...g, kind: g.kind || 'group', label: g.label ?? id,
      icon: g.icon === false ? null : (g.icon || GROUP_ICONS[g.kind]) ? iconData(g.icon || GROUP_ICONS[g.kind]) : null,
    }])),
    edges: (def.edges || []).map(edgeOf),
  };
}

/** A step's diagram op. Shorthands: 'all' shows everything; an array shows those things. */
export function diagramOp(step) {
  const d = step.diagram;
  if (d === 'all' || Array.isArray(d) || typeof d === 'string') return { show: d };
  const { stage, ...op } = d;
  if (op.flow && typeof op.flow === 'object' && !Array.isArray(op.flow)) {
    const { path: p, ...flowOptions } = op.flow;
    return { ...op, flow: p, flowOptions };
  }
  return op;
}
export const diagramStage = step => (typeof step.diagram === 'object' && !Array.isArray(step.diagram) ? step.diagram.stage : undefined);

/** Checks the diagram and every diagram step before anything is recorded. */
export function checkDiagram(spec, steps) {
  const problems = [];
  const checkDef = (def, where) => {
    if (!def?.nodes || !Object.keys(def.nodes).length) return problems.push(`${where}: a diagram needs nodes`);
    const ids = new Set(Object.keys(def.nodes));
    for (const [id, n] of Object.entries(def.nodes)) {
      if (!Array.isArray(n.at) || n.at.length !== 2 || n.at.some(v => typeof v !== 'number')) problems.push(`${where}: node "${id}" needs at: [col, row]`);
      if (n.icon !== false && !findIcon(n.icon ?? id)) {
        const near = searchIcons(String(n.icon ?? id).split(/[^a-z]+/i).filter(w => w.length > 2).slice(0, 1).join(' ')).slice(0, 6);
        problems.push(`${where}: no icon "${n.icon ?? id}" for node "${id}"${near.length ? ` (try: ${near.map(x => x.split(' ')[0]).join(', ')})` : ''}; search with --icons <words>`);
      }
    }
    const placed = new Map();
    for (const [id, g] of Object.entries(def.groups || {})) {
      if (ids.has(id)) problems.push(`${where}: group "${id}" has the same id as a node`);
      if (g.kind && !GROUP_KINDS.includes(g.kind)) problems.push(`${where}: group "${id}" has unknown kind "${g.kind}" (use ${GROUP_KINDS.join(', ')})`);
      for (const c of g.contains || []) {
        if (!ids.has(c) && !(def.groups || {})[c]) problems.push(`${where}: group "${id}" contains unknown "${c}"`);
        if (placed.has(c)) problems.push(`${where}: "${c}" is directly in both "${placed.get(c)}" and "${id}"; nest the groups instead`);
        placed.set(c, id);
      }
      if (!g.contains?.length) problems.push(`${where}: group "${id}" contains nothing`);
    }
    const seen = new Set();
    for (const e of (def.edges || []).map(edgeOf)) {
      if (!ids.has(e.from) || !ids.has(e.to)) problems.push(`${where}: edge ${e.id} joins something that isn't a node`);
      if (seen.has(e.id)) problems.push(`${where}: edge ${e.id} is listed twice`);
      seen.add(e.id);
    }
    return { ids, groups: new Set(Object.keys(def.groups || {})), edges: seen };
  };
  let known = spec.diagram ? checkDef(spec.diagram, 'diagram') : null;
  steps.forEach((step, i) => {
    if (!step.diagram) return;
    const where = `step ${i + 1}`;
    if (step.do || step.code || step.clay || step.draw) problems.push(`${where}: a diagram step cannot also have do, code, clay or draw`);
    const stage = diagramStage(step);
    if (stage) known = checkDef(stage, where);
    if (!known) return problems.push(`${where}: no diagram yet: add spec.diagram, or diagram: { stage: { … } } on this step`);
    if (typeof known === 'number') return;
    const op = diagramOp(step);
    const thing = id => known.ids.has(id) || known.groups.has(id) || known.edges.has(String(id).replace(/\s/g, ''));
    const list = v => (v === undefined || v === null || v === 'all' || v === false ? [] : [].concat(v));
    for (const id of [...list(op.show), ...list(op.hide), ...list(op.focus), ...list(op.highlight), ...Object.keys(op.mark || {})]) {
      if (!thing(id)) problems.push(`${where}: nothing called "${id}" in the diagram`);
    }
    for (const n of list(op.note)) if (!thing(n.at)) problems.push(`${where}: note at "${n.at}": nothing called that`);
    for (const f of list(op.flow)) {
      const hops = String(f).split('->').map(s => s.trim());
      for (let k = 0; k < hops.length - 1; k++) {
        if (!known.edges.has(edgeId(hops[k], hops[k + 1])) && !known.edges.has(edgeId(hops[k + 1], hops[k]))) {
          problems.push(`${where}: flow "${f}": no edge between ${hops[k]} and ${hops[k + 1]}`);
        }
      }
    }
  });
  if (problems.length) die(`The diagram has problems:\n  ${problems.join('\n  ')}`);
}

/** A still at the end of every diagram step, applied in order: quick to check layout and focus. */
export async function diagramStills({ spec, dir, launch }) {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: DIAGRAM_VIEWPORT, deviceScaleFactor: 1.2 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(diagramPage(spec));
    await page.evaluate(() => window.diagram.ready);
    fs.mkdirSync(dir, { recursive: true });
    const frames = [];
    const warnings = [];
    const load = async (def, index) => {
      const r = await page.evaluate(d => window.diagram.load(d), diagramDef(def));
      warnings.push(...r.warnings.map(text => ({ index, text })));
    };
    let loaded = false;
    for (const [index, step] of spec.steps.entries()) {
      if (!step.diagram) continue;
      const stage = diagramStage(step);
      if (stage) { await load(stage, index); loaded = true; }
      if (!loaded) { await load(spec.diagram, index); loaded = true; }
      // Long enough for notes and focus to settle; packets show part-way along their path.
      await page.evaluate(op => window.diagram.apply(op, 900), diagramOp(step)).catch(e => die(`step ${index + 1}: ${e.message}`));
      const file = path.join(dir, `diagram-${String(index + 1).padStart(3, '0')}.png`);
      await page.screenshot({ path: file });
      frames.push({ index, file });
    }
    if (errors.length) die(`The diagram page failed: ${errors.join('; ')}`);
    return { frames, warnings };
  } finally {
    await browser.close();
  }
}
