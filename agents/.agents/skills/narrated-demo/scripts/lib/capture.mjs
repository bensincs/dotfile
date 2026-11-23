// Pass 1: plays the demo and captures it, chapter by chapter.
//
// Every scene has its own page and screencast, so switching scenes never disturbs another:
//   app    the web app (the page `do` steps drive), with a visible pointer
//   code   VS Code in the browser, from a private local server, read-only
//   board  the chalkboard page
//   diagram  the architecture diagram page
//   text   the big-text page
//   terminal  a terminal emulator page; real commands run off camera, their output plays on camera
//   clay   no page while capturing: its frames render offline afterwards, on the same clock
// Switching scenes, opening files and loading pages happen off camera, as cuts.
//
// Each chapter runs in one of three modes:
//   record  capture it: frames at device resolution, plus a log of what happened when (spoken
//           lines, focus for the camera, navigation, people, scenes, motion)
//   replay  run its app actions quickly off camera, only to rebuild the app's state for later
//   skip    nothing to do: its video is cached and nothing later needs its state
import fs from 'node:fs';
import path from 'node:path';
import { die, launch, sleep } from './common.mjs';
import { BOARD_VIEWPORT, notesKit } from './board.mjs';
import { CLAY_FPS, clayParts, clayTimeline, renderClay } from './clay.mjs';
import * as code from './code.mjs';
import { DIAGRAM_VIEWPORT, diagramDef, diagramOp, diagramStage } from './diagram.mjs';
import { TEXT_VIEWPORT, textItem } from './text.mjs';
import { runCommand, terminalEntries, terminalTitle } from './terminal.mjs';

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

/** How long a clay step's actions take: the line, or `ms`, or about a second an action. */
export const clayBudget = (step, line) => (line ? Math.max(900, line.ms - 150) : step.ms ?? 1200 * Math.max(1, clayParts(step).actions.length));

/**
 * chapters: [{ name, mode: 'record' | 'replay' | 'skip', steps: [{ step, index }], last }]
 * lines: the voiced line for each step index (or null). scenes: each step's scene (null for cuts).
 * Returns a capture per recorded chapter.
 */
