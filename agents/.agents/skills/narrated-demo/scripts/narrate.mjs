#!/usr/bin/env node
// Records narrated demo, walkthrough and explainer videos.
//
//   node narrate.mjs <demo.mjs> [--draft] [--out <dir>] [--voice <name>] [--fps 30] [--no-captions] [--headed]
//                    [--audio-only] [--silent] [--keep-raw]
//   node narrate.mjs <demo.mjs> --review [--draft]   # redo the review of the last render, no re-render
//   node narrate.mjs <demo.mjs> --redo <chapter,...>  # re-record chapters even if unchanged
//   node narrate.mjs <demo.mjs> --fresh               # ignore every cached chapter
//   node narrate.mjs <demo.mjs> --stills              # clay and diagram steps: a still of each, no capture
//   node narrate.mjs --icons <words>         # search the Azure icons for diagram nodes
//   node narrate.mjs --check                 # confirm speech synthesis works with the saved config
//   node narrate.mjs --samples [voice,...] [--text "..."] [--out <dir>]   # audition voices
//   node narrate.mjs --set-voice <voice>     # save the preferred voice in the config
//   node narrate.mjs --voice                 # print the saved voice
//
// 1. Voices every line with Azure AI Speech (cached in ~/.cache/narrated-demo/narration).
// 2. Capture: plays the steps at double resolution; each step lasts as long as its line. Web apps,
//    code (VS Code) and the chalkboard are browser pages; clay scenes render offline on the same clock.
// 3. Compose: camera moves, window frame, full-screen board and clay, captions, name cards, title
//    cards and fades, rendered frame by frame at 1920 x 1080 (960 x 540 for --draft), with the voice.
// 4. Review: contact sheets and a report in <name>.review/. Videos land next to the spec.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG, RUNTIME, SKILL, die } from './lib/common.mjs';
import {
  CHECK_VOICE, NO_VOICE, duration, loadConfig, samples, saveConfig, spoken, synthesise, voiceList,
} from './lib/speech.mjs';
import { boardPage } from './lib/board.mjs';
import { capture, clayBudget } from './lib/capture.mjs';
import { checkClay, clayStills } from './lib/clay.mjs';
import { checkCode, codeRoot, codeTarget } from './lib/code.mjs';
import { checkDiagram, diagramPage, diagramStills } from './lib/diagram.mjs';
import { checkText, textPage } from './lib/text.mjs';
import { checkTerminal, terminalPage } from './lib/terminal.mjs';
import { ICON_DIR, searchIcons } from './lib/icons.mjs';
import { compose } from './lib/compose.mjs';
import { chapterRows, review, sheets } from './lib/review.mjs';
import { isStateless, resolveScenes } from './lib/scenes.mjs';

// ---------- arguments ----------
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? (args.splice(i, 1), true) : false; };
const option = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const check = flag('--check');
const headed = flag('--headed');
const audioOnly = flag('--audio-only');
const noCaptions = flag('--no-captions');
const keepRaw = flag('--keep-raw');
const silent = flag('--silent'); // same timing, no voice track
const draft = flag('--draft');   // half size, 15 fps, fast encode: for checking before the final
const reviewOnly = flag('--review');
const fresh = flag('--fresh');
const redo = (option('--redo') || '').split(',').filter(Boolean);
const wantSamples = flag('--samples');
const stills = flag('--stills');
const iconQuery = option('--icons');
const setVoice = option('--set-voice');
const textOption = option('--text');
const outOption = option('--out');
const fpsOption = option('--fps');
const showVoice = args.length === 1 && args[0] === '--voice';
const voiceOption = showVoice ? (args.splice(0, 1), undefined) : option('--voice');
const specPath = args[0];

