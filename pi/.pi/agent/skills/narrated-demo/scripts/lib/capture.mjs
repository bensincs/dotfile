// Pass 1: replays the demo in a real browser and captures it, chapter by chapter.
//
// Each chapter runs in one of three modes:
//   record  capture it: frames from Chrome's screencast at device resolution, plus a log of what
//           happened when (spoken lines, focus for the camera, navigation, people, scenes, motion)
//   replay  run its actions quickly off camera, only to rebuild the app's state for a later chapter
//   skip    nothing to do: its video is cached and nothing later needs its state
import fs from 'node:fs';
import path from 'node:path';
import { die, launch, sleep } from './common.mjs';
import { BOARD_VIEWPORT, isBoardStep, notesKit } from './board.mjs';

const LEAD_MS = 250; // the voice starts just after the step does

// A visible pointer with a click pulse (headless browsers draw none). Hidden on the chalkboard.
const POINTER = () => {
  const mount = () => {
    if (!document.body || document.getElementById('__demo_pointer')) return;
    if (document.documentElement.dataset.board === 'true') return;
    const pointer = document.createElement('div');
    pointer.id = '__demo_pointer';
    Object.assign(pointer.style, {
      position: 'fixed', left: '-40px', top: '-40px', width: '20px', height: '20px', margin: '-10px 0 0 -10px',
      borderRadius: '50%', background: 'rgba(0, 194, 156, .32)', border: '2px solid #00a383',
      boxShadow: '0 2px 8px rgba(0,0,0,.25)', zIndex: 2147483647, pointerEvents: 'none', transition: 'transform .12s',
    });
    document.body.append(pointer);
    const at = sessionStorage.getItem('__demo_pointer');
    if (at) { const [x, y] = at.split(','); pointer.style.left = `${x}px`; pointer.style.top = `${y}px`; }
    addEventListener('mousemove', e => {
      pointer.style.left = `${e.clientX}px`; pointer.style.top = `${e.clientY}px`;
      sessionStorage.setItem('__demo_pointer', `${e.clientX},${e.clientY}`);
    }, true);
    addEventListener('mousedown', () => { pointer.style.transform = 'scale(.6)'; }, true);
    addEventListener('mouseup', () => { pointer.style.transform = 'scale(1)'; }, true);
  };
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', mount) : mount();
};

// Selectors an annotation aims at, so the camera can frame them.
const targets = items => items.flatMap(it => [it.circle, it.underline, it.at, ...(Array.isArray(it.arrow) ? it.arrow : [])])
  .filter(ref => typeof ref === 'string');

/**
 * chapters: [{ name, mode: 'record' | 'replay' | 'skip', steps: [{ step, index }], last }]
 * lines: the voiced line for each step index (or null). Returns a capture per recorded chapter.
 */
