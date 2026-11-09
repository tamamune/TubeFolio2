// ツールバーの各ボタンから開くページ。
// エラーが起きたときは、真っ白にならず、画面に内容を出す(原因調べ用)
window.addEventListener('error', e => { const m = document.querySelector('main'); if (m) m.insertAdjacentHTML('beforeend', `<p class="empty" style="color:#e5322d">エラー: ${String(e.message).replace(/</g, '&lt;')}(${(e.filename || '').split('/').pop()}:${e.lineno})</p>`); });
//   p=new    新着動画(登録チャンネルの動画。ショート・ライブを除く)
//   p=live   ライブ・配信
//   p=shorts ショート
//   それ以外は、まだ中身のない空のページ。
// 一覧は4日分を、日付(年月日)ごとに分けて表示し、日付ごとに「新しい順 / 古い順」を切り替えられる。
const qp = new URLSearchParams(location.search);
const P = qp.get('p') || '', TITLE = qp.get('t') || 'ページ';
document.title = TITLE + ' - TubeFolio2';
const $ = s => document.querySelector(s);
const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KIND = { new: 'v', live: 'l', shorts: 's' };
const DAYS = 4;
const main = $('main');

if (P === 'later') { viewPage(); // 視聴: 再生リスト
} else if (!KIND[P]) { // まだ中身のないページ
  main.innerHTML = `<h1>${esc(TITLE)}</h1><p class="empty">このページは、まだ中身がありません。</p>`;
} else {
  const kind = KIND[P];
  const sortKey = 'tfPageSort_' + P;
  let data = null, timer = 0;

  main.innerHTML = `<div class="head"><h1>${esc(TITLE)}</h1><span class="sub">登録チャンネルの新着(直近${DAYS}日)</span><span class="sp"></span><span id="st"></span></div><div id="list"></div>`;

  const ymd = d => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${'日月火水木金土'[d.getDay()]})`;
  const dkey = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const url = it => it.kind === 's' ? `https://www.youtube.com/shorts/${it.id}` : `https://www.youtube.com/watch?v=${it.id}`;

  // 一覧は、全部を作り直さず、新しく取れた分だけを、新しい順の正しい位置に差し込む(取得中に何度も更新しても重くならない)
  const els = new Map(); let built = false;
  const foldKey = 'tfPageFold_' + P; let fold = {}; try { fold = JSON.parse(localStorage.getItem(foldKey) || '{}'); } catch (e) { /* 無視 */ }
  function build() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: DAYS }, (_, i) => new Date(today.getTime() - i * 86400000));
    $('#list').innerHTML = (kind === 'l' ? '<section class="day livenow" data-k="live" hidden><div class="dh"><span class="fd">▾</span><h2>🔴 ライブ中</h2><span class="cnt"></span></div><div class="grid"></div></section>' : '') + days.map((d, i) =>
      `<section class="day${fold[dkey(d)] ? ' fold' : ''}" data-k="${dkey(d)}"><div class="dh"><span class="fd">▾</span><h2>${ymd(d)}${i === 0 ? ' ・今日' : i === 1 ? ' ・昨日' : ''}</h2><span class="cnt"></span></div><div class="grid ${kind === 's' ? 'shorts' : ''}"></div><p class="none">この日の新着はありません。</p></section>`).join('');
    built = true; els.clear();
  }
  function draw() {
    if (!data) { $('#list').innerHTML = '<p class="empty">読み込み中…</p>'; built = false; return; }
    if (!built) build();
    const want = new Map(); // 場所:ID → 動画
    (data.items || []).filter(x => x.kind === kind).forEach(x => { const sec = (kind === 'l' && x.live) ? 'live' : dkey(new Date(x.published)); if ($(`#list section[data-k="${sec}"]`)) want.set(sec + ':' + x.id, { x, sec }); });
    els.forEach((el, k) => { if (!want.has(k)) { el.remove(); els.delete(k); } }); // 取れなくなったもの(配信が終わった等)は消す
    const tpl = document.createElement('template');
    [...want].filter(([k]) => !els.has(k)).sort((a, b) => b[1].x.published.localeCompare(a[1].x.published)).forEach(([k, { x, sec }]) => {
      tpl.innerHTML = card(x); const el = tpl.content.firstElementChild; el.dataset.pub = x.published;
      const grid = $(`#list section[data-k="${sec}"] .grid`);
      const after = [...grid.children].find(c => c.dataset.pub < x.published); // 新しい順: 自分より古い最初の動画の前に入れる
      grid.insertBefore(el, after || null); els.set(k, el);
    });
    document.querySelectorAll('#list section.day').forEach(s => {
      const n = s.querySelectorAll('.grid > .card').length; s.querySelector('.cnt').textContent = n ? n + '件' : '';
      const none = s.querySelector('.none'); if (none) none.hidden = n > 0; if (s.dataset.k === 'live') s.hidden = !n;
    });
  }
  function card(x) {
    const t = new Date(x.published), th = `https://i.ytimg.com/vi/${x.id}/${x.kind === 's' ? 'oardefault' : 'mqdefault'}.jpg`;
    return `<a class="card" href="${url(x)}" target="_top" title="${esc(x.title)}"><div class="th"><img loading="lazy" src="${th}" onerror="this.src='https://i.ytimg.com/vi/${x.id}/mqdefault.jpg'"><span class="tm">${hm(t)}</span></div>
      <div class="inf">${x.avatar ? `<img class="av" loading="lazy" src="${esc(x.avatar)}">` : '<span class="av"></span>'}<div class="tx"><b>${esc(x.title)}</b><small>${esc(x.ch)}</small></div></div></a>`;
  }


  function status() {
    chrome.runtime.sendMessage({ type: 'feedStatus', kind }, r => {
      const st = $('#st'); if (!st) return;
      if (r && r.running) { st.textContent = `${r.phase} ${r.done}/${r.total}(取得できた分から表示)`; if (r.items && r.items.length) { data = { items: r.items, t: 0 }; draw(); } timer = setTimeout(status, 600); } else st.textContent = data && data.t ? `更新: ${new Date(data.t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}` : '';
    });
  }
  function load(force) {
    clearTimeout(timer); status();
    chrome.runtime.sendMessage({ type: 'feedAll', days: DAYS, force: !!force, kind }, r => {
      clearTimeout(timer);
      if (!r || r.error) { $('#st').textContent = '取得に失敗しました' + (r && r.error ? `(${r.error})` : ''); return; }
      data = r; draw(); status();
    });
  }
  // 列の個数: 上のバーの「▦ 列数」の設定に合わせる(動画・ライブ配信は「動画の列数」、ショートは「ショート棚の列数」。標準のときは、画面の幅に合わせて自動)
  const applyCols = () => chrome.storage.local.get('settings').then(r => {
    const g = (r.settings || {}).thumb || {}, n = kind === 's' ? (g.scols ? (g.sN || 6) : 0) : (g.cols ? (g.colsN || 5) : 0);
    if (n) document.documentElement.style.setProperty('--pg-cols', `repeat(${n}, minmax(0, 1fr))`); else document.documentElement.style.removeProperty('--pg-cols');
  }).catch(() => {});
  applyCols(); chrome.storage.onChanged.addListener(ch => { if (ch.settings) applyCols(); });
  draw();
  // 前回の結果があれば、すぐに表示する(古くても先に見せて、裏で最新に更新する)
  try { chrome.storage.local.get('feedCache_' + kind).then(r => { const fc = r['feedCache_' + kind]; if (fc && fc.items && !data) { data = fc; draw(); const st = $('#st'); if (st && !st.textContent) st.textContent = '前回の結果を表示中(更新しています)'; } }); } catch (e) { /* 無視 */ }
  load(false);
}
// ページの中をクリックしたことを、YouTube側(親)へ知らせる(親で開いているメニューを閉じるため)
document.addEventListener('mousedown', () => { try { parent.postMessage({ tfClick: 1 }, '*'); } catch (e) { /* 無視 */ } }, true);
// 日付の見出しを押すと、その日の一覧を折りたたむ / 開く(状態は覚えておく)
document.addEventListener('click', e => {
  const h = e.target.closest('.day .dh'); if (!h) return;
  const s = h.closest('.day'), k = s.dataset.k, P2 = new URLSearchParams(location.search).get('p') || '';
  const on = s.classList.toggle('fold'); let fold = {}; try { fold = JSON.parse(localStorage.getItem('tfPageFold_' + P2) || '{}'); } catch (e2) { /* 無視 */ }
  if (on) fold[k] = 1; else delete fold[k];
  try { localStorage.setItem('tfPageFold_' + P2, JSON.stringify(fold)); } catch (e2) { /* 無視 */ }
});

