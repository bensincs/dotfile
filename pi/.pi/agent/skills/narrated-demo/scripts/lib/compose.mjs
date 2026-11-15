// Pass 2: composes the final video frame by frame.
// For each output frame it picks the captured frame. App and code frames get the camera (eased zoom
// and pan) and sit in a window frame on a background; chalkboard and clay frames fill the screen.
// Captions, name cards, title cards and fades go on top. The stage page renders each state;
// screenshots stream into ffmpeg with the voice mix and subtitles.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RUNTIME, asset, die, initials, launch } from './common.mjs';

const W = 1920;
const H = 1080;
const DEFAULT_BACKGROUND = 'radial-gradient(1400px 800px at 18% -10%, rgb(0 210 170 / 16%), transparent 60%), '
  + 'radial-gradient(1200px 700px at 100% 110%, rgb(80 120 255 / 10%), transparent 60%), linear-gradient(160deg, #111816, #090c0b)';
const PALETTE = ['#3fe0c0', '#8fa8ff', '#f2c94c', '#ffa260', '#f5a3d0', '#9be38f'];
// Scenes that fill the frame; the others (app, code) sit in a window.
const FULL = new Set(['board', 'diagram', 'text', 'clay']);

const easeInOut = p => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
// Smootherstep: gentle at both ends, so camera moves start and settle without a jolt.
const smooth = p => p * p * p * (p * (p * 6 - 15) + 10);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ms = n => {
  const t = Math.max(0, Math.round(n));
  const pad = (v, w = 2) => String(v).padStart(w, '0');
  return `${pad(Math.floor(t / 3_600_000))}:${pad(Math.floor(t / 60_000) % 60)}:${pad(Math.floor(t / 1000) % 60)},${pad(t % 1000, 3)}`;
};

/**
 * The camera: which part of the page is visible over time, as a rectangle in page pixels.
 * Zooms in for typing, notes and explicit targets (not every click); eases back out when the
 * pointer heads for a link, on page and scene changes, and after a pause. Easing the rectangle
 * itself, rather than a centre and scale, keeps moves smooth even at the page's edges.
 */
function camera(cap, options) {
  const { width: vw, height: vh } = cap.viewport;
  const scale = options.scale ?? 1.35;
  const hold = options.hold ?? 3000;
  const easeIn = options.ease ?? 1100;
  const easeOut = options.easeOut ?? 1400;
  const triggers = new Set(options.on ?? ['type', 'annotate', 'zoom']);
  const home = { x: 0, y: 0, w: vw, h: vh, out: true };
  const view = (cx, cy, s) => {
    const w = vw / s; const h = vh / s;
    return { x: clamp(cx - w / 2, 0, vw - w), y: clamp(cy - h / 2, 0, vh - h), w, h };
  };
  const keys = [];
  for (const e of cap.events) {
    if (e.type === 'focus' && triggers.has(e.kind)) {
      const r = e.rect;
      // Never so close that the target stops fitting comfortably.
      const s = clamp(Math.min(scale, (0.7 * vw) / Math.max(r.w, 1), (0.7 * vh) / Math.max(r.h, 1)), 1, scale);
      keys.push({ t: e.t, ...view(r.x + r.w / 2, r.y + r.h / 2, s), focus: true });
    } else if ((e.type === 'focus' && e.kind === 'navigate') || e.type === 'nav' || e.type === 'zoomout') {
      keys.push({ t: e.t, ...home });
    }
  }
  for (const seg of cap.segments) keys.push({ t: seg.from, ...home, cut: true });
  keys.sort((a, b) => a.t - b.t);
  const all = [];
  keys.forEach((k, i) => {
    all.push(k);
    const next = keys[i + 1];
    if (k.focus && (!next || next.t > k.t + hold)) all.push({ t: k.t + hold, ...home });
  });
  // A new scene starts where it should, without easing in from the last one.
  const lerp = (a, b, p) => ({ x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, w: a.w + (b.w - a.w) * p, h: a.h + (b.h - a.h) * p });
  const progress = (k, t) => (k.cut ? 1 : smooth(clamp((t - k.t) / (k.out ? easeOut : easeIn), 0, 1)));
  const starts = [home];
  for (let i = 1; i < all.length; i++) starts.push(lerp(starts[i - 1], all[i - 1], progress(all[i - 1], all[i].t)));
  return t => {
    let i = -1;
    for (let lo = 0, hi = all.length - 1; lo <= hi;) { const mid = (lo + hi) >> 1; if (all[mid].t <= t) { i = mid; lo = mid + 1; } else hi = mid - 1; }
    if (i < 0) return home;
    return lerp(starts[i], all[i], progress(all[i], t));
  };
}

/**
 * Composes one chapter (or a whole single-chapter demo) into a video segment with its voice.
 * No subtitle track: the caller joins segments and adds subtitles from the returned cues.
 * edges: fade in at the start and out at the end (chapter boundaries, with transition 'fade').
 */
