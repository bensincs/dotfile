// Code scenes: real VS Code in the browser, showing files from the project being explained.
// The recorder starts a private VS Code web server on 127.0.0.1 (a disposable profile, read-only
// use), opens files off camera, then scrolls and highlights lines on camera.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { RUNTIME, die, sleep } from './common.mjs';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const EDITOR = '.monaco-editor:not(.chat-editor-overflow)';

// Readable, uncluttered, and unable to run anything: no trust, no AI, no git, no extensions UI.
export const EDITOR_SETTINGS = {
  'editor.fontSize': 22, 'editor.lineHeight': 32, 'editor.minimap.enabled': false,
  'editor.stickyScroll.enabled': false, 'editor.wordWrap': 'on', 'editor.wrappingIndent': 'indent', 'editor.smoothScrolling': true,
  'editor.cursorBlinking': 'solid', 'editor.renderLineHighlight': 'none', 'editor.occurrencesHighlight': 'off',
  'editor.selectionHighlight': false, 'editor.hover.enabled': false, 'editor.links': false,
  'editor.lightbulb.enabled': 'off', 'editor.codeLens': false, 'editor.inlayHints.enabled': 'off', 'editor.parameterHints.enabled': false,
  'editor.quickSuggestions': { other: false, comments: false, strings: false }, 'editor.matchBrackets': 'never',
  'editor.guides.indentation': true, 'editor.scrollBeyondLastLine': false, 'editor.padding.top': 12,
  'workbench.colorTheme': 'Default Dark Modern', 'workbench.startupEditor': 'none',
  'workbench.statusBar.visible': false, 'workbench.activityBar.location': 'hidden', 'workbench.tips.enabled': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden', 'workbench.layoutControl.enabled': false,
  'workbench.editor.showTabs': 'single', 'window.commandCenter': false, 'breadcrumbs.enabled': true,
  'security.workspace.trust.enabled': false, 'security.workspace.trust.banner': 'never',
  'chat.disableAIFeatures': true, 'git.enabled': false, 'extensions.ignoreRecommendations': true,
  'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'files.autoSave': 'off',
};
const SELECTION = { 'editor.selectionBackground': '#3fe0c040', 'editor.inactiveSelectionBackground': '#3fe0c040' };

/** `code` on a step: 'file', 'file:12', 'file:12-18', ':12-18' (same file), or { file, lines, at, note, zoom }.
 *  `at` scrolls to a line without highlighting anything. */
export function codeTarget(value, previousFile) {
  const o = typeof value === 'string' ? (() => {
    const m = value.match(/^(.*?)(?::(\d+)(?:-(\d+))?)?$/);
    return { file: m[1] || undefined, lines: m[2] ? [Number(m[2]), Number(m[3] || m[2])] : undefined };
  })() : { ...value, lines: value.lines === undefined ? undefined : [].concat(value.lines) };
  const file = o.file || previousFile;
  if (!file) die(`A code step needs a file first: code: 'path/to/file:12-18' (got ${JSON.stringify(value)})`);
  const lines = o.lines ? [o.lines[0], o.lines[1] ?? o.lines[0]] : null;
  return { ...o, file, lines, at: o.at ?? null };
}

/** Every code step's file and lines must exist: fails before any recording starts. */
export function checkCode(spec, steps) {
  const root = codeRoot(spec);
  let file;
  const problems = [];
  steps.forEach((step, i) => {
    if (!step.code) return;
    if (step.do) problems.push(`step ${i + 1}: a code step cannot also have do; code scenes are read-only`);
    const t = codeTarget(step.code, file);
    file = t.file;
    const full = path.resolve(root, t.file);
    if (!full.startsWith(root + path.sep) && full !== root) return problems.push(`step ${i + 1}: ${t.file} is outside ${root}`);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return problems.push(`step ${i + 1}: no file ${t.file} in ${root}`);
    const count = fs.readFileSync(full, 'utf8').split('\n').length;
    if (t.lines && (!Number.isInteger(t.lines[0]) || t.lines[0] < 1 || t.lines[1] < t.lines[0] || t.lines[1] > count)) {
      problems.push(`step ${i + 1}: lines ${t.lines.join('-')} are not in ${t.file} (1-${count})`);
    }
    if (t.at !== null && (!Number.isInteger(t.at) || t.at < 1 || t.at > count)) problems.push(`step ${i + 1}: line ${t.at} is not in ${t.file} (1-${count})`);
  });
  if (problems.length) die(`The code scenes have problems:\n  ${problems.join('\n  ')}`);
}
export const codeRoot = spec => path.resolve(spec.code?.root || process.cwd());

