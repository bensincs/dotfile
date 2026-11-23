// Review stage: a contact sheet and a report for every render, so problems are found per step.
//   <name>.review/sheet-1.png …  one frame late in each step, labelled with its number, time and line
//   <name>.review/review.md      timings, silent stretches and stutter in motion, flagged per step
//   <name>.review/rows.json      what the review needs, so `--review` can redo it without re-rendering
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './common.mjs';

const LEAD_MS = 250;
const SILENCE_MS = 2500; // longer than this with nothing said is worth a look
const STUTTER_MS = 180;  // a gap this long while something moves reads as a stutter (board items pause 140 ms by design)

const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const label = step => (step.cut ? '(cut)' : step.say || (step.draw ? 'chalkboard' : step.diagram ? 'diagram' : step.text !== undefined ? 'text' : step.terminal !== undefined ? 'terminal' : step.clay ? 'clay' : step.code ? `code ${typeof step.code === 'string' ? step.code : step.code.file || ''}` : step.annotate ? 'notes' : 'action'));
const sceneOf = (cap, st) => cap.segments.filter(g => g.from <= st.start + 1).at(-1)?.scene || '';

/** One row per on-camera step of a captured chapter, timed from the start of its video segment. */
export function chapterRows(cap, introMs, spec, chapter) {
  const at = wall => introMs + (wall - cap.t0);
  const frameTimes = cap.frames.map(f => f.t);
  const inMotion = (a, b) => cap.motion.some(m => a >= m.from && b <= m.to + 50);
  return cap.steps.map(st => {
    const spoken = st.line ? LEAD_MS + st.line.ms : 0;
    const inside = frameTimes.filter(t => t >= st.start && t <= st.end);
    const stutters = inside.slice(1).map((t, i) => (inMotion(inside[i], t) ? t - inside[i] : 0)).filter(g => g > STUTTER_MS);
    return {
      n: st.index + 1, chapter, label: label(spec.steps[st.index]), scene: sceneOf(cap, st),
      start: at(st.start), shot: at(Math.max(st.start + spoken * 0.9, st.end - 350)),
      length: st.end - st.start, spoken, silence: Math.max(0, st.acted - st.start - spoken), stutters,
      notes: (cap.clayWarnings || []).filter(w => w.index === st.index).map(w => w.text),
    };
  });
}

export async function review({ rows, mp4, dir }) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify(rows));
  const frames = path.join(dir, 'frames');
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });

  const shown = rows.map(r => {
    const file = path.join(frames, `${String(r.n).padStart(3, '0')}.jpg`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', (r.shot / 1000).toFixed(2), '-i', mp4, '-frames:v', '1', '-update', '1', '-vf', 'scale=640:-1', '-q:v', '3', file]);
    const flags = [];
    if (r.silence > SILENCE_MS) flags.push(`${(r.silence / 1000).toFixed(1)}s of action after the line ends`);
    for (const note of r.notes || []) flags.push(note);
    if (r.stutters.length) flags.push(`${r.stutters.length} stutter${r.stutters.length > 1 ? 's' : ''} in motion (worst ${Math.round(Math.max(...r.stutters))} ms)`);
    return { ...r, flags, file };
  });

  // review.md
  const flagged = shown.filter(r => r.flags.length);
  const md = [
    `# Review: ${path.basename(mp4)}`, '',
    `${shown.length} on-camera steps; ${flagged.length} flagged. Contact sheets: \`sheet-*.png\` (one frame late in each step).`, '',
    '| # | At | Chapter | Scene | Step | Length | Line | Flags |', '|---|---|---|---|---|---|---|---|',
    ...shown.map(r => `| ${r.n} | ${clock(r.start)} | ${r.chapter || ''} | ${r.scene || ''} | ${r.label.replace(/\|/g, '/').slice(0, 90)} | ${(r.length / 1000).toFixed(1)}s | ${r.spoken ? `${(r.spoken / 1000).toFixed(1)}s` : '–'} | ${r.flags.join('; ')} |`),
    '', '## What to check on each frame',
    '- The screen matches what the line says.',
    '- App: the camera frames the action and does not cut off what matters.',
    '- Code: the right file and lines are highlighted, readable, and clear of the captions.',
    '- Chalkboard: text does not overlap, and nothing runs off the board.',
    '- Diagram: the parts the line names are on screen; labels are readable and nothing overlaps.',
    '- Clay: the characters and things the line names are in shot and not hidden behind others.',
    '- Notes point at the right things; name cards and captions do not cover the action.',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'review.md'), md + '\n');

  const files = await sheets(dir, shown.map(r => ({
    file: r.file, title: `#${r.n} · ${clock(r.start)}`, tag: [r.chapter, r.scene].filter(Boolean).join(' · '), text: r.label, flags: r.flags,
  })));
  return { sheets: files, report: path.join(dir, 'review.md'), flagged: flagged.length, steps: shown.length };
}

/** Contact sheets: 12 frames a sheet, three across, rendered as a page and screenshotted.
 *  cards: [{ file, title, tag?, text, flags? }]. Returns the PNG paths. */
export async function sheets(dir, cards) {
  for (const old of fs.readdirSync(dir).filter(f => /^sheet-\d+\.(png|html)$/.test(f))) fs.rmSync(path.join(dir, old));
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1980, height: 800 } });
  const out = [];
  for (let i = 0; i < cards.length; i += 12) {
    const figures = cards.slice(i, i + 12).map(c => `<figure><img src="${pathToFileURL(c.file).href}">
      <figcaption><b>${esc(c.title)}</b>${c.tag ? `<i>${esc(c.tag)}</i>` : ''} ${esc(c.text)}${c.flags?.length ? `<em>${esc(c.flags.join(' · '))}</em>` : ''}</figcaption></figure>`).join('');
    const html = path.join(dir, `sheet-${i / 12 + 1}.html`);
    fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:20px;background:#111;font:14px system-ui;color:#ddd;display:grid;grid-template-columns:repeat(3,640px);gap:20px}
      figure{margin:0}img{display:block;width:640px;border-radius:6px}figcaption{padding:8px 2px;line-height:1.4}
      b{color:#fff;margin-right:6px}i{color:#3fe0c0;font-style:normal;margin-right:6px}em{display:block;color:#ff8a8a;font-style:normal}</style>${figures}`);
    await page.goto(pathToFileURL(html).href);
    await page.waitForLoadState('load');
    const file = path.join(dir, `sheet-${i / 12 + 1}.png`);
    await page.screenshot({ path: file, fullPage: true });
    out.push(file);
  }
  await browser.close();
  return out;
}