// ---------- voice commands ----------
if (iconQuery !== undefined) {
  const found = searchIcons(iconQuery);
  console.log(found.length ? found.join('\n') : `No icons match "${iconQuery}". Try fewer or shorter words.`);
  process.exit(0);
}
if (check) {
  const config = loadConfig();
  const file = path.join(os.tmpdir(), 'narrated-demo-check.mp3');
  await synthesise(config, { text: 'Narration is ready.', voice: config.voice || CHECK_VOICE, rate: '0%' }, file);
  console.log(`Speech works: ${config.endpoint} (${duration(file)} ms test clip).`);
  console.log(config.voice ? `Voice: ${config.voice}` : 'Voice: not chosen yet');
  process.exit(0);
}
if (showVoice) {
  const config = loadConfig();
  console.log(config.voice || 'not chosen');
  process.exit(config.voice ? 0 : 1);
}
if (setVoice) {
  const config = loadConfig();
  if (!(await voiceList(config)).includes(setVoice)) die(`${setVoice} is not available in ${config.location}. Run --samples to hear the options.`);
  saveConfig({ ...config, voice: setVoice });
  console.log(`Saved ${setVoice} as the narration voice in ${CONFIG}.`);
  process.exit(0);
}
if (wantSamples) {
  await samples(loadConfig(), { voices: args[0]?.split(','), text: textOption, dir: path.resolve(outOption || 'demos/voice-samples') });
  process.exit(0);
}

// ---------- the demo ----------
if (!specPath) die('Usage: narrate.mjs <demo.mjs> [--draft] [--stills] [--audio-only] [--review] [--redo chapter,...] [--fresh] '
  + '[--out dir] [--voice name] [--fps n] [--no-captions] [--headed] [--silent] [--keep-raw]\n'
  + '       narrate.mjs --check | --voice | --set-voice <voice> | --samples [voice,...] [--text "..."] | --icons <words>');
const spec = (await import(pathToFileURL(path.resolve(specPath)))).default;
if (!spec?.steps?.length) die(`${specPath} must export default { url, steps: [{ say, do } or { say, draw }] }`);
const config = loadConfig();
const name = spec.name || path.basename(specPath).replace(/(\.demo)?\.m?js$/, '');
const outDir = path.resolve(outOption || spec.out || path.dirname(path.resolve(specPath)));
fs.mkdirSync(outDir, { recursive: true });
const suffix = draft ? '.draft' : silent ? '.silent' : '';
const mp4 = path.join(outDir, `${name}${suffix}.mp4`);
const reviewDir = path.join(outDir, `${name}${draft ? '.draft' : ''}.review`);

async function runReview(rows) {
  const result = await review({ rows, mp4, dir: reviewDir });
  console.log(`\nReview:    ${result.report} (${result.flagged} of ${result.steps} steps flagged)`);
  for (const sheet of result.sheets) console.log(`           ${sheet}`);
}
if (reviewOnly) {
  const file = path.join(reviewDir, 'rows.json');
  if (!fs.existsSync(file) || !fs.existsSync(mp4)) die(`Nothing to review: render ${mp4} first.`);
  await runReview(JSON.parse(fs.readFileSync(file, 'utf8')));
  process.exit(0);
}
const voice = voiceOption || spec.voice || config.voice;
if (!voice) die(NO_VOICE);
const rate = spec.rate || '0%';
const personas = spec.personas || {};
for (const step of spec.steps) {
  if (step.cut && (step.say || step.draw || step.annotate)) die('Cut steps run off camera: give them `do` only, no `say`, `draw` or `annotate`.');
  for (const id of [step.persona, step.speaker].filter(Boolean)) {
    if (!personas[id]) die(`Step "${(step.say || '').slice(0, 40)}…" names persona "${id}", but spec.personas has no "${id}".`);
  }
}
const pronounce = { ...(config.pronounce || {}), ...(spec.pronounce || {}) };

// ---------- scenes: catch mistakes before voicing or recording anything ----------
const scenes = resolveScenes(spec);
checkCode(spec, spec.steps);
checkClay(spec, spec.steps);
checkDiagram(spec, spec.steps);
checkText(spec.steps);
checkTerminal(spec, spec.steps);
let lastFile;
const codeTargets = spec.steps.map(step => (step.code ? (lastFile = codeTarget(step.code, lastFile).file, codeTarget(step.code, lastFile)) : null));

// ---------- voice every line ----------
const cacheDir = path.join(RUNTIME, 'narration');
fs.mkdirSync(cacheDir, { recursive: true });
async function voiceLine(say, speaker, stepRate) {
  if (!say) return null;
  const who = speaker ? personas[speaker] : null;
  const text = say.trim();
  const line = { text: spoken(text, pronounce), voice: who?.voice || voice, rate: stepRate || rate };
  const hash = createHash('sha256').update(JSON.stringify(line)).digest('hex').slice(0, 16);
  const file = path.join(cacheDir, `${hash}.mp3`);
  if (!fs.existsSync(file)) await synthesise(config, line, file);
  // A persona speaking is named in the caption; the narrator isn't.
  return { ...line, file, ms: duration(file), caption: who ? `${who.short || who.name}: ${text}` : text };
}