/** The files code steps show, for chapter fingerprints: changing a file re-records its chapter. */
export function codeFiles(spec, steps) {
  let file;
  return steps.filter(s => s.code).map(s => (file = codeTarget(s.code, file).file));
}

// ---------- the server ----------
function candidates(spec) {
  const list = [spec.code?.cli, process.env.NARRATED_DEMO_VSCODE];
  if (process.platform === 'darwin') {
    for (const app of ['Visual Studio Code', 'Visual Studio Code - Insiders']) {
      const bin = `/Applications/${app}.app/Contents/Resources/app/bin`;
      list.push(`${bin}/code-tunnel`, `${bin}/code-tunnel-insiders`, `${os.homedir()}${bin}/code-tunnel`, `${os.homedir()}${bin}/code-tunnel-insiders`);
    }
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const name of ['code-tunnel', 'code-tunnel-insiders', 'code', 'code-insiders']) list.push(path.join(dir, name));
  }
  return [...new Set(list.filter(Boolean))];
}
function findCli(spec) {
  for (const cli of candidates(spec)) {
    if (!fs.existsSync(cli)) continue;
    try {
      const help = execFileSync(cli, ['serve-web', '--help'], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
      if (help.includes('--server-data-dir')) return cli;
    } catch { /* not this one */ }
  }
  return die('Code scenes need the VS Code CLI with `serve-web` (VS Code 1.89 or later). Install VS Code, '
    + 'or set code: { cli: "/path/to/code" } in the spec (or NARRATED_DEMO_VSCODE).');
}
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** Starts a private VS Code web server for the project. Returns { url, label, stop }. */
export async function startCodeServer(spec) {
  const root = codeRoot(spec);
  const cli = findCli(spec);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'narrated-code-'));
  const machine = path.join(work, 'server', 'data', 'Machine');
  fs.mkdirSync(machine, { recursive: true });
  const settings = {
    ...EDITOR_SETTINGS,
    ...(spec.code?.theme ? { 'workbench.colorTheme': spec.code.theme } : {}),
    ...(spec.code?.fontSize ? { 'editor.fontSize': spec.code.fontSize, 'editor.lineHeight': Math.round(spec.code.fontSize * 1.45) } : {}),
    'workbench.colorCustomizations': SELECTION,
    ...(spec.code?.settings || {}),
  };
  fs.writeFileSync(path.join(machine, 'settings.json'), JSON.stringify(settings, null, 2));
  const port = await freePort();
  // Loopback only and short-lived, so no connection token; never bind this to another interface.
  // The CLI's cache (VS Code's web assets, downloaded once) is kept; the profile is thrown away.
  const cache = path.join(RUNTIME, 'vscode-cli');
  fs.mkdirSync(cache, { recursive: true });
  const child = spawn(cli, ['--cli-data-dir', cache, 'serve-web', '--host', '127.0.0.1', '--port', String(port),
    '--without-connection-token', '--accept-server-license-terms', '--disable-telemetry',
    '--server-data-dir', path.join(work, 'server'), '--default-folder', root], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const stop = () => {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
    fs.rmSync(work, { recursive: true, force: true });
  };
  // Stop the server however the render ends, including Ctrl+C: it must never outlive the render.
  process.once('exit', stop);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { stop(); process.exit(130); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) { stop(); die(`VS Code's web server stopped:\n${log.slice(-800)}`); }
    try { const r = await fetch(base); if (r.status < 500) break; } catch { /* not listening yet */ }
    await sleep(250);
  }
  const url = `${base}/?${new URLSearchParams({ folder: root })}`;
  return { url, root, label: path.basename(root), stop };
}