export async function capture({ spec, chapters, lines, frameRoot, headed, boardUrl }) {
  const viewport = spec.viewport || { width: 1440, height: 900 };
  const browser = await launch({ headed });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: spec.scale ?? 2,
    colorScheme: spec.colorScheme || 'light',
    bypassCSP: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addInitScript(POINTER);
  const page = await context.newPage();
  const now = () => Date.now();

  // ---------- per-chapter recording state ----------
  let rec = null; // { frames, events, cues, segments, steps, motion, cuts, writes, dir, count } while recording
  let fast = false; // replaying: no glides, no typing pace, nothing drawn
  let scene = null; // what the page shows: 'app', 'board' or null (switching)
  const enter = name => {
    scene = name;
    if (rec) {
      rec.segments.push({ scene: name, from: now() });
      // The screencast only sends frames on repaint; nudge one so a static page still shows.
      page.evaluate(() => {
        const el = document.getElementById('__demo_pointer') || document.body;
        el.style.opacity = el.style.opacity === '0.999' ? '1' : '0.999';
      }).catch(() => {});
    }
  };
  const leave = () => {
    const last = rec?.segments.at(-1);
    if (last && last.to === undefined) last.to = now();
    scene = null;
  };
  const moving = async work => {
    const from = now();
    try { return await work(); } finally { rec?.motion.push({ from, to: now() }); }
  };

  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    // Acknowledge first: Chrome sends the next frame only after the ack.
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    if (!rec) return;
    const file = path.join(rec.dir, `${String(rec.count++).padStart(6, '0')}.jpg`);
    rec.frames.push({ t: metadata.timestamp ? metadata.timestamp * 1000 : now(), file });
    rec.writes.push(fs.promises.writeFile(file, Buffer.from(data, 'base64')));
  });
  // Only as large as the final video can use: the board fills 1920 px; the app sits in a ~1470 px
  // window and the camera zooms up to ~1.6x. Smaller frames encode faster, so more of them arrive.
  let casting = false;
  const startCast = async () => {
    const board = page.viewportSize()?.width === BOARD_VIEWPORT.width && scene === 'board';
    await cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: 90, maxWidth: board ? 1920 : 2560, maxHeight: board ? 1080 : 1600, everyNthFrame: 1,
    });
    casting = true;
  };
  const stopCast = async () => { if (casting) await cdp.send('Page.stopScreencast').catch(() => {}); casting = false; };
  // Chrome keeps the screencast's frame size after a viewport change, so restart it.
  const resize = async size => {
    await page.setViewportSize(size);
    if (casting) { await stopCast(); await startCast(); }
  };
  page.on('framenavigated', frame => {
    if (rec && frame === page.mainFrame()) rec.events.push({ t: now(), type: 'nav', url: frame.url() });
  });

  // ---------- helpers for steps ----------
  let zoomStep = true;
  const focus = (box, kind) => {
    if (!rec || spec.zoom === false || !zoomStep || scene !== 'app' || !box) return;
    rec.events.push({ t: now(), type: 'focus', kind, rect: { x: box.x, y: box.y, w: box.width, h: box.height } });
  };
  const visible = selector => page.locator(selector).filter({ visible: true }).first();
  const kit = notesKit(spec.annotations);
  const arrived = async () => {
    await page.waitForLoadState('load');
    if (scene === null || scene === 'board') enter('app');
  };
  const pause = ms => (fast ? Promise.resolve() : sleep(ms));

  const d = {
    page,
    context,
    wait: sleep,
    /** An absolute URL for a path on the demo's site. */
    url: p => (spec.url ? new URL(p, spec.url).href : p),
    /** A separate, unrecorded browser session, e.g. for another person accepting an invite. */
    async newPage() {
      const other = await browser.newContext({ viewport, bypassCSP: true });
      return other.newPage();
    },
    async moveTo(selector, kind = 'point') {
      const el = visible(selector);
      await el.scrollIntoViewIfNeeded();
      const box = await el.boundingBox();
      focus(box, kind);
      if (fast) return page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await moving(() => page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 }));
      await sleep(200);
    },
    async click(selector, kind = 'click') {
      await d.moveTo(selector, kind);
      await page.mouse.down(); await pause(80); await page.mouse.up();
    },
    async type(selector, text, { delay = 65 } = {}) {
      await d.click(selector, 'type');
      if (fast) return page.keyboard.insertText(text);
      await moving(() => page.keyboard.type(text, { delay }));
      await sleep(250);
    },
    async navigate(selector) {
      await Promise.all([page.waitForNavigation(), d.click(selector, 'navigate')]);
      await arrived();
      await pause(500);
    },
    async select(selector, value) {
      await d.moveTo(selector, 'type');
      await visible(selector).selectOption(value);
      await pause(400);
    },
    async goto(url) {
      await page.goto(spec.url ? new URL(url, spec.url).href : url);
      await arrived();
      await pause(500);
    },
    async press(key) { await page.keyboard.press(key); await pause(200); },
    /** Zoom the camera onto an element (or back out with d.zoomOut()). */
    async zoomTo(selector) { const box = await visible(selector).boundingBox(); focus(box, 'zoom'); },
    zoomOut() { rec?.events.push({ t: now(), type: 'zoomout' }); },
    board: {
      async open() {
        if (scene === 'board') return;
        leave();
        await resize(BOARD_VIEWPORT);
        await page.goto(boardUrl);
        await page.evaluate(() => window.board.ready);
        await sleep(300);
        enter('board');
      },
      async draw(items, ms) {
        await d.board.open();
        await moving(() => page.evaluate(([list, time]) => window.board.draw(list, time), [items, ms]));
      },
      async erase(ms = 900) { await d.board.open(); await page.evaluate(time => window.board.erase(time), ms); },
    },
    /** Draw chalk-style notes over the app; items can aim at page elements by selector. */
    async annotate(items, ms = 1500) {
      if (!(await page.evaluate(() => Boolean(window.__notes)))) {
        await page.addStyleTag({ content: kit.style });
        for (const script of kit.scripts) await page.addScriptTag({ content: script });
        await page.evaluate(theme => window.__mountNotes(theme), kit.theme);
        await page.evaluate(() => window.__notes.ready);
      }
      // Resolve targets with Playwright, so notes accept the same selectors as every other helper
      // (including :has-text()), then frame everything they point at.
      const rects = {};
      for (const selector of targets(items)) {
        const box = await visible(selector).boundingBox({ timeout: 3000 }).catch(() => null);
        if (box) rects[selector] = { x: box.x, y: box.y, w: box.width, h: box.height };
      }
      await page.evaluate(r => { window.__noteRects = r; }, rects);
      const found = Object.values(rects);
      if (found.length) {
        const x = Math.min(...found.map(r => r.x)); const y = Math.min(...found.map(r => r.y));
        const right = Math.max(...found.map(r => r.x + r.w)); const bottom = Math.max(...found.map(r => r.y + r.h));
        focus({ x: x - 120, y: y - 80, width: right - x + 240, height: bottom - y + 160 }, 'annotate');
      }
      await moving(() => page.evaluate(([list, time]) => window.__notes.draw(list, time), [items, ms]));
    },
    async clearNotes() { await page.evaluate(() => window.__notes?.clear(300)).catch(() => {}); },
  };

  // ---------- off camera: setup, if any app chapter runs ----------
  const appRuns = chapters.some(ch => ch.mode !== 'skip' && !ch.board);
  if (appRuns && spec.setup) {
    if (spec.url) await page.goto(spec.url);
    await spec.setup(d);
  }

  // ---------- chapters ----------
  const results = [];
  let person = null;
  let clearNotes = false;
  for (const ch of chapters) {
    if (ch.mode === 'skip') continue;

    // Replay: the chapter's actions, fast and off camera, to rebuild the app's state.
    if (ch.mode === 'replay') {
      fast = true;
      for (const { step } of ch.steps) {
        if (isBoardStep(step) && !step.do) continue;
        if (scene === 'board') { leave(); await resize(viewport); }
        if (step.do) await step.do(d);
        if (scene === null) enter('app');
        const who = step.persona ?? step.speaker;
        if (who) person = who;
      }
      fast = false;
      continue;
    }

    // Record.
    const dir = path.join(frameRoot, ch.key);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    rec = { dir, count: 0, frames: [], events: [], cues: [], segments: [], steps: [], motion: [], cuts: [], writes: [] };
    const first = ch.steps[0].step;
    if (isBoardStep(first)) await d.board.open();
    else if (scene === 'board' || page.url() === 'about:blank') {
      leave();
      if (page.viewportSize()?.width !== viewport.width) await resize(viewport);
      if (page.url() === 'about:blank' && spec.url) { await page.goto(spec.url); await arrived(); }
    }
    await startCast();
    if (scene && !rec.segments.length) enter(scene);
    if (clearNotes) { await d.clearNotes(); clearNotes = false; }
    // A freshly started screencast can take a moment to deliver frames (especially straight after
    // an off-camera replay). Nudge repaints until frames flow, then settle, before the clock starts.
    for (let tries = 0; tries < 40 && rec.frames.length < 3; tries++) {
      await page.evaluate(() => {
        const el = document.getElementById('__demo_pointer') || document.body;
        el.style.opacity = el.style.opacity === '0.999' ? '1' : '0.999';
      }).catch(() => {});
      await sleep(100);
    }
    await sleep(600);
    const t0 = now();

    for (const { step, index } of ch.steps) {
      // Off camera: do the work, then carry on as if no time had passed.
      if (step.cut) {
        if (clearNotes) { await d.clearNotes(); clearNotes = false; }
        const from = now();
        const was = scene;
        leave();
        if (step.do) await step.do(d);
        if (was === 'board' && page.url().startsWith('file:')) enter('board');
        else { await page.waitForLoadState('load'); enter('app'); }
        await sleep(250); // let the new scene's first frame arrive before the clock restarts
        rec.cuts.push({ from, to: now() - 250 });
        rec.events.push({ t: now(), type: 'nav', url: page.url() }); // the address bar shows where the cut ended
        continue;
      }
      zoomStep = step.zoom !== false;
      if (clearNotes) { await d.clearNotes(); clearNotes = false; }
      const line = lines[index];
      const startedAt = now();
      const who = step.persona ?? step.speaker;
      if (who && who !== person) { person = who; rec.events.push({ t: startedAt, type: 'persona', id: who, ms: line?.ms ?? 0 }); }
      if (line) rec.cues.push({ ...line, start: startedAt + LEAD_MS, end: startedAt + LEAD_MS + line.ms });
      if (step.zoom === 'out') d.zoomOut();
      if (!isBoardStep(step) && scene === 'board') { leave(); await resize(viewport); }

      // Board items and notes share the line's time, so drawing ends as the sentence does.
      const drawMs = line ? Math.max(900, line.ms - 250) : step.ms ?? 1200 * (step.draw?.length || 1);
      const action = (async () => {
        if (step.erase) await d.board.erase(step.eraseMs ?? 900);
        if (step.draw) await d.board.draw(step.draw, step.erase ? Math.max(600, drawMs - (step.eraseMs ?? 900)) : drawMs);
        else if (step.board) await d.board.open();
        if (step.do) await step.do(d);
        if (scene === null) enter('app'); // left the board without navigating
        if (typeof step.zoom === 'string' && step.zoom !== 'out') await d.zoomTo(step.zoom);
        if (step.annotate) {
          await d.annotate(step.annotate, step.annotateMs ?? (line ? Math.max(900, line.ms * 0.6) : 1500));
          clearNotes = !step.keepNotes;
        }
      })();
      await Promise.all([action, sleep(line ? LEAD_MS + line.ms : 0)]);
      const acted = now();
      await sleep(step.pause ?? 450);
      rec.steps.push({ index, start: startedAt, acted, end: now(), line: line ? { ms: line.ms, caption: line.caption } : null });
    }
    if (ch.last) await sleep(spec.tail ?? 1200);
    const end = now();
    const scenePrev = scene;
    leave();
    scene = scenePrev;
    await stopCast();
    await Promise.all(rec.writes);
    results.push({ chapter: ch, ...finish(rec, t0, end, viewport) });
    rec = null;
  }

  await sleep(200);
  await context.close();
  await browser.close();
  return results;
}