console.log(`Voicing with ${voice}${Object.keys(pronounce).length ? ` (pronouncing ${Object.keys(pronounce).join(', ')})` : ''}`);
const intro = spec.intro ? { ...spec.intro, line: await voiceLine(spec.intro.say) } : null;
const outro = spec.outro ? { ...spec.outro, line: await voiceLine(spec.outro.say) } : null;
const lines = [];
for (const [i, step] of spec.steps.entries()) {
  const line = await voiceLine(step.say, step.speaker, step.rate);
  lines.push(line);
  if (line) console.log(`  ${String(i + 1).padStart(2)}. ${(line.ms / 1000).toFixed(1)}s  ${line.caption}`);
}
const spokenMs = [intro?.line, outro?.line, ...lines].filter(Boolean).reduce((sum, l) => sum + l.ms, 0);
console.log(`Narration: ${(spokenMs / 1000).toFixed(1)}s`);
if (audioOnly) process.exit(0);

// ---------- chapters ----------
// A step with `chapter: 'name'` starts a chapter. Each chapter's video is cached under a fingerprint
// of everything that shapes it, so a render only records and composes what changed. App chapters
// also depend on the state every earlier app chapter created; chalkboard chapters depend on nothing.
const boardUrl = scenes.includes('board') ? boardPage(spec.board) : null;
const diagramUrl = scenes.includes('diagram') ? diagramPage(spec) : null;
const textUrl = scenes.includes('text') ? textPage(spec) : null;
const terminalUrl = scenes.includes('terminal') ? terminalPage(spec) : null;
const fps = Number(fpsOption || spec.fps || (draft ? 15 : 30));
const captions = !noCaptions && spec.captions !== false;
const hash = (...parts) => createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 20);
const source = value => JSON.stringify(value ?? null, (k, v) => (typeof v === 'function' ? `fn:${v.toString()}` : v));
// The skill's own drawing, capture and compose code is part of every fingerprint (not the review: it doesn't touch the video).
const engine = hash(...[...fs.readdirSync(path.join(SKILL, 'scripts', 'lib')).filter(f => f !== 'review.mjs').map(f => path.join('scripts', 'lib', f)),
  ...fs.readdirSync(path.join(SKILL, 'assets')).map(f => path.join('assets', f))]
  .sort().map(f => fs.readFileSync(path.join(SKILL, f), 'utf8')));
const look = source({
  viewport: spec.viewport, scale: spec.scale, colorScheme: spec.colorScheme, board: spec.board, annotations: spec.annotations, text: spec.text, terminal: spec.terminal,
  frame: spec.frame, zoom: spec.zoom, transition: spec.transition, personas: spec.personas, cardMs: spec.cardMs, url: spec.url,
  tail: spec.tail, fps, draft, silent, captions,
});
// Preview without recording: a still at the end of every clay and diagram step. Clay steps are
// timed from the voiced lines, so rushed moves show up here too.
if (stills) {
  const dir = path.join(outDir, `${name}.stills`);
  fs.rmSync(dir, { recursive: true, force: true });
  const { launch } = await import('./lib/common.mjs');
  const cards = [];
  const warnings = [];
  if (scenes.includes('clay')) {
    const timed = { ...spec, steps: spec.steps.map((step, i) => (step.clay ? { ...step, ms: clayBudget(step, lines[i]) } : step)) };
    const clay = await clayStills({ spec: timed, dir, launch });
    clay.frames.forEach((f, i) => cards.push({ index: clay.windows[i].index, file: f.file }));
    warnings.push(...clay.warnings);
  }
  if (scenes.includes('diagram')) {
    const diagram = await diagramStills({ spec, dir, launch });
    cards.push(...diagram.frames);
    warnings.push(...diagram.warnings);
  }
  if (!cards.length) die('--stills previews clay and diagram steps, and this spec has neither.');
  cards.sort((a, b) => a.index - b.index);
  const files = await sheets(dir, cards.map(c => ({
    file: c.file, title: `#${c.index + 1}`, tag: scenes[c.index], text: spec.steps[c.index].say || '(no line)',
    flags: warnings.filter(w => w.index === c.index).map(w => w.text),
  })));
  for (const w of warnings) console.log(`  step ${w.index + 1}: ${w.text}`);
  console.log(`\nStills: ${dir} (${cards.length} step${cards.length === 1 ? '' : 's'})`);
  for (const f of files) console.log(`        ${f}`);
  process.exit(0);
}