// ---------- the editor page ----------
const palette = page => page.locator('.quick-input-widget input');
const paletteOpen = page => page.locator('.quick-input-widget').isVisible();
async function closePalette(page) {
  for (let i = 0; i < 3 && await paletteOpen(page); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); }
}
// Runs a command by its palette title. Unknown titles are skipped: the palette never stays open.
async function command(page, name) {
  await closePalette(page);
  await page.keyboard.press(`${MOD}+Shift+P`);
  await palette(page).waitFor({ state: 'visible', timeout: 20_000 });
  await palette(page).fill(`>${name}`);
  await page.waitForTimeout(450);
  const found = await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: name.replace(/^View: /, '') }).count();
  if (found) await palette(page).press('Enter');
  await page.waitForTimeout(300);
  await closePalette(page);
}

/** Loads the editor and tidies it: no banners, no side bars, no panels. Off camera. */
export async function openEditor(page, url) {
  await page.goto(url);
  await page.waitForSelector('.monaco-workbench', { timeout: 180_000 });
  await page.waitForSelector('.part.sidebar, .part.editor', { timeout: 60_000 });
  // No banners or toasts, and no text cursor: the video highlights lines, nobody is typing.
  await page.addStyleTag({ content: '.part.banner, .notifications-toasts, .notification-toast-container, .monaco-editor .cursors-layer { display: none !important; }' });
  await page.waitForTimeout(800);
  await page.locator('.part.editor').click({ position: { x: 300, y: 300 } }).catch(() => {});
  for (const name of ['View: Close Primary Side Bar', 'View: Close Secondary Side Bar', 'View: Hide Secondary Side Bar', 'View: Hide Panel']) {
    await command(page, name);
  }
  await page.mouse.move(2, 2);
}

