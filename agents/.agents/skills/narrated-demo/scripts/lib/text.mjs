// Big text scenes: one statement, number, list, quote or row of stats, animated as it's spoken.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RUNTIME, asset, dependency, die } from './common.mjs';

export const TEXT_VIEWPORT = { width: 1600, height: 900 };
const KINDS = ['headline', 'number', 'list', 'quote', 'stats'];

const THEMES = {
  dark: { bg: '#0d1117', text: '#f2f4f7', sub: '#9aa6b5', glow: 'radial-gradient(1200px 700px at 20% 0%, rgb(0 210 170 / 10%), transparent 60%), radial-gradient(1000px 600px at 100% 100%, rgb(80 120 255 / 9%), transparent 60%)' },
  light: { bg: '#f7f8fa', text: '#141820', sub: '#5c6675', glow: 'radial-gradient(1200px 700px at 20% 0%, rgb(0 120 212 / 7%), transparent 60%)' },
  azure: { bg: '#0b2a4a', text: '#ffffff', sub: '#a9c4e3', glow: 'radial-gradient(1200px 800px at 15% 0%, rgb(80 170 255 / 22%), transparent 60%)' },
};

const fontCss = () => [500, 600, 700, 800].map(w => {
  const font = fs.readFileSync(dependency(`@fontsource/inter/files/inter-latin-${w}-normal.woff2`)).toString('base64');
  return `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:${w}}`;
}).join('');

/** Writes the self-contained big-text page; returns its URL. */
export function textPage(spec) {
  const opts = spec.text || {};
  const theme = { ...(THEMES[opts.theme || 'dark'] || die(`Unknown text theme "${opts.theme}". Use: ${Object.keys(THEMES).join(', ')}`)) };
  const accent = opts.accent || (opts.theme === 'light' ? '#0078d4' : opts.theme === 'azure' ? '#50e6ff' : '#3fe0c0');
  const vars = `--bg:${theme.bg};--text:${theme.text};--sub:${theme.sub};--glow:${theme.glow};--accent:${accent};--accent-soft:${accent}2e`;
  const html = `<!doctype html><html data-board="true"><head><meta charset="utf-8"><title>Text</title>
<style>${fontCss()}:root{${vars}}</style><style>${asset('text.css')}</style></head><body><div id="root"></div>
<script>${asset('text.js')}</script><script>window.bigtext = createBigText(document.getElementById('root'));</script></body></html>`;
  const file = path.join(RUNTIME, 'text', 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  return pathToFileURL(file).href;
}

/** A step's text item. A string is a headline. */
export const textItem = step => (typeof step.text === 'string' ? { headline: step.text } : step.text);

export function checkText(steps) {
  const problems = [];
  steps.forEach((step, i) => {
    if (step.text === undefined) return;
    const item = textItem(step);
    const kinds = KINDS.filter(k => item && k in item);
    if (kinds.length !== 1) problems.push(`step ${i + 1}: text needs exactly one of ${KINDS.join(', ')} (or a string headline)`);
    if (item?.list && (!Array.isArray(item.list) || !item.list.length)) problems.push(`step ${i + 1}: text list needs items`);
    if (item?.stats && (!Array.isArray(item.stats) || item.stats.some(s => s.value === undefined))) problems.push(`step ${i + 1}: stats need [{ value, label }]`);
    if (step.do || step.code || step.clay || step.draw || step.diagram) problems.push(`step ${i + 1}: a text step cannot also have do, code, clay, draw or diagram`);
  });
  if (problems.length) die(`The text scenes have problems:\n  ${problems.join('\n  ')}`);
}
