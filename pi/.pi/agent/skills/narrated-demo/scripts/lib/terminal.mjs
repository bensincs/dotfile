// Terminal scenes: commands typed at a human pace, with scripted or real output.
//   terminal: 'git status'                          typed only (no output)
//   terminal: { cmd: 'git status', output: '…' }    typed, then the given output (safe, repeatable)
//   terminal: { run: 'npm test' }                   typed, then really run off camera; its real output streams in
//   terminal: [ …several of those… ], { clear: true }
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RUNTIME, asset, dependency, die } from './common.mjs';

const THEMES = {
  dark: {
    background: '#141414', foreground: '#d6d6d6', cursor: '#d6d6d6', selectionBackground: '#3a3d41',
    black: '#1e1e1e', red: '#f14c4c', green: '#23d18b', yellow: '#f5f543', blue: '#3b8eea', magenta: '#d670d6', cyan: '#29b8db', white: '#e5e5e5',
    brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#ffffff',
  },
  light: {
    background: '#fbfbfb', foreground: '#1f2328', cursor: '#1f2328', selectionBackground: '#cce4ff',
    black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#7d4e00', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
  },
};
export const terminalTheme = spec => THEMES[spec.terminal?.theme || 'dark'] || die(`Unknown terminal theme "${spec.terminal?.theme}". Use: dark, light`);
export const terminalCwd = spec => path.resolve(spec.terminal?.cwd || process.cwd());
const home = p => (p.startsWith(os.homedir()) ? `~${p.slice(os.homedir().length)}` : p);

/** The prompt, coloured: the folder in cyan, then a green arrow. `prompt` in the spec overrides it. */
export function terminalPrompt(spec) {
  if (spec.terminal?.prompt !== undefined) return spec.terminal.prompt;
  return `\x1b[36m${path.basename(terminalCwd(spec)) || '/'}\x1b[0m \x1b[32m❯\x1b[0m `;
}
/** The window title: the shell and folder, like a real terminal's tab. */
export const terminalTitle = spec => spec.terminal?.title ?? `${path.basename(process.env.SHELL || 'zsh')} — ${home(terminalCwd(spec))}`;

const fontCss = () => [400, 700].map(w => {
  const font = fs.readFileSync(dependency(`@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${w}-normal.woff2`)).toString('base64');
  return `@font-face{font-family:"JetBrains Mono";src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:${w}}`;
}).join('');

/** Writes the self-contained terminal page; returns its URL. */
export function terminalPage(spec) {
  const theme = terminalTheme(spec);
  const xterm = path.dirname(path.dirname(dependency('@xterm/xterm/lib/xterm.js')));
  const html = `<!doctype html><html data-board="true"><head><meta charset="utf-8"><title>Terminal</title>
<style>${fontCss()}</style><style>${fs.readFileSync(path.join(xterm, 'css', 'xterm.css'), 'utf8')}</style>
<style>html,body{margin:0;height:100%;overflow:hidden;background:${theme.background}}#term{position:absolute;inset:26px 30px 22px}
.xterm .xterm-viewport{overflow:hidden!important}</style></head><body><div id="term"></div>
<script>${fs.readFileSync(path.join(xterm, 'lib', 'xterm.js'), 'utf8')}</script><script>${asset('terminal.js')}</script>
<script>window.term = createTerm(document.getElementById('term'), ${JSON.stringify({ prompt: terminalPrompt(spec), theme, fontSize: spec.terminal?.fontSize ?? 22 })});</script></body></html>`;
  const file = path.join(RUNTIME, 'terminal', 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  return pathToFileURL(file).href;
}

/** A step's commands: [{ command, output, run, clear }]. */
export function terminalEntries(step) {
  const list = Array.isArray(step.terminal) ? step.terminal : [step.terminal];
  return list.map(e => {
    if (typeof e === 'string') return { command: e, output: null, run: false };
    if (e.clear && !e.cmd && !e.run && !e.type) return { clear: true };
    const command = e.run ?? e.cmd ?? e.type;
    return { command, output: e.output ?? null, run: Boolean(e.run), clear: Boolean(e.clear), timeout: e.timeout, cwd: e.cwd };
  });
}

export function checkTerminal(spec, steps) {
  const problems = [];
  if (spec.terminal?.cwd && !fs.existsSync(terminalCwd(spec))) problems.push(`terminal.cwd ${terminalCwd(spec)} does not exist`);
  steps.forEach((step, i) => {
    if (step.terminal === undefined) return;
    if (step.do || step.code || step.clay || step.draw || step.diagram || step.text !== undefined) {
      problems.push(`step ${i + 1}: a terminal step cannot also have do, code, clay, draw, diagram or text`);
    }
    for (const e of terminalEntries(step)) {
      if (!e.clear && (typeof e.command !== 'string' || !e.command.trim())) problems.push(`step ${i + 1}: each terminal entry needs a command (a string, or { cmd, output } or { run })`);
      if (e.run && e.output !== null) problems.push(`step ${i + 1}: use either run (real output) or cmd with output (scripted), not both`);
    }
  });
  if (problems.length) die(`The terminal scenes have problems:\n  ${problems.join('\n  ')}`);
}

/** Runs a command for real, in the terminal's folder, with colours on. Returns its output (stdout and stderr, in order). */
export function runCommand(spec, entry, cols = 100) {
  const cwd = entry.cwd ? path.resolve(terminalCwd(spec), entry.cwd) : terminalCwd(spec);
  return new Promise(resolve => {
    const child = spawn('/bin/sh', ['-c', entry.command], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '1', CLICOLOR_FORCE: '1', TERM: 'xterm-256color', COLUMNS: String(cols), ...(spec.terminal?.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); out += `\n[stopped after ${(entry.timeout ?? 120_000) / 1000}s]\n`; }, entry.timeout ?? 120_000);
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ output: out, code });
    });
  });
}
