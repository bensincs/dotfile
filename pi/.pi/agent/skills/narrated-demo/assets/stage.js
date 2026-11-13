// Compositor: narrate.mjs calls stage.layout() once, then stage.render(state) for every output frame.
(() => {
  const $ = id => document.getElementById(id);
  const shown = { app: '', board: '' };
  async function load(img, key, src) {
    if (!src || shown[key] === src) return;
    img.src = src;
    await img.decode().catch(() => {});
    shown[key] = src;
  }
  window.stage = {
    layout(l) {
      document.documentElement.style.setProperty('--bg', l.background);
      document.documentElement.style.setProperty('--accent', l.accent);
      document.body.classList.toggle('bare', !l.window);
      document.body.classList.toggle('no-url', !l.url);
      Object.assign($('window').style, { left: `${l.x}px`, top: `${l.y}px`, width: `${l.w}px`, height: `${l.h + l.bar}px` });
      Object.assign($('view').style, { width: `${l.w}px`, height: `${l.h}px` });
    },
    async render(s) {
      document.body.dataset.scene = s.scene;
      if (s.scene === 'app') {
        await load($('app'), 'app', s.src);
        $('app').style.width = `${s.imgW}px`;
        $('app').style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.zoom})`;
        $('url').textContent = s.url || '';
      } else if (s.scene === 'board') {
        await load($('board'), 'board', s.src);
      }
      $('content').style.opacity = s.scene === 'title' ? 0 : s.fade;
      const title = $('titlecard');
      title.style.opacity = s.scene === 'title' ? s.fade : 0;
      if (s.title) {
        $('t-title').textContent = s.title.title || '';
        $('t-sub').textContent = s.title.subtitle || '';
        $('t-sub').style.display = s.title.subtitle ? '' : 'none';
      }
      const card = $('card');
      card.style.opacity = s.card ? s.card.opacity : 0;
      if (s.card) {
        card.style.transform = `translateY(${s.card.shift}px)`;
        $('c-avatar').textContent = s.card.initials;
        $('c-avatar').style.background = s.card.color;
        $('c-name').textContent = s.card.name;
        $('c-role').textContent = s.card.role || '';
        $('c-role').style.display = s.card.role ? '' : 'none';
      }
      const caption = $('caption');
      caption.style.opacity = s.caption ? s.caption.opacity : 0;
      if (s.caption) caption.textContent = s.caption.text;
    },
  };
})();