export async function capture({ spec, chapters, lines, scenes, codeTargets = [], frameRoot, headed, boardUrl, diagramUrl, textUrl, terminalUrl, draft }) {
  const viewport = spec.viewport || { width: 1440, height: 900 };
  const scale = spec.scale ?? 2;
  // Headless Chrome's screencast ignores the emulated pixel ratio; this flag renders every page at
  // `scale` for real, so frames are sharp enough for the camera to zoom in.
  const browser = await launch({ headed, args: [`--force-device-scale-factor=${scale}`] });
  const context = await browser.newContext({
    viewport, deviceScaleFactor: scale, colorScheme: spec.colorScheme || 'light', bypassCSP: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addInitScript(POINTER);
  const page = await context.newPage();
  const now = () => Date.now();
  let codeServer = null;
  page.on('framenavigated', frame => {
    if (rec && frame === page.mainFrame()) rec.events.push({ t: now(), type: 'nav', url: frame.url() });
  });

  // ---------- per-chapter recording state ----------
  let rec = null; // { frames, events, cues, segments, steps, motion, cuts, clay, writes, dir, count, started } while recording
  let fast = false; // replaying: no glides, no typing pace, nothing drawn
  let scene = null; // what the video shows: 'app', 'code', 'board', 'clay', or null (switching)
  const enter = name => {
    scene = name;
    if (rec) rec.segments.push({ scene: name, from: now() });
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

  // ---------- scenes: a page and a screencast each ----------
  const stages = {};
  let active = null; // the stage being cast
  async function cast(stage) {
    stage.cdp = await stage.page.context().newCDPSession(stage.page);
    stage.size = stage.page.viewportSize();
    stage.cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      // Acknowledge first: Chrome sends the next frame only after the ack.
      stage.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      if (!rec || active !== stage || scene !== stage.name) return;
      // A frame of the headless window rather than the page (a different shape) never makes it in;
      // the page's size is locked again, so the next frames are right.
      if (metadata.deviceWidth && Math.abs(metadata.deviceWidth / metadata.deviceHeight - stage.size.width / stage.size.height) > 0.01) {
        if (!stage.relocking) { stage.relocking = true; lock(stage).catch(() => {}).finally(() => { stage.relocking = false; nudge(stage.page); }); }
        return;
      }
      const file = path.join(rec.dir, `${String(rec.count++).padStart(6, '0')}.jpg`);
      rec.frames.push({ t: metadata.timestamp ? metadata.timestamp * 1000 : now(), file, scene: stage.name });
      rec.writes.push(fs.promises.writeFile(file, Buffer.from(data, 'base64')));
    });
  }
  // Only as large as the final video can use: the board fills 1920 px; the app sits in a ~1470 px
  // window and the camera zooms up to ~1.6x. Smaller frames encode faster, so more of them arrive.
  // Lock the page's size and pixel ratio for the screencast, every time it starts. Without this it
  // can capture the headless window, which is shorter than the page (letterboxed or cropped frames).
  const lock = stage => stage.cdp.send('Emulation.setDeviceMetricsOverride',
    { width: stage.size.width, height: stage.size.height, deviceScaleFactor: scale, mobile: false });
  const startCast = async stage => {
    if (!stage?.cdp || stage.casting) return;
    await lock(stage);
    const board = ['board', 'diagram', 'text'].includes(stage.name);
    await stage.cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: 90, maxWidth: board ? 1920 : 2560, maxHeight: board ? 1080 : 1600, everyNthFrame: 1,
    });
    stage.casting = true;
  };
  const stopCast = async stage => {
    if (stage?.casting) await stage.cdp.send('Page.stopScreencast').catch(() => {});
    if (stage) stage.casting = false;
  };
  // The screencast only sends frames on repaint; nudge until frames flow so a still page shows.
  // A one-pixel, near-transparent mark in a corner changes on every nudge, so something repaints.
  const nudge = p => p.evaluate(() => {
    let el = document.getElementById('__demo_nudge');
    if (!el && document.body) {
      el = document.createElement('div');
      el.id = '__demo_nudge';
      Object.assign(el.style, { position: 'fixed', right: '0', bottom: '0', width: '1px', height: '1px', zIndex: 2147483646, pointerEvents: 'none' });
      document.body.append(el);
    }
    if (el) el.style.background = el.style.background === 'rgba(0, 0, 0, 0.02)' ? 'rgba(0, 0, 0, 0.01)' : 'rgba(0, 0, 0, 0.02)';
  }).catch(() => {});
  async function flowing(stage) {
    if (!rec || !stage?.page) return;
    const before = rec.frames.length;
    for (let tries = 0; tries < 40 && rec.frames.length < before + 2; tries++) { await nudge(stage.page); await sleep(60); }
  }

  // Full-screen scenes (board, diagram, text) get their own context at their own size.
  const fullPage = async size => (await browser.newContext({ viewport: size, deviceScaleFactor: scale })).newPage();

  async function stageFor(name) {
    if (stages[name]) return stages[name];
    let stage;
    if (name === 'app') {
      stage = { name, page };
    } else if (name === 'board') {
      if (!boardUrl) die('A chalkboard step needs the board page.');
      const p = await fullPage(BOARD_VIEWPORT);
      await p.goto(boardUrl);
      await p.evaluate(() => window.board.ready);
      stage = { name, page: p };
    } else if (name === 'diagram') {
      const p = await fullPage(DIAGRAM_VIEWPORT);
      await p.goto(diagramUrl);
      await p.evaluate(() => window.diagram.ready);
      stage = { name, page: p, applied: null };
    } else if (name === 'terminal') {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale });
      const p = await ctx.newPage();
      await p.goto(terminalUrl);
      await p.evaluate(() => window.term.ready);
      await p.evaluate(() => window.term.prompt());
      stage = { name, page: p };
    } else if (name === 'text') {
      const p = await fullPage(TEXT_VIEWPORT);
      await p.goto(textUrl);
      await p.evaluate(() => window.bigtext.ready);
      stage = { name, page: p };
    } else if (name === 'code') {
      codeServer = await code.startCodeServer(spec);
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: 'dark', bypassCSP: true });
      const p = await ctx.newPage();
      await code.openEditor(p, codeServer.url);
      stage = { name, page: p, file: null };
    } else if (name === 'clay') {
      stage = { name, page: null };
    }
    if (stage.page) await cast(stage);
    stages[name] = stage;
    return stage;
  }

  // Shows a scene. While recording, the switch (and any `prepare` work) happens off camera.
  async function show(name, prepare = null) {
    if (scene === name && !prepare) return;
    const work = async () => {
      const stage = await stageFor(name);
      if (active !== stage) {
        await stopCast(active);
        // Idle editor and board pages are frozen so they don't compete with the scene being recorded.
        // The app is never frozen: its timers and requests may matter to the demo.
        if (active?.cdp && active.name !== 'app') await active.cdp.send('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => {});
        if (stage.cdp && stage.name !== 'app') await stage.cdp.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
        // The board starts empty at every chapter, and whenever the video comes back to it.
        if (name === 'board') await stage.page.evaluate(() => window.board.clear(0));
        // Big text too: the last headline shouldn't flash up before the next one.
        if (name === 'text') await stage.page.evaluate(() => window.bigtext.clear(0));
        if (name === 'app' && page.url() === 'about:blank') {
          if (!spec.url) die('This step shows the app, but the spec has no url and nothing has opened a page yet.');
          await page.goto(spec.url);
          await page.waitForLoadState('load');
        }
      }
      if (prepare) await prepare(stage);
      active = stage;
      await startCast(stage);
    };
    // The title bar of windowed scenes: the editor's project and file, or the terminal's folder.
    const label = () => {
      if (name === 'code' && stages.code?.file) rec.events.push({ t: now(), type: 'label', scene: 'code', text: `${codeServer.label} › ${stages.code.file}` });
      if (name === 'terminal') rec.events.push({ t: now(), type: 'label', scene: 'terminal', text: terminalTitle(spec) });
    };
    if (!rec) { await work(); scene = name; return; }
    const from = now();
    leave();
    await work();
    enter(name);
    await flowing(active);
    if (rec.started) rec.cuts.push({ from, to: now() - 60 });
    label(); // after the cut, so it isn't cut out with it
  }

  // ---------- helpers for steps ----------
  let zoomStep = true;
  const focus = (box, kind) => {
    if (!rec || spec.zoom === false || !zoomStep || !['app', 'code'].includes(scene) || !box) return;
    rec.events.push({ t: now(), type: 'focus', kind, rect: { x: box.x, y: box.y, w: box.width ?? box.w, h: box.height ?? box.h } });
  };
  const visible = selector => page.locator(selector).filter({ visible: true }).first();
  const kits = { light: notesKit(spec.annotations), dark: notesKit({ ...spec.annotations, surface: 'dark' }) };
  kits.code = /light/i.test(spec.code?.theme || '') ? kits.light : kits.dark; // notes in the editor match its theme
  let notesOn = null; // the page with notes drawn on it
  const arrived = async () => {
    await page.waitForLoadState('load');
    if (scene === null) enter('app');
  };
  const pause = ms => (fast ? Promise.resolve() : sleep(ms));

  async function annotateOn(p, items, ms, { kit = kits.light, rects = {} } = {}) {
    if (!(await p.evaluate(() => Boolean(window.__notes)))) {
      await p.addStyleTag({ content: kit.style });
      for (const script of kit.scripts) await p.addScriptTag({ content: script });
      await p.evaluate(theme => window.__mountNotes(theme), kit.theme);
      await p.evaluate(() => window.__notes.ready);
    }
    // Resolve targets with Playwright, so notes accept the same selectors as every other helper
    // (including :has-text()), then frame everything they point at.
    const found = { ...rects };
    for (const selector of targets(items)) {
      if (found[selector]) continue;
      const box = await p.locator(selector).filter({ visible: true }).first().boundingBox({ timeout: 3000 }).catch(() => null);
      if (box) found[selector] = { x: box.x, y: box.y, w: box.width, h: box.height };
    }
    await p.evaluate(r => { window.__noteRects = r; }, found);
    const all = Object.values(found);
    if (all.length) {
      const x = Math.min(...all.map(r => r.x)); const y = Math.min(...all.map(r => r.y));
      const right = Math.max(...all.map(r => r.x + r.w)); const bottom = Math.max(...all.map(r => r.y + r.h));
      focus({ x: x - 120, y: y - 80, width: right - x + 240, height: bottom - y + 160 }, 'annotate');
    }
    notesOn = p;
    await moving(() => p.evaluate(([list, time]) => window.__notes.draw(list, time), [items, ms]));
  }
  const clearNotes = async () => {
    if (notesOn) await notesOn.evaluate(() => window.__notes?.clear(300)).catch(() => {});
    notesOn = null;
  };

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
    /** Draw chalk-style notes over the app; items can aim at page elements by selector. */
    annotate: (items, ms = 1500) => annotateOn(page, items, ms),
    clearNotes,
  };

  // ---------- each step's own action, by scene ----------
  async function boardAction(step, drawMs) {
    const board = stages.board.page;
    if (step.erase) await board.evaluate(ms => window.board.erase(ms), step.eraseMs ?? 900);
    const ms = step.erase ? Math.max(600, drawMs - (step.eraseMs ?? 900)) : drawMs;
    if (step.draw) await moving(() => board.evaluate(([list, time]) => window.board.draw(list, time), [step.draw, ms]));
  }
  async function codeAction(step, line) {
    const stage = stages.code;
    const p = stage.page;
    const t = codeTargets[step.__index];
    if (!t.lines) {
      await code.clearSelection(p);
      const glide = t.at ? await code.revealLines(p, t.at, t.at) : null;
      if (glide) rec?.motion.push(glide);
      return;
    }
    const [a, b] = t.lines;
    const glide = await code.revealLines(p, a, b);
    if (glide) rec?.motion.push(glide);
    await sleep(120);
    await code.selectLines(p, a, b);
    const rect = await code.linesRect(p, a, b);
    if (rect && (t.zoom || step.zoom === true)) focus(rect, 'zoom');
    if (rect && t.note) {
      // Beside the lines if there is room; otherwise above them at the right, on a dark backing.
      const size = t.size || 34;
      const wide = String(t.note).length * size * 0.48;
      const beside = rect.right + 48 + wide < rect.edge - 24;
      const note = beside
        ? { note: t.note, at: [rect.right + 48, rect.y + rect.h / 2], align: 'left' }
        : { note: t.note, at: [rect.edge - 32, Math.max(size, rect.y - size * 0.7)], align: 'right', backdrop: kits.code === kits.light ? '#ffffffee' : '#1f1f1fee' };
      await annotateOn(p, [{ ...note, color: t.color || 'yellow', size, rotate: beside ? -2 : 0 }],
        line ? Math.max(800, line.ms * 0.5) : 1200, { kit: kits.code });
    }
  }
  // Opens the step's file, off camera, when the code scene needs a different one.
  const codePrepare = index => async stage => {
    const t = codeTargets[index];
    if (!t || stage.file === t.file) return;
    await code.openFile(stage.page, t.file, t.lines ? code.centreLine(...t.lines) : t.at ? code.centreLine(t.at, t.at) : 1);
    stage.file = t.file;
  };
  // Real commands run off camera, before their step; the step then types them and plays the output.
  const ran = new Map(); // step index -> outputs, in entry order
  const terminalPrepare = index => async () => {
    const outs = [];
    for (const e of terminalEntries(spec.steps[index])) outs.push(e.run ? (await runCommand(spec, e)).output : null);
    ran.set(index, outs);
  };
  const needsRun = index => spec.steps[index].terminal !== undefined && terminalEntries(spec.steps[index]).some(e => e.run) && !ran.has(index);
  const prepareFor = (index, name) => (name === 'code' ? codePrepare(index) : name === 'diagram' ? diagramPrepare(index)
    : name === 'terminal' && needsRun(index) ? terminalPrepare(index) : null);
  // Far jumps in the same file happen off camera too: gliding past a hundred lines reads as noise.
  const FAR = 40;
  const farJump = async index => {
    const t = codeTargets[index];
    const range = t?.lines || (t?.at ? [t.at, t.at] : null);
    return Boolean(range && stages.code && stages.code.file === t.file && (await code.distanceTo(stages.code.page, ...range)) > FAR);
  };
  const jumpPrepare = index => async stage => {
    const t = codeTargets[index];
    await code.goToLine(stage.page, code.centreLine(...(t.lines || [t.at, t.at])));
  };
  const needsFile = index => codeTargets[index] && codeTargets[index].file !== stages.code?.file;

  // ---------- diagrams: rebuilt from earlier steps whenever the page isn't where the story is ----------
  const diagramSteps = spec.steps.map((s, i) => (s.diagram ? i : -1)).filter(i => i >= 0);
  const diagramReady = index => {
    const before = diagramSteps.filter(i => i < index).at(-1) ?? -1;
    return stages.diagram && stages.diagram.applied === before && !diagramStage(spec.steps[index]);
  };
  const loadDiagram = async (p, def, index) => {
    const { warnings } = await p.evaluate(d => window.diagram.load(d), diagramDef(def));
    for (const w of warnings) if (!diagramWarnings.some(x => x.index === index && x.text === w)) diagramWarnings.push({ index, text: w });
  };
  const diagramWarnings = [];
  const diagramPrepare = index => async stage => {
    if (diagramReady(index)) return;
    const p = stage.page;
    const own = diagramStage(spec.steps[index]);
    if (own) {
      await loadDiagram(p, own, index);
    } else {
      // The latest stage at or before this step, then every diagram step since, instantly.
      const earlier = diagramSteps.filter(i => i < index);
      const from = [...earlier].reverse().find(i => diagramStage(spec.steps[i]));
      if (from === undefined && !spec.diagram) die(`Step ${index + 1} shows a diagram, but there is none yet.`);
      await loadDiagram(p, from === undefined ? spec.diagram : diagramStage(spec.steps[from]), from ?? index);
      for (const i of earlier.filter(i => from === undefined || i >= from)) await p.evaluate(op => window.diagram.apply(op, 0), diagramOp(spec.steps[i]));
    }
    stage.applied = -2; // loaded for this step; its own op is applied on camera
  };

  // ---------- off camera: setup, if any app chapter runs ----------
  try {
    const appRuns = chapters.some(ch => ch.mode !== 'skip' && ch.steps.some(({ index, step }) => scenes[index] === 'app' || step.do || step.cut));
    if (appRuns && spec.setup) {
      if (spec.url) await page.goto(spec.url);
      await spec.setup(d);
    }

    const results = [];
    let person = null;
    for (const ch of chapters) {
      if (ch.mode === 'skip') continue;

      // Replay: the chapter's app actions, fast and off camera, to rebuild the app's state.
      if (ch.mode === 'replay') {
        fast = true;
        for (const { step, index } of ch.steps) {
          const who = step.persona ?? step.speaker;
          if (who) person = who;
          if (!step.do) continue;
          if (scenes[index] === 'app' || step.cut) await show('app');
          await step.do(d);
        }
        fast = false;
        continue;
      }

      // Record.
      const dir = path.join(frameRoot, ch.key);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      rec = { dir, count: 0, frames: [], events: [], cues: [], segments: [], steps: [], motion: [], cuts: [], clay: [], writes: [], started: false };
      const firstShown = ch.steps.find(({ index }) => scenes[index]);
      const first = firstShown ? scenes[firstShown.index] : scene || 'app';
      scene = null;
      active = null;
      await show(first, firstShown ? prepareFor(firstShown.index, first) : null);
      if (notesOn) await clearNotes();
      await flowing(active);
      await sleep(400);
      const t0 = now();
      rec.started = true;
      let clearPending = false;

      for (const { step, index } of ch.steps) {
        // Off camera: do the work, then carry on as if no time had passed.
        if (step.cut) {
          if (clearPending) { await clearNotes(); clearPending = false; }
          const from = now();
          const was = scene;
          leave();
          if (step.do) await step.do(d);
          if (was === 'app') await page.waitForLoadState('load');
          enter(was);
          await flowing(active);
          rec.cuts.push({ from, to: now() - 60 });
          if (was === 'app') rec.events.push({ t: now(), type: 'nav', url: page.url() }); // the address bar shows where the cut ended
          continue;
        }
        const want = scenes[index];
        if (clearPending) { await clearNotes(); clearPending = false; }
        if (want !== scene || (want === 'code' && needsFile(index))) {
          await show(want, prepareFor(index, want)).catch(e => { throw stepError(e, index, want, step); });
        } else if (want === 'code' && await farJump(index)) {
          await show(want, jumpPrepare(index)).catch(e => { throw stepError(e, index, want, step); });
        } else if (want === 'terminal' && needsRun(index)) {
          await show(want, terminalPrepare(index)).catch(e => { throw stepError(e, index, want, step); });
        } else if (want === 'diagram' && !diagramReady(index) && stages.diagram?.applied !== -2) {
          await show(want, diagramPrepare(index)).catch(e => { throw stepError(e, index, want, step); });
        }
        zoomStep = step.zoom !== false;
        const line = lines[index];
        const startedAt = now();
        const who = step.persona ?? step.speaker;
        if (who && who !== person) { person = who; rec.events.push({ t: startedAt, type: 'persona', id: who, ms: line?.ms ?? 0 }); }
        if (line) rec.cues.push({ ...line, start: startedAt + LEAD_MS, end: startedAt + LEAD_MS + line.ms, hidden: step.caption === false });
        if (step.zoom === 'out') d.zoomOut();

        // Drawing, notes and clay share the line's time, so they end as the sentence does.
        const shareMs = line ? Math.max(900, line.ms - 250) : step.ms ?? (step.diagram || step.text !== undefined || step.terminal !== undefined ? 2000 : 1200 * (step.draw?.length || 1));
        const clayMs = want === 'clay' ? clayBudget(step, line) : 0;
        const action = (async () => {
          if (want === 'board') await boardAction(step, shareMs);
          if (want === 'terminal' && step.terminal !== undefined) {
            const p = stages.terminal.page;
            const entries = terminalEntries(step);
            const outs = ran.get(index) || [];
            // Typing takes up to 40% of the line; output streams through the rest.
            const share = shareMs / Math.max(1, entries.filter(e => !e.clear).length);
            for (const [k, e] of entries.entries()) {
              if (e.clear) { await p.evaluate(() => { window.term.clear(); return window.term.prompt(); }); continue; }
              const out = e.run ? outs[k] : e.output;
              await moving(() => p.evaluate(([cmd, ms]) => window.term.type(cmd, ms), [e.command, Math.min(share * 0.4, e.command.length * 75)]));
              await sleep(220); // a beat before pressing Enter
              if (out) await moving(() => p.evaluate(([text, ms]) => window.term.output(text, ms), [out, share * 0.55]));
              await p.evaluate(() => window.term.prompt());
            }
            ran.delete(index);
          }
          if (want === 'text' && step.text !== undefined) {
            await moving(() => stages.text.page.evaluate(([item, ms]) => window.bigtext.show(item, ms), [textItem(step), shareMs]));
          }
          if (want === 'diagram') {
            const p = stages.diagram.page;
            await moving(() => p.evaluate(([op, ms]) => window.diagram.apply(op, ms), [diagramOp(step), shareMs]));
            stages.diagram.applied = index;
          }
          if (want === 'code') await codeAction({ ...step, __index: index }, line);
          if (want === 'clay') await sleep(clayMs);
          if (step.do) await step.do(d);
          if (scene === null) enter(want); // a navigation mid-step
          if (want === 'app' && typeof step.zoom === 'string' && step.zoom !== 'out') await d.zoomTo(step.zoom);
          if (step.annotate) {
            const kit = want === 'code' ? kits.code : kits.light;
            await annotateOn(want === 'code' ? stages.code.page : page, step.annotate,
              step.annotateMs ?? (line ? Math.max(900, line.ms * 0.6) : 1500), { kit });
          }
          if (step.annotate || (want === 'code' && step.code?.note)) clearPending = !step.keepNotes;
        })();
        await Promise.all([action.catch(e => { throw stepError(e, index, want, step); }), sleep(line ? LEAD_MS + line.ms : 0)]);
        const acted = now();
        await sleep(step.pause ?? 450);
        if (want === 'clay') rec.clay.push({ index, start: startedAt, budget: clayMs, end: now() });
        rec.steps.push({ index, start: startedAt, acted, end: now(), line: line ? { ms: line.ms, caption: line.caption } : null });
      }
      if (ch.last) await sleep(spec.tail ?? 1200);
      const end = now();
      const shown = scene;
      leave();
      await stopCast(active);
      await Promise.all(rec.writes);
      if (rec.clay.length) await clayFrames(rec, spec, draft);
      rec.diagramWarnings = diagramWarnings.filter(w => ch.steps.some(({ index }) => index === w.index));
      results.push({ chapter: ch, ...finish(rec, t0, end, viewport) });
      scene = shown;
      rec = null;
    }
    return results;
  } finally {
    await sleep(200);
    await browser.close().catch(() => {});
    codeServer?.stop();
  }
}

