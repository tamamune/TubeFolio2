// TubeFolio2 content script: 左パネル / お気に入りバッジ / 視聴履歴記録
(() => {
  if (window.__tf2) return;
  window.__tf2 = true;

  let S = null;                       // 現在の状態
  const view = { gid: 'all', q: '' }; // パネル表示状態
  const esc = TF.esc;
  const alive = () => { try { return !!chrome.runtime.id; } catch { return false; } };

  /* ---------- 共通ヘルパ ---------- */
  const vidFromHref = href => {
    try {
      const u = new URL(href, location.origin);
      return u.pathname === '/watch' ? u.searchParams.get('v') : null;
    } catch { return null; }
  };
  const curId = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
  const groupOf = gid => S.groups.find(g => g.id === gid);
  const colorOf = fav => (groupOf(fav.groups[0]) || S.groups[0]).color;
  const lastGroup = () => (groupOf(S.settings.lastGroup) ? S.settings.lastGroup : S.groups[0].id);

  function currentMeta() {
    const id = curId();
    if (!id) return null;
    const flexy = document.querySelector('ytd-watch-flexy');
    const ok = !flexy || flexy.getAttribute('video-id') === id;
    const title = ok && (document.querySelector('ytd-watch-metadata h1')?.textContent.trim()
      || document.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, ''));
    const channel = ok && (document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a')?.textContent.trim() || '');
    return { id, title: title || '', channel: channel || '' };
  }

  /* ---------- 一覧のバッジ ---------- */
  const CONT = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model';
  const THUMB = 'img, yt-image, yt-thumbnail-view-model, ytd-thumbnail';

  function metaFromAnchor(a) {
    const id = vidFromHref(a.href);
    const c = a.closest(CONT) || a.parentElement;
    const t = c && c.querySelector('#video-title');
    const title = (t && (t.getAttribute('title') || t.textContent) ||
      (c && c.querySelector('h3')?.textContent) || a.getAttribute('aria-label') || a.title || '').trim();
    const channel = (c && c.querySelector('ytd-channel-name a, #channel-name a, .yt-content-metadata-view-model-wiz__metadata-text')?.textContent || '').trim();
    return { id, title, channel };
  }

  function makeBadge(a) {
    const b = document.createElement('span');
    b.className = 'tf2-badge';
    b.innerHTML = '<b class="s">☆</b><b class="m">▾</b>';
    const stop = e => { e.preventDefault(); e.stopPropagation(); };
    b.addEventListener('mousedown', e => e.stopPropagation());
    b.addEventListener('click', e => {
      stop(e);
      if (!alive()) return;
      const m = metaFromAnchor(a);
      if (!m.id) return;
      if (e.target.classList.contains('m')) { showMenu(m, b.getBoundingClientRect()); return; }
      if (S.favorites[m.id]) TF.removeFav(m.id); else TF.addFav(m, lastGroup());
    });
    a.appendChild(b);
  }

  function cleanupBadges() {
    document.querySelectorAll('.tf2-badge').forEach(b => b.remove());
    document.querySelectorAll('a.tf2-anchor').forEach(a => a.classList.remove('tf2-anchor', 'tf2-isfav'));
  }

  function scan() {
    if (!S) return;
    if (!S.settings.features.badges) { cleanupBadges(); return; }
    document.querySelectorAll('a[href*="/watch?v="]').forEach(a => {
      if (a.classList.contains('tf2-anchor')) return;
      if (a.closest('#movie_player, ytd-player, .ytp-ce-element')) return;
      if (!a.querySelector(THUMB)) return;
      if (!vidFromHref(a.href)) return;
      a.classList.add('tf2-anchor');
      makeBadge(a);
    });
    paint();
  }

  function paint() {
    document.querySelectorAll('a.tf2-anchor').forEach(a => {
      const b = a.querySelector(':scope > .tf2-badge');
      if (!b) return;
      const id = vidFromHref(a.href);
      const f = id && S.favorites[id];
      a.classList.toggle('tf2-isfav', !!f);
      b.classList.toggle('fav', !!f);
      b.firstChild.textContent = f ? '★' : '☆';
      if (f) a.style.setProperty('--tf2c', colorOf(f));
    });
  }

  /* ---------- 左パネル(Shadow DOM) ---------- */
  const host = document.createElement('div');
  host.id = 'tf2-root';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
:host{all:initial}
*{box-sizing:border-box;font-family:"Segoe UI","Yu Gothic UI",sans-serif}
.tab{position:fixed;left:0;top:130px;width:26px;height:56px;background:#f5b301;color:#222;border-radius:0 8px 8px 0;
  display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;z-index:2147483000;box-shadow:1px 1px 6px rgba(0,0,0,.4)}
.panel{position:fixed;left:0;top:56px;bottom:0;width:310px;background:#1c1c1f;color:#eee;z-index:2147483001;
  display:none;flex-direction:column;box-shadow:2px 0 14px rgba(0,0,0,.6);font-size:13px}
.panel.open{display:flex}
header{display:flex;align-items:center;gap:4px;padding:8px 10px;background:#2a2a2e;font-size:14px}
header b{flex:1;color:#f5b301}
button{background:none;border:0;color:#ccc;cursor:pointer;font-size:14px;padding:3px 6px;border-radius:4px}
button:hover{background:#444;color:#fff}
.cur{padding:8px 10px;border-bottom:1px solid #333;display:none}
.cur.on{display:block}
.cur .t{font-size:12px;color:#bbb;margin-bottom:6px;line-height:1.35;max-height:2.7em;overflow:hidden}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chip{border:1px solid var(--c);color:var(--c);border-radius:12px;padding:2px 9px;font-size:12px;cursor:pointer;background:none}
.chip.on{background:var(--c);color:#222}
.groups{padding:6px 6px 2px;max-height:34%;overflow:auto;border-bottom:1px solid #333}
.g{display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:6px;cursor:pointer}
.g:hover{background:#2c2c31}.g.sel{background:#3a3a42}
.dot{width:10px;height:10px;border-radius:50%;flex:none}
.g .n{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.g .c{color:#999;font-size:11px}
.g .ed{display:none}.g:hover .ed{display:inline}
.add{color:#f5b301;padding:5px 8px;cursor:pointer}
.q{margin:8px 10px;padding:6px 8px;background:#121214;border:1px solid #444;border-radius:6px;color:#eee}
.list{flex:1;overflow:auto;padding:0 6px 10px}
.it{display:flex;gap:8px;padding:5px;border-radius:6px;align-items:flex-start}
.it:hover{background:#2c2c31}
.it a{display:flex;gap:8px;flex:1;min-width:0;color:inherit;text-decoration:none}
.it img{width:88px;height:50px;object-fit:cover;border-radius:4px;flex:none;background:#000}
.it .t{font-size:12px;line-height:1.3;max-height:2.6em;overflow:hidden}
.it .ch{font-size:11px;color:#999;margin-top:2px}
.dots{display:flex;gap:3px;margin-top:3px}.dots i{width:8px;height:8px;border-radius:50%}
.empty{color:#888;text-align:center;padding:24px 0}
.menu{position:fixed;display:none;background:#26262a;color:#eee;border:1px solid #555;border-radius:8px;padding:6px;
  z-index:2147483002;min-width:190px;box-shadow:0 4px 18px rgba(0,0,0,.6);font-size:13px}
.menu.open{display:block}
.mi{display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:5px;cursor:pointer}
.mi:hover{background:#3a3a42}
.mi .ck{width:14px;text-align:center}
.sep{height:1px;background:#444;margin:4px 0}
</style>
<div class="tab" data-act="toggle" title="TubeFolio2">★</div>
<aside class="panel">
  <header><b>TubeFolio2</b>
    <button data-act="dash" title="履歴・分析">📊</button>
    <button data-act="opts" title="設定">⚙</button>
    <button data-act="toggle" title="閉じる">✕</button></header>
  <section class="cur"></section>
  <section class="groups"></section>
  <input class="q" placeholder="お気に入りを検索">
  <section class="list"></section>
</aside>
<div class="menu"></div>`;

  const $ = s => root.querySelector(s);
  const panel = $('.panel'), tab = $('.tab'), menu = $('.menu');

  function renderCur() {
    const el = $('.cur');
    const m = S.settings.features.panel && currentMeta();
    el.classList.toggle('on', !!m);
    if (!m) return;
    const f = S.favorites[m.id];
    el.innerHTML = `<div class="t">${f ? '★' : '☆'} ${esc(m.title || f && f.title || m.id)}</div>
      <div class="chips">${S.groups.map(g => `<button class="chip ${f && f.groups.includes(g.id) ? 'on' : ''}" style="--c:${g.color}" data-act="chip" data-g="${g.id}">${esc(g.name)}</button>`).join('')}</div>`;
  }

  function renderGroups() {
    const favs = Object.values(S.favorites);
    const cnt = gid => favs.filter(f => f.groups.includes(gid)).length;
    let h = `<div class="g ${view.gid === 'all' ? 'sel' : ''}" data-act="sel" data-g="all"><span class="dot" style="background:#aaa"></span><span class="n">すべて</span><span class="c">${favs.length}</span></div>`;
    h += S.groups.map((g, i) => `<div class="g ${view.gid === g.id ? 'sel' : ''}" data-act="sel" data-g="${g.id}">
      <span class="dot" style="background:${g.color}"></span><span class="n">${esc(g.name)}</span><span class="c">${cnt(g.id)}</span>
      <span class="ed"><button data-act="ren" data-g="${g.id}" title="名前変更">✎</button>${i ? `<button data-act="del" data-g="${g.id}" title="削除">🗑</button>` : ''}</span></div>`).join('');
    h += '<div class="add" data-act="addg">＋ グループを追加</div>';
    $('.groups').innerHTML = h;
  }

  function renderList() {
    const list = $('.list');
    const keep = list.scrollTop;
    const q = view.q.toLowerCase();
    const items = Object.values(S.favorites)
      .filter(f => (view.gid === 'all' || f.groups.includes(view.gid)) &&
        (!q || (f.title + ' ' + f.channel).toLowerCase().includes(q)))
      .sort((a, b) => b.addedAt - a.addedAt);
    list.innerHTML = items.length ? items.map(f => `<div class="it">
      <a href="/watch?v=${f.id}"><img loading="lazy" src="${esc(f.thumb)}"><div><div class="t">${esc(f.title)}</div>
        <div class="ch">${esc(f.channel)}</div>
        <div class="dots">${f.groups.map(g => groupOf(g) ? `<i style="background:${groupOf(g).color}" title="${esc(groupOf(g).name)}"></i>` : '').join('')}</div></div></a>
      <button data-act="rm" data-id="${f.id}" title="お気に入り解除">✕</button></div>`).join('')
      : '<div class="empty">お気に入りはありません</div>';
    list.scrollTop = keep;
  }

  function renderPanel() {
    const on = S.settings.features.panel;
    tab.style.display = on ? 'flex' : 'none';
    panel.classList.toggle('open', on && S.settings.panelOpen);
    tab.style.left = on && S.settings.panelOpen ? '310px' : '0';
    if (!groupOf(view.gid) && view.gid !== 'all') view.gid = 'all';
    renderCur(); renderGroups(); renderList();
  }

  /* ---------- グループ選択メニュー(バッジの▾) ---------- */
  function showMenu(meta, rect) {
    const f = S.favorites[meta.id];
    menu.innerHTML = S.groups.map(g => `<div class="mi" data-act="mg" data-g="${g.id}"><span class="ck">${f && f.groups.includes(g.id) ? '✔' : ''}</span><span class="dot" style="background:${g.color}"></span>${esc(g.name)}</div>`).join('')
      + '<div class="sep"></div><div class="mi" data-act="mnew"><span class="ck">＋</span>新規グループ</div>'
      + (f ? '<div class="mi" data-act="mrm"><span class="ck">✕</span>お気に入り解除</div>' : '');
    menu._meta = meta;
    menu.style.left = Math.max(4, Math.min(rect.left, innerWidth - 210)) + 'px';
    menu.style.top = Math.min(rect.bottom + 4, innerHeight - 260) + 'px';
    menu.classList.add('open');
  }
  const closeMenu = () => menu.classList.remove('open');
  addEventListener('click', e => { if (!e.composedPath().includes(menu) && !(e.target.closest && e.target.closest('.tf2-badge'))) closeMenu(); }, true);
  addEventListener('scroll', closeMenu, true);
  addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

  /* ---------- パネル操作 ---------- */
  root.addEventListener('click', async e => {
    const t = e.target.closest('[data-act]');
    if (!t || !alive()) return;
    const act = t.dataset.act, g = t.dataset.g;
    if (act === 'toggle') TF.setSetting('panelOpen', !S.settings.panelOpen);
    else if (act === 'dash') chrome.runtime.sendMessage({ type: 'openDashboard' });
    else if (act === 'opts') chrome.runtime.sendMessage({ type: 'openOptions' });
    else if (act === 'sel') { view.gid = g; renderGroups(); renderList(); }
    else if (act === 'chip') { const m = currentMeta(); if (m) TF.toggleFavGroup(m, g); }
    else if (act === 'rm') TF.removeFav(t.dataset.id);
    else if (act === 'addg') {
      const n = prompt('新しいグループ名'); if (n && n.trim()) TF.addGroup(n.trim());
    } else if (act === 'ren') {
      const cur = groupOf(g); const n = prompt('グループ名を変更', cur.name); if (n && n.trim()) TF.updateGroup(g, n.trim());
    } else if (act === 'del') {
      if (confirm(`グループ「${groupOf(g).name}」を削除しますか?\n(動画は「${S.groups[0].name}」に移動します)`)) TF.deleteGroup(g);
    } else if (act === 'mg') { TF.toggleFavGroup(menu._meta, g); closeMenu(); }
    else if (act === 'mrm') { TF.removeFav(menu._meta.id); closeMenu(); }
    else if (act === 'mnew') {
      const n = prompt('新しいグループ名');
      if (n && n.trim()) { const id = await TF.addGroup(n.trim()); await TF.toggleFavGroup(menu._meta, id); }
      closeMenu();
    }
  });
  $('.q').addEventListener('input', e => { view.q = e.target.value; renderList(); });

  /* ---------- 視聴履歴の記録 ---------- */
  let sess = null, dirty = false, lastFlush = 0;
  function readWatchMeta(id) {
    const flexy = document.querySelector('ytd-watch-flexy');
    if (flexy && flexy.getAttribute('video-id') !== id) return null;
    const title = document.querySelector('ytd-watch-metadata h1')?.textContent.trim();
    if (!title) return null;
    const channel = document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a')?.textContent.trim() || '';
    return { title, channel };
  }
  function flush() {
    if (!sess || !dirty || sess.sec < 5) return;
    dirty = false; lastFlush = Date.now();
    if (alive()) TF.logSession({ ...sess }).catch(() => {});
  }
  function tick() {
    if (!alive() || !S) return;
    if (!S.settings.features.history) { sess = null; return; }
    const id = curId();
    if (sess && sess.id !== id) { flush(); sess = null; dirty = false; }
    if (!id) return;
    if (!sess) sess = { sid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), id, at: Date.now(), sec: 0, title: '', channel: '', dur: 0, pos: 0 };
    const v = document.querySelector('video.html5-main-video');
    if (!v) return;
    const ad = document.querySelector('#movie_player')?.classList.contains('ad-showing');
    if (ad) return;
    if (!v.paused && !v.ended) { sess.sec++; dirty = true; }
    if (v.duration && isFinite(v.duration)) sess.dur = Math.round(v.duration);
    sess.pos = Math.round(v.currentTime || 0);
    const m = readWatchMeta(id);
    if (m) { sess.title = m.title; sess.channel = m.channel; }
    if (dirty && Date.now() - lastFlush > 10000) flush();
  }
  setInterval(tick, 1000);
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  /* ---------- 起動 ---------- */
  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { if (alive()) { scan(); renderCur(); } }, 400); };

  async function refresh() {
    if (!alive()) return;
    S = await TF.get();
    renderPanel();
    scan();
  }

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ['settings', 'groups', 'favorites'].some(k => k in ch)) refresh();
  });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('yt-navigate-finish', () => { schedule(); setTimeout(() => S && renderCur(), 1200); });

  refresh().then(() => document.documentElement.appendChild(host));
})();
