// Chalkboard pages and the chalk layer for notes over a live app.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RUNTIME, asset, dependency, die } from './common.mjs';

export const BOARD_VIEWPORT = { width: 1600, height: 900 };

const THEMES = {
  graphite: {
    board: '#1a211e', boardEdge: '#111613', frame: '#0b0f0d', smudge: 'rgb(255 255 255 / 3.5%)',
    colors: { white: '#f1efe6', muted: '#a9b3ad', accent: '#3fe0c0', yellow: '#f2c94c', red: '#ff7a8a',
      orange: '#ffa260', blue: '#8fa8ff', green: '#9be38f', pink: '#f5a3d0' },
  },
  green: {
    board: '#2b4a3a', boardEdge: '#1d3428', frame: '#5a3d24', smudge: 'rgb(255 255 255 / 4%)',
    colors: { white: '#f4f2e8', muted: '#b9c7bd', accent: '#ffe27a', yellow: '#ffe27a', red: '#ff9a9a',
      orange: '#ffbd7a', blue: '#a8c4ff', green: '#c8f0a0', pink: '#ffc0dc' },
  },
};

// Notes over an app: marker-like colours that read on light interfaces. "white" is the default ink.
const NOTE_COLORS = {
  white: '#1f2622', muted: '#5d6a62', accent: '#00a383', yellow: '#b7791f', red: '#e5484d',
  orange: '#dd6b20', blue: '#3e63dd', green: '#2f9e44', pink: '#d6409f',
};

const fontCss = () => {
  const font = fs.readFileSync(dependency('@fontsource/caveat/files/caveat-latin-600-normal.woff2')).toString('base64');
  return `@font-face{font-family:Chalk;src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:100 900}`;
};

/** Writes the self-contained board page (theme, font, rough.js, engine inline); returns its URL. */
export function boardPage(options = {}) {
  const base = THEMES[options.theme || 'graphite'] || die(`Unknown board theme "${options.theme}". Use: ${Object.keys(THEMES).join(', ')}`);
  const theme = { ...base, ...options, colors: { ...base.colors, ...(options.colors || {}) } };
  const vars = `--board:${theme.board};--board-edge:${theme.boardEdge};--frame:${theme.frame};--smudge:${theme.smudge}`;
  const html = `<!doctype html><html data-board="true"><head><meta charset="utf-8"><title>Board</title>
<style>${fontCss()}:root{${vars}}</style><style>${asset('board.css')}</style></head><body>
<div id="surface"><svg id="board" viewBox="0 0 ${BOARD_VIEWPORT.width} ${BOARD_VIEWPORT.height}" preserveAspectRatio="xMidYMid meet"><defs>
<filter id="grain" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="4" result="noise"/>
  <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" result="rough"/>
  <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.4 1.9" result="mask"/>
  <feComposite in="rough" in2="mask" operator="in"/>
</filter></defs><g class="ghosts" id="ghosts"></g><g class="ink" id="ink"></g></svg></div>
${theme.chalk ? '<div id="chalk"></div>' : ''}
<script>${fs.readFileSync(dependency('roughjs/bundled/rough.js'), 'utf8')}</script>
<script>${asset('board.js')}</script>
<script>window.board = createChalkboard(document.getElementById('board'),
  { theme: ${JSON.stringify(theme)}, chalk: document.getElementById('chalk') });</script></body></html>`;
  const file = path.join(RUNTIME, 'board', 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  return pathToFileURL(file).href;
}

/** Scripts and styles that put a chalk layer over any page, for `annotate` steps and code notes.
 *  surface: 'light' (an app: marker-like inks) or 'dark' (an editor: the board's bright chalk). */
export function notesKit(options = {}) {
  const base = options.surface === 'dark' ? THEMES.graphite.colors : NOTE_COLORS;
  return {
    style: fontCss(),
    scripts: [fs.readFileSync(dependency('roughjs/bundled/rough.js'), 'utf8'), asset('board.js'), asset('notes.js')],
    theme: { colors: { ...base, ...(options.surface === 'dark' ? {} : options.colors || {}) } },
  };
}
