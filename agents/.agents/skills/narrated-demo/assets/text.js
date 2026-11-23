// Big text: kinetic typography for hooks, numbers, lists and quotes. Runs inside the recorded page.
//   createBigText(root) -> { show(item, ms), clear(ms), ready }
// item: { headline, sub } | { number, label, sub } | { list, title } | { quote, by } | { stats: [{ value, label }], title }
window.createBigText = root => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const h = (tag, cls, parent, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    if (parent) parent.append(n);
    return n;
  };
  // *word* is emphasised in the accent colour.
  function words(parent, text) {
    const spans = [];
    String(text).split(/(\*[^*]+\*)/).filter(Boolean).forEach(part => {
      const accent = /^\*.*\*$/.test(part);
      for (const w of part.replace(/^\*|\*$/g, '').split(/(\s+)/)) {
        if (!w) continue;
        if (/^\s+$/.test(w)) { parent.append(' '); continue; }
        const s = h('span', `w${accent ? ' accent' : ''}`, parent, w);
        spans.push(s);
      }
    });
    return spans;
  }
  const rise = (el, ms, delay = 0) => el.animate(
    [{ opacity: 0, transform: 'translateY(0.35em)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }],
    { duration: ms, delay, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }).finished;
  const stagger = (els, ms) => {
    const each = Math.min(650, Math.max(280, ms * 0.5));
    const gap = els.length > 1 ? Math.min(180, (ms - each) / (els.length - 1)) : 0;
    return Promise.all(els.map((el, i) => rise(el, each, i * Math.max(40, gap))));
  };
  // Counts up the numeric part of a value: '73%', '$1.2M', '3x', '45 min'.
  function count(el, value, ms) {
    const m = String(value).match(/^(\D*?)(\d[\d,]*\.?\d*)(.*)$/);
    if (!m) { el.textContent = value; return rise(el, Math.min(ms, 700)); }
    const [, pre, num, post] = m;
    const target = Number(num.replace(/,/g, ''));
    const decimals = (num.split('.')[1] || '').length;
    const commas = num.includes(',');
    const fmt = v => {
      const s = v.toFixed(decimals);
      return commas ? Number(s).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : s;
    };
    const start = performance.now();
    const time = Math.max(500, ms);
    el.textContent = pre + fmt(0) + post;
    rise(el, 450);
    return new Promise(resolve => {
      const tick = now => {
        const k = Math.min(1, (now - start) / time);
        const e = 1 - (1 - k) ** 3;
        el.textContent = pre + fmt(target * e) + post;
        k < 1 ? requestAnimationFrame(tick) : resolve();
      };
      requestAnimationFrame(tick);
    });
  }

  let current = null;
  async function clear(ms = 350) {
    const old = current;
    current = null;
    if (!old) return;
    await old.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-0.4em)' }], { duration: ms, easing: 'ease-in', fill: 'forwards' }).finished;
    old.remove();
  }
  async function show(item, ms = 2000) {
    await clear(current ? 300 : 0);
    const card = h('div', `card ${item.align === 'left' ? 'left' : ''}`, root);
    current = card;
    const budget = Math.max(600, ms - 300);
    if (item.headline !== undefined) {
      const head = h('h1', 'headline', card);
      const ws = words(head, item.headline);
      await stagger(ws, budget * 0.7);
      if (item.sub) await rise(h('p', 'sub', card, item.sub), Math.min(600, budget * 0.3));
    } else if (item.number !== undefined) {
      const n = h('div', 'number', card);
      const done = count(n, item.number, budget * 0.6);
      if (item.label) await sleep(budget * 0.25).then(() => rise(h('p', 'label', card, item.label), 500));
      if (item.sub) rise(h('p', 'sub', card, item.sub), 500, 200);
      await done;
    } else if (item.list) {
      if (item.title) await rise(h('h2', 'title', card, item.title), Math.min(500, budget * 0.2));
      const ul = h('ul', 'list', card);
      const lis = item.list.map(text => { const li = h('li', '', ul); h('i', 'dot', li); words(h('span', '', li), text); li.style.opacity = 0; return li; });
      const gap = (budget * 0.8) / Math.max(1, lis.length);
      for (const li of lis) {
        li.style.opacity = '';
        rise(li, Math.min(550, gap * 0.9));
        await sleep(gap);
      }
    } else if (item.quote !== undefined) {
      h('div', 'mark', card, '\u201C');
      const q = h('blockquote', 'quote', card);
      await stagger(words(q, item.quote), budget * 0.7);
      if (item.by) await rise(h('p', 'by', card, `\u2014 ${item.by}`), 500);
    } else if (item.stats) {
      if (item.title) await rise(h('h2', 'title', card, item.title), Math.min(500, budget * 0.2));
      const row = h('div', 'stats', card);
      const cells = item.stats.map(s => {
        const cell = h('div', `stat${s.accent ? ' accent' : ''}`, row);
        const v = h('div', 'value', cell);
        h('div', 'slabel', cell, s.label || '');
        cell.style.opacity = 0;
        return { cell, v, s };
      });
      const gap = (budget * 0.5) / Math.max(1, cells.length);
      await Promise.all(cells.map(({ cell, v, s }, i) => sleep(i * gap).then(() => {
        cell.style.opacity = '';
        rise(cell, 450);
        return count(v, s.value, budget * 0.5);
      })));
    } else {
      throw new Error(`text: nothing to show in ${JSON.stringify(item)}`);
    }
  }
  return { show, clear, ready: document.fonts.load('700 40px Inter').then(() => document.fonts.ready).then(() => true) };
};
