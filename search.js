// 検索ページ(ツールバーの「検索」)。page.js から recPage() で呼ばれる。
//  対象: 登録チャンネル(新着一覧から、キーワードで絞る) / 非登録チャンネル / すべて(YouTubeの検索)
//  種類: 動画 / ライブ・配信 / ショート
//  結果の動画: 🕒 =「TubeFolio2 後で見る」へ直接追加、「⋮」= 再生リストを選んで追加
function recPage(opts = {}) {
  // opts.trend = true: 「検索2」。種類に「📈 急上昇」を足し、操作の部分を1つの枠にまとめて並べる(種類は tfRec2Kind に覚える。「検索」とは別)
  const T = !!opts.trend, KK = T ? 'tfRec2Kind' : 'tfRecKind';
  const main = document.querySelector('main');
  const E = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ls = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  const lset = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const SCOPES = [['reg', '登録チャンネル'], ['non', '非登録チャンネル'], ['all', 'すべて']];
  const KINDS = [['v', '動画'], ['l', 'ライブ・配信'], ['s', 'ショート'], ...(T ? [['t', '📈 急上昇']] : [])];
  let scope = ls('tfRecScope', 'reg'), kind = ls(KK, 'v'), q = ls('tfRecQ', ''), busy = 0, token = null, shown = 0;
  if (!SCOPES.some(x => x[0] === scope)) scope = 'reg'; if (!KINDS.some(x => x[0] === kind)) kind = 'v';
  const seg = (arr, cur, a) => `<span class="rseg">${arr.map(([k, t]) => `<button data-${a}="${k}" class="${k === cur ? 'on' : ''}">${t}</button>`).join('')}</span>`;
  const HEAD = `<div class="head"><h1>検索</h1><span class="sp"></span><span id="st"></span></div>`;
  const ROW = `<div class="rrow"><span class="rgrp" id="rsg"><span class="rl">対象</span><span id="rs">${seg(SCOPES, scope, 's')}</span></span><span class="rgrp"><span class="rl">種類</span><span id="rk">${seg(KINDS, kind, 'k')}</span></span></div>`;
  const FORM = `<form id="rf" class="rform"><span class="rqw"><input id="rq" type="search" placeholder="キーワード(空欄: 登録=新着の一覧 / 非登録・すべて=YouTubeのおすすめ)" value="${E(q)}" autocomplete="off"><button type="button" id="rclear" class="rclear" title="クリア(キーワードを消して、フォルダを「すべて」に戻す)" hidden>✕</button></span><button class="rgo" type="submit">検索</button><button type="button" id="rreset" class="rclr" title="キーワードを空にして、対象を「すべて」、種類を「動画」に戻します">クリア</button><span class="rrg"><button type="button" id="rrand" class="rrand" title="ランダムなタグを選んで、キーワードに入れて探す(タグは 設定 → 整理・通知 → ランダムタグ)">🎲 ランダムタグ</button><span class="rrn" id="rrn" title="選ぶタグの数。2つ以上は「a | b | c」(どれかを含む)でまとめて探す"></span></span></form>`;
  const TNAV = T ? `<div id="rtnav" class="rtnav" hidden><span class="rl">📅 日付</span><button type="button" id="rt-prev" title="前の日">◀</button><input type="date" id="rt-date" min="2024-01-01"><button type="button" id="rt-next" title="次の日">▶</button><button type="button" id="rt-now" title="今日の急上昇">今日</button><span class="rl rt-gap">カテゴリ</span><select id="rt-cat"><option value="">すべて</option></select><span class="rl rt-src">日本・1日ごと(データ: youtube-trending.info)</span></div>` : '';
  const REST = `<div id="rres"></div><div class="rmore"><button id="rmore" class="rgo" hidden>もっと見る</button></div><div id="rsent" style="height:1px"></div>`;
  main.innerHTML = T ? HEAD + `<div class="rpanel" id="rpanel">${FORM}${ROW}${TNAV}<div id="rfold" class="rfold"></div></div>` + REST
    : HEAD + ROW + '<div id="rfold" class="rfold"></div>' + FORM + REST;
  const $ = s => main.querySelector(s), box = $('#rres'), st = $('#st');
  // サムネが無い(404 / YouTubeの灰色の代用画像=小さい)ときは、別の画像に順に差し替える。拡張機能のページはインラインの onerror が使えないので、まとめて監視する
  const THUMBS = ['oardefault', 'hq2', 'mqdefault', 'hqdefault'];
  const nextThumb = im => {
    const id = im.dataset.vid; if (!id) return;
    const cur = THUMBS.findIndex(n => im.src.includes('/' + n + '.')), nx = THUMBS[cur + 1];
    if (nx) im.src = `https://i.ytimg.com/vi/${id}/${nx}.jpg`;
  };
  box.addEventListener('error', e => { if (e.target.tagName === 'IMG') nextThumb(e.target); }, true);
  box.addEventListener('load', e => { const im = e.target; if (im.tagName === 'IMG' && im.dataset.vid && im.naturalWidth <= 140) nextThumb(im); }, true);

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
    return `<a class="card rc" data-ch="${E(x.ch)}" data-chid="${E(x.chId)}" href="${href(x)}" target="_top" data-v="${E(x.id)}" title="${E(x.title)}"><div class="th"><img loading="lazy" src="${E(th)}" data-vid="${E(x.id)}">${x.live ? '<span class="rlive">● ライブ</span>' : ''}${x.len ? `<span class="tm">${E(x.len)}</span>` : ''}<button class="rlater" title="再生リスト「TubeFolio2 後で見る」に追加">🕒</button></div>
      <div class="inf">${x.avatar ? `<img class="av" loading="lazy" src="${E(x.avatar)}">` : '<span class="av"></span>'}<div class="tx"><b>${E(x.title)}</b><small>${E(x.ch)}</small>${meta ? `<small>${E(meta)}</small>` : ''}</div><button class="vdots rdots" title="メニュー">⋮</button></div></a>`;
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
  // ---- フォルダでの絞り込み: 上のバーの「フォルダ」で選んだフォルダ(設定 plFolder。サブフォルダ含む)のチャンネルだけを、登録チャンネルの結果に出す ----
  let fold = 'all', foldNames = null;
  const loadFold = async () => {
    const S = await TF.get(); fold = S.settings.plFolder || 'all'; foldNames = null;
    if (fold !== 'all') {
      const sub = TF.subtree(S.groups, fold), names = new Set();
      Object.values(S.channels).forEach(c => { const filed = c.groups.some(id => S.groups.some(g => g.id === id)); if (fold === 'none' ? !filed : c.groups.some(id => sub.has(id))) names.add(TF.clean(c.name)); });
      foldNames = names; foldName = fold === 'none' ? '未分類' : ((S.groups.find(g => g.id === fold) || {}).name || '');
    }
  };
  let foldName = '';
  const folderOk = x => !foldNames || foldNames.has(TF.clean(x.ch || ''));
  const foldNote = () => { const n = document.getElementById('rfold'); if (!n) return; n.innerHTML = fold === 'all' ? '' : `📁 ${E(foldName)} のチャンネルだけを表示中(登録チャンネル) ・ <a href="#" id="rfx">解除</a>`; const c = document.getElementById('rclear'), i = document.getElementById('rq'); if (c && i) c.hidden = !(i.value.trim() || fold !== 'all'); }; // ✕ クリアの表示も合わせる
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#rfx')) { e.preventDefault(); TF.mutate(s => { s.settings.plFolder = 'all'; }); } });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.settings && ((ch.settings.newValue || {}).plFolder || 'all') !== fold) loadFold().then(() => { foldNote(); if (scope === 'reg' && regItems.length) { drawReg(); st.textContent = visibleCount() + '件(直近' + DAYS + '日)'; if (!visibleCount()) note('このフォルダのチャンネルに、新着がありません'); } }); });
  const visibleCount = () => regItems.filter(folderOk).length;
  // 取得の途中に何度も呼ばれるので、全部を作り直さない: すでに出ているカードはそのまま残し、増えた分だけを正しい位置に差し込む(作り直すと、サムネが読み込み直しになって、ちかちかする)
  function drawReg() { // 日付ごとの見出し(押すと折りたたみ)
    const days = new Map(); regItems.filter(folderOk).forEach(x => { const k = dkey(new Date(x.published)); if (!days.has(k)) days.set(k, []); days.get(k).push(x); });
    [...box.children].forEach(c => { if (!c.matches('section.day')) c.remove(); }); // 「見つかりませんでした」などの案内を消す
    const tpl = document.createElement('template'), mk = h => { tpl.innerHTML = h; return tpl.content.firstElementChild; };
    const secs = new Map([...box.children].map(s => [s.dataset.k, s])); let prevS = null;
    days.forEach((arr, k) => {
      let s = secs.get('rec-' + k); secs.delete('rec-' + k);
      if (!s) { const d = new Date(arr[0].published); s = mk(`<section class="day" data-k="rec-${k}"><div class="dh"><span class="fd">▾</span><h2>${ymd(d)}${dkey(new Date()) === k ? ' ・今日' : ''}</h2><span class="cnt"></span></div><div class="grid${kind === 's' ? ' shorts' : ''}"></div></section>`); }
      const at = prevS ? prevS.nextElementSibling : box.firstElementChild; if (at !== s) box.insertBefore(s, at); prevS = s;
      const cnt = s.querySelector('.cnt'), ct = arr.length + '件'; if (cnt.textContent !== ct) cnt.textContent = ct;
      const grid = s.querySelector('.grid'), have = new Map([...grid.children].map(c => [c.dataset.v, c])); let prev = null;
      arr.forEach(x => { let c = have.get(x.id); have.delete(x.id); if (!c) c = mk(cardOf(x)); const w = prev ? prev.nextElementSibling : grid.firstElementChild; if (w !== c) grid.insertBefore(c, w); prev = c; });
      have.forEach(c => c.remove());
    });
    secs.forEach(s => s.remove());
    shown = regItems.length; foldNote();
  }
  // ---- 📈 急上昇(検索2の種類): 日本の急上昇(1日ごと。データ: youtube-trending.info。background.js の trendDay)。日付を1日ずつさかのぼれる。
  //   キーワード(スペース=すべて含む / | =どれかを含む)とカテゴリで絞り込む。カードは、ほかの結果と同じ(🕒・⋮ が使える)。順位と、前の日からの上がり下がりを、サムネに出す
  const tYmd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tToday = () => tYmd(new Date()), tAdd = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return tYmd(d); };
  const tLabel = s => { const d = new Date(s + 'T00:00:00'); return `${d.getMonth() + 1}月${d.getDate()}日(${'日月火水木金土'[d.getDay()]})`; };
  let tDate = tToday(), tVids = null, tFor = '', tShown = 60, tCat = '', tTried = false;
  const trCard = v => cardOf({ id: v.id, title: v.title, ch: v.ch, chId: v.chId || '', len: v.len, views: v.views ? v.views + ' 回視聴' : '', when: typeof trdAgo === 'function' ? trdAgo(v.pub) : '', kind: 'v' })
    .replace('<a class="card rc"', `<a class="card rc${v.rank <= 3 ? ' rtop' : ''}"`).replace('<div class="th">', `<div class="th"><span class="tr-rk">${+v.rank || ''}</span>${typeof trdChg === 'function' ? trdChg(v.chg) : ''}`);
  const paintTNav = () => { const i = $('#rt-date'); if (!i) return; i.max = tToday(); i.value = tDate; $('#rt-next').disabled = tDate >= tToday(); };
  const tCats = () => { const sel = $('#rt-cat'), cs = [...new Set((tVids || []).map(v => v.cat).filter(Boolean))].sort(); if (tCat && !cs.includes(tCat)) tCat = ''; sel.innerHTML = '<option value="">すべて</option>' + cs.map(c => `<option value="${E(c)}"${c === tCat ? ' selected' : ''}>${E(c)}</option>`).join(''); };
  function drawTrend() {
    paintTNav();
    const all = tVids || [], ors = q.toLowerCase().split('|').map(s => s.split(/\s+/).filter(Boolean)).filter(w => w.length);
    const hit = all.filter(v => (!tCat || v.cat === tCat) && (!ors.length || ors.some(w => w.every(k => (v.title + ' ' + v.ch).toLowerCase().includes(k)))));
    st.textContent = `${tLabel(tFor || tDate)} ・ ${hit.length} / ${all.length}本`;
    const mb = $('#rmore');
    if (!hit.length) { mb.hidden = true; return note(all.length ? '該当する動画がありません' : 'この日の急上昇がありません'); }
    box.innerHTML = '<div class="grid">' + hit.slice(0, tShown).map(trCard).join('') + '</div>'; shown = Math.min(hit.length, tShown);
    mb.hidden = hit.length <= tShown; if (!mb.hidden) mb.textContent = `もっと見る(残り ${hit.length - tShown}本)`;
  }
  async function runTrend(more, my) {
    if (more) { tShown += 60; return drawTrend(); }
    tShown = 60; paintTNav();
    if (tVids && tFor === tDate) return drawTrend(); // 同じ日: 絞り込みだけ(取り直さない)
    st.textContent = '取得中…'; note('読み込み中…');
    const d = tDate, r = await send({ type: 'trendDay', date: d });
    if (my !== gen) return;
    if (!r || r.error) {
      if (d === tToday() && !tTried) { tTried = true; tDate = tAdd(d, -1); return runTrend(false, my); } // 今日の分が、まだ無いときは、昨日
      tVids = null; tFor = ''; st.textContent = ''; paintTNav(); return note(`${(r && r.error) || '読み込めませんでした'}(${tLabel(d)})`);
    }
    tVids = r.videos || []; tFor = d; tCats(); drawTrend();
  }
  async function run(more) {
    if (more && busy) return; const my = ++gen; busy = 1; const moreBtn = $('#rmore');
    q = $('#rq').value.trim(); lset('tfRecQ', q);
    if (!more) { box.innerHTML = ''; shown = 0; seen = new Set(); token = null; regItems = []; moreBtn.hidden = true; moreBtn.textContent = 'もっと見る'; }
    if (T && kind === 't') { try { await runTrend(more, my); } finally { if (my === gen) busy = 0; } return; } // 📈 急上昇(検索2)
    await loadReg();
    try {
      if (scope === 'reg') {
        st.textContent = '取得中…';
        // キーワード: スペース区切りは「すべて含む」、「|」区切りは「どれかを含む」(YouTubeの検索と同じ。例: a b | c = 「aとb」か「c」)
        const ors = q.toLowerCase().split('|').map(s => s.split(/\s+/).filter(Boolean)).filter(w => w.length);
        const hit = x => { const s = (x.title + ' ' + x.ch).toLowerCase(); return !ors.length || ors.some(w => w.every(k => s.includes(k))); };
        const apply = items => { // 取れた分から順に描く(全チャンネルの取得を待たない)
          regItems = items.filter(hit).sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
          regItems.forEach(x => { x.when = x.published ? '投稿 ' + hm(new Date(x.published)) : ''; x.kind = kind; x.chId = ''; });
          if (regItems.length) drawReg();
        };
        // 集めている途中は、並べない(取れた分を毎回並べ直すと、新しい動画が上に割り込んでカードがずれ続け、押せなかった)。進み具合だけを出し、そろってから一度に並べる
        const prog = (done, total, n) => { const t = total ? `取得中… ${done} / ${total} チャンネル ・ ${n}件(そろったら、まとめて表示します)` : '取得中…'; st.textContent = total ? `取得中… ${done}/${total}チャンネル` : '取得中…'; if (!box.querySelector('section.day')) { let e = box.querySelector('.rprog'); if (!e) { box.innerHTML = '<div class="empty rprog"><span></span><i><b></b></i></div>'; e = box.querySelector('.rprog'); } e.firstChild.textContent = t; e.querySelector('b').style.width = (total ? Math.round(done / total * 100) : 0) + '%'; } };
        prog(0, 0, 0);
        const poll = setInterval(async () => {
          const p = await send({ type: 'feedStatus', kind }); if (my !== gen || !p || !p.running) return;
          prog(p.done, p.total, (p.items || []).length);
        }, 400);
        let r; try {
          // まず「今日の分」だけを先に出す(新しいキャッシュがあれば、それがそのまま全期間の結果)。そのあと、直近DAYS日ぶんを取って、並べ直す
          if (!more) { const q1 = await send({ type: 'feedAll', days: DAYS, kind, quick: true }); if (my !== gen) return; if (q1 && !q1.error && !q1.quick) r = q1; else if (q1 && !q1.error && (q1.items || []).length) { apply(q1.items); st.textContent = visibleCount() + '件(今日の分・続きを取得中…)'; } }
          if (!r) r = await send({ type: 'feedAll', days: DAYS, kind });
        } finally { clearInterval(poll); }
        if (my !== gen) return;
        if (!r || r.error) { st.textContent = ''; return note('取得できませんでした' + (r && r.error ? '(' + r.error + ')' : '')); }
        apply(r.items || []);
        if (!regItems.length) { st.textContent = '0件'; return note(q ? '見つかりませんでした' : `直近${DAYS}日の新着がありません`); }
        st.textContent = visibleCount() + '件(直近' + DAYS + '日)'; if (!visibleCount()) return note('このフォルダのチャンネルに、新着がありません');
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
  { const se = $('#rsent'); if (se && 'IntersectionObserver' in window) new IntersectionObserver(es => { if (es.some(x => x.isIntersecting) && !busy && ((T && kind === 't') ? !$('#rmore').hidden : (token && scope !== 'reg'))) run(true); }, { rootMargin: '600px' }).observe(se); }
  $('#rreset').addEventListener('click', async () => { // クリア: キーワードを空・対象 = すべて・種類 = 動画に戻して、探し直す
    $('#rq').value = ''; lset('tfRecQ', ''); scope = 'all'; kind = 'v'; lset('tfRecScope', scope); lset(KK, kind);
    $('#rs').innerHTML = seg(SCOPES, scope, 's'); $('#rk').innerHTML = seg(KINDS, kind, 'k'); if (typeof syncMode === 'function') syncMode();
    if (fold !== 'all') { await TF.mutate(s => { s.settings.plFolder = 'all'; }); fold = 'all'; foldNames = null; foldNote(); }
    updClear(); run(false);
  });
  $('#rf').addEventListener('submit', e => { e.preventDefault(); run(false); });
  // 🎲 ランダムタグ: 溜まったタグ(playedTags)から、回数の多いものほど選ばれやすく選んで、キーワードに入れて探す
  //   いくつ選ぶか(1〜5)は px.randN(Drive同期)。2つ以上は、別々のタグを選んで「a | b | c」(どれかを含む)でまとめて探す
  let randN = 1;
  const drawRandN = () => { $('#rrn').innerHTML = `<select id="rrsel" title="選ぶタグの数(マウスのホイールでも変えられます)">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === randN ? ' selected' : ''}>${n}個</option>`).join('')}</select>`; };
  chrome.storage.local.get('px').then(r => { randN = Math.min(5, Math.max(1, +((r.px || {}).randN) || 1)); drawRandN(); });
  drawRandN();
  const saveRandN = async () => { const { px = {} } = await chrome.storage.local.get('px'); await chrome.storage.local.set({ px: { ...px, randN }, prefsAt: Date.now() }); };
  $('#rrn').addEventListener('change', e => { if (e.target.id !== 'rrsel') return; randN = Math.min(5, Math.max(1, +e.target.value || 1)); saveRandN(); });
  $('#rrn').addEventListener('wheel', e => { e.preventDefault(); randN = Math.min(5, Math.max(1, randN + (e.deltaY > 0 ? 1 : -1))); drawRandN(); saveRandN(); }, { passive: false }); // ホイールで数を変える
  $('#rrand').addEventListener('click', async () => {
    const { playedTags = {} } = await chrome.storage.local.get('playedTags');
    const list = Object.values(playedTags).filter(e => e && e.t && !e.x && !e.ng);
    if (!list.length) { st.textContent = 'ランダム用のタグがありません(設定 → 整理・通知 → ランダムタグ で追加できます)'; return; }
    const picks = [];
    for (let k = 0; k < randN && list.length; k++) { // 選んだタグは候補から外して、同じタグが重ならないようにする
      const w = list.map(e => Math.sqrt(Math.max(1, e.n || 1))), sum = w.reduce((a, b) => a + b, 0);
      let r = Math.random() * sum, i = 0;
      for (; i < list.length - 1; i++) { r -= w[i]; if (r <= 0) break; }
      picks.push(list.splice(i, 1)[0].t);
    }
    $('#rq').value = picks.join(' | '); updClear();
    if (scope !== 'all') { scope = 'all'; lset('tfRecScope', scope); $('#rs').innerHTML = seg(SCOPES, scope, 's'); } // 対象を「すべて」にして探す
    run(false);
  });
  // ✕ クリア: キーワードを消して、フォルダの絞り込みを「すべて」に戻して、探し直す。消すものがあるときだけ出す
  const updClear = () => { const c = $('#rclear'); if (c) c.hidden = !($('#rq').value.trim() || fold !== 'all'); };
  $('#rq').addEventListener('input', updClear);
  $('#rclear').addEventListener('click', async () => {
    $('#rq').value = ''; lset('tfRecQ', '');
    if (fold !== 'all') { await TF.mutate(s => { s.settings.plFolder = 'all'; }); fold = 'all'; foldNames = null; foldNote(); }
    updClear(); $('#rq').focus(); run(false);
  });
  updClear();
  // 急上昇ワードを押したとき(YouTube側の trends.js から): クリアしてから(キーワード・フォルダ)、キーワードに入れて探す
  window.addEventListener('message', async e => {
    if (e.source !== window.parent || !e.data || typeof e.data.tfTerm !== 'string') return;
    if (fold !== 'all') { await TF.mutate(s => { s.settings.plFolder = 'all'; }); fold = 'all'; foldNames = null; foldNote(); }
    $('#rq').value = e.data.tfTerm; updClear(); run(false);
  });
  $('#rmore').addEventListener('click', () => run(true));
  $('#rs').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (!b) return; scope = b.dataset.s; lset('tfRecScope', scope); $('#rs').innerHTML = seg(SCOPES, scope, 's'); run(false); });
  const PH = $('#rq').placeholder;
  const syncMode = () => { if (!T) return; const tm = kind === 't'; $('#rsg').classList.toggle('off', tm); $('#rtnav').hidden = !tm; $('#rpanel').classList.toggle('tmode', tm); $('#rq').placeholder = tm ? '急上昇の中から絞り込み(タイトル・チャンネル。スペース=すべて含む / | =どれかを含む。空欄=全部)' : PH; };
  $('#rk').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; lset(KK, kind); $('#rk').innerHTML = seg(KINDS, kind, 'k'); syncMode(); run(false); });
  syncMode();
  if (T) { // 急上昇の日付・カテゴリ
    const go = d => { tDate = d > tToday() ? tToday() : d; run(false); };
    $('#rt-prev').addEventListener('click', () => go(tAdd(tFor || tDate, -1)));
    $('#rt-next').addEventListener('click', () => { const b = tFor || tDate; if (b < tToday()) go(tAdd(b, 1)); });
    $('#rt-now').addEventListener('click', () => { tTried = false; go(tToday()); });
    $('#rt-date').addEventListener('change', e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) go(e.target.value); });
    $('#rt-cat').addEventListener('change', e => { tCat = e.target.value; tShown = 60; drawTrend(); });
  }

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
    if (lb) { // 🕒: 「TubeFolio2 後で見る」へ登録。登録済み(✓)のときは、外す。印の付け替えは、page.js が、背景の控え(plLaterIds)の変更を見て行う
      if (lb.dataset.busy) return; lb.dataset.busy = '1'; const inl = card.classList.contains('inlater'); lb.textContent = '…';
      try {
        if (inl) { const c = (await chrome.storage.local.get('plLaterIds')).plLaterIds, r = c && c.id ? await send({ type: 'plRemove', listId: c.id, videoId: vid }) : { error: '再生リストを確認中です' }; r && r.ok ? toast('「TubeFolio2 後で見る」から外しました') : toast('外せませんでした: ' + ((r && r.error) || '不明なエラー'), 6000); }
        else await add(vid, null);
      } finally { delete lb.dataset.busy; lb.textContent = card.classList.contains('inlater') ? '✓' : '🕒'; }
      return;
    }
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

  Promise.all([loadReg(), loadFold(), chrome.storage.local.get('recOpen')]).then(([, , ro]) => {
    const o = ro && ro.recOpen; // ホームでフォルダを押して開いたとき: 登録チャンネル・動画に切り替えて、キーワードは空にする
    if (o) { scope = o.scope || 'reg'; kind = o.kind || 'v'; q = ''; lset('tfRecScope', scope); lset(KK, kind); lset('tfRecQ', ''); const rq = $('#rq'); if (rq) rq.value = ''; updClear(); $('#rs').innerHTML = seg(SCOPES, scope, 's'); $('#rk').innerHTML = seg(KINDS, kind, 'k'); chrome.storage.local.remove('recOpen'); }
    foldNote(); if (o || scope === 'reg' || q || (T && kind === 't')) run(false); else note('キーワードを入れて、検索してください'); });
}