const chapters = [];
for (const [index, step] of spec.steps.entries()) {
  if (step.chapter || !chapters.length) chapters.push({ name: step.chapter || 'main', steps: [] });
  chapters.at(-1).steps.push({ step, index });
}
// What else a chapter shows, beyond its own steps: the code files it opens, and for clay, the
// set and every clay step before it (the clay world carries on from one clay step to the next).
function shownFrom(ch) {
  const extra = [];
  const files = [...new Set(ch.steps.map(({ index }) => codeTargets[index]?.file).filter(Boolean))];
  if (files.length) extra.push(source(spec.code), ...files.map(f => fs.readFileSync(path.resolve(codeRoot(spec), f), 'utf8')));
  const lastClay = Math.max(-1, ...ch.steps.filter(({ step }) => step.clay).map(({ index }) => index));
  if (lastClay >= 0) extra.push(source(spec.clay), source(spec.steps.slice(0, lastClay).map(s => s.clay ?? null)));
  // Diagrams carry on from step to step too, and their icons come from the downloaded set.
  const lastDiagram = Math.max(-1, ...ch.steps.filter(({ step }) => step.diagram).map(({ index }) => index));
  if (lastDiagram >= 0) {
    extra.push(source(spec.diagram), source(spec.steps.slice(0, lastDiagram).map(s => s.diagram ?? null)));
    extra.push(fs.existsSync(path.join(ICON_DIR, 'SOURCE')) ? fs.readFileSync(path.join(ICON_DIR, 'SOURCE'), 'utf8') : '');
  }
  return hash(...extra);
}
let state = hash(source(spec.url), source(spec.setup));
chapters.forEach((ch, i) => {
  ch.first = i === 0;
  ch.last = i === chapters.length - 1;
  ch.scenes = [...new Set(ch.steps.map(({ index }) => scenes[index]).filter(Boolean))];
  // Code, chalkboard and clay chapters don't depend on (or change) the app's state.
  ch.stateless = ch.steps.every(({ step, index }) => isStateless(step, scenes[index]));
  const content = source([
    ch.steps.map(({ step, index }) => [step, scenes[index], lines[index] && [lines[index].text, lines[index].voice, lines[index].caption]]),
    ch.first && intro && [intro, intro.line?.text, intro.line?.voice], ch.last && outro && [outro, outro.line?.text, outro.line?.voice],
  ]);
  ch.key = hash(engine, look, content, shownFrom(ch), ch.stateless ? 'stateless' : state, String(chapters.length > 1));
  // Only actions change the app's state; a new line, note or camera move here leaves later chapters cached.
  if (!ch.stateless) state = hash(state, source(ch.steps.map(({ step }) => [step.do, step.cut])));
});
const chapterDir = path.join(RUNTIME, 'chapters', name);
if (fresh) fs.rmSync(chapterDir, { recursive: true, force: true });
fs.mkdirSync(chapterDir, { recursive: true });
const cached = ch => !redo.includes(ch.name) && fs.existsSync(path.join(chapterDir, `${ch.key}.mp4`)) && fs.existsSync(path.join(chapterDir, `${ch.key}.json`));
const lastAppRecord = chapters.reduce((last, ch, i) => (!ch.stateless && !cached(ch) ? i : last), -1);
for (const [i, ch] of chapters.entries()) {
  ch.mode = !cached(ch) ? 'record' : !ch.stateless && i < lastAppRecord ? 'replay' : 'skip';
}
console.log(`Chapters (${chapters.length}):`);
for (const ch of chapters) {
  const what = { record: 'record', replay: 'replay off camera to rebuild state', skip: 'cached' }[ch.mode];
  console.log(`  ${ch.name.padEnd(18)} ${ch.scenes.join('+').padEnd(14)} ${what}`);
}
for (const unknown of redo.filter(r => !chapters.some(ch => ch.name === r))) die(`No chapter called "${unknown}".`);