export async function compose({ cap, spec, intro, outro, out, fps = 30, silent = false, captions = true, draft = false, edges = false }) {
  // ---------- final timeline ----------
  const introMs = intro ? Math.max(intro.ms ?? 3200, (intro.line?.ms ?? 0) + 1500) : 0;
  const bodyMs = cap.end - cap.t0;
  const outroMs = outro ? Math.max(outro.ms ?? 3200, (outro.line?.ms ?? 0) + 1500) : 0;
  const total = introMs + bodyMs + outroMs;
  const wall = t => cap.t0 + (t - introMs);

  const cues = [
    ...(intro?.line ? [{ ...intro.line, start: 500, end: 500 + intro.line.ms }] : []),
    ...cap.cues.map(c => ({ ...c, start: introMs + c.start - cap.t0, end: introMs + c.end - cap.t0 })),
    ...(outro?.line ? [{ ...outro.line, start: introMs + bodyMs + 500, end: introMs + bodyMs + 500 + outro.line.ms }] : []),
  ];

  // Frames captured inside a scene (not mid page-load or mid-switch), in time order.
  const segmentOf = t => cap.segments.find(s => t >= s.from && t < (s.to ?? Infinity));
  const frames = cap.frames.filter(f => { const s = segmentOf(f.t); return s && (!f.scene || f.scene === s.scene); })
    .map(f => ({ ...f, scene: f.scene || segmentOf(f.t).scene }));
  if (!frames.length) die('No usable frames were captured.');
  const frameAt = t => {
    let i = 0;
    for (let lo = 0, hi = frames.length - 1; lo <= hi;) { const mid = (lo + hi) >> 1; if (frames[mid].t <= t) { i = mid; lo = mid + 1; } else hi = mid - 1; }
    return frames[i];
  };
  const navs = cap.events.filter(e => e.type === 'nav');
  const labels = cap.events.filter(e => e.type === 'label');
  // The title bar: the app's address, or the project and file shown in the editor.
  const urlAt = (t, scene) => {
    if (scene === 'code' || scene === 'terminal') return labels.filter(l => l.t <= t && l.scene === scene).at(-1)?.text || '';
    const nav = navs.filter(n => n.t <= t).at(-1);
    if (!nav || nav.url.startsWith('file:') || nav.url.startsWith('data:')) return '';
    try { const u = new URL(nav.url); return `${u.host}${u.pathname}${u.search}`; } catch { return nav.url; }
  };

  // ---------- layout ----------
  const frame = spec.frame === false ? { window: false, padding: 0 } : (spec.frame || {});
  const framed = frame.window !== false;
  const padding = frame.padding ?? (framed ? 64 : 0);
  const bar = framed ? 44 : 0;
  const { width: vw, height: vh } = cap.viewport;
  const k = Math.min((W - 2 * padding) / vw, (H - 2 * padding - bar) / vh);
  const view = { w: Math.round(vw * k), h: Math.round(vh * k) };
  const layout = {
    x: Math.round((W - view.w) / 2), y: Math.round((H - view.h - bar) / 2), w: view.w, h: view.h, bar,
    window: framed, url: framed && frame.url !== false,
    background: frame.background || DEFAULT_BACKGROUND, accent: frame.accent || '#00d2aa',
  };
  // Each chapter ends back at the full page, so the next one starts where this one leaves off.
  const look = camera({ ...cap, events: [...cap.events, { t: cap.end - ((spec.zoom?.easeOut ?? 1400) + 300), type: 'zoomout' }] },
    typeof spec.zoom === 'object' ? spec.zoom : {});

  // ---------- transitions, people ----------
  const transition = typeof spec.transition === 'string' ? { type: spec.transition } : (spec.transition || { type: 'none' });
  const half = (transition.ms ?? 700) / 2;
  const cuts = [
    ...(intro ? [introMs] : []),
    ...cap.segments.slice(1).map(s => introMs + s.from - cap.t0),
    ...(outro ? [introMs + bodyMs] : []),
    ...(edges ? [0, total] : []),
  ];
  const fadeAt = t => (transition.type === 'fade' ? Math.min(1, ...cuts.map(c => clamp(Math.abs(t - c) / half, 0, 1))) : 1);
  const people = spec.personas || {};
  const ids = Object.keys(people);
  const cardMs = spec.cardMs ?? 4200;
  const personaEvents = cap.events.filter(e => e.type === 'persona').map(e => ({ ...e, at: introMs + e.t - cap.t0 }));
  const cardAt = t => {
    const e = personaEvents.filter(p => p.at <= t).at(-1);
    if (!e) return null;
    // On screen for cardMs, or for the whole of the line the person speaks as they appear.
    const shown = Math.max(cardMs, e.ms + 600);
    if (t - e.at > shown) return null;
    const local = t - e.at;
    const opacity = Math.min(clamp(local / 350, 0, 1), clamp((shown - local) / 350, 0, 1));
    const p = people[e.id];
    return {
      name: p.name, role: p.role, initials: initials(p.name), opacity, shift: (1 - easeInOut(opacity)) * 26,
      color: p.color || PALETTE[ids.indexOf(e.id) % PALETTE.length],
    };
  };
  const captionAt = t => {
    if (!captions) return null;
    const c = cues.find(q => !q.hidden && t >= q.start && t < q.end + 200);
    if (!c) return null;
    return { text: c.caption, opacity: Math.min(clamp((t - c.start) / 150, 0, 1), clamp((c.end + 200 - t) / 150, 0, 1)) };
  };

  const stateAt = t => {
    const base = { fade: fadeAt(t), card: cardAt(t), caption: captionAt(t) };
    if (t < introMs) return { ...base, scene: 'title', title: intro };
    if (t >= introMs + bodyMs) return { ...base, scene: 'title', title: outro };
    const w = wall(t);
    const f = frameAt(w);
    if (FULL.has(f.scene)) return { ...base, scene: f.scene, src: pathToFileURL(f.file).href };
    const c = look(w); // visible rectangle in page pixels
    const zoom = vw / c.w;
    return { ...base, scene: f.scene, src: pathToFileURL(f.file).href, imgW: view.w, zoom, tx: -c.x * k * zoom, ty: -c.y * k * zoom, url: urlAt(w, f.scene) };
  };

  // ---------- render ----------
  const stageFile = path.join(RUNTIME, 'stage', 'index.html');
  fs.mkdirSync(path.dirname(stageFile), { recursive: true });
  fs.writeFileSync(stageFile, `<!doctype html><html><head><meta charset="utf-8"><style>${asset('stage.css')}</style></head><body>
<div id="bg"></div><div id="content"><div id="window"><div class="bar"><span class="dots"><i></i><i></i><i></i></span><span id="url"></span></div>
<div id="view"><img id="app" alt=""></div></div><img id="board" alt=""></div>
<div id="titlecard"><div class="rule"></div><h1 id="t-title"></h1><p id="t-sub"></p></div>
<div id="card"><span id="c-avatar"></span><span><strong id="c-name"></strong><small id="c-role"></small></span></div>
<div id="caption"></div><script>${asset('stage.js')}</script></body></html>`);

  // Every segment gets an audio track (silence underneath the lines), so segments join cleanly.
  const audio = silent ? [] : cues;
  const seconds = (total / 1000).toFixed(3);
  const inputs = ['-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    ...(silent ? [] : ['-f', 'lavfi', '-t', seconds, '-i', 'anullsrc=r=48000:cl=mono']), ...audio.flatMap(c => ['-i', c.file])];
  const mix = silent ? [] : ['-filter_complex',
    `[1:a]anull[base];${audio.map((c, i) => `[${i + 2}:a]adelay=delays=${Math.round(c.start)}:all=1[a${i}]`).join(';')}${audio.length ? ';' : ''}`
    + `[base]${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length + 1}:duration=first:normalize=0:dropout_transition=0[voice]`,
  '-map', '[voice]', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000'];
  // Drafts: half size, faster encode. Same layout, timing and audio, for checking before the final.
  const encode = draft ? ['-preset', 'veryfast', '-crf', '26'] : ['-preset', 'medium', '-crf', '18'];
  const ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-map', '0:v', ...mix,
    '-c:v', 'libx264', ...encode, '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', '-t', seconds, out],
  { stdio: ['pipe', 'inherit', 'inherit'] });
  const finished = once(ffmpeg, 'exit');

  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: draft ? 0.5 : 1 });
  await page.goto(pathToFileURL(stageFile).href);
  await page.evaluate(l => window.stage.layout(l), layout);
  const count = Math.ceil((total / 1000) * fps);
  let reported = 0;
  for (let n = 0; n < count; n++) {
    await page.evaluate(s => window.stage.render(s), stateAt((n * 1000) / fps));
    const shot = await page.screenshot({ type: 'jpeg', quality: draft ? 80 : 92 });
    if (!ffmpeg.stdin.write(shot)) await once(ffmpeg.stdin, 'drain');
    const pct = Math.floor((100 * (n + 1)) / count);
    if (pct >= reported + 10) { reported = pct - (pct % 10); process.stdout.write(`  composing ${reported}%\r`); }
  }
  ffmpeg.stdin.end();
  const [code] = await finished;
  await browser.close();
  process.stdout.write('\n');
  if (code !== 0) die('ffmpeg failed to encode the video.');
  return { total, introMs, cues: cues.map(c => ({ start: c.start, end: c.end, caption: c.caption })) };
}