/** Opens a file (relative to the project) at a line, off camera. */
export async function openFile(page, file, line = 1) {
  await closePalette(page);
  await page.keyboard.press(`${MOD}+P`);
  const input = palette(page);
  await input.waitFor({ state: 'visible', timeout: 20_000 });
  await input.fill(file);
  await page.waitForFunction(f => [...document.querySelectorAll('.quick-input-list .monaco-list-row')]
    .some(r => (r.getAttribute('aria-label') || r.textContent || '').includes(f.split('/').pop())), file, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(250);
  await input.press('Enter');
  await page.waitForFunction(f => document.title.includes(f.split('/').pop()), file, { timeout: 15_000 })
    .catch(() => die(`VS Code did not open ${file}.`));
  await page.waitForSelector(`${EDITOR} .view-lines`);
  await goToLine(page, line);
}

/** Jumps to a line in the open file, off camera (the palette shows while it works). */
export async function goToLine(page, line) {
  await closePalette(page);
  await page.keyboard.press(`${MOD}+P`);
  const input = palette(page);
  await input.waitFor({ state: 'visible', timeout: 20_000 });
  await input.fill(`:${line}`);
  await input.press('Enter');
  await page.waitForTimeout(300);
  await closePalette(page);
  await page.mouse.move(2, 2);
}

/** How far lines a-b are from the view, in lines: 0 when they are already showing. */
export async function distanceTo(page, a, b) {
  const v = await visibleLines(page);
  return a < v.first ? v.first - a : b > v.last ? b - v.last : 0;
}

const visibleLines = page => page.evaluate(sel => {
  const nums = [...document.querySelectorAll(`${sel} .margin-view-overlays .line-numbers`)]
    .map(n => ({ n: Number(n.textContent), top: n.getBoundingClientRect().top })).filter(x => x.n);
  const lines = document.querySelector(`${sel} .lines-content`)?.parentElement?.getBoundingClientRect();
  const lh = Number(getComputedStyle(document.querySelector(`${sel} .view-line`)).height.replace('px', '')) || 32;
  const inside = lines ? nums.filter(x => x.top >= lines.top - 2 && x.top + lh <= lines.bottom + 2) : nums;
  return { first: Math.min(...inside.map(x => x.n)), last: Math.max(...inside.map(x => x.n)), lh, box: lines && { x: lines.left, y: lines.top, w: lines.width, h: lines.height } };
}, EDITOR);

/** The line to open a file at so lines a-b land centred, a little high (captions cover the bottom). */
export const centreLine = (a, b) => Math.round((a + b) / 2 + 2);

/** Scrolls smoothly, on camera, until lines a-b sit comfortably in view.
 *  Monaco reads one large wheel event as a single notch (about a line) but small ones as a glide,
 *  so this glides in small steps, checking where it is as it goes. Returns { from, to } while it
 *  moved (for the review's motion log), or null if the lines were already in view. */
export async function revealLines(page, a, b) {
  let v = await visibleLines(page);
  const span = v.last - v.first + 1;
  const target = Math.max(1, Math.round((a + b) / 2 - span * 0.45));
  const inView = a >= v.first + 1 && b <= v.last - 3;
  if ((inView && Math.abs(target - v.first) <= 3) || Math.abs(target - v.first) <= 1) return null;
  const from = Date.now();
  await page.mouse.move(v.box.x + v.box.w * 0.6, v.box.y + v.box.h / 2);
  let stuck = 0;
  for (let i = 0; i < 160 && stuck < 8; i++) {
    const left = target - v.first;
    if (Math.abs(left) <= 0) break;
    // Fast in the middle, gentle as it arrives.
    const px = Math.sign(left) * Math.min(48, Math.max(8, Math.abs(left) * v.lh * 0.18));
    await page.mouse.wheel(0, px);
    await sleep(16);
    const next = await visibleLines(page);
    stuck = next.first === v.first ? stuck + 1 : 0;
    if (Math.sign(target - next.first) !== Math.sign(left)) { v = next; break; } // went past: close enough
    v = next;
  }
  await sleep(220);
  return { from, to: Date.now() };
}

/** Selects lines a-b (inclusive) through the gutter, so wrapped lines select whole. */
export async function selectLines(page, a, b) {
  const gutter = n => page.locator(`${EDITOR} .margin-view-overlays .line-numbers`).filter({ hasText: new RegExp(`^\\s*${n}\\s*$`) }).first();
  await gutter(a).click();
  if (b !== a) {
    await page.keyboard.down('Shift');
    try { await gutter(b).click(); } finally { await page.keyboard.up('Shift'); }
  }
  await page.mouse.move(2, 2);
}
export const clearSelection = page => page.keyboard.press('Escape');

/** Where lines a-b are on screen, in page pixels: for the camera and for notes beside the code.
 *  w spans the longest of those lines; `right` is the longest line nearby, where a note must start. */
export async function linesRect(page, a, b) {
  return page.evaluate(([sel, from, to]) => {
    const nums = [...document.querySelectorAll(`${sel} .margin-view-overlays .line-numbers`)];
    const rows = nums.filter(n => Number(n.textContent) >= from && Number(n.textContent) <= to).map(n => n.getBoundingClientRect());
    if (!rows.length) return null;
    // Wrapped lines span several rows, and only the first has a number: the selection covers them all.
    const picked = [...document.querySelectorAll(`${sel} .view-overlays .selected-text`)].map(e => e.getBoundingClientRect()).filter(r => r.height);
    if (picked.length) rows.push(...picked.map(r => ({ top: r.top, bottom: r.bottom, left: rows[0].left })));
    const textRight = l => { const s = l.querySelector(':scope > span'); return s ? s.getBoundingClientRect().right : l.getBoundingClientRect().left; };
    const all = [...document.querySelectorAll(`${sel} .view-line`)];
    const top = Math.min(...rows.map(r => r.top)), bottom = Math.max(...rows.map(r => r.bottom));
    const within = all.filter(l => { const t = l.getBoundingClientRect().top; return t >= top - 4 && t < bottom - 4; });
    const near = all.filter(l => { const t = l.getBoundingClientRect().top; return t >= top - 40 && t < bottom + 36; });
    const x = rows[0].left;
    // The editor's visible right edge, inside its scrollbar (the scrolled content can be wider).
    const editor = document.querySelector(sel)?.getBoundingClientRect();
    const edge = Math.min(editor ? editor.right : innerWidth, innerWidth) - 18;
    return { x, y: top, w: Math.max(Math.max(...within.map(textRight), 0) - x, 200), h: bottom - top,
      right: Math.max(...near.map(textRight), x), edge };
  }, [EDITOR, a, b]);
}
