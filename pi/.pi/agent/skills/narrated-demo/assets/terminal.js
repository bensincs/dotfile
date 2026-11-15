// Terminal scenes: a real terminal emulator (xterm.js) that types commands and streams output.
// Runs inside the recorded page.  createTerm(el, opts) -> { type(cmd, ms), output(text, ms), prompt(), clear(), ready }
window.createTerm = (el, { prompt, theme, fontSize }) => {
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", Menlo, monospace', fontSize, lineHeight: 1.28, letterSpacing: 0,
    cursorBlink: false, cursorStyle: 'bar', allowProposedApi: true, convertEol: true, scrollback: 2000, theme,
  });
  term.open(el);
  // Fit the grid to the page: one character cell, measured.
  const fit = () => {
    const cell = term._core._renderService.dimensions.css.cell;
    const cols = Math.max(40, Math.floor((el.clientWidth - 4) / cell.width));
    const rows = Math.max(10, Math.floor((el.clientHeight - 4) / cell.height));
    term.resize(cols, rows);
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const write = s => new Promise(r => term.write(s, r));
  const showPrompt = () => write(prompt);
  // Types like a person: a steady pace with small hesitations, faster for long commands.
  async function type(cmd, ms) {
    const per = Math.max(18, Math.min(75, ms / Math.max(1, cmd.length)));
    for (const ch of cmd) {
      await write(ch);
      await sleep(per * (0.6 + Math.random() * 0.8));
    }
    await write('\r\n');
  }
  // Streams output line by line within ms, keeping ANSI colours.
  async function output(text, ms) {
    const lines = String(text).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    if (!text) return;
    const per = lines.length > 1 ? Math.max(8, Math.min(140, ms / lines.length)) : 0;
    const batch = Math.max(1, Math.ceil(lines.length / Math.max(1, ms / 16)));
    for (let i = 0; i < lines.length; i += batch) {
      await write(lines.slice(i, i + batch).join('\r\n') + '\r\n');
      if (per) await sleep(per * batch);
    }
  }
  return {
    ready: document.fonts.load(`${fontSize}px "JetBrains Mono"`).then(() => document.fonts.ready).then(() => { fit(); return true; }),
    prompt: showPrompt,
    type,
    output,
    clear: () => { term.reset(); },
  };
};