// ---------- capture and compose what changed ----------
const recording = chapters.filter(ch => ch.mode === 'record');
if (recording.length) {
  const frameRoot = path.join(RUNTIME, 'frames', `${name}-${process.pid}`);
  console.log('Capturing');
  const captured = await capture({ spec, chapters, lines, scenes, codeTargets, frameRoot, headed, boardUrl, diagramUrl, textUrl, terminalUrl, draft })
    .catch(e => die(process.env.NARRATED_DEMO_DEBUG ? e.stack : e.message));
  for (const cap of captured) {
    const ch = cap.chapter;
    const inMotion = (a, b) => cap.motion.some(m => a >= m.from && b <= m.to + 50);
    const gaps = cap.frames.slice(1).map((f, i) => [cap.frames[i].t, f.t]).filter(([a, b]) => inMotion(a, b)).map(([a, b]) => b - a);
    const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    if (process.env.NARRATED_DEMO_DEBUG) {
      const rel = t => Math.round(t - cap.t0);
      console.log('    segments', cap.segments.map(g => `${g.scene}@${rel(g.from)}-${g.to === undefined ? '' : rel(g.to)}`).join(' '));
      console.log('    motion', cap.motion.map(m => `${rel(m.from)}-${rel(m.to)}`).join(' '));
      console.log('    gaps', cap.frames.slice(1).map((f, i) => [rel(cap.frames[i].t), f.t - cap.frames[i].t]).filter(([, g]) => g > 180).map(([t, g]) => `${t}+${Math.round(g)}`).join(' '));
      console.log('    first frames', cap.frames.slice(0, 5).map(f => rel(f.t)).join(' '));
    }
    const motion = gaps.length ? `~${Math.round(1000 / avg)} fps while moving, ${gaps.filter(g => g > 180).length} stutters over 180 ms` : 'nothing moving in the browser';
    console.log(`  ${ch.name}: ${((cap.end - cap.t0) / 1000).toFixed(1)}s, ${cap.frames.length} frames${cap.cuts ? `, ${cap.cuts} cuts` : ''}; ${motion}`);
  }
  console.log(draft ? 'Composing drafts (960 x 540, 15 fps)' : 'Composing');
  for (const cap of captured) {
    const ch = cap.chapter;
    const out = path.join(chapterDir, `${ch.key}.mp4`);
    process.stdout.write(`  ${ch.name}\n`);
    const { introMs, cues } = await compose({
      cap, spec, intro: ch.first ? intro : null, outro: ch.last ? outro : null, out, fps, silent, draft, captions,
      edges: chapters.length > 1 && (spec.transition === 'fade' || spec.transition?.type === 'fade'),
    });
    const rows = chapterRows(cap, introMs, spec, chapters.length > 1 ? ch.name : '');
    fs.writeFileSync(path.join(chapterDir, `${ch.key}.json`), JSON.stringify({ duration: duration(out), cues, rows }));
  }
  if (keepRaw) console.log(`Frames kept in ${frameRoot}`);
  else fs.rmSync(frameRoot, { recursive: true, force: true });
}

// ---------- assemble ----------
let offset = 0;
const allCues = [];
const allRows = [];
const list = path.join(chapterDir, `assemble-${process.pid}.txt`);
fs.writeFileSync(list, chapters.map(ch => `file '${path.join(chapterDir, `${ch.key}.mp4`)}'`).join('\n'));
for (const ch of chapters) {
  const meta = JSON.parse(fs.readFileSync(path.join(chapterDir, `${ch.key}.json`), 'utf8'));
  allCues.push(...meta.cues.map(c => ({ ...c, start: c.start + offset, end: c.end + offset })));
  allRows.push(...meta.rows.map(r => ({ ...r, start: r.start + offset, shot: r.shot + offset })));
  offset += meta.duration;
}
const stamp = n => {
  const t = Math.max(0, Math.round(n));
  const pad = (v, w = 2) => String(v).padStart(w, '0');
  return `${pad(Math.floor(t / 3_600_000))}:${pad(Math.floor(t / 60_000) % 60)}:${pad(Math.floor(t / 1000) % 60)},${pad(t % 1000, 3)}`;
};
const srt = path.join(outDir, `${name}${draft ? '.draft' : ''}.srt`);
fs.writeFileSync(srt, allCues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.caption}\n`).join('\n'));
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-i', srt,
  '-map', '0', '-map', '1', '-c', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', '-movflags', '+faststart', mp4]);
fs.rmSync(list, { force: true });

console.log(`\nVideo:     ${mp4} (${(duration(mp4) / 1000).toFixed(1)}s)`);
console.log(`Subtitles: ${srt}`);
await runReview(allRows);