// ---------- 視聴: 再生リスト。「ライブラリに保存」した再生リスト(ミックスリストなど)は「ライブラリ」ひとつにまとめ、中はサムネのカードで並べる。
// 自分の再生リスト(後で見る・高く評価した動画を含む)は、細い行で1つずつ。行・カードは、ドラッグで順番を変えられる(順番は設定 plOrder に保存 = Drive同期の対象)。 ----------
function viewPage() {
  main.innerHTML = `<div class="head"><h1>${esc(TITLE)}</h1><span class="sub">再生リスト(ドラッグで順番を変えられます)</span><span class="sp"></span><span id="st"></span></div><div id="pls"><p class="empty">読み込み中…</p></div>`;
  const loaded = new Set();
  const vcard = (x, listId) => `<a class="card" href="https://www.youtube.com/watch?v=${esc(x.id)}${listId && !['WL', 'LL'].includes(listId) ? '&list=' + esc(listId) : ''}" target="_top" title="${esc(x.title)}"><div class="th"><img loading="lazy" src="${esc(x.thumb || 'https://i.ytimg.com/vi/' + x.id + '/mqdefault.jpg')}">${x.len ? `<span class="tm">${esc(x.len)}</span>` : ''}</div><div class="inf"><span class="av"></span><div class="tx"><b>${esc(x.title)}</b><small>${esc(x.ch)}</small></div></div></a>`;
  // ---- 再生リストの見出し: 本数・合計時間・残り時間、空き時間にぴったり収まる組み合わせの連続再生、就寝時間まで、連続再生、ランダム再生(元のTubeFolioの「後で見る」と同じ) ----
  const cache = new Map(), sums = new Map(); let freeMin = 45, sleepFrom = '23:00';
  // 本数・合計時間・残り時間は、一覧の上(行の見出し / ライブラリ内の見出し)に出す
  const showSum = (into, id) => { const h = into.closest('.libvid') ? into.closest('.libvid').querySelector('h3') : into.closest('.pl') && into.closest('.pl').querySelector(':scope > .plh'); if (!h) return; let s = h.querySelector('small.sm'); if (!s) { s = document.createElement('small'); s.className = 'sm'; h.appendChild(s); } s.textContent = sums.get(id) || ''; const old = h.querySelector('small:not(.sm)'); if (old) old.remove(); };
  const secOf = t => { const p = String(t || '').split(':').map(Number); return p.length && !p.some(isNaN) ? p.reduce((a, x) => a * 60 + x, 0) : 0; };
  const hmt = sec => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60); return h ? `${h}時間${m ? m + '分' : ''}` : `${m}分`; };
  const saveSet = (k, v) => chrome.storage.local.get('settings').then(r => { const s = r.settings || {}; s[k] = v; return chrome.storage.local.set({ settings: s }); });
  const vids = (items, id, title) => {
    items = items || []; cache.set(id, items);
    const known = items.filter(x => secOf(x.len)), unk = items.length - known.length;
    const total = known.reduce((a, x) => a + secOf(x.len), 0), rest = known.reduce((a, x) => a + secOf(x.len) * (1 - Math.min(100, x.pct || 0) / 100), 0);
    const sum = `${items.length}本` + (known.length ? ` ・ 合計 ${hmt(total)}(残り ${hmt(rest)})` : '') + (unk ? ` ・ 長さ不明 ${unk}本` : '') + ' ・ 追加した順';
    sums.set(id, sum);
    return `<div class="pltools" data-id="${esc(id)}">
      <div class="plctl"><span>⏱ 空き時間</span><input class="fmin" type="text" inputmode="numeric" value="${freeMin}分" title="分を入力します(Enterで、ぴったり再生)"><button data-a="fit" class="b1">▶ ぴったり再生</button><button data-a="bed" class="b2">🌙 就寝時間まで</button><span class="fmsg"></span><span class="sp"></span><button data-a="all" class="b3">▶ 連続再生</button><button data-a="rnd" class="b4">🔀 ランダム再生</button></div></div>`
      + (items.length ? `<div class="grid">${items.map(x => vcard(x, id)).join('')}</div>` : '<p class="none">動画がありません。</p>');
  };
  // 入れた時間に収まり、いちばん長く見られる組み合わせ(未視聴を優先)
  const pickFit = (list, limit) => {
    const U = 10, W = Math.floor(limit / U), cand = list.filter(x => { const d = secOf(x.len); return d > 0 && d <= limit && (x.pct || 0) < 90; });
    const best = new Array(W + 1).fill(-1); best[0] = 0; const from = new Array(W + 1).fill(null);
    cand.forEach((x, i) => { const w = Math.ceil(secOf(x.len) / U); for (let c = W; c >= w; c--) if (best[c - w] >= 0 && best[c - w] + w > best[c]) { best[c] = best[c - w] + w; from[c] = { i, chain: from[c - w] }; } });
    let c = W; while (c > 0 && best[c] < 0) c--;
    const out = []; for (let f = from[c]; f; f = f.chain) out.push(cand[f.i]);
    return out.sort((a, b) => cand.indexOf(a) - cand.indexOf(b));
  };
  const playIds = list => window.open('https://www.youtube.com/watch_videos?video_ids=' + list.slice(0, 50).map(x => x.id).join(','), '_top'); // 一時的な連続再生リスト(最大50本)
  const minToBed = () => { const [h, m] = sleepFrom.split(':').map(Number), d = new Date(), now = d.getHours() * 60 + d.getMinutes(), a = (h || 0) * 60 + (m || 0); return (a - now + 1440) % 1440; };
  const load = (id, into, title) => { // 再生リストの動画を、into に読み込む(一度だけ)
    if (loaded.has(id)) return; loaded.add(id); into.innerHTML = '<p class="none">読み込み中…</p>';
    chrome.runtime.sendMessage({ type: 'plVideos', ids: [id] }, r => {
      if (!r || r.error) { into.innerHTML = `<p class="none">取得できませんでした${r && r.error ? `(${esc(r.error)})` : ''}</p>`; loaded.delete(id); return; }
      into.innerHTML = vids(r.items, id, title); showSum(into, id);
    });
  };
  const saveOrder = key => ids => chrome.storage.local.get('settings').then(r => { const s = r.settings || {}; s.plOrder = { ...(s.plOrder || {}), [key]: ids }; return chrome.storage.local.set({ settings: s }); });
  // ドラッグで並べ替え(container の直下の itemSel を入れ替える)
  function sortable(container, itemSel, horizontal, onSave) {
    let drag = null;
    container.addEventListener('dragstart', e => { if (container.id === 'pls' && e.target.closest && e.target.closest('.plc')) return; const it = e.target.closest ? e.target.closest(itemSel) : null; if (!it || it.parentElement !== container) return; drag = it; it.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', it.dataset.id || ''); } catch (e2) { /* 無視 */ } });
    container.addEventListener('dragover', e => {
      if (!drag) return; const over = e.target.closest(itemSel); e.preventDefault();
      if (!over || over === drag || over.parentElement !== container) return;
      const r = over.getBoundingClientRect(), after = horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
      container.insertBefore(drag, after ? over.nextSibling : over);
    });
    container.addEventListener('dragend', () => { if (!drag) return; drag.classList.remove('dragging'); drag = null; onSave([...container.children].filter(c => c.matches(itemSel)).map(c => c.dataset.id)); });
  }
  Promise.all([new Promise(res => chrome.runtime.sendMessage({ type: 'plLists' }, res)), chrome.storage.local.get('settings')]).then(([r, st]) => {
    const box = $('#pls'), ord = (st.settings || {}).plOrder || {}; freeMin = (st.settings || {}).freeMin || 45; sleepFrom = (st.settings || {}).sleepFrom || '23:00';
    if (!r || r.error) { box.innerHTML = `<p class="empty">再生リストを取得できませんでした${r && r.error ? `(${esc(r.error)})` : ''}。YouTubeにログインしているか、確認してください。</p>`; return; }
    const byOrd = (arr, key) => { const o = ord[key] || []; return arr.map((x, i) => [x, i]).sort((a, b) => { const ia = o.indexOf(a[0].id), ib = o.indexOf(b[0].id); return (ia < 0 ? 1e6 + a[1] : ia) - (ib < 0 ? 1e6 + b[1] : ib); }).map(x => x[0]); };
    const all = r.lists || [];
    // 自分の再生リスト = 作成者が「いちばん多い名前」のもの(ミックスリスト RD… は、常にライブラリ側)。それ以外は、ライブラリに保存したもの
    const cnt = new Map(); all.forEach(x => { if (x.owner && !/^RD/.test(x.id)) cnt.set(x.owner, (cnt.get(x.owner) || 0) + 1); });
    const me = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
    const isMine = x => ['WL', 'LL'].includes(x.id) || (!/^RD/.test(x.id) && (!x.owner || (me && x.owner === me[0])));
    const mine = byOrd(all.filter(isMine), 'mine'), saved = byOrd(all.filter(x => !isMine(x)), 'lib');
    const card = x => `<div class="plc" draggable="true" data-id="${esc(x.id)}">${x.thumb ? `<img class="plt" loading="lazy" draggable="false" src="${esc(x.thumb)}">` : '<span class="plt ph">📚</span>'}<b>${esc(x.title || '(無題)')}</b><small>${esc([x.owner, x.count].filter(Boolean).join(' ・ '))}</small></div>`;
    const libRow = `<section class="pl lib open" draggable="true" data-id="library"><div class="plh"><span class="fd">▾</span><b>ライブラリ</b><small>保存した再生リスト ${saved.length}件</small></div><div class="plb">${saved.length ? `<div class="libgrid">${saved.map(card).join('')}</div><div class="libvid" hidden></div>` : '<p class="none">ライブラリに保存した再生リストは、ありません。</p>'}</div></section>`
    const rowOf = x => `<section class="pl" draggable="true" data-id="${esc(x.id)}"><div class="plh"><span class="fd">▾</span><b>${esc(x.title || '(無題)')}</b>${x.count ? `<small>${esc(x.count)}</small>` : ''}</div><div class="plb" hidden></div></section>`;
    box.innerHTML = byOrd([{ id: 'library' }, ...mine], 'mine').map(x => x.id === 'library' ? libRow : rowOf(x)).join(''); // ライブラリも、ほかの再生リストと同じように、上下に動かせる
    $('#st').textContent = `再生リスト ${mine.length}件 ・ ライブラリ ${saved.length}件`;
    sortable(box, '.pl', false, saveOrder('mine'));
    const lg = box.querySelector('.libgrid'); if (lg) sortable(lg, '.plc', true, saveOrder('lib'));
  });
  $('#pls').addEventListener('click', e => {
    const tb = e.target.closest('.pltools button[data-a]'); // 見出しの操作(ぴったり再生・就寝時間まで・連続再生・ランダム再生)
    if (tb) {
      const box = tb.closest('.pltools'), id = box.dataset.id, list = cache.get(id) || [], msg = box.querySelector('.fmsg'), inp = box.querySelector('.fmin'), a = tb.dataset.a;
      const fit = (min, label) => { const pick = pickFit(list, min * 60); if (!pick.length) { msg.textContent = '収まる動画がありません(長さが分かる未視聴の動画が対象)'; return; } msg.textContent = `${label}: ${pick.length}本(${hmt(pick.reduce((s, x) => s + secOf(x.len), 0))})を再生します`; playIds(pick); };
      if (a === 'fit') { freeMin = Math.max(5, Math.min(600, parseInt(String(inp.value).replace(/[^\d]/g, ''), 10) || 45)); inp.value = freeMin + '分'; saveSet('freeMin', freeMin); fit(freeMin, `空き時間 ${freeMin}分`); }
      else if (a === 'bed') { const m = minToBed(); if (m < 5) { msg.textContent = `もう就寝時間(${sleepFrom}〜)です。おやすみなさい🌙`; return; } fit(m, `就寝時間(${sleepFrom})まで ${hmt(m * 60)}`); }
      else { let l = list.filter(x => (x.pct || 0) < 90); if (!l.length) l = list.slice(); if (!l.length) { msg.textContent = '再生できる動画がありません'; return; } if (a === 'rnd') l = l.slice().sort(() => Math.random() - 0.5); playIds(l); }
      return;
    }
    if (e.target.closest('.pltools')) return; // 入力欄などを押しても、開閉しない
    const c = e.target.closest('.plc'); // ライブラリの中の再生リスト: 押すと、下に動画を出す(同じカードをもう一度押すと閉じる)
    if (c) { const lv = $('#pls .libvid'), same = lv.dataset.id === c.dataset.id && !lv.hidden; document.querySelectorAll('#pls .plc.act').forEach(x => x.classList.remove('act')); if (same) { lv.hidden = true; return; } lv.dataset.id = c.dataset.id; lv.hidden = false; c.classList.add('act'); lv.innerHTML = `<h3>${esc(c.querySelector('b').textContent)}</h3><div class="libv"></div>`; loaded.delete(c.dataset.id); load(c.dataset.id, lv.querySelector('.libv'), c.querySelector('b').textContent); return; }
    const h = e.target.closest('.plh'); if (!h) return;
    const s = h.closest('.pl'), b = s.querySelector(':scope > .plb');
    if (s.classList.contains('lib')) { b.hidden = !b.hidden; s.classList.toggle('open', !b.hidden); return; } // ライブラリ: 開閉だけ
    const open = b.hidden; b.hidden = !open; s.classList.toggle('open', open);
    if (open) load(s.dataset.id, b, h.querySelector('b').textContent);
  });
}
// 空き時間の入力欄: Enterで「ぴったり再生」
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('.fmin')) e.target.closest('.pltools').querySelector('[data-a="fit"]').click(); });
