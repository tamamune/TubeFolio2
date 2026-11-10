// 検索ページ(ツールバーの「検索」)。page.js から recPage() で呼ばれる。
//  対象: 登録チャンネル(新着一覧から、キーワードで絞る) / 非登録チャンネル / すべて(YouTubeの検索)
//  種類: 動画 / ライブ・配信 / ショート
//  結果の動画: 🕒 =「TubeFolio2 後で見る」へ直接追加、「⋮」= 再生リストを選んで追加
function recPage() {
  const main = document.querySelector('main');
  const E = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ls = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  const lset = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const SCOPES = [['reg', '登録チャンネル'], ['non', '非登録チャンネル'], ['all', 'すべて']];
  const KINDS = [['v', '動画'], ['l', 'ライブ・配信'], ['s', 'ショート']];
  let scope = ls('tfRecScope', 'reg'), kind = ls('tfRecKind', 'v'), q = ls('tfRecQ', ''), busy = 0, token = null, shown = 0;
  if (!SCOPES.some(x => x[0] === scope)) scope = 'reg'; if (!KINDS.some(x => x[0] === kind)) kind = 'v';
  const seg = (arr, cur, a) => `<span class="rseg">${arr.map(([k, t]) => `<button data-${a}="${k}" class="${k === cur ? 'on' : ''}">${t}</button>`).join('')}</span>`;
  main.innerHTML = `<div class="head"><h1>検索</h1><span class="sp"></span><span id="st"></span><button id="rclr" class="rclr" title="検索で取得したデータ(新着の一覧・ショートの投稿日・結果)を空にします。表示の速さを調べるときに使います">🗑 検索データを空にする</button></div>
    <form id="rf" class="rform"><input id="rq" type="search" placeholder="キーワード(空欄: 登録=新着の一覧 / 非登録・すべて=YouTubeのおすすめ)" value="${E(q)}" autocomplete="off"><button class="rgo" type="submit">検索</button></form>
    <div class="rrow"><span class="rl">対象</span><span id="rs">${seg(SCOPES, scope, 's')}</span><span class="rl">種類</span><span id="rk">${seg(KINDS, kind, 'k')}</span></div>
    <div id="rres"></div><div class="rmore"><button id="rmore" class="rgo" hidden>もっと見る</button></div><div id="rsent" style="height:1px"></div>`;
  const $ = s => main.querySelector(s), box = $('#rres'), st = $('#st');

  // ---- 登録チャンネルの判定(IDまたは名前が一致) ----
  let regIds = new Set(), regNames = new Set();
  const loadReg = () => chrome.storage.local.get(['channels', 'meta']).then(r => {
    regIds = new Set(); regNames = new Set();
    Object.entries(r.channels || {}).forEach(([k, c]) => { if (/^UC/.test(k)) regIds.add(k); if (c && c.name) regNames.add(c.name); const m = (r.meta || {})[k]; if (m && m.id) regIds.add(m.id); });
  });
  const isReg = x => (x.chId && regIds.has(x.chId)) || (x.ch && regNames.has(x.ch));

  // ---- 結果のカード ----
  const href = x => x.kind === 's' ? `https://www.youtube.com/shorts/${x.id}` : `https://www.youtube.com/watch?v=${x.id}`;
  const cardOf = x => {
    const th = x.thumb || `https://i.ytimg.com/vi/${x.id}/${x.kind === 's' ? 'oardefault' : 'mqdefault'}.jpg`;
    const meta = [x.views, x.when].filter(Boolean).join(' ・ ');
    return `<a class="card rc" data-ch="${E(x.ch)}" data-chid="${E(x.chId)}" href="${href(x)}" target="_top" data-v="${E(x.id)}" title="${E(x.title)}"><div class="th"><img loading="lazy" src="${E(th)}" onerror="this.src='https://i.ytimg.com/vi/${E(x.id)}/mqdefault.jpg'">${x.live ? '<span class="rlive">● ライブ</span>' : ''}${x.len ? `<span class="tm">${E(x.len)}</span>` : ''}<button class="rlater" title="再生リスト「TubeFolio2 後で見る」に追加">🕒</button></div>
      <div class="inf">${x.avatar ? `<img class="av" loading="lazy" src="${E(x.avatar)}">` : '<span class="av"></span>'}<div class="tx"><b>${E(x.title)}</b><small>${E(x.ch)}${isReg(x) ? ' <i class="rreg">登録</i>' : ''}</small>${meta ? `<small>${E(meta)}</small>` : ''}</div><button class="vdots rdots" title="メニュー">⋮</button></div></a>`;
  };
  const addCards = items => {
    if (!items.length) return;
    let g = box.querySelector('.grid'); if (!g) { box.innerHTML = '<div class="grid' + (kind === 's' ? ' shorts' : '') + '"></div>'; g = box.querySelector('.grid'); }
    g.insertAdjacentHTML('beforeend', items.map(cardOf).join('')); shown += items.length;
  };
  const note = t => { box.innerHTML = `<p class="empty">${E(t)}</p>`; };

  // ---- 検索の実行 ----
  //  登録チャンネル: 新着の一覧(直近5日)を日付ごとに。キーワードで絞る
  //  非登録 / すべて: キーワードなし = YouTubeのおすすめ(下へスクロールすると、続きを足す) / あり = YouTubeの検索
  const DAYS = 5;
  const send = m => new Promise(res => chrome.runtime.sendMessage(m, res));
  let seen = new Set(), regItems = [], gen = 0;
  const uniq = items => items.filter(x => x.id && !seen.has(x.id) && seen.add(x.id));
  const ymd = d => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${'日月火水木金土'[d.getDay()]})`;
  const dkey = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  function drawReg() { // 日付ごとの見出し(押すと折りたたみ)
    const days = new Map(); regItems.forEach(x => { const k = dkey(new Date(x.published)); if (!days.has(k)) days.set(k, []); days.get(k).push(x); });
    box.innerHTML = [...days.entries()].map(([k, arr], i) => { const d = new Date(arr[0].published); return `<section class="day" data-k="rec-${k}"><div class="dh"><span class="fd">▾</span><h2>${ymd(d)}${dkey(new Date()) === k ? ' ・今日' : ''}</h2><span class="cnt">${arr.length}件</span></div><div class="grid${kind === 's' ? ' shorts' : ''}">${arr.map(cardOf).join('')}</div></section>`; }).join('');
    shown = regItems.length;
  }
  async function run(more) {
    if (more && busy) return; const my = ++gen; busy = 1; const moreBtn = $('#rmore');
    q = $('#rq').value.trim(); lset('tfRecQ', q);
    if (!more) { box.innerHTML = ''; shown = 0; seen = new Set(); token = null; regItems = []; moreBtn.hidden = true; }
    await loadReg();
    try {
      if (scope === 'reg') {
        st.textContent = '取得中…';
        const w = q.toLowerCase().split(/\s+/).filter(Boolean);
        const apply = items => { // 取れた分から順に描く(全チャンネルの取得を待たない)
          regItems = items.filter(x => !w.length || w.every(k => (x.title + ' ' + x.ch).toLowerCase().includes(k))).sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
          regItems.forEach(x => { x.when = x.published ? hm(new Date(x.published)) : ''; x.kind = kind; x.chId = ''; });
          if (regItems.length) drawReg();
        };
        let last = -1; const poll = setInterval(async () => {
          const p = await send({ type: 'feedStatus', kind }); if (my !== gen || !p || !p.running) return;
          const it = p.items || []; st.textContent = `取得中… ${p.done}/${p.total}チャンネル ・ ${it.length}件`;
          if (it.length !== last) { last = it.length; apply(it.slice()); }
        }, 400);
        let r; try { r = await send({ type: 'feedAll', days: DAYS, kind }); } finally { clearInterval(poll); }
        if (my !== gen) return;
        if (!r || r.error) { st.textContent = ''; return note('取得できませんでした' + (r && r.error ? '(' + r.error + ')' : '')); }
        apply(r.items || []);
        if (!regItems.length) { st.textContent = '0件'; return note(q ? '見つかりませんでした' : `直近${DAYS}日の新着がありません`); }
        st.textContent = regItems.length + '件(直近' + DAYS + '日)';
      } else {
        const searching = !!q; st.textContent = searching ? '検索中…' : 'おすすめを取得中…'; let got = 0;
        for (let i = 0; i < 5 && got < 12; i++) {
          const r = await send(searching ? { type: 'ytSearch', q, kind, token } : { type: 'ytHome', kind, token });
          if (my !== gen) return;
          if (!r || r.error) { st.textContent = ''; if (!shown) note('取得できませんでした' + (r && r.error ? '(' + r.error + ')' : '')); break; }
          token = r.token || null;
          let items = uniq((r.items || []).map(x => ({ ...x, kind })));
          if (scope === 'non') items = items.filter(x => !isReg(x));
          addCards(items); got += items.length;
          if (!token) break;
        }
        st.textContent = shown + '件' + (searching ? '' : '(おすすめ)'); moreBtn.hidden = !token;
        if (!shown && !box.querySelector('.empty')) note('見つかりませんでした');
      }
    } finally { if (my === gen) busy = 0; }
  }
  // 下までスクロールしたら、続きを足す(おすすめ・検索)
  { const se = $('#rsent'); if (se && 'IntersectionObserver' in window) new IntersectionObserver(es => { if (es.some(x => x.isIntersecting) && token && !busy && scope !== 'reg') run(true); }, { rootMargin: '600px' }).observe(se); }
  $('#rclr').addEventListener('click', async () => { // 検索データを空にする(新着の一覧・ショートの投稿日・結果の表示)
    await send({ type: 'feedClear' }); myCache = null; seen = new Set(); regItems = []; token = null; shown = 0; box.innerHTML = ''; $('#rmore').hidden = true; st.textContent = '';
    toast('検索データを空にしました。もう一度「検索」を押すと、取得し直します');
  });
  $('#rf').addEventListener('submit', e => { e.preventDefault(); run(false); });
  $('#rmore').addEventListener('click', () => run(true));
  $('#rs').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (!b) return; scope = b.dataset.s; lset('tfRecScope', scope); $('#rs').innerHTML = seg(SCOPES, scope, 's'); run(false); });
  $('#rk').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; lset('tfRecKind', kind); $('#rk').innerHTML = seg(KINDS, kind, 'k'); run(false); });

  // ---- 🕒 と「⋮」(再生リストへ追加) ----
  const toast = (t, ms = 3500) => { let e = document.getElementById('ptoast'); if (!e) { e = document.createElement('div'); e.id = 'ptoast'; document.body.appendChild(e); } e.textContent = t; e.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => e.classList.remove('on'), ms); };
  let myCache = null;
  const myLists = async () => {
    if (myCache && Date.now() - myCache.t < 60000) return myCache.l;
    const [r, st0] = await Promise.all([send({ type: 'plLists' }), chrome.storage.local.get('settings')]);
    if (!r || r.error) throw new Error((r && r.error) || '取得できません');
    const all = r.lists || [], cnt = new Map(); all.forEach(x => { if (x.owner && !/^RD/.test(x.id)) cnt.set(x.owner, (cnt.get(x.owner) || 0) + 1); });
    const me = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0], o = ((st0.settings || {}).plMenuOrder) || [];
    const mine = all.filter(x => x.id !== 'LL' && (x.id === 'WL' || (!/^RD/.test(x.id) && (!x.owner || (me && x.owner === me[0])))));
    const l = mine.map((x, i) => [x, i]).sort((a, b) => { const ia = o.indexOf(a[0].id), ib = o.indexOf(b[0].id); return (ia < 0 ? 1e6 + a[1] : ia) - (ib < 0 ? 1e6 + b[1] : ib); }).map(x => x[0]);
    myCache = { t: Date.now(), l }; return l;
  };
  const add = (vid, listId, name) => send({ type: 'plAdd', videoId: vid, listId }).then(r => r && r.ok ? toast('「' + (name || 'TubeFolio2 後で見る') + '」に追加しました') : toast('追加できませんでした: ' + ((r && r.error) || '不明なエラー'), 6000));
  const closeMenu = () => document.querySelectorAll('#rmenu').forEach(m => m.remove());
  box.addEventListener('click', async e => {
    const lb = e.target.closest('.rlater'), dt = e.target.closest('.rdots');
    if (!lb && !dt) return;
    e.preventDefault(); e.stopPropagation();
    const card = e.target.closest('.rc'), vid = card && card.dataset.v; if (!vid) return;
    if (lb) { lb.textContent = '…'; await add(vid, null); lb.textContent = '✓'; setTimeout(() => { lb.textContent = '🕒'; }, 1500); return; }
    const same = document.getElementById('rmenu') && document.getElementById('rmenu')._b === dt; closeMenu(); if (same) return;
    const r = dt.getBoundingClientRect(), m = document.createElement('div'); m.id = 'rmenu'; m._b = dt;
    m.style.top = Math.max(8, Math.min(r.bottom + 2, innerHeight - 330)) + 'px'; m.style.left = Math.max(8, Math.min(r.left - 200, innerWidth - 260)) + 'px';
    m.innerHTML = '<div class="vf-h">再生リストへ追加</div><div class="vf-n">読み込み中…</div>'; document.body.appendChild(m);
    try {
      const lists = await myLists(); if (!m.isConnected) return;
      m.innerHTML = '<div class="vf-h">再生リストへ追加</div>';
      lists.forEach(l => { const b = document.createElement('button'); b.className = 'vf-it'; b.textContent = l.title || l.id; b.title = l.title || ''; b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); closeMenu(); add(vid, l.id, l.title || '再生リスト'); }); m.appendChild(b); });
      if (!lists.length) m.insertAdjacentHTML('beforeend', '<div class="vf-n">再生リストがありません</div>');
    } catch (err) { if (m.isConnected) m.innerHTML = '<div class="vf-h">再生リストへ追加</div><div class="vf-n">取得できません</div>'; }
  });
  document.addEventListener('mousedown', e => { if (!e.target.closest('#rmenu, .rdots')) closeMenu(); }, true);
  document.addEventListener('scroll', closeMenu, true);

  loadReg().then(() => { if (scope === 'reg' || q) run(false); else note('キーワードを入れて、検索してください'); });
}
