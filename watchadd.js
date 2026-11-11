// 登録メニュー(⚙ のボタン)と、フォルダを選ぶメニュー。
//   ・再生画面の右下の ⚙: 押すとメニューが開く(以前の「🕒 後で見る」ボタンの代わり)
//       1) 「TubeFolio2 後で見る」へ登録 / すでに入っていれば「TubeFolio2 後で見る」から削除(YouTube の再生リスト「TubeFolio2 後で見る」)
//       2) 再生リストへ登録 … 自分の再生リストの一覧から選ぶ(並びは、設定 plMenuOrder = サムネの「⋮」のメニューと同じ)
//       3) フォルダ登録 … フォルダの一覧から選ぶ(この動画のチャンネルを、フォルダに入れる / 外す。複数選べる)
//   ・チャンネルのページ: 見出しのボタンの並び(登録・コミュニティなど)の横に「📁 フォルダ」。押すと 3) と同じ一覧
//   保存先は、これまでと同じ(フォルダ = channels[キー].groups。Drive同期の対象)。新しく保存するデータは無い
//   色は CSS変数(content.css の #tf-wmenu / #tf-wadd / #tf-chfold)。ダーク = html[dark]、ライト = それ以外
(() => {
  if (window.__tfWatchAdd) return; window.__tfWatchAdd = true;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const txt = e => ((e && e.textContent) || '').replace(/\s+/g, ' ').trim();
  const send = m => new Promise(res => { try { chrome.runtime.sendMessage(m, r => { void chrome.runtime.lastError; res(r || null); }); } catch (e) { res(null); } });
  const toast = (m, ms) => { let t = document.getElementById('tf-wtoast'); if (!t) { t = document.createElement('div'); t.id = 'tf-wtoast'; document.body.appendChild(t); } t.textContent = m; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), ms || 3000); };
  const isWatch = () => location.pathname === '/watch';
  const vid = () => (isWatch() ? new URLSearchParams(location.search).get('v') : null);
  const chPath = () => /^\/(@[^\/]+|channel\/UC[\w-]+|c\/[^\/]+|user\/[^\/]+)(\/|$)/.test(location.pathname);

  // ---- いまのチャンネル ----
  function watchChannel() {
    const ch = (globalThis.TGPage && TGPage.currentChannel && TGPage.currentChannel()) || null; if (!ch) return null;
    const img = document.querySelector('ytd-watch-metadata ytd-video-owner-renderer img, #owner #avatar img');
    return { key: String(ch.key).replace(/^channel\//, ''), id: ch.id || '', name: ch.name || '', avatar: img && /ggpht|yt3/.test(img.src) ? img.src : '' };
  }
  function pageChannel() {
    if (!chPath()) return null;
    const root = document.querySelector('ytd-browse:not([hidden]) #page-header, ytd-browse:not([hidden]) yt-page-header-renderer, ytd-browse:not([hidden]) ytd-c4-tabbed-header-renderer') || document;
    let key = TF.keyFromHref(location.pathname);
    if (!key) { const h = [...root.querySelectorAll('yt-content-metadata-view-model span, #channel-handle')].map(txt).find(t => /^@\S+/.test(t)); if (h) key = h.split(/\s/)[0].toLowerCase(); } // /c/名前・/user/名前 のときは、見出しの @ハンドル
    if (!key) return null;
    const img = root.querySelector('yt-avatar-shape img, yt-decorated-avatar-view-model img, #avatar img');
    return { key, id: /^UC/.test(key) ? key : '', name: txt(root.querySelector('h1')) || key, avatar: img && /ggpht|yt3/.test(img.src) ? img.src : '' };
  }
  // 登録済みのチャンネルは、保存してあるキー(@ハンドル / UC…)を使う(キーの形が違っても、同じチャンネルを指すように)
  async function storedKey(ch, S) {
    if (S.channels[ch.key]) return ch.key;
    if (ch.id && S.channels[ch.id]) return ch.id;
    const { meta = {} } = await chrome.storage.local.get('meta');
    if (ch.id) { const k = Object.keys(S.channels).find(x => meta[x] && meta[x].id === ch.id); if (k) return k; }
    if (meta[ch.key] && meta[ch.key].id && S.channels[meta[ch.key].id]) return meta[ch.key].id;
    return ch.key;
  }

  // ---- メニュー(1個だけ。中身を入れ替えて使う) ----
  let menu = null, anchorEl = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } anchorEl = null; document.removeEventListener('pointerdown', outside, true); };
  const outside = e => { if (menu && !menu.contains(e.target) && !(anchorEl && anchorEl.contains(e.target))) closeMenu(); };
  function place() {
    if (!menu || !anchorEl) return;
    const r = anchorEl.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
    const up = r.top > innerHeight / 2; // ボタンが画面の下半分にあるときは、上に開く
    menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
    menu.style.top = Math.max(8, Math.min(innerHeight - h - 8, up ? r.top - h - 8 : r.bottom + 8)) + 'px';
  }
  function openMenu(anchor) {
    closeMenu(); anchorEl = anchor;
    menu = document.createElement('div'); menu.id = 'tf-wmenu';
    ['keydown', 'keyup', 'keypress'].forEach(t => menu.addEventListener(t, e => { if (t === 'keydown' && e.key === 'Escape') closeMenu(); e.stopPropagation(); }));
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    return menu;
  }
  const setView = html => { if (!menu) return; menu.innerHTML = html; place(); };
  const head = (t, back) => `<div class="h">${back ? '<button data-a="back" title="戻る">←</button>' : ''}<b>${esc(t)}</b><button data-a="close" title="閉じる">✕</button></div>`;

  // ---- フォルダの一覧(チャンネルを、フォルダに入れる / 外す) ----
  async function folderView(ch, back) {
    if (!menu) return;
    if (!ch) { setView(head('フォルダ登録', back) + '<p class="msg">チャンネルを特定できませんでした。少し待ってから、もう一度押してください。</p>'); return; }
    const S = await TF.get(), key = await storedKey(ch, S), cur = new Set((S.channels[key] && S.channels[key].groups) || []);
    if (!menu) return;
    const keepTop = (menu.querySelector('.l') || {}).scrollTop || 0;
    setView(head('フォルダ登録', back) + `<p class="sub" title="${esc(ch.name)}">${esc(ch.name || key)}</p><p class="msg">押すたびに、入れる / 外す を切り替えます(いくつでも選べます)。</p>
      <div class="l">${TF.flat(S.groups).map(({ g, depth }) => `<button class="it${cur.has(g.id) ? ' on' : ''}" data-g="${esc(g.id)}" style="padding-left:${10 + depth * 16}px"><i class="ck">${cur.has(g.id) ? '✓' : ''}</i><span class="ic">${TF.iconHtml(g.icon || '📁')}</span><span class="nm">${esc(g.name)}</span></button>`).join('') || '<p class="msg">フォルダがありません。</p>'}</div>
      <div class="f"><input data-f="new" placeholder="新しいフォルダの名前" maxlength="30"><button data-a="newf">＋ 作って入れる</button></div>`);
    const l = menu.querySelector('.l'); if (l) l.scrollTop = keepTop;
    menu._folder = { ch, key, back };
  }
  async function toggleFolder(gid) {
    const f = menu && menu._folder; if (!f) return;
    await TF.toggleGroup({ key: f.key, name: f.ch.name, avatar: f.ch.avatar }, gid);
    folderView(f.ch, f.back);
  }

  // ---- 再生リストの一覧 ----
  let plCache = null;
  const myLists = (all, S) => {
    const cnt = new Map(); all.forEach(x => { if (x.owner && !/^RD/.test(x.id)) cnt.set(x.owner, (cnt.get(x.owner) || 0) + 1); });
    const me = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0], o = (S && S.settings.plMenuOrder) || [];
    return all.filter(x => x.id !== 'LL' && (x.id === 'WL' || (!/^RD/.test(x.id) && (!x.owner || (me && x.owner === me[0])))))
      .map((x, i) => [x, i]).sort((a, b) => { const ia = o.indexOf(a[0].id), ib = o.indexOf(b[0].id); return (ia < 0 ? 1e6 + a[1] : ia) - (ib < 0 ? 1e6 + b[1] : ib); }).map(x => x[0]);
  };
  async function listView() {
    setView(head('再生リストへ登録', true) + '<p class="msg">読み込み中…</p>');
    if (!plCache || Date.now() - plCache.t > 60000) { const r = await send({ type: 'plLists' }); if (r && !r.error) plCache = { t: Date.now(), lists: r.lists || [] }; else { setView(head('再生リストへ登録', true) + `<p class="msg">再生リストを取得できませんでした${r && r.error ? '(' + esc(r.error) + ')' : ''}。</p>`); return; } }
    const ls = myLists(plCache.lists, await TF.get());
    setView(head('再生リストへ登録', true) + `<div class="l">${ls.map(x => `<button class="it" data-pl="${esc(x.id)}" title="${esc(x.title || '')}"><span class="ic">📚</span><span class="nm">${esc(x.title || x.id)}</span></button>`).join('') || '<p class="msg">再生リストがありません。</p>'}</div>`);
  }

  // ---- 「TubeFolio2 後で見る」に入っているか(再生リストの中身を見て判定。1分は覚えておく) ----
  let later = null; // { id, t, map: 動画ID → setId }
  async function laterState(force) {
    if (later && !force && Date.now() - later.t < 60000) return later;
    const t = await send({ type: 'plTargetInfo' }); if (!t || !t.id) return (later = null);
    const r = await send({ type: 'plVideos', ids: [t.id] }); if (!r || r.error) return (later = null);
    return (later = { id: t.id, t: Date.now(), map: new Map((r.items || []).map(x => [x.id, x.setId || ''])) });
  }
  async function rootView() {
    const v = vid(); if (!menu) return;
    const row = st => st === 'load' ? '<button class="it" disabled><span class="ic">🕒</span><span class="nm">「TubeFolio2 後で見る」を確認中…</span></button>'
      : st === 'in' ? '<button class="it on" data-a="laterdel"><span class="ic">✓</span><span class="nm">「TubeFolio2 後で見る」から削除</span></button>'
      : '<button class="it" data-a="lateradd"><span class="ic">🕒</span><span class="nm">「TubeFolio2 後で見る」へ登録</span></button>';
    const html = st => head('登録', false) + `<div class="l">${row(st)}<button class="it" data-a="lists"><span class="ic">📚</span><span class="nm">再生リストへ登録</span><i class="go">›</i></button><button class="it" data-a="folders"><span class="ic">📁</span><span class="nm">フォルダ登録</span><i class="go">›</i></button></div>`;
    menu._folder = null; menu._root = true;
    setView(html(later && Date.now() - later.t < 60000 ? (later.map.has(v) ? 'in' : 'out') : 'load'));
    const L = await laterState(false);
    if (menu && menu._root && v === vid()) setView(html(L && L.map.has(v) ? 'in' : 'out'));
  }

  document.addEventListener('click', async e => {
    if (!menu || !menu.contains(e.target)) return;
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    e.preventDefault(); e.stopPropagation();
    const a = b.dataset.a, v = vid();
    if (a === 'close') return closeMenu();
    if (a === 'back') return rootView();
    if (b.dataset.g) return toggleFolder(b.dataset.g);
    if (a === 'newf') { const i = menu.querySelector('[data-f="new"]'), name = (i.value || '').trim(), f = menu._folder; if (!name || !f) return; const before = new Set((await TF.get()).groups.map(g => g.id)); const S2 = await TF.addGroup(name, TF.suggestIcon(name) || '📁'); const g = S2.groups.find(x => !before.has(x.id)); if (g) await TF.toggleGroup({ key: f.key, name: f.ch.name, avatar: f.ch.avatar }, g.id); return folderView(f.ch, f.back); }
    if (a === 'folders') { menu._root = false; return folderView(watchChannel(), true); }
    if (a === 'lists') { menu._root = false; return listView(); }
    if (a === 'lateradd' || b.dataset.pl) {
      if (!v) return; b.disabled = true; const nm = b.querySelector('.nm'), name = b.dataset.pl ? (nm.textContent || '再生リスト') : 'TubeFolio2 後で見る'; nm.textContent = '登録中…';
      const r = await send(b.dataset.pl ? { type: 'plAdd', videoId: v, listId: b.dataset.pl } : { type: 'plAdd', videoId: v });
      if (r && r.ok) { toast(`「${name}」に登録しました`); if (later && (!b.dataset.pl || b.dataset.pl === later.id)) later.map.set(v, ''); closeMenu(); }
      else { toast('登録できませんでした: ' + ((r && r.error) || '拡張機能に接続できません。ページを更新してください'), 6000); if (menu) (b.dataset.pl ? listView : rootView)(); }
      return;
    }
    if (a === 'laterdel') {
      if (!v) return; b.disabled = true; b.querySelector('.nm').textContent = '削除中…';
      const L = await laterState(false) , r = L ? await send({ type: 'plRemove', listId: L.id, videoId: v, setId: L.map.get(v) || '' }) : { error: '再生リストが見つかりません' };
      if (r && r.ok) { toast('「TubeFolio2 後で見る」から削除しました'); if (later) later.map.delete(v); chrome.storage.local.set({ plAddedAt: Date.now() }).catch(() => {}); closeMenu(); }
      else { toast('削除できませんでした: ' + ((r && r.error) || '不明なエラー'), 6000); later = null; if (menu) rootView(); }
    }
  }, true);
  document.addEventListener('keydown', e => { if (menu && e.target.closest && e.target.closest('#tf-wmenu [data-f="new"]') && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const b = menu.querySelector('[data-a="newf"]'); if (b) b.click(); } }, true);
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.plAddedAt) later = null; });
  window.addEventListener('resize', place);

  // ---- 再生画面の右下の ⚙ / チャンネルのページの「📁 フォルダ」 ----
  const GEAR = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6a.5.5 0 0 0 .1-.7l-2-3.4a.5.5 0 0 0-.6-.2l-2.5 1a7.300 7.300 0 0 0-1.700-1L14.400 2.400a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4L9.100 5.100a7.300 7.300 0 0 0-1.700 1l-2.500-1a.5.5 0 0 0-.6.2l-2 3.400a.5.5 0 0 0 .1.700L4.600 11a7.500 7.500 0 0 0 0 2l-2.100 1.600a.5.5 0 0 0-.1.700l2 3.400a.5.5 0 0 0 .6.2l2.500-1a7.300 7.300 0 0 0 1.700 1l.4 2.700a.5.5 0 0 0 .5.4h4a.5.5 0 0 0 .5-.4l.4-2.700a7.300 7.300 0 0 0 1.700-1l2.500 1a.5.5 0 0 0 .6-.2l2-3.400a.5.5 0 0 0-.1-.700L19.400 13zM12 15.500A3.500 3.500 0 1 1 12 8.500a3.500 3.500 0 0 1 0 7z"/></svg>';
  let fab = null, lastV = null;
  function ensure() {
    // 再生画面: ⚙
    if (!isWatch()) { if (fab) { if (menu && anchorEl === fab) closeMenu(); fab.remove(); fab = null; } }
    else {
      if (!fab || !fab.isConnected) {
        fab = document.createElement('button'); fab.id = 'tf-wadd'; fab.title = '登録(TubeFolio2 後で見る / 再生リスト / フォルダ)'; fab.innerHTML = GEAR + '<span>登録</span>';
        fab.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (menu && anchorEl === fab) return closeMenu(); openMenu(fab); rootView(); });
        document.body.appendChild(fab);
      }
      if (lastV !== vid()) { lastV = vid(); if (menu && anchorEl === fab) closeMenu(); }
    }
    // チャンネルのページ: 見出しのボタンの並びの最後に「📁 フォルダ」
    let cb = document.getElementById('tf-chfold');
    if (!chPath()) { if (cb) cb.remove(); return; }
    const acts = document.querySelector('ytd-browse:not([hidden]) yt-flexible-actions-view-model, ytd-browse:not([hidden]) ytd-c4-tabbed-header-renderer #buttons');
    if (!acts) return;
    if (cb && cb.parentElement !== acts) { cb.remove(); cb = null; }
    if (!cb) {
      cb = document.createElement('button'); cb.id = 'tf-chfold'; cb.type = 'button'; cb.title = 'このチャンネルを、フォルダに入れる / 外す';
      cb.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (menu && anchorEl === cb) return closeMenu(); openMenu(cb); folderView(pageChannel(), false); });
      acts.appendChild(cb);
    }
    // ボタンの文字: 入っているフォルダの数
    const ch = pageChannel(), S = globalThis.TGPage && TGPage.state && TGPage.state();
    let n = 0; if (ch && S && S.channels) { const c = S.channels[ch.key] || S.channels['channel/' + ch.key]; n = c && c.groups ? c.groups.length : 0; }
    const label = n ? `📁 フォルダ(${n})` : '📁 フォルダ'; if (cb.textContent !== label) { cb.textContent = label; cb.classList.toggle('on', n > 0); }
  }
  setInterval(ensure, 800);
  document.addEventListener('yt-navigate-finish', () => { closeMenu(); setTimeout(ensure, 300); });
  window.tfFolderPick = { open: (anchor, ch) => { openMenu(anchor); folderView(ch, false); }, close: closeMenu };
})();
