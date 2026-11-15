// Claymation scenes: renders plasticine frames offline with three.js (assets/clay.js).
// Capture records when each clay step happens; this renders those moments frame by frame, so
// clay scenes never stutter however busy the machine is. Frames are JPEGs on the capture's clock.
import fs from 'node:fs';
import path from 'node:path';
import { SKILL, dependency, die } from './common.mjs';

export const CLAY_FPS = 24; // smooth, like modern studio stop motion; 12 ("on twos") is the classic, jerkier look

// What a step's `clay` field may hold. The engine checks the details; this catches typos early.
export const CLAY_KINDS = ['robot', 'person', 'block', 'parcel', 'house', 'server', 'laptop', 'cloud', 'sign', 'banner', 'tree', 'rock', 'flower'];
export const CLAY_ACTIONS = ['walk', 'carry', 'pick', 'place', 'turn', 'look', 'bubble', 'appear', 'vanish', 'glow', 'dim', 'smoke',
  'move', 'spin', 'wait', 'wave', 'hop', 'cheer', 'nod', 'shake', 'point', 'shrug', 'think'];

/** A clay step's parts: { stage?, actions, camera }. Accepts an array of actions as shorthand. */
export function clayParts(step) {
  const c = step.clay;
  if (Array.isArray(c)) return { actions: c, camera: step.camera };
  return { stage: c.stage, actions: c.do || c.actions || [], camera: c.camera ?? step.camera };
}

export function checkClay(spec, steps) {
  const problems = [];
  const things = defs => (defs || []).forEach((t, i) => {
    if (!CLAY_KINDS.some(k => k in t)) problems.push(`clay thing ${i + 1} ${JSON.stringify(t)}: unknown kind (use ${CLAY_KINDS.join(', ')})`);
  });
  if (spec.clay) things(spec.clay.things);
  steps.forEach((step, i) => {
    if (!step.clay) return;
    if (step.do || step.draw || step.code) problems.push(`step ${i + 1}: a clay step cannot also have do, draw or code`);
    const { stage, actions } = clayParts(step);
    if (stage) things(stage.things);
    actions.forEach(a => {
      if (!CLAY_ACTIONS.some(v => v in a)) problems.push(`step ${i + 1}: unknown clay action ${JSON.stringify(a)} (use ${CLAY_ACTIONS.join(', ')})`);
    });
  });
  if (problems.length) die(`The clay scenes have problems:\n  ${problems.join('\n  ')}`);
}

/** The timeline the engine plays: the stage, and every clay step up to the last one in `windows`. */
export function clayTimeline(spec, windows) {
  const known = new Map(windows.map(w => [w.index, w]));
  const last = Math.max(...windows.map(w => w.index));
  const steps = [];
  spec.steps.forEach((step, index) => {
    if (!step.clay || index > last) return;
    const w = known.get(index); // steps shown in earlier chapters have no window: they have already happened
    steps.push({ index, ...clayParts(step), start: w ? w.start : -Infinity, budget: w ? w.budget : 0, end: w ? w.end : -Infinity });
  });
  return { world: { set: 'meadow', things: [], ...(spec.clay || {}) }, steps, fps: spec.clay?.fps ?? CLAY_FPS, boil: spec.clay?.boil ?? 0.5, dof: spec.clay?.dof ?? 1 };
}

const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.woff2': 'font/woff2' };

async function webglPage(browser) {
  const page = await browser.newPage();
  const ok = await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2')));
  await page.close();
  return ok;
}

/**
 * Renders clay frames for the given times (ms on the timeline's clock) into `dir`.
 * Returns { frames: [{ t, file }], warnings: [{ index, text }] }. Uses the GPU when headless Chrome
 * has one, and software WebGL otherwise.
 */
export async function renderClay({ timeline, times, width, height, dir, launch }) {
  const three = path.dirname(dependency('three/package.json'));
  const font = dependency('@fontsource/fredoka/files/fredoka-latin-600-normal.woff2');
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>@font-face{font-family:Fredoka;src:url(https://clay.local/fredoka.woff2) format("woff2");font-weight:100 900}
html,body{margin:0;background:#000;overflow:hidden}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"https://clay.local/three/build/three.module.js","three/addons/":"https://clay.local/three/examples/jsm/"}}</script>
</head><body><script type="module" src="https://clay.local/clay.js"></script></body></html>`;
  const files = {
    '/index.html': () => html,
    '/clay.js': () => fs.readFileSync(path.join(SKILL, 'assets', 'clay.js')),
    '/fredoka.woff2': () => fs.readFileSync(font),
  };

  let browser = await launch();
  if (!(await webglPage(browser))) {
    await browser.close();
    browser = await launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    if (!(await webglPage(browser))) die('Clay scenes need WebGL, and this Chrome has none (not even software rendering).');
  }
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://clay.local/**', route => {
      const { pathname } = new URL(route.request().url());
      let body;
      if (files[pathname]) body = files[pathname]();
      else if (pathname.startsWith('/three/')) {
        const file = path.join(three, pathname.slice('/three/'.length));
        if (!file.startsWith(three) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        body = fs.readFileSync(file);
      } else return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: TYPES[path.extname(pathname)] || 'application/octet-stream', body });
    });
    await page.goto('https://clay.local/index.html');
    await page.waitForFunction(() => window.clayReady === true, null, { timeout: 60_000 }).catch(() => {
      die(`The clay engine did not start${errors.length ? `: ${errors.join('; ')}` : '.'}`);
    });
    const { warnings } = await page.evaluate(tl => window.clay.load(tl), { ...timeline, width, height }).catch(e => {
      die(e.message.replace(/^.*?clay: /s, 'clay: ').split('\n')[0]);
    });
    fs.mkdirSync(dir, { recursive: true });
    const out = [];
    if (process.env.NARRATED_DEMO_DEBUG_CLAY) for (const t of times) console.log(JSON.stringify(await page.evaluate(at => window.clay.inspect(at), t)));
    for (const [i, t] of times.entries()) {
      const data = await page.evaluate(at => window.clay.frame(at), t);
      const file = path.join(dir, `clay-${String(i).padStart(6, '0')}.jpg`);
      fs.writeFileSync(file, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
      out.push({ t, file });
    }
    if (errors.length) die(`The clay engine failed: ${errors.join('; ')}`);
    return { frames: out, warnings };
  } finally {
    await browser.close();
  }
}

/** Renders a clay-only preview: stills at chosen moments, without voice or capture. */
export async function clayStills({ spec, at, width = 1280, height = 720, dir, launch }) {
  // Lay the clay steps end to end, `ms` each (or 3 s), as capture would with silent steps.
  let t = 0;
  const windows = [];
  spec.steps.forEach((step, index) => {
    if (!step.clay) return;
    const budget = step.ms ?? 3000;
    windows.push({ index, start: t, budget, end: t + budget + 450 });
    t += budget + 450;
  });
  if (!windows.length) die('This spec has no clay steps.');
  const times = at?.length ? at : windows.map(w => w.start + w.budget * 0.98);
  return { ...(await renderClay({ timeline: clayTimeline(spec, windows), times, width, height, dir, launch })), windows };
}