// Names the step that failed, so a selector or file problem is easy to find in the spec.
function stepError(e, index, scene, step) {
  const what = step.say ? ` "${step.say.slice(0, 50)}${step.say.length > 50 ? '…' : ''}"` : '';
  const err = new Error(`Step ${index + 1} (${scene})${what} failed: ${String(e.message).split('\n')[0]}`);
  err.stack = e.stack;
  return err;
}

// Clay scenes render after capture: every frame of every clay segment, on the capture's clock.
async function clayFrames(rec, spec, draft) {
  const fps = spec.clay?.fps ?? CLAY_FPS;
  const times = [];
  for (const seg of rec.segments.filter(s => s.scene === 'clay')) {
    for (let t = seg.from; t < seg.to; t += 1000 / fps) times.push(t);
  }
  const size = draft ? { width: 960, height: 540 } : { width: 1920, height: 1080 };
  const started = Date.now();
  const { frames, warnings } = await renderClay({ timeline: clayTimeline(spec, rec.clay), times, ...size, dir: rec.dir, launch });
  rec.clayWarnings = warnings;
  process.stdout.write(`  rendered ${times.length} clay frames at ${size.width} x ${size.height} in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  rec.frames.push(...frames.map(f => ({ ...f, scene: 'clay' })));
}

// Close the gaps left by cuts: everything after a cut moves earlier by its length.
function finish(rec, t0, end, viewport) {
  if (!rec.frames.length) die('No frames were captured.');
  const frames = [...rec.frames].sort((a, b) => a.t - b.t);
  const cuts = rec.cuts.filter(c => c.to > c.from);
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
    clayWarnings: [...(rec.clayWarnings || []), ...(rec.diagramWarnings || [])],
    viewport,
  };
}
