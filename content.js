// TubeFolio2 content script (YouTube)
(() => {
  let S = null; // state
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = t => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const OUTER = 'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, ytd-compact-video-renderer';
  const CARD = OUTER + ', yt-lockup-view-model';
  const isSubs = () => location.pathname === '/feed/subscriptions';
  const isChList = () => location.pathname === '/feed/channels';

  const groupOf = id => S.groups.find(g => g.id === id);
  const cardKey = card => {
    const a = card.querySelector('a[href^="/@"], a[href^="/channel/UC"]');
    return a ? TF.keyFromHref(a.getAttribute('href')) : null;
  };
  const cardMeta = card => {
    const a = card.querySelector('ytd-channel-name a, a[href^="/@"]:not(:empty)');
    const img = card.querySelector('yt-avatar-shape img, #avatar img, img.yt-core-image');
    return { name: a ? a.textContent.trim() : '', avatar: img && /ggpht|yt3/.test(img.src) ? img.src : '' };
  };
  const watchedPct = card => {
    const p = card.querySelector('ytd-thumbnail-overlay-resume-playback-renderer #progress, yt-thumbnail-overlay-progress-bar-view-model [style*="width"], .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment');
    const m = p && (p.style.width || '').match(/([\d.]+)%/);
    return m ? parseFloat(m[1]) : 0;
  };
  const videoId = card => {
    const a = card.querySelector('a[href*="/watch?v="]');
    const m = a && a.getAttribute('href').match(/[?&]v=([\w-]{11})/);
    return m ? m[1] : null;
  };

  // ---------- カード処理 ----------
  function processCards() {
    document.querySelectorAll(CARD).forEach(card => {
      if (card.matches('yt-lockup-view-model') && card.closest(OUTER)) return;
      const key = cardKey(card);
      // カード自体のレイアウトには触れず、グループ登録済みならサムネに枠色だけ付ける(ホバープレビュー保護)
      const gs0 = key && S.channels[key] ? S.channels[key].groups.map(groupOf).filter(Boolean) : [];
      if (gs0.length) { card.setAttribute('data-tf-on', ''); card.style.setProperty('--tf-c', gs0[0].color); }
      else if (card.hasAttribute('data-tf-on')) { card.removeAttribute('data-tf-on'); card.style.removeProperty('--tf-c'); }
      // フィルタ(登録フィード)
      let hide = false;
      if (isSubs()) {
        const ag = S.settings.activeGroup;
        const gs = key && S.channels[key] ? S.channels[key].groups.filter(id => groupOf(id)) : [];
        if (ag === 'none') hide = gs.length > 0;
        else if (ag !== 'all') { const sub = TF.subtree(S.groups, ag); hide = !gs.some(id => sub.has(id)); }
        if (!hide && S.settings.hideWatched && watchedPct(card) >= 80) hide = true;
      }
      card.classList.toggle('tf-hide', hide);
    });
    document.querySelectorAll('ytd-rich-section-renderer').forEach(s =>
      s.classList.toggle('tf-hide', isSubs() && S.settings.activeGroup !== 'all'));
  }

  // ---------- 登録フィードのバー ----------
  function renderBar() {
    let bar = $('#tf-bar');
    if (!isSubs()) { if (bar) bar.remove(); return; }
    const host = $('ytd-browse[page-subtype="subscriptions"] #primary') || $('ytd-browse[page-subtype="subscriptions"]');
    if (!host) return;
    if (!bar) { bar = el('div'); bar.id = 'tf-bar'; host.prepend(bar); }
    else if (bar.parentElement !== host) host.prepend(bar);
    const ag = S.settings.activeGroup;
    const cnt = gid => { const sub = TF.subtree(S.groups, gid); return Object.values(S.channels).filter(c => c.groups.some(id => sub.has(id))).length; };
    const unfiled = Object.values(S.channels).filter(c => !c.groups.some(id => groupOf(id))).length;
    const chip = (id, label, n, color) =>
      `<button class="tf-chip${ag === id ? ' act' : ''}" data-g="${id}" ${color ? `style="--c:${color}"` : ''}>${label}<span>${n}</span></button>`;
    bar.innerHTML = `
      <div class="tf-chips">
        ${chip('all', '🗂️ すべて', Object.keys(S.channels).length)}
        ${TF.flat(S.groups).map(({ g, depth }) => chip(g.id, `${depth ? '↳ ' : ''}${esc(g.icon)} ${esc(g.name)}`, cnt(g.id), g.color)).join('')}
        ${chip('none', '📥 未分類', unfiled)}
      </div>
      <div class="tf-tools">
        <label class="tf-sw"><input type="checkbox" id="tf-hw" ${S.settings.hideWatched ? 'checked' : ''}><span></span>視聴済みを隠す</label>
        <button class="tf-btn" id="tf-play" title="表示中の動画(最大50件)を連続再生">▶ 一括再生</button>
        <button class="tf-btn" id="tf-imp" title="YouTubeの登録チャンネルを取り込む">⟳ 取り込み</button>
        <button class="tf-btn" id="tf-mgr">⚙ 管理</button>
      </div>`;
    bar.querySelectorAll('.tf-chip').forEach(b => b.onclick = () =>
      TF.mutate(s => { s.settings.activeGroup = b.dataset.g; }));
    $('#tf-hw', bar).onchange = e => TF.mutate(s => { s.settings.hideWatched = e.target.checked; });
    $('#tf-mgr', bar).onclick = () => chrome.runtime.sendMessage({ type: 'openManager' });
    $('#tf-imp', bar).onclick = () => { location.href = '/feed/channels?tf_import=1'; };
    $('#tf-play', bar).onclick = () => {
      const ids = [];
      document.querySelectorAll(CARD).forEach(c => {
        if (c.matches('yt-lockup-view-model') && c.closest(OUTER)) return;
        if (c.classList.contains('tf-hide')) return;
        const v = videoId(c); if (v && !ids.includes(v)) ids.push(v);
      });
      if (!ids.length) return toast('再生できる動画がありません');
      location.href = '/watch_videos?video_ids=' + ids.slice(0, 50).join(',');
    };
  }

  // ---------- グループ選択ポップオーバー ----------
  function openPicker(anchor, meta) {
    closePicker();
    const pop = el('div'); pop.id = 'tf-pop';
    const draw = () => {
      const cur = (S.channels[meta.key] || { groups: [] }).groups;
      pop.innerHTML = `<div class="tf-pop-h">${esc(meta.name || meta.key)}</div>` +
        TF.flat(S.groups).map(({ g, depth }) => `<label class="tf-row" style="padding-left:${8 + depth * 16}px"><input type="checkbox" data-g="${g.id}" ${cur.includes(g.id) ? 'checked' : ''}>
          <b style="background:${g.color}">${esc(g.icon)}</b><span>${esc(g.name)}</span></label>`).join('') +
        `<div class="tf-new"><input placeholder="新しいグループ名" maxlength="30"><button>追加</button></div>`;
      pop.querySelectorAll('input[type=checkbox]').forEach(i => i.onchange = () => TF.toggleGroup(meta, i.dataset.g));
      const inp = $('.tf-new input', pop);
      const add = async () => { if (inp.value.trim()) { await TF.addGroup(inp.value.trim()); } };
      $('.tf-new button', pop).onclick = add;
      inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') add(); };
      inp.onkeyup = inp.onkeypress = e => e.stopPropagation();
    };
    pop._draw = draw; pop._meta = meta;
    draw();
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(r.left, innerWidth - 260) + 'px';
    pop.style.top = Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 10) + 'px';
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  }
  function outside(e) { const p = $('#tf-pop'); if (p && !p.contains(e.target)) closePicker(); }
  function closePicker() { const p = $('#tf-pop'); if (p) p.remove(); document.removeEventListener('mousedown', outside, true); }

  // ---------- チャンネル/動画ページのFAB ----------
  function renderFab() {
    let fab = $('#tf-fab');
    let meta = null;
    if (/^\/(@|channel\/UC)/.test(location.pathname)) {
      const key = TF.keyFromHref(location.pathname);
      const n = $('ytd-channel-name yt-formatted-string, #channel-name yt-formatted-string, yt-dynamic-text-view-model h1');
      const img = $('yt-decorated-avatar-view-model img, #avatar img');
      if (key) meta = { key, name: n ? n.textContent.trim() : '', avatar: img ? img.src : '' };
    } else if (location.pathname === '/watch') {
      const a = $('ytd-video-owner-renderer a[href^="/@"], #owner a[href^="/@"], #owner a[href^="/channel/UC"]');
      const key = a && TF.keyFromHref(a.getAttribute('href'));
      const img = $('#owner img');
      if (key) meta = { key, name: a.textContent.trim() || ($('#owner ytd-channel-name a') || {}).textContent || '', avatar: img ? img.src : '' };
    }
    if (!meta) { if (fab) fab.remove(); return; }
    if (!fab) { fab = el('button'); fab.id = 'tf-fab'; document.body.appendChild(fab); fab.onclick = () => openPicker(fab, fab._meta); }
    fab._meta = meta;
    const gs = (S.channels[meta.key] ? S.channels[meta.key].groups : []).map(groupOf).filter(Boolean);
    fab.innerHTML = gs.length ? gs.map(g => g.icon).join('') + ' <span>グループ編集</span>' : '＋ <span>グループに追加</span>';
    fab.classList.toggle('on', gs.length > 0);
  }

  // ---------- 登録チャンネル取り込み ----------
  function toast(msg, ms = 3500) {
    let t = $('#tf-toast'); if (!t) { t = el('div'); t.id = 'tf-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
  }
  let importing = false;
  async function importChannels() {
    if (importing) return; importing = true;
    let last = -1, same = 0;
    while (same < 4) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(r => setTimeout(r, 900));
      const n = document.querySelectorAll('ytd-channel-renderer').length;
      toast(`取り込み中… ${n}件`, 8000);
      same = n === last ? same + 1 : 0; last = n;
    }
    const list = [];
    document.querySelectorAll('ytd-channel-renderer').forEach(r => {
      const a = r.querySelector('a#main-link, #info a, a[href^="/@"], a[href^="/channel/UC"]');
      const key = a && TF.keyFromHref(a.getAttribute('href'));
      if (!key) return;
      const name = TF.clean(((r.querySelector('#text, #channel-title') || {}).textContent || ''));
      const img = r.querySelector('img');
      list.push({ key, name, avatar: img && /^https:\/\/(yt3|lh3)\.|ggpht/.test(img.src) ? img.src : '' });
    });
    await TF.upsertChannels(list);
    window.scrollTo(0, 0);
    importing = false;
    toast(`✓ ${list.length}件のチャンネルを取り込みました`, 6000);
    if (location.search.includes('tf_import')) setTimeout(() => { location.href = '/feed/subscriptions'; }, 1500);
  }
  function checkImport() {
    if (isChList() && location.search.includes('tf_import') && !importing) setTimeout(importChannels, 1200);
  }

  // ---------- ホバー時に出る単一のフローティングボタン(カードに要素を追加しない) ----------
  let hb = null, hbCard = null;
  function hoverBtn() {
    if (hb) return hb;
    hb = el('button', 'tf-pick'); hb.title = 'グループに追加'; hb.style.display = 'none';
    hb.addEventListener('mouseleave', e => { if (!hbCard || !hbCard.contains(e.relatedTarget)) hideHb(); });
    hb.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (hbCard) { const k = cardKey(hbCard); if (k) openPicker(hb, { key: k, ...cardMeta(hbCard) }); } });
    document.body.appendChild(hb);
    return hb;
  }
  function hideHb() { if (hb) hb.style.display = 'none'; hbCard = null; }
  function paintHb(card, key) {
    const b = hoverBtn();
    const gs = (S.channels[key] ? S.channels[key].groups : []).map(groupOf).filter(Boolean);
    b.innerHTML = gs.length ? gs.slice(0, 4).map(g => `<i style="background:${g.color}"></i>`).join('') : '＋';
    b.classList.toggle('on', gs.length > 0);
    const t = card.querySelector('ytd-thumbnail, yt-thumbnail-view-model, a#thumbnail') || card;
    const r = t.getBoundingClientRect();
    b.style.left = (r.left + 8) + 'px'; b.style.top = (r.top + 8) + 'px'; b.style.display = 'flex';
  }
  document.addEventListener('mouseover', e => {
    if (!e.target.closest) return;
    if (e.target.closest('#tf-pop, .tf-pick')) return;
    let card = e.target.closest(OUTER);
    if (!card) { const l = e.target.closest('yt-lockup-view-model'); if (l) card = l; }
    if (!card) return hideHb();
    if (card === hbCard) return;
    const key = cardKey(card);
    if (!key) return hideHb();
    hbCard = card; paintHb(card, key);
  }, true);
  window.addEventListener('scroll', hideHb, { passive: true });

  // ---------- 更新ループ ----------
  let tmr = 0;
  const refresh = () => { if (!S) return; processCards(); renderBar(); renderFab(); const p = $('#tf-pop'); if (p && p._draw) p._draw(); };
  const schedule = () => { clearTimeout(tmr); tmr = setTimeout(refresh, 250); };

  async function init() {
    S = await TF.get();
    chrome.storage.onChanged.addListener(async () => { S = await TF.get(); refresh(); });
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('yt-navigate-finish', () => { schedule(); checkImport(); });
    refresh(); checkImport();
  }
  init();
})();