// Close the gaps left by cuts: everything after a cut moves earlier by its length.
function finish(rec, t0, end, viewport) {
  if (!rec.frames.length) die('No frames were captured.');
  const frames = [...rec.frames].sort((a, b) => a.t - b.t);
  const { cuts } = rec;
  const removed = t => cuts.reduce((sum, c) => sum + (t >= c.to ? c.to - c.from : t > c.from ? t - c.from : 0), 0);
  const shift = t => t - removed(t);
  const outside = t => !cuts.some(c => t > c.from && t < c.to);
  return {
    t0,
    end: shift(end),
    frames: frames.filter(f => outside(f.t)).map(f => ({ ...f, t: shift(f.t) })),
    events: rec.events.filter(e => outside(e.t)).map(e => ({ ...e, t: shift(e.t) })),
    cues: rec.cues.map(c => ({ ...c, start: shift(c.start), end: shift(c.end) })),
    segments: rec.segments.map(g => ({ ...g, from: shift(g.from), to: g.to === undefined ? undefined : shift(g.to) })),
    steps: rec.steps.map(st => ({ ...st, start: shift(st.start), acted: shift(st.acted), end: shift(st.end) })),
    motion: rec.motion.filter(m => outside(m.from) && outside(m.to)).map(m => ({ from: shift(m.from), to: shift(m.to) })),
    cuts: cuts.length,
    viewport,
  };
}
