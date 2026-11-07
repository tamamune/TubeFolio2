// TubeFolio2 content script: 上部バーの★ボタン / 左パネル(チャンネルをグループ管理) / 一覧のチャンネル★ / 視聴履歴
(() => {
  if (window.__tf2) return;
  window.__tf2 = true;

  let S = null;
  const view = { gid: 'all', q: '' };
  const esc = TF.esc;
  const alive = () => { try { return !!chrome.runtime.id; } catch { return false; } };

  /* ---------- 共通ヘルパ ---------- */
  const CH_SEL = 'a[href^="/@"], a[href^="/channel/"], a[href^="/c/"], a[href^="/user/"]';
  function chKey(href) {
    try {
      const p = decodeURIComponent(new URL(href, location.origin).pathname);
      const m = p.match(/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/);
      return m ? m[1] : null;
    } catch { return null; }
  }
  const curId = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
  const groupOf = gid => S.groups.find(g => g.id === gid);
  const colorOf = ch => (groupOf(ch.groups[0]) || S.groups[0]).color;
  const lastGroup = () => (groupOf(S.settings.lastGroup) ? S.settings.lastGroup : S.groups[0].id);
  const favOf = k => { const c = S.channels[k]; return c && c.groups.length ? c : null; };
  const initial = n => esc((n || '?').replace(/^[@*\s]+/, '').charAt(0).toUpperCase());

  function watchChannelAnchor() {
    const id = curId();
    if (!id) return null;
    const flexy = document.querySelector('ytd-watch-flexy');
    if (flexy && flexy.getAttribute('video-id') !== id) return null;
    const a = [...document.querySelectorAll('ytd-watch-metadata #owner ' + CH_SEL.split(', ').join(', ytd-watch-metadata #owner '))]
      .find(x => x.textContent.trim());
    return a || null;
  }
  function currentMeta() {
    const a = watchChannelAnchor();
    if (!a) return null;
    const id = chKey(a.href);
    if (!id) return null;
    const img = document.querySelector('ytd-watch-metadata #owner img');
    return { id, name: a.textContent.trim(), avatar: img ? img.src : '' };
  }

  /* ---------- 一覧のチャンネル★ ---------- */
  const CONT = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, yt-lockup-view-model, ytd-video-owner-renderer';
  const THUMB = 'img, yt-image, yt-thumbnail-view-model, ytd-thumbnail';

  function metaFromBadge(b) {
    const a = b.previousElementSibling;
    if (!a || !a.matches || !a.matches(CH_SEL)) return null;
    const id = chKey(a.href);
    if (!id) return null;
    const c = a.closest(CONT) || a.parentElement;
    const img = c && c.querySelector('a[href^="/@"] img, a[href^="/channel/"] img, a[href^="/c/"] img, a[href^="/user/"] img');
    return { id, name: a.textContent.trim(), avatar: img ? img.src : '' };
  }

  function makeBadge(a) {
    const b = document.createElement('span');
    b.className = 'tf2-badge';
    b.innerHTML = '<b class="s">☆</b><b class="m">▾</b>';
    b.addEventListener('mousedown', e => e.stopPropagation());
    b.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (!alive()) return;
      const m = metaFromBadge(b);
      if (!m) return;
      if (e.target.classList.contains('m')) { showMenu(m, b.getBoundingClientRect()); return; }
      if (favOf(m.id)) TF.removeCh(m.id); else TF.addCh(m, lastGroup());
    });
    a.insertAdjacentElement('afterend', b);
  }

  function cleanupBadges() {
    document.querySelectorAll('.tf2-badge').forEach(b => b.remove());
    document.querySelectorAll('.tf2-thumb').forEach(a => a.classList.remove('tf2-thumb', 'tf2-isfav'));
  }

  function scan() {
    if (!S) return;
    if (!S.settings.features.badges) { cleanupBadges(); return; }
    document.querySelectorAll(CONT).forEach(c => {
      const a = [...c.querySelectorAll(CH_SEL)].find(x => x.textContent.trim() && !x.querySelector('img'));
      if (!a) return;
      const nx = a.nextElementSibling;
      if (nx && nx.classList.contains('tf2-badge')) return;
      makeBadge(a);
    });
    paint();
  }

  function paint() {
    document.querySelectorAll('.tf2-badge').forEach(b => {
      const a = b.previousElementSibling;
      const key = a && a.matches && a.matches(CH_SEL) ? chKey(a.href) : null;
      if (!key) { b.remove(); return; }
      const ch = favOf(key);
      b.classList.toggle('fav', !!ch);
      b.firstChild.textContent = ch ? '★' : '☆';
      b.title = ch ? 'フォルダ登録済み(クリックで解除)' : 'フォルダに追加';
      if (ch) b.style.setProperty('--tf2c', colorOf(ch)); else b.style.removeProperty('--tf2c');
      const c = b.closest(CONT);
      const t = c && [...c.querySelectorAll('a[href*="/watch?v="]')].find(x => x.querySelector(THUMB));
      if (t) {
        t.classList.add('tf2-thumb');
        t.classList.toggle('tf2-isfav', !!ch);
        if (ch) t.style.setProperty('--tf2c', colorOf(ch));
      }
    });
  }

  /* ---------- 上部バーの★ボタン ---------- */
  const topBtn = document.createElement('button');
  topBtn.id = 'tf2-btn';
  topBtn.title = 'TubeFolio2 お気に入りチャンネル';
  topBtn.textContent = '★';
  topBtn.addEventListener('click', () => alive() && TF.setSetting('panelOpen', !S.settings.panelOpen));

  function placeTopBtn() {
    const on = S && S.settings.features.panel;
    if (!on) { topBtn.remove(); return; }
    const end = document.querySelector('ytd-masthead #end');
    topBtn.classList.toggle('float', !end);
    const parent = end || document.documentElement;
    if (topBtn.parentElement !== parent) {
      if (end) end.insertBefore(topBtn, end.firstChild); else parent.appendChild(topBtn);
    }
    topBtn.classList.toggle('on', !!S.settings.panelOpen);
  }

  /* ---------- 左パネル(Shadow DOM) ---------- */
  const host = document.createElement('div');
  host.id = 'tf2-root';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
:host{all:initial}
*{box-sizing:border-box;font-family:"Segoe UI","Yu Gothic UI",sans-serif}
.panel{position:fixed;left:0;top:56px;bottom:0;width:310px;background:#1c1c1f;color:#eee;z-index:2147483001;
  display:none;flex-direction:column;box-shadow:2px 0 14px rgba(0,0,0,.6);font-size:13px}
.panel.open{display:flex}
header{display:flex;align-items:center;gap:4px;padding:8px 10px;background:#2a2a2e;font-size:14px}
header b{flex:1;color:#f5b301}
button{background:none;border:0;color:#ccc;cursor:pointer;font-size:14px;padding:3px 6px;border-radius:4px}
button:hover{background:#444;color:#fff}
.cur{padding:8px 10px;border-bottom:1px solid #333;display:none}
.cur.on{display:block}
.cur .t{font-size:12px;color:#bbb;margin-bottom:6px;line-height:1.35}
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
.imp{padding:6px 10px 0}.imp button{border:1px solid #555;width:100%}.st{color:#999;font-size:11px;margin-top:4px;min-height:14px}
.q{margin:8px 10px;padding:6px 8px;background:#121214;border:1px solid #444;border-radius:6px;color:#eee}
.list{flex:1;overflow:auto;padding:0 6px 10px}
.it{display:flex;gap:8px;padding:5px;border-radius:6px;align-items:center}
.it:hover{background:#2c2c31}
.it a{display:flex;gap:10px;flex:1;min-width:0;color:inherit;text-decoration:none;align-items:center}
.av{width:36px;height:36px;border-radius:50%;flex:none;background:#444;display:flex;align-items:center;justify-content:center;font-weight:600;object-fit:cover}
.it .t{font-size:13px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
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
<aside class="panel">
  <header><b>★ 登録チャンネル</b>
    <button data-act="dash" title="履歴・分析">📊</button>
    <button data-act="opts" title="設定">⚙</button>
    <button data-act="toggle" title="閉じる">✕</button></header>
  <section class="cur"></section>
  <section class="groups"></section>
  <div class="imp"><button data-act="import">⟳ 登録チャンネルを全件取り込む</button><div class="st"></div></div>
  <input class="q" placeholder="チャンネルを検索">
  <section class="list"></section>
</aside>
<div class="menu"></div>`;

  const $ = s => root.querySelector(s);
  const panel = $('.panel'), menu = $('.menu');

  function avatar(ch) {
    return ch.avatar ? `<img class="av" src="${esc(ch.avatar)}" referrerpolicy="no-referrer">`
      : `<div class="av" style="background:${colorOf(ch)};color:#222">${initial(ch.name)}</div>`;
  }

  function renderCur() {
    const el = $('.cur');
    const m = S.settings.features.panel && currentMeta();
    el.classList.toggle('on', !!m);
    if (!m) return;
    const f = S.channels[m.id];
    el.innerHTML = `<div class="t">${f && f.groups.length ? '★' : '☆'} この動画のチャンネル: <b>${esc(m.name)}</b></div>
      <div class="chips">${S.groups.map(g => `<button class="chip ${f && f.groups.includes(g.id) ? 'on' : ''}" style="--c:${g.color}" data-act="chip" data-g="${g.id}">${esc(g.name)}</button>`).join('')}</div>`;
  }

  function renderGroups() {
    const chs = Object.values(S.channels);
    const cnt = gid => chs.filter(f => f.groups.includes(gid)).length;
    const none = chs.filter(f => !f.groups.length).length;
    let h = `<div class="g ${view.gid === 'all' ? 'sel' : ''}" data-act="sel" data-g="all"><span class="dot" style="background:#aaa"></span><span class="n">すべての登録チャンネル</span><span class="c">${chs.length}</span></div>`;
    h += `<div class="g ${view.gid === 'none' ? 'sel' : ''}" data-act="sel" data-g="none"><span class="dot" style="background:#666"></span><span class="n">未分類</span><span class="c">${none}</span></div>`;
    h += S.groups.map((g, i) => `<div class="g ${view.gid === g.id ? 'sel' : ''}" data-act="sel" data-g="${g.id}">
      <span class="dot" style="background:${g.color}"></span><span class="n">📁 ${esc(g.name)}</span><span class="c">${cnt(g.id)}</span>
      <span class="ed"><button data-act="ren" data-g="${g.id}" title="名前変更">✎</button>${i ? `<button data-act="del" data-g="${g.id}" title="削除">🗑</button>` : ''}</span></div>`).join('');
    h += '<div class="add" data-act="addg">＋ フォルダを追加</div>';
    $('.groups').innerHTML = h;
  }

  function renderList() {
    const list = $('.list');
    const keep = list.scrollTop;
    const q = view.q.toLowerCase();
    const items = Object.values(S.channels)
      .filter(f => (view.gid === 'all' || (view.gid === 'none' ? !f.groups.length : f.groups.includes(view.gid))) &&
        (!q || f.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    list.innerHTML = items.length ? items.map(f => `<div class="it">
      <a href="/${esc(f.id)}">${avatar(f)}<div style="min-width:0"><div class="t">${esc(f.name)}</div>
        <div class="dots">${f.groups.map(g => groupOf(g) ? `<i style="background:${groupOf(g).color}" title="${esc(groupOf(g).name)}"></i>` : '').join('')}</div></div></a>
      <button data-act="rowmenu" data-id="${esc(f.id)}" title="フォルダに入れる">📁</button></div>`).join('')
      : `<div class="empty">${Object.keys(S.channels).length ? '該当するチャンネルがありません' : '「全件取り込む」で登録チャンネルを読み込んでください'}</div>`;
    list.scrollTop = keep;
  }

  function renderPanel() {
    const on = S.settings.features.panel;
    panel.classList.toggle('open', on && S.settings.panelOpen);
    if (!groupOf(view.gid) && view.gid !== 'all' && view.gid !== 'none') view.gid = 'all';
    placeTopBtn();
    renderCur(); renderGroups(); renderList();
  }

  /* ---------- グループ選択メニュー(★の▾) ---------- */
  function showMenu(meta, rect) {
    const f = S.channels[meta.id];
    menu.innerHTML = S.groups.map(g => `<div class="mi" data-act="mg" data-g="${g.id}"><span class="ck">${f && f.groups.includes(g.id) ? '✔' : ''}</span><span class="dot" style="background:${g.color}"></span>${esc(g.name)}</div>`).join('')
      + '<div class="sep"></div><div class="mi" data-act="mnew"><span class="ck">＋</span>新規フォルダ</div>'
      + (f && f.groups.length ? '<div class="mi" data-act="mrm"><span class="ck">✕</span>フォルダから外す</div>' : '');
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
    else if (act === 'chip') { const m = currentMeta(); if (m) TF.toggleChGroup(m, g); }
    else if (act === 'rowmenu') { const c = S.channels[t.dataset.id]; if (c) showMenu(c, t.getBoundingClientRect()); }
    else if (act === 'import') importAll();
    else if (act === 'addg') {
      const n = prompt('新しいフォルダ名'); if (n && n.trim()) TF.addGroup(n.trim());
    } else if (act === 'ren') {
      const cur = groupOf(g); const n = prompt('フォルダ名を変更', cur.name); if (n && n.trim()) TF.updateGroup(g, n.trim());
    } else if (act === 'del') {
      if (confirm(`フォルダ「${groupOf(g).name}」を削除しますか?\n(チャンネルは「${S.groups[0].name}」に移動します)`)) TF.deleteGroup(g);
    } else if (act === 'mg') { TF.toggleChGroup(menu._meta, g); closeMenu(); }
    else if (act === 'mrm') { TF.removeCh(menu._meta.id); closeMenu(); }
    else if (act === 'mnew') {
      const n = prompt('新しいフォルダ名');
      if (n && n.trim()) { const id = await TF.addGroup(n.trim()); await TF.toggleChGroup(menu._meta, id); }
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
    const a = watchChannelAnchor();
    return { title, channel: a ? a.textContent.trim() : '', ch: a ? chKey(a.href) : '' };
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
    if (!sess) sess = { sid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), id, ch: '', at: Date.now(), sec: 0, title: '', channel: '', dur: 0, pos: 0 };
    const v = document.querySelector('video.html5-main-video');
    if (!v) return;
    if (document.querySelector('#movie_player')?.classList.contains('ad-showing')) return;
    if (!v.paused && !v.ended) { sess.sec++; dirty = true; }
    if (v.duration && isFinite(v.duration)) sess.dur = Math.round(v.duration);
    sess.pos = Math.round(v.currentTime || 0);
    const m = readWatchMeta(id);
    if (m) { sess.title = m.title; sess.channel = m.channel; sess.ch = m.ch; }
    if (dirty && Date.now() - lastFlush > 10000) flush();
  }
  setInterval(tick, 1000);
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  /* ---------- 登録チャンネルの取り込み ---------- */
  const setStatus = t => { const el = $('.st'); if (el) el.textContent = t; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function saveSubs(items) {
    if (!S || !items.length || !alive()) return;
    const diff = items.filter(i => {
      const c = S.channels[i.id];
      return !c || !c.sub || (i.name && c.name !== i.name) || (i.avatar && !c.avatar);
    });
    if (diff.length) TF.upsertSubs(diff);
  }
  const okImg = img => (img && img.src && !img.src.startsWith('data:') ? img.src : '');

  // サイドバー「登録チャンネル」セクションから取り込む
  function collectGuide() {
    const hdr = document.querySelector('ytd-guide-section-renderer a[href="/feed/channels"]');
    const sec = hdr && hdr.closest('ytd-guide-section-renderer');
    if (!sec) return;
    const items = [];
    sec.querySelectorAll('ytd-guide-entry-renderer a').forEach(a => {
      const id = a.matches(CH_SEL) ? chKey(a.href) : null;
      if (!id) return;
      const name = (a.getAttribute('title') || a.textContent).trim();
      items.push({ id, name, avatar: okImg(a.querySelector('img')) });
    });
    saveSubs(items);
  }
  // /feed/channels(登録チャンネル一覧ページ)から取り込む
  function collectFeed() {
    const items = [];
    document.querySelectorAll('ytd-channel-renderer').forEach(c => {
      const a = [...c.querySelectorAll(CH_SEL)][0];
      const id = a && chKey(a.href);
      if (!id) return;
      const name = (c.querySelector('ytd-channel-name #text, #info #text')?.textContent || a.textContent).trim();
      items.push({ id, name, avatar: okImg(c.querySelector('#avatar img, yt-img-shadow img')) });
    });
    saveSubs(items);
    return items.length;
  }
  async function runFeedImport() {
    setStatus('取り込み中… (自動スクロール)');
    let last = -1, same = 0;
    while (same < 4) {
      scrollTo(0, document.documentElement.scrollHeight);
      await sleep(900);
      const n = document.querySelectorAll('ytd-channel-renderer').length;
      if (n === last) same++; else { same = 0; last = n; }
    }
    const n = collectFeed();
    scrollTo(0, 0);
    setStatus(`${n}件の登録チャンネルを取り込みました`);
  }
  function importAll() {
    if (location.pathname === '/feed/channels') { runFeedImport(); return; }
    try { sessionStorage.setItem('tf2_import', '1'); } catch {}
    location.href = '/feed/channels';
  }

  /* ---------- 起動 ---------- */
  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { if (alive() && S) { placeTopBtn(); scan(); renderCur(); collectGuide(); } }, 400); };

  async function refresh() {
    if (!alive()) return;
    S = await TF.get();
    renderPanel();
    scan();
  }

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ['settings', 'groups', 'channels'].some(k => k in ch)) refresh();
  });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('yt-navigate-finish', () => { schedule(); setTimeout(() => S && renderCur(), 1200); });

  refresh().then(async () => {
    document.documentElement.appendChild(host);
    let flag = false;
    try { flag = sessionStorage.getItem('tf2_import') === '1'; sessionStorage.removeItem('tf2_import'); } catch {}
    if (flag && location.pathname === '/feed/channels') {
      await TF.setSetting('panelOpen', true);
      await sleep(1500);
      runFeedImport();
    }
  });
})();
