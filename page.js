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
const main = $('main');

// 枠は、サムネの大きさ・位置が変わったとき(日付の折りたたみ・画面幅・画像の読み込み)に、必ず測り直す
function placeMk(cd, th) { const mk = cd.querySelector(':scope > .mkc'); if (!mk || !th.offsetWidth) return; mk.style.top = (th.offsetTop + th.offsetHeight + 4 - 64) + 'px'; mk.style.left = (th.offsetLeft + th.offsetWidth + 4 - 64) + 'px'; }
const thRO = new ResizeObserver(es => es.forEach(e => { const cd = e.target.closest('.card'); if (cd) placeMk(cd, e.target); }));
const watchTh = th => { if (!th._tfRo) { th._tfRo = true; thRO.observe(th); } };
// ---------- 動画一覧の目印(ホームの「新D」と同じ): サムネの右下の角の外側に、青(登録)/赤(未登録)のL字の線。必ず表示する。視聴ページは、viewPage 内で同じものを出す ----------
{
  const nrm = t => String(t || '').normalize('NFKC').trim().toLowerCase();
  let names = new Set(), ids = new Set(), ready = false;
  const load = () => Promise.all([TF.get(), chrome.storage.local.get('meta')]).then(([S, m]) => {
    names = new Set(Object.values(S.channels).map(c => nrm(TF.clean(c.name))).filter(Boolean)); ids = new Set();
    Object.entries(S.channels).forEach(([k, c]) => { if (/^UC/.test(k)) ids.add(k); const mm = (m.meta || {})[k]; if (mm && mm.id) ids.add(mm.id); });
    ready = true; markAll();
  }).catch(() => {});
  const isReg = cd => cd.dataset.reg === '1' || (cd.dataset.chid && ids.has(cd.dataset.chid)) || names.has(nrm(cd.dataset.ch));
  function markAll() {
    document.querySelectorAll('.card[data-ch]').forEach(cd => {
      if (cd.closest('#pls')) return;
      const th = cd.querySelector('.th'); if (!th) return;
      let mk = cd.querySelector(':scope > .mkc'); if (!mk) { mk = document.createElement('span'); mk.className = 'mkc'; cd.appendChild(mk); }
      mk.style.borderColor = ready && !isReg(cd) ? '#e5322d' : '#1a73e8';
      placeMk(cd, th); watchTh(th);
    });
  }
  let t = 0; const sched = () => { clearTimeout(t); t = setTimeout(markAll, 60); };
  new MutationObserver(sched).observe(main, { childList: true, subtree: true });
  window.addEventListener('resize', sched); document.addEventListener('load', sched, true); document.addEventListener('click', () => setTimeout(sched, 120), true);
  chrome.storage.onChanged.addListener((ch, a) => { if (a === 'local' && (ch.channels || ch.groups || ch.meta)) load(); });
  load();
}

// 列の個数: 上のバーの「▦ 列数」の設定に合わせる(動画の一覧は「動画の列数」、ショートの一覧は「ショート棚の列数」。標準のときは、画面の幅に合わせて自動)。
// どのページ(新着・ライブ・ショート・視聴・検索・ブックマーク)でも効く。以前は、新着・ライブ・ショートのページだけだった
const applyCols = () => chrome.storage.local.get('settings').then(r => {
  const g = (r.settings || {}).thumb || {}, st = document.documentElement.style;
  const put = (name, n) => { if (n) st.setProperty(name, `repeat(${n}, minmax(0, 1fr))`); else st.removeProperty(name); };
  put('--pg-cols', g.cols ? (g.colsN || 5) : 0); put('--pg-scols', g.scols ? (g.sN || 6) : 0);
}).catch(() => {});
applyCols(); chrome.storage.onChanged.addListener((ch, a) => { if (a === 'local' && ch.settings) applyCols(); });

// どこまで見たかの印(設定「再生済みの動画のサムネを薄くする」dimPlayed。既定オン)。ホームと同じように、サムネの下に赤い線(見た割合)を出す。
//   視聴済み(8割以上見た動画) = サムネを薄くして、左上に「✓ 視聴済み」。途中まで見た動画 = 薄くせず、左上に「途中 ◯%」。少し再生しただけでは、視聴済みにしない。
//   見た割合 = YouTube 側の見た割合(再生リストの一覧の data-pct)と、この拡張機能の視聴履歴(hist。見た時間 ÷ 長さ)の、大きい方
{
  let info = new Map(), dimOn = true, hideW = false, pt = 0, later = new Set();
  const loadLater = () => chrome.storage.local.get('plLaterIds').then(r => { const c = r.plLaterIds; later = new Set((c && c.ids) || []); markPlayed(); if (!c || Date.now() - (c.t || 0) > 600e3) chrome.runtime.sendMessage({ type: 'plLaterSync' }, () => void chrome.runtime.lastError); }).catch(() => {});
  const idOf = cd => { const h = cd.getAttribute('href') || (cd.querySelector('a[href]') || { getAttribute: () => '' }).getAttribute('href') || '', m = h.match(/[?&]v=([\w-]{11})/) || h.match(/\/shorts\/([\w-]{11})/); return m ? m[1] : ''; };
  const secOfT = t => { const p = String(t || '').trim().split(':').map(Number); return p.length > 1 && !p.some(isNaN) ? p.reduce((a, x) => a * 60 + x, 0) : 0; };
  const markPlayed = () => { document.querySelectorAll('.card').forEach(cd => {
    const id = idOf(cd), e = id ? info.get(id) : null, th = cd.querySelector('.th'), short = !!cd.closest('.grid.shorts');
    let pct = +cd.dataset.pct || 0;
    if (e) { const len = secOfT((cd.querySelector('.tm') || {}).textContent), h = TF.pctOf(e, len); pct = Math.max(pct, TF.isPlayed(e, len) ? Math.max(h, TF.PLAYED_PCT) : Math.max(h, 0)); }
    pct = Math.round(Math.min(100, pct));
    const done8 = pct >= TF.PLAYED_PCT, hid = hideW && P === 'rec' && done8 && !!cd.closest('#rres'); // 検索の結果は、「視聴済みを隠す」(🙈)のとき、8割以上見た動画を隠す
    if (cd.classList.contains('hidw') !== hid) cd.classList.toggle('hidw', hid);
    const on = dimOn && done8, part = dimOn && !on && pct >= 1 && !short;
    if (cd.classList.contains('played') !== on) cd.classList.toggle('played', on);
    if (cd.classList.contains('part') !== part) cd.classList.toggle('part', part);
    if (th) {
      const t = part ? `途中 ${pct}%` : on && !short ? `✓ 視聴済み ${pct}%` : ''; if ((th.dataset.pt || '') !== t) { if (t) th.dataset.pt = t; else delete th.dataset.pt; }
      let pb = th.querySelector(':scope > .pbar'); const want = dimOn && pct >= 1 && !short;
      if (!want) { if (pb) pb.remove(); } else { if (!pb) { pb = document.createElement('span'); pb.className = 'pbar'; pb.appendChild(document.createElement('i')); th.appendChild(pb); } const w = pct + '%'; if (pb.firstChild.style.width !== w) pb.firstChild.style.width = w; }
    }
    // 「TubeFolio2 後で見る」に登録済みの動画: 印を出す(視聴ページは、再生リストそのものの一覧なので出さない)。検索ページの 🕒 ボタンは「✓ 登録済み」にする(ボタンは、いつも出している)
    const inl = P !== 'later' && later.has(idOf(cd)); if (cd.classList.contains('inlater') !== inl) cd.classList.toggle('inlater', inl);
    const lb = cd.querySelector('.rlater'); if (lb && !lb.dataset.busy) { const t = inl ? '✓ 登録済み' : '🕒'; if (lb.textContent !== t) { lb.textContent = t; lb.title = inl ? '「TubeFolio2 後で見る」に登録済み(押すと外す)' : '再生リスト「TubeFolio2 後で見る」に追加'; } }
  });
    document.querySelectorAll('#rres section.day').forEach(sc => { const none = !sc.querySelector('.card:not(.hidw)'); if (sc.hidden !== none) sc.hidden = none; }); // 全部隠れた日は、見出しごと隠す
  };
  const loadPlayed = () => chrome.storage.local.get(['hist', 'settings']).then(r => { info = TF.playedInfo(r.hist); hideW = !!(r.settings || {}).hideWatched; dimOn = (r.settings || {}).dimPlayed !== false; markPlayed(); }).catch(() => {});
  new MutationObserver(() => { clearTimeout(pt); pt = setTimeout(markPlayed, 150); }).observe(main, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((ch, a) => { if (a !== 'local') return; if (ch.hist || ch.settings) loadPlayed(); if (ch.plLaterIds) { later = new Set(((ch.plLaterIds.newValue || {}).ids) || []); markPlayed(); } });
  loadPlayed(); loadLater();
}

if (P === 'later') { viewPage(); // 視聴: 再生リスト
} else if (P === 'rec' || P === 'rec2') { recPage({ trend: true }); // 検索(急上昇の種類つき。旧「検索2」を統合)
} else if (P === 'bm') { bmPage(); // ブックマーク
} else if (P === 'hist') { histPage(); // 視聴履歴(histpage.js)
} else if (P === 'trdapi') { trdApiPage(); // 急上昇動画(YouTube Data API・実験。trdpage.js)
} else if (P === 'trd') { trdPage(); // 急上昇動画(日付別・実験。trdpage.js)
} else if (P === 'rec2') { rec2Page(); // 検索2: 検索 + 急上昇(日付をさかのぼる)のタブ(trdpage.js)
} else if (P === 'histd') { histDash(); // 視聴履歴ダッシュボード(試作。histdash.js)
} else { // まだ中身のないページ
  main.innerHTML = `<h1>${esc(TITLE)}</h1><p class="empty">このページは、まだ中身がありません。</p>`;
}
// 一覧のチャンネル名(とチャンネルのアイコン)を押したら、動画ではなく、そのチャンネルのページを開く(カード全体が動画へのリンクなので、先に受け取って止める)。
//   行き先: カードに付けたチャンネルID / @ハンドル → 登録チャンネル(名前で照らし合わせる) → どれも分からないときは、YouTube でチャンネル名を探す
{
  const nrm = t => String(t || '').normalize('NFKC').trim().toLowerCase();
  let byName = new Map(), ids = {}, chans = {}, grps = [];
  const load = () => Promise.all([TF.get(), chrome.storage.local.get('meta')]).then(([S, m]) => { chans = S.channels || {}; grps = S.groups || []; byName = new Map(); Object.values(S.channels).forEach(c => { const n = nrm(TF.clean(c.name)); if (n) byName.set(n, c.key); }); ids = Object.fromEntries(Object.entries(m.meta || {}).map(([k, v]) => [k, v && v.id])); }).then(() => { mark(); document.querySelectorAll('.card[data-ch]').forEach(cd => markFold(cd)); }).catch(() => {});
  load(); chrome.storage.onChanged.addListener((ch, a) => { if (a === 'local' && (ch.channels || ch.groups)) load(); });
  const urlOfKey = k => 'https://www.youtube.com/' + (/^UC[\w-]{22}$/.test(k) ? 'channel/' + k : k.startsWith('@') ? k : '@' + k);
  const chUrl = cd => {
    const name = (cd.dataset.ch || '').trim(), key = cd.dataset.chkey || byName.get(nrm(name)) || '';
    if (/^UC[\w-]{22}$/.test(cd.dataset.chid || '')) return 'https://www.youtube.com/channel/' + cd.dataset.chid;
    if (key) return ids[key] ? 'https://www.youtube.com/channel/' + ids[key] : urlOfKey(key);
    return name ? 'https://www.youtube.com/results?search_query=' + encodeURIComponent(name) + '&sp=EgIQAg%3D%3D' : ''; // sp = 「チャンネル」だけを探す
  };
  const chEl = e => { const t = e.target.closest ? e.target.closest('.card[data-ch] .tx > small:not(.dt), .card[data-ch] .inf > .av') : null; if (!t || (t.matches('small') && t !== t.parentElement.querySelector('small'))) return null; return t; }; // 名前の行(最初の small)と、アイコンだけ
  document.addEventListener('click', e => {
    const t = chEl(e); if (!t || e.target.closest('button')) return;
    const u = chUrl(t.closest('.card')); if (!u) return;
    e.preventDefault(); e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.shiftKey) window.open(u, '_blank'); else window.open(u, '_top');
  }, true);
  document.addEventListener('auxclick', e => { if (e.button !== 1) return; const t = chEl(e), u = t && chUrl(t.closest('.card')); if (u) { e.preventDefault(); e.stopPropagation(); window.open(u, '_blank'); } }, true); // 中ボタン: 別のタブで
  const mark = () => document.querySelectorAll('.card[data-ch]').forEach(cd => { if (!(cd.dataset.ch || '').trim()) return; const sm = cd.querySelector('.tx > small:not(.dt)'), av = cd.querySelector('.inf > .av'); [sm, av].forEach(x => { if (x && !x.classList.contains('chl')) { x.classList.add('chl'); x.title = 'チャンネルのページを開く: ' + cd.dataset.ch; } }); });
  // フォルダ設定で登録したフォルダの名前を、チャンネル名の下に出す(フォルダの色の点 + 名前。複数のフォルダに入っているチャンネルは、全部)
  const idKey = id => { if (!id) return ''; if (chans[id]) return id; const k = Object.keys(ids).find(x => ids[x] === id); return k && chans[k] ? k : ''; };
  const foldersOf = cd => {
    const key = (cd.dataset.chkey && chans[cd.dataset.chkey] ? cd.dataset.chkey : '') || idKey(cd.dataset.chid) || byName.get(nrm(TF.clean(cd.dataset.ch || ''))) || byName.get(nrm(cd.dataset.ch)) || '';
    const c = key && chans[key]; return c ? (c.groups || []).map(id => grps.find(g => g.id === id)).filter(Boolean) : [];
  };
  const markFold = cd => {
    const tx = cd.querySelector('.tx'); if (!tx) return;
    const gs = foldersOf(cd); let fc = tx.querySelector(':scope > .fch');
    if (!gs.length) { if (fc) fc.remove(); return; }
    const sig = gs.map(g => g.id + '\u0001' + g.name + '\u0001' + g.color).join('\u0002');
    if (!fc) { fc = document.createElement('span'); fc.className = 'fch'; const sm = tx.querySelector(':scope > small:not(.dt)'); if (sm) sm.after(fc); else tx.appendChild(fc); }
    if (fc.dataset.s === sig) return;
    fc.dataset.s = sig; fc.textContent = '';
    gs.forEach(g => { const i = document.createElement('i'); i.textContent = g.name; i.title = 'フォルダ: ' + g.name; if (/^#[0-9a-f]{3,8}$/i.test(g.color || '')) i.style.setProperty('--c', g.color); fc.appendChild(i); });
  };
  const mark0 = mark, markAllFold = () => document.querySelectorAll('.card[data-ch]').forEach(markFold);
  let t = 0; new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { mark0(); markAllFold(); }, 200); }).observe(main, { childList: true, subtree: true }); mark0(); markAllFold();
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
  main.innerHTML = `<div class="head vhead"><h1 title="再生リスト(ドラッグで順番を変えられます)">${esc(TITLE)}</h1><span id="st"></span><span id="plf" class="sub"></span><button type="button" id="vai" class="vreel" title="AIが探しているような演出のあと、たくさんのおすすめを、回せる球の形で出します(試作)">✨ おすすめ動画</button><form id="vf" class="rform"><span class="rqw"><input id="vq" type="search" placeholder="キーワード(タイトル・チャンネル。スペース=すべて含む / | =どれかを含む)" autocomplete="off"><button type="button" id="vclear" class="rclear" title="クリア(キーワードを消して、フォルダを「すべて」に戻す)" hidden>✕</button></span><button class="rgo" type="submit">検索</button><span id="vkn" class="sub"></span></form></div>
    <div id="pls"><p class="empty">読み込み中…</p></div>`;
  const loaded = new Set();
  // ---- 「🎵 音楽🎵」(急上昇の音楽を自動で入れる再生リスト。background.js の musicAuto)のカードに 📌 取り置き:
  //   印を付けた動画は、30日たっても自動では外さない(autoMusic.keep。Drive同期の対象)。もう一度押すと外す
  $('#vai').addEventListener('click', () => { if (typeof openAiPick === 'function') openAiPick(); }); // ✨ おすすめ動画(試作。aipick.js)
  let am = {};
  const markKeep = () => {
    const id = am.listId;
    document.querySelectorAll('#pls .card').forEach(cd => {
      const th = cd.querySelector('.th'); if (!th) return;
      const href = cd.getAttribute('href') || '', v = (href.match(/[?&]v=([\w-]{11})/) || [])[1]; let b = th.querySelector('.vkeep');
      if (!id || !v || !href.includes('list=' + id)) { if (b) b.remove(); return; }
      if (!b) { b = document.createElement('button'); b.type = 'button'; b.className = 'vkeep'; b.textContent = '📌'; th.appendChild(b); }
      const k = !!(am.keep || {})[v]; if (b.dataset.vid !== v) b.dataset.vid = v; if (b.classList.contains('on') !== k) b.classList.toggle('on', k);
      const tt = k ? '取り置き中(30日たっても、自動では外しません。押すと解除)' : '📌 取り置き(30日たっても、自動では外さない)'; if (b.title !== tt) b.title = tt;
    });
  };
  // ---- 「🎵 音楽🎵」を開いたとき、自動追加のツール(状態・オン/オフ・今すぐ実行・取り置き一覧・削除した動画の一覧)を、リストの上に出す。×(削除)・📌(取り置き)は、下のカードのまま ----
  let amPx = {};
  const amOpen = { keep: false, rm: false };
  const amHtml = () => {
    const a = { on: true, ...am }, l = a.last, kp = Object.entries(a.keep || {}), rm = Object.entries(a.removed || {}), px = amPx || {};
    const gap = +px.amGapH || 3, kd = px.amKeepD !== undefined ? +px.amKeepD : 30, bd = px.amBlockD !== undefined ? +px.amBlockD : 10;
    const when = l ? new Date(l.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const th = (id, t, act, label) => `<span class="am-i"><a href="https://www.youtube.com/watch?v=${id}" target="_top" title="${esc(id)}"><img loading="lazy" src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt=""></a><small>${esc(new Date(t).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }))}</small><button type="button" data-am="${act}" data-vid="${id}">${label}</button></span>`;
    return `<div class="am-row"><b>🎵 急上昇の音楽の自動追加</b><span class="am-st ${a.on ? 'on' : ''}">${a.on ? 'オン' : 'オフ'}</span><button type="button" data-am="tog">${a.on ? 'オフにする' : 'オンにする'}</button><button type="button" data-am="run">今すぐ実行</button><span class="am-sub">${gap}時間ごと ・ ${kd ? kd + '日で外す' : '自動では外さない'} ・ ${bd ? '削除した動画は' + bd + '日入れない' : '削除した動画も入れ直す'}(設定: TubeFolio2 設定 → その他)</span></div>`
      + `<div class="am-row"><span class="am-sub">${l ? `最後 ${esc(when)} ・ +${l.add}本 / 外した ${l.del}本 ・ 全${l.total}本` : 'まだ実行していません'}</span></div>`
      + `<details class="am-d"${amOpen.keep ? ' open' : ''} data-d="keep"><summary>📌 取り置き ${kp.length}本(期限がきても外しません)</summary><div class="am-g">${kp.map(([id, t]) => th(id, t, 'unkeep', '解除')).join('') || '<span class="am-sub">なし(下のカードの 📌 で取り置きできます)</span>'}</div></details>`
      + `<details class="am-d"${amOpen.rm ? ' open' : ''} data-d="rm"><summary>🗑 削除して入れない ${rm.length}本${bd ? '(' + bd + '日)' : ''}</summary><div class="am-g">${rm.sort((x, y) => y[1] - x[1]).map(([id, t]) => th(id, t, 'unblock', '戻す')).join('') || '<span class="am-sub">なし(下のカードの × で削除すると、ここへ入ります)</span>'}</div></details>`;
  };
  const markTool = () => {
    const sec = am.listId ? document.querySelector(`#pls .pl[data-id="${CSS.escape(am.listId)}"]`) : null;
    document.querySelectorAll('#pls .amtool').forEach(x => { if (!sec || x.parentNode !== sec) x.remove(); });
    if (!sec) return;
    let t = sec.querySelector(':scope > .amtool'); if (!t) { t = document.createElement('div'); t.className = 'amtool'; sec.insertBefore(t, sec.querySelector(':scope > .plb')); }
    const h = amHtml(); if (t._h !== h) { t._h = h; t.innerHTML = h; }
  };
  chrome.storage.local.get(['autoMusic', 'px']).then(r => { am = r.autoMusic || {}; amPx = r.px || {}; markKeep(); markTool(); }).catch(() => {});
  chrome.storage.onChanged.addListener((ch, a) => { if (a === 'local' && (ch.autoMusic || ch.px)) { if (ch.autoMusic) am = ch.autoMusic.newValue || {}; if (ch.px) amPx = ch.px.newValue || {}; markKeep(); markTool(); } });
  $('#pls').addEventListener('toggle', e => { const d = e.target.closest && e.target.closest('.am-d'); if (d) amOpen[d.dataset.d] = d.open; }, true);
  $('#pls').addEventListener('click', async e => {
    const b = e.target.closest && e.target.closest('.amtool [data-am]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const k = b.dataset.am, { autoMusic: a = {} } = await chrome.storage.local.get('autoMusic');
    if (k === 'tog') return void chrome.storage.local.set({ autoMusic: { ...a, on: a.on === false } });
    if (k === 'unkeep') { const keep = { ...(a.keep || {}) }; delete keep[b.dataset.vid]; return void chrome.storage.local.set({ autoMusic: { ...a, keep } }); }
    if (k === 'unblock') { const removed = { ...(a.removed || {}) }; delete removed[b.dataset.vid]; return void chrome.storage.local.set({ autoMusic: { ...a, removed } }); }
    if (k === 'run') { b.disabled = true; b.textContent = '実行中…'; chrome.runtime.sendMessage({ type: 'musicAuto' }, r => { void chrome.runtime.lastError; b.disabled = false; b.textContent = '今すぐ実行'; }); }
  }, true);
  { let kt = 0; new MutationObserver(() => { clearTimeout(kt); kt = setTimeout(() => { markKeep(); markTool(); }, 200); }).observe($('#pls'), { childList: true, subtree: true }); }
  document.addEventListener('click', async e => {
    const b = e.target.closest && e.target.closest('.vkeep'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const v = b.dataset.vid, { autoMusic: a = {} } = await chrome.storage.local.get('autoMusic'), keep = { ...(a.keep || {}) };
    if (keep[v]) delete keep[v]; else keep[v] = Date.now();
    b.classList.toggle('on', !!keep[v]); // 先に見た目を変える
    await chrome.storage.local.set({ autoMusic: { ...a, keep } });
  }, true);
  // ---- 登録チャンネルの目印: サムネに色の線(フォルダ登録=フォルダの色 / 登録のみ=青 / 未登録=赤)。チャンネルは、表示名で照らし合わせる ----
  const nrm = t => String(t || '').normalize('NFKC').trim().toLowerCase();
  let chIdx = new Map(), grpMap = {};
  // 目印(ホームの「新D」と同じ): サムネの右下の角の外側に、青(登録)/赤(未登録)のL字の線。サムネとの隙間4px、角は同心円、線の長さ64px
  const markAll = () => document.querySelectorAll('#pls .card[data-ch]').forEach(cd => {
    const th = cd.querySelector('.th'); if (!th) return;
    let mk = cd.querySelector(':scope > .mkc');
    if (!chIdx.size) { if (mk) mk.remove(); return; }
    const c = chIdx.get(nrm(cd.dataset.ch));
    if (!mk) { mk = document.createElement('span'); mk.className = 'mkc'; cd.appendChild(mk); }
    mk.style.borderColor = c ? '#1a73e8' : '#e5322d';
    placeMk(cd, th); watchTh(th);
  });
  window.addEventListener('resize', () => markAll());
  // ---- フォルダでの絞り込み: 上のバーの「フォルダ」でフォルダを選ぶと(設定 plFolder)、そのフォルダ(サブフォルダ含む)に登録したチャンネルの動画だけを表示する ----
  let plFolder = 'all', curS = null;
  const folderOk = ch => {
    if (plFolder === 'all' || !curS) return true;
    const c = chIdx.get(nrm(ch)), filed = c && c.groups.some(id => curS.groups.some(g => g.id === id));
    if (plFolder === 'none') return !filed;
    const sub = TF.subtree(curS.groups, plFolder); return !!c && c.groups.some(id => sub.has(id));
  };
  // ---- キーワードで探す: 「検索」を押すと、すべての再生リストを開いて(読み込んで)、タイトル・チャンネルが合う動画だけを出す ----
  //   スペース区切り = すべて含む、「|」区切り = どれかを含む(検索ページと同じ)。合う動画が無い再生リストは隠す。✕ で元に戻す
  let kwOrs = []; const kwOpened = new Set();
  const kwOk = cd => { if (!kwOrs.length) return true; const s = ((cd.getAttribute('title') || '') + ' ' + (cd.dataset.ch || '')).toLowerCase(); return kwOrs.some(w => w.every(k => s.includes(k))); };
  const applyFolder = () => {
    document.querySelectorAll('#pls .card[data-ch]').forEach(cd => { cd.style.display = folderOk(cd.dataset.ch) && kwOk(cd) ? '' : 'none'; });
    { // キーワードで探している間: 合う動画が無い再生リストを隠し、見つかった本数を出す
      let n = 0;
      document.querySelectorAll('#pls .pl').forEach(s => {
        const cards = [...s.querySelectorAll('.card[data-ch]')], hit = cards.filter(cd => cd.style.display !== 'none').length; n += hit;
        const loading = !!s.querySelector('.plb .none') && !cards.length && /読み込み中/.test(s.querySelector('.plb .none').textContent);
        s.hidden = !!kwOrs.length && !hit && !loading;
      });
      const kn = $('#vkn'); if (kn) kn.textContent = kwOrs.length ? `${n}本 見つかりました` : '';
      const vc = $('#vclear'), vi = $('#vq'); if (vc && vi) vc.hidden = !(vi.value.trim() || plFolder !== 'all'); // ✕ はクリアするものがあるときだけ
    }
    const note = $('#plf'); if (!note) return;
    const g = curS && curS.groups.find(x => x.id === plFolder);
    note.innerHTML = plFolder === 'all' || !curS ? '' : `📁 ${plFolder === 'none' ? '未分類' : esc(g ? g.name : '')} のチャンネルだけを表示中 ・ <a href="#" id="plfx">解除</a>`;
  };
  chrome.storage.local.get('settings').then(r => { plFolder = (r.settings || {}).plFolder || 'all'; applyFolder(); });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.sleepWin && !ch.settings) chrome.storage.local.get('settings').then(r => { const s = r.settings || {}, sw = ch.sleepWin.newValue || {}; sleepFrom = s.sleepFrom || sw.from || sleepFrom; sleepTo = s.sleepTo || sw.to || sleepTo; });
    if (ch.settings) { const ns = ch.settings.newValue || {}; if ((ns.plFolder || 'all') !== plFolder) { plFolder = ns.plFolder || 'all'; applyFolder(); } if (ns.sleepFrom) sleepFrom = ns.sleepFrom; if (ns.sleepTo) sleepTo = ns.sleepTo; if (ch.sleepWin) { const sw = ch.sleepWin.newValue || {}; if (!ns.sleepFrom && sw.from) sleepFrom = sw.from; if (!ns.sleepTo && sw.to) sleepTo = sw.to; } if (ns.plSort) plSort = ns.plSort; }
    if (ch.groups || ch.channels) TF.get().then(S => { curS = S; grpMap = Object.fromEntries(S.groups.map(g => [g.id, g])); chIdx = new Map(); Object.values(S.channels).forEach(c => { const n = nrm(TF.clean(c.name)); if (n) chIdx.set(n, c); }); markAll(); applyFolder(); });
  });
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#plfx')) { e.preventDefault(); chrome.storage.local.get('settings').then(r => { const s = r.settings || {}; s.plFolder = 'all'; return chrome.storage.local.set({ settings: s }); }); } });
  const updVClear = () => { const c = $('#vclear'); if (c) c.hidden = !($('#vq').value.trim() || plFolder !== 'all'); };
  const openForKw = () => { // 閉じている再生リストを開いて読み込む(キーワードで探すため)。あとで ✕ で閉じ直す
    document.querySelectorAll('#pls .pl:not(.lib)').forEach(s => {
      const b = s.querySelector(':scope > .plb'); if (!b || !b.hidden) return;
      b.hidden = false; s.classList.add('open'); kwOpened.add(s.dataset.id); load(s.dataset.id, b, (s.querySelector(':scope > .plh b') || {}).textContent || '');
    });
  };
  const runKw = () => {
    const q = $('#vq').value.trim().toLowerCase();
    kwOrs = q.split('|').map(s => s.split(/\s+/).filter(Boolean)).filter(w => w.length);
    if (kwOrs.length) openForKw(); else closeKw();
    applyFolder(); updVClear();
  };
  const closeKw = () => { // 検索で開いた再生リストを閉じ直す
    kwOpened.forEach(id => { const s = document.querySelector(`#pls .pl[data-id="${CSS.escape(id)}"]`); if (!s) return; const b = s.querySelector(':scope > .plb'); if (b) b.hidden = true; s.classList.remove('open'); });
    kwOpened.clear(); document.querySelectorAll('#pls .pl').forEach(s => { s.hidden = false; });
  };
  $('#vf').addEventListener('submit', e => { e.preventDefault(); runKw(); });
  $('#vq').addEventListener('input', () => { updVClear(); if (!$('#vq').value.trim() && kwOrs.length) runKw(); }); // 消したら元に戻す
  $('#vq').addEventListener('keydown', e => { if (e.key === 'Enter' && e.isComposing) e.preventDefault(); }); // 日本語の変換の確定では探さない
  $('#vclear').addEventListener('click', () => {
    $('#vq').value = ''; kwOrs = []; closeKw();
    if (plFolder !== 'all') { plFolder = 'all'; chrome.storage.local.get('settings').then(r => { const s = r.settings || {}; s.plFolder = 'all'; return chrome.storage.local.set({ settings: s }); }); }
    applyFolder(); updVClear(); $('#vq').focus();
  });
  // 急上昇ワードを押したとき(YouTube側の trends.js から): キーワードに入れて探す
  window.addEventListener('message', e => { if (e.source !== window.parent || !e.data || typeof e.data.tfTerm !== 'string') return; $('#vq').value = e.data.tfTerm; runKw(); });
  TF.get().then(S => { grpMap = Object.fromEntries(S.groups.map(g => [g.id, g])); chIdx = new Map(); Object.values(S.channels).forEach(c => { const n = nrm(TF.clean(c.name)); if (n) chIdx.set(n, c); }); markAll(); curS = S; applyFolder(); }).catch(() => {});
  { let mt = 0; new MutationObserver(() => { clearTimeout(mt); mt = setTimeout(() => { markAll(); applyFolder(); }, 80); }).observe($('#pls'), { childList: true, subtree: true }); }
  let destLists = [];
  const vtb = (x, listId) => destLists.some(l => l.id === listId) ? `<span class="vtb" data-from="${esc(listId)}" data-v="${esc(x.id)}" data-set="${esc(x.setId || '')}"><button class="vdots" title="メニュー">⋮</button></span>` : '';
  // チャンネルのアイコン: 再生リストの動画には、アイコンの情報が付かないので、登録チャンネルの情報(channels / meta)から、ID・@ハンドル・名前で引く
  const avMap = new Map(), ownIds = new Set(); // ownIds: 自分の再生リストのID(動画を削除できるリスト)
  chrome.storage.local.get(['channels', 'meta']).then(r => {
    const ch = r.channels || {}, meta = r.meta || {};
    Object.entries(ch).forEach(([k, c]) => {
      const a = (c && c.avatar) || (meta[k] && meta[k].avatar); if (!a) return;
      avMap.set(k.toLowerCase(), a); if (meta[k] && meta[k].id) avMap.set(meta[k].id, a); if (/^UC/.test(k)) avMap.set(k, a);
      if (c && c.name) avMap.set('n:' + String(c.name).toLowerCase(), a);
    });
  }).catch(() => {});
  const avatarHtml = x => { const a = x.avatar || avMap.get(x.handle) || avMap.get(x.chId) || avMap.get('n:' + String(x.ch || '').toLowerCase()); return a ? `<img class="av" loading="lazy" src="${esc(a)}">` : `<span class="av"${x.chId ? ` data-chid="${esc(x.chId)}"` : ''}></span>`; };
  // 登録チャンネルにないチャンネルのアイコンは、背景側で取ってきて、あとから差し替える(1度に3件まで)
  const avQ = new Set(); let avBusy = 0;
  function pumpAv() {
    while (avBusy < 3 && avQ.size) {
      const id = avQ.values().next().value; avQ.delete(id); avBusy++;
      chrome.runtime.sendMessage({ type: 'chAvatar', id }, r => {
        avBusy--; void chrome.runtime.lastError;
        if (r && r.url) { avMap.set(id, r.url); document.querySelectorAll(`span.av[data-chid="${CSS.escape(id)}"]`).forEach(e => { const im = document.createElement('img'); im.className = 'av'; im.loading = 'lazy'; im.src = r.url; e.replaceWith(im); }); }
        pumpAv();
      });
    }
  }
  const fillAvatars = root => { [...root.querySelectorAll('span.av[data-chid]')].forEach(e => { const id = e.dataset.chid; if (avMap.has(id)) { const im = document.createElement('img'); im.className = 'av'; im.loading = 'lazy'; im.src = avMap.get(id); e.replaceWith(im); } else avQ.add(id); }); pumpAv(); };
  // サムネの左下の「×」: この再生リストから削除(自分の再生リストだけ。高く評価した動画は除く)
  const delBtn = (x, listId) => (listId && listId !== 'LL' && ownIds.has(listId)) ? `<button type="button" class="vdel" data-vid="${esc(x.id)}" data-set="${esc(x.setId || '')}" data-list="${esc(listId)}" title="この再生リストから削除">×</button>` : '';
  // ---- 登録日(再生リストに入れた日): YouTube は教えてくれないので、この拡張機能が「初めてそのリストで見つけた日」を覚える(plSeen。Drive同期の対象)。
  //   初めて開いたリストに元からあった動画は、日が分からないので出さない(0)。それ以後に増えた動画と、TubeFolio2 のボタンで追加した動画に、日が付く
  let plSeen = {}; const ymdNum = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const noteSeen = (listId, items) => {
    if (!listId || !items) return; const cur = plSeen[listId], today = ymdNum(new Date()), next = {}; let ch = !cur;
    items.forEach(x => { if (cur && x.id in cur) next[x.id] = cur[x.id]; else { next[x.id] = cur ? today : 0; ch = true; } });
    if (cur && Object.keys(cur).length !== Object.keys(next).length) ch = true; // リストから消えた動画の分は捨てる
    if (!ch) return; plSeen = { ...plSeen, [listId]: next };
    chrome.storage.local.get('plSeen').then(r => chrome.storage.local.set({ plSeen: { ...(r.plSeen || {}), [listId]: next } })).catch(() => {});
  };
  const fmtNum = n => `${Math.floor(n / 10000)}/${Math.floor(n / 100) % 100}/${n % 100}`;
  const dateLine = (x, listId) => { const a = (plSeen[listId] || {})[x.id], parts = []; if (a) parts.push('登録 ' + fmtNum(a)); if (x.pub) { const d = new Date(x.pub); parts.push(`投稿 ${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}頃`); } return parts.length ? `<small class="dt">${esc(parts.join(' ・ '))}</small>` : ''; };
  const vcard = (x, listId) => `<a class="card" data-pct="${Math.round(x.pct || 0)}" data-ch="${esc(x.ch)}"${x.chId ? ` data-chid="${esc(x.chId)}"` : ''}${x.handle ? ` data-chkey="${esc(x.handle)}"` : ''} href="https://www.youtube.com/watch?v=${esc(x.id)}${listId && !['WL', 'LL', 'resume'].includes(listId) ? '&list=' + esc(listId) : ''}${listId === 'resume' && x.pos > 5 ? '&t=' + Math.max(0, x.pos - 3) + 's' : ''}" target="_top" title="${esc(x.title)}"><div class="th"><img loading="lazy" src="${esc(x.thumb || 'https://i.ytimg.com/vi/' + x.id + '/mqdefault.jpg')}">${x.len ? `<span class="tm">${esc(x.len)}</span>` : ''}${delBtn(x, listId)}</div><div class="inf">${avatarHtml(x)}<div class="tx"><b>${esc(x.title)}</b><small>${esc(x.ch)}</small>${dateLine(x, listId)}</div>${vtb(x, listId)}</div></a>`;
  // ---- 再生リストの見出し: 本数・合計時間・残り時間、空き時間にぴったり収まる組み合わせの連続再生、就寝時間まで、連続再生、ランダム再生(元のTubeFolioの「後で見る」と同じ) ----
  const cache = new Map(), sums = new Map(); let freeMin = 45, sleepFrom = '23:00', sleepTo = '06:00', plSort = {}; // plSort: 再生リストごとの並び(add 追加順 / new 新しい順 / old 古い順)。設定 plSort。Drive同期の対象
  // 本数・合計時間・残り時間は、一覧の上(行の見出し / ライブラリ内の見出し)に出す
  // 本数・合計時間は、前回の表示を覚えておき、開いた直後から出す。取り直した結果が同じなら何も書き換えない(表示が順にパラパラ変わらないように)
  const sumCache = (() => { try { return JSON.parse(localStorage.getItem('tfPlSums') || '{}'); } catch (e) { return {}; } })();
  const putSum = (h, id, t) => {
    let s = h.querySelector('small.sm'); if (!s) { s = document.createElement('small'); s.className = 'sm'; const tt = h.querySelector('b'); if (tt) tt.after(s); else h.appendChild(s); }
    if (t && s.textContent !== t) s.textContent = t;
    const old = h.querySelector('small:not(.sm)'); if (old && t) old.remove();
    if (t && sumCache[id] !== t) { sumCache[id] = t; try { localStorage.setItem('tfPlSums', JSON.stringify(sumCache)); } catch (e) { /* なし */ } }
  };
  const showSum = (into, id) => { const h = into.closest('.libvid') ? into.closest('.libvid').querySelector('h3') : into.closest('.pl') && into.closest('.pl').querySelector(':scope > .plh'); if (!h) return; putSum(h, id, sums.get(id) || ''); };
  const secOf = t => { const p = String(t || '').split(':').map(Number); return p.length && !p.some(isNaN) ? p.reduce((a, x) => a * 60 + x, 0) : 0; };
  const hmt = sec => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60); return h ? `${h}時間${m ? m + '分' : ''}` : `${m}分`; };
  const saveSet = (k, v) => chrome.storage.local.get('settings').then(r => { const s = r.settings || {}; s[k] = v; return chrome.storage.local.set({ settings: s }); });
  const MINS = [10, 20, 30, 40, 50, 60, 120]; // 空き時間の候補(分)
  const minOpts = () => [...new Set([...MINS, freeMin])].sort((a, b) => a - b).map(n => `<option value="${n}"${n === freeMin ? ' selected' : ''}>${n}分</option>`).join('');
  const sumOf = items => {
    const known = items.filter(x => secOf(x.len)), unk = items.length - known.length;
    const total = known.reduce((a, x) => a + secOf(x.len), 0), rest = known.reduce((a, x) => a + secOf(x.len) * (1 - Math.min(100, x.pct || 0) / 100), 0);
    return `${items.length}本` + (known.length ? ` ・ 合計 ${hmt(total)}(残り ${hmt(rest)})` : '') + (unk ? ` ・ 長さ不明 ${unk}本` : '') + ' ・ 追加した順';
  };
  // 再生リストの動画は、一度だけ取得して使い回す(ページを開いた直後に、閉じているリストの本数・合計時間も出すため)
  const plData = new Map();
  const modeOf = id => (plSort[id] === 'old' ? 'old' : 'new'); // 並び: 追加日の 新しい順(初期) / 古い順
  // 「▶ 続きから」: 途中まで見た動画(YouTube の再生履歴と TubeFolio2 の視聴履歴。1%〜80%・30日以内)。ほかの再生リストと同じ行・カードで出す(reel.js の reelGather)
  const fetchResume = () => (typeof reelGather === 'function' ? reelGather(true) : Promise.resolve({ resume: [] })).then(p => ({ items: (p && p.resume) || [], ordered: true })).catch(e => ({ error: String((e && e.message) || e) }));
  const fetchPl = (id, order) => { const k = id + '|' + (order || ''); if (id === 'resume') { if (!plData.has(k)) plData.set(k, fetchResume().then(r => { if (r.error) plData.delete(k); return r; })); return plData.get(k); } if (!plData.has(k)) plData.set(k, new Promise(res => chrome.runtime.sendMessage({ type: 'plVideos', ids: [id], order }, res)).then(r => { if (!r || r.error) plData.delete(k); return r; })); return plData.get(k); };
  const sortItems = (items, mode) => mode === 'new' || mode === 'old' ? items.map((x, i) => [x, i]).sort((a, b) => { const pa = a[0].pub || 0, pb = b[0].pub || 0; if (!pa && !pb) return a[1] - b[1]; if (!pa) return 1; if (!pb) return -1; return (mode === 'new' ? pb - pa : pa - pb) || a[1] - b[1]; }).map(x => x[0]) : items.slice();
  const sortSeg = id => `<span class="sortseg" data-id="${esc(id)}" title="並び順(再生リストへ追加した日。YouTubeの並べ替えと同じ)">${[['new', '新しい順'], ['old', '古い順']].map(([k, l]) => `<button data-sort="${k}" class="${modeOf(id) === k ? 'on' : ''}">${l}</button>`).join('')}</span>`;
  const vids = (items, id, title, ordered) => {
    items = (items || []).slice();
    // YouTube側の並べ替えを使えなかったリスト(自分で作ったリスト等)は、取れた順=追加した順(古いものが先)と見なす。高く評価した動画(LL)だけは、新しいものが先
    if (!ordered) { const newestFirst = id === 'LL'; if ((modeOf(id) === 'new') === newestFirst) { /* そのまま */ } else items.reverse(); }
    cache.set(id, items);
    const sum = sumOf(items);
    sums.set(id, sum);
    if (id === 'resume') return items.length ? `<div class="grid">${items.map(x => vcard(x, id)).join('')}</div>` : '<p class="none">途中まで見た動画はありません。</p>'; // ぴったり再生・ランダム再生などのツールは出さない
    return `<div class="pltools" data-id="${esc(id)}">
      <div class="plctl"><span>⏱ 空き時間</span><select class="fmin" title="空き時間(この時間に収まるように動画を選びます)">${minOpts()}</select><button data-a="fit" class="b1">▶ ぴったり再生</button><button data-a="bed" class="b2">🌙 就寝時間まで</button><span class="fmsg"></span><span class="sp"></span>${sortSeg(id)}<button data-a="all" class="b3">▶ 連続再生</button><button data-a="rnd" class="b4">🔀 ランダム再生</button></div></div>`
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
  // 連続再生の待ち行列: 動画IDの並びを保存して、先頭の動画を開く。以降の「次の動画」は、YouTube側(content.js)が、再生が終わるたびに順に開く
  const playIds = (list, name) => { const ids = list.map(x => x.id).filter(Boolean); if (!ids.length) return; chrome.storage.local.set({ tfQueue: { ids, t: Date.now(), name: name || '連続再生' } }).then(() => window.open('https://www.youtube.com/watch?v=' + ids[0], '_top')); };
  // 再生リストを、初めから(YouTube本来の再生リストとして)連続再生
  const playList = (id, list) => { const first = (list.find(x => (x.pct || 0) < 90) || list[0] || {}).id; if (!first) return; chrome.storage.local.remove('tfQueue').then(() => window.open('https://www.youtube.com/watch?v=' + first + '&list=' + encodeURIComponent(id), '_top')); };
  const hmMin = t => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const inBed = () => { const d = new Date(), n = d.getHours() * 60 + d.getMinutes(), a = hmMin(sleepFrom), b = hmMin(sleepTo); return a === b ? false : a < b ? n >= a && n < b : n >= a || n < b; }; // 就寝時間帯の中か(日をまたぐ 23:00〜06:00 にも対応)
  const minToBed = () => inBed() ? 0 : (hmMin(sleepFrom) - (new Date().getHours() * 60 + new Date().getMinutes()) + 1440) % 1440;
  const load = (id, into, title) => { // 再生リストの動画を、into に読み込む(一度だけ)
    if (loaded.has(id)) return; loaded.add(id); into.innerHTML = '<p class="none">読み込み中…</p>';
    fetchPl(id, modeOf(id)).then(r => {
      if (!r || r.error) { into.innerHTML = `<p class="none">取得できませんでした${r && r.error ? `(${esc(r.error)})` : ''}</p>`; loaded.delete(id); return; }
      if (id !== 'resume') noteSeen(id, r.items); into.innerHTML = vids(r.items, id, title, r.ordered); showSum(into, id); fillAvatars(into);
    });
  };
  // 「後で見る」ボタン(サムネの🕒)で動画を追加したら、開いている再生リストの一覧・本数・合計時間を、取り直す。
  // YouTube は、追加した直後の内容をすぐには返さないことがあるので、少し待って(2.5秒後)と、もう一度(8秒後)取り直す
  const refreshLists = () => {
    plData.clear();
    document.querySelectorAll('#pls .pl:not(.lib)').forEach(sec => {
      const id = sec.dataset.id, b = sec.querySelector(':scope > .plb'); if (!b || id === 'resume') return;
      loaded.delete(id);
      if (!b.hidden) load(id, b, (sec.querySelector(':scope > .plh b') || {}).textContent || '');
      else fetchPl(id, modeOf(id)).then(r => { if (r && !r.error) { sums.set(id, sumOf(r.items || [])); showSum(b, id); } });
    });
  };
  chrome.storage.onChanged.addListener(ch => { if (ch.plAddedAt) { setTimeout(refreshLists, 2500); setTimeout(refreshLists, 8000); } });
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
  Promise.all([new Promise(res => chrome.runtime.sendMessage({ type: 'plLists' }, res)), chrome.storage.local.get(['settings', 'plSeen', 'sleepWin'])]).then(([r, st]) => {
    plSeen = st.plSeen || {};
    const box = $('#pls'), ord = (st.settings || {}).plOrder || {}, plOpen = (st.settings || {}).plOpen || {}; // plOpen: 再生リストごとの「最初から開く(true)/閉じる(false)」。未設定の既定は、「TubeFolio2 後で見る」だけ開く
    freeMin = (st.settings || {}).freeMin || 30; { const sw = st.sleepWin || {}; sleepFrom = (st.settings || {}).sleepFrom || sw.from || '23:00'; sleepTo = (st.settings || {}).sleepTo || sw.to || '06:00'; } plSort = (st.settings || {}).plSort || {};
    if (!r || r.error) { box.innerHTML = `<p class="empty">再生リストを取得できませんでした${r && r.error ? `(${esc(r.error)})` : ''}。YouTubeにログインしているか、確認してください。</p>`; return; }
    const byOrd = (arr, key) => { const o = ord[key] || []; return arr.map((x, i) => [x, i]).sort((a, b) => { const ia = o.indexOf(a[0].id), ib = o.indexOf(b[0].id); return (ia < 0 ? 1e6 + a[1] : ia) - (ib < 0 ? 1e6 + b[1] : ib); }).map(x => x[0]); };
    const all = r.lists || [];
    // 自分の再生リスト = 作成者が「いちばん多い名前」のもの(ミックスリスト RD… は、常にライブラリ側)。それ以外は、ライブラリに保存したもの
    const cnt = new Map(); all.forEach(x => { if (x.owner && !/^RD/.test(x.id)) cnt.set(x.owner, (cnt.get(x.owner) || 0) + 1); });
    const me = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
    const isMine = x => ['WL', 'LL'].includes(x.id) || (!/^RD/.test(x.id) && (!x.owner || (me && x.owner === me[0])));
    const mine = byOrd(all.filter(isMine), 'mine'); mine.forEach(x => ownIds.add(x.id)); const saved = byOrd(all.filter(x => !isMine(x)), 'lib');
    destLists = mine.filter(x => x.id !== 'LL');
    const card = x => `<div class="plc" draggable="true" data-id="${esc(x.id)}">${x.thumb ? `<img class="plt" loading="lazy" draggable="false" src="${esc(x.thumb)}">` : '<span class="plt ph">📚</span>'}<b>${esc(x.title || '(無題)')}</b><small>${esc([x.owner, x.count].filter(Boolean).join(' ・ '))}</small></div>`;
    const defOpen = (id, title) => plOpen[id] !== undefined ? !!plOpen[id] : (id !== 'library' && /TubeFolio2\s*後で見る/.test(title || ''));
    const pin = (id, title) => `<button class="pin ${defOpen(id, title) ? 'on' : ''}" data-pin="${esc(id)}" title="このページを開いたとき、最初から開くか閉じるかを切り替えます">${defOpen(id, title) ? '▣ 最初から開く' : '□ 最初は閉じる'}</button>`;
    const libRow = `<section class="pl lib ${defOpen('library') ? 'open' : ''}" draggable="true" data-id="library"><div class="plh"><span class="fd">▾</span><b>ライブラリ</b><small>保存した再生リスト ${saved.length}件</small>${pin('library')}<span class="mv" title="順番を上・下へ動かす(ドラッグでも動かせます)"><button type="button" data-mv="-1">▲</button><button type="button" data-mv="1">▼</button></span></div><div class="plb" ${defOpen('library') ? '' : 'hidden'}>${saved.length ? `<div class="libgrid">${saved.map(card).join('')}</div><div class="libvid" hidden></div>` : '<p class="none">ライブラリに保存した再生リストは、ありません。</p>'}</div></section>`
    const rowOf = x => `<section class="pl" draggable="true" data-id="${esc(x.id)}"><div class="plh"><span class="fd">▾</span><b>${esc(x.title || '(無題)')}</b>${sumCache[x.id] ? `<small class="sm">${esc(sumCache[x.id])}</small>` : ''}${pin(x.id, x.title)}<span class="mv" title="順番を上・下へ動かす(ドラッグでも動かせます)"><button type="button" data-mv="-1">▲</button><button type="button" data-mv="1">▼</button></span></div><div class="plb" hidden></div></section>`;
    box.innerHTML = byOrd([{ id: 'library' }, { id: 'resume', title: '▶ 続きから' }, ...mine], 'mine').map(x => x.id === 'library' ? libRow : rowOf(x)).join(''); // ライブラリも、ほかの再生リストと同じように、上下に動かせる
    $('#st').textContent = `再生リスト ${mine.length}件 ・ ライブラリ ${saved.length}件`;
    sortable(box, '.pl', false, saveOrder('mine'));
    const lg = box.querySelector('.libgrid'); if (lg) sortable(lg, '.plc', true, saveOrder('lib'));
    // 閉じている再生リストにも、本数・合計時間を出す(ページを開いたとき、裏で各リストの動画を取得する)
    mine.forEach(x => fetchPl(x.id, modeOf(x.id)).then(r => {
      if (!r || r.error) return; noteSeen(x.id, r.items || []); sums.set(x.id, sumOf(r.items || []));
      const h = box.querySelector(`.pl[data-id="${CSS.escape(x.id)}"] > .plh`); if (!h) return;
      putSum(h, x.id, sums.get(x.id));
    }));
    // 「最初から開く」に設定された再生リストは、開いた状態で始める
    box.querySelectorAll('.pl:not(.lib)').forEach(s => { const x = mine.find(m => m.id === s.dataset.id); if (x && defOpen(x.id, x.title)) { const b = s.querySelector(':scope > .plb'); b.hidden = false; s.classList.add('open'); load(x.id, b, x.title || ''); } });
    if (kwOrs.length) { openForKw(); applyFolder(); } // 読み込む前にキーワードで探していたとき
  });
  $('#pls').addEventListener('change', e => { if (e.target.matches && e.target.matches('.fmin')) { freeMin = +e.target.value || 30; saveSet('freeMin', freeMin); } });
  // ---- 動画ごとのツール: 別の再生リストへ「移動」「コピー」。押す/マウスを乗せると、再生リスト一覧を隣に出す ----
  let vfly = null, vhide = 0;
  const ptoast = (t, ms = 3500) => { let e = document.getElementById('ptoast'); if (!e) { e = document.createElement('div'); e.id = 'ptoast'; document.body.appendChild(e); } e.textContent = t; e.classList.add('on'); clearTimeout(ptoast._t); ptoast._t = setTimeout(() => e.classList.remove('on'), ms); };
  const closeVfly = () => { clearTimeout(vhide); if (vfly) { vfly.remove(); vfly = null; } };
  const refreshList = id => { // 追加先の一覧を取り直す
    plData.delete(id); loaded.delete(id);
    const s = document.querySelector(`#pls .pl[data-id="${CSS.escape(id)}"]`); if (!s) return;
    const b = s.querySelector(':scope > .plb'), t = (s.querySelector(':scope > .plh b') || {}).textContent || '';
    if (!b.hidden) load(id, b, t); else fetchPl(id, modeOf(id)).then(r => { if (r && !r.error) { sums.set(id, sumOf(r.items || [])); showSum(b, id); } });
  };
  function doMove(tb, to, name) {
    const mode = tb.dataset.mode, from = tb.dataset.from, v = tb.dataset.v, set = tb.dataset.set;
    ptoast(`${mode === 'move' ? '移動' : 'コピー'}しています…`);
    chrome.runtime.sendMessage({ type: 'plMove', videoId: v, setId: set, from, to, move: mode === 'move' }, res => {
      if (!res || res.error) return ptoast('できませんでした: ' + ((res && res.error) || '不明なエラー'), 6000);
      ptoast(`「${name}」に${mode === 'move' ? '移動' : 'コピー'}しました`);
      refreshList(to);
      if (mode === 'move') {
        const card = tb.closest('.card'), body = tb.closest('.plb'); if (card) card.remove();
        plData.get(from) && plData.get(from).then(r => { if (r && r.items) r.items = r.items.filter(x => x.id !== v); });
        const items = (cache.get(from) || []).filter(x => x.id !== v); cache.set(from, items); sums.set(from, sumOf(items)); if (body) showSum(body, from);
      }
    });
  }
  const closeVmenu = () => { const m = document.getElementById('vmenu'); if (m) m.remove(); closeVfly(); };
  function showVfly(row, tb) {
    if (vfly && vfly._btn === row) return;
    closeVfly(); tb.dataset.mode = row.dataset.mv;
    const r = row.getBoundingClientRect(), f = vfly = document.createElement('div'); f.id = 'vfly'; f._btn = row;
    f.style.top = Math.max(8, Math.min(r.top, innerHeight - 330)) + 'px';
    f.style.left = (r.right + 260 > innerWidth ? Math.max(8, r.left - 254) : r.right + 2) + 'px';
    const h = document.createElement('div'); h.className = 'vf-h'; h.textContent = row.dataset.mv === 'move' ? '移動先の再生リスト' : 'コピー先の再生リスト'; f.appendChild(h);
    destLists.filter(l => l.id !== tb.dataset.from).forEach(l => { const b = document.createElement('button'); b.className = 'vf-it'; b.textContent = l.title || l.id; b.title = l.title || ''; b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); closeVmenu(); doMove(tb, l.id, l.title || '再生リスト'); }); f.appendChild(b); });
    f.addEventListener('mouseenter', () => clearTimeout(vhide)); f.addEventListener('mouseleave', () => { vhide = setTimeout(closeVfly, 400); });
    document.body.appendChild(f);
  }
  // 動画の「⋮」: 「動画の移動」「動画のコピー」のメニュー。項目にマウスを乗せる/押すと、隣に再生リストの一覧が出る
  function showVmenu(tb) {
    const old = document.getElementById('vmenu'); const same = old && old._tb === tb; closeVmenu(); if (same) return;
    const r = tb.getBoundingClientRect(), m = document.createElement('div'); m.id = 'vmenu'; m._tb = tb;
    m.innerHTML = '<button class="vm-it" data-mv="move"><span>⇄</span>動画の移動</button><button class="vm-it" data-mv="copy"><span>⧉</span>動画のコピー</button>';
    m.style.top = Math.max(8, Math.min(r.bottom + 2, innerHeight - 110)) + 'px'; m.style.left = Math.max(8, Math.min(r.left - 150, innerWidth - 220)) + 'px';
    m.addEventListener('mouseover', e => { const b = e.target.closest('.vm-it'); if (b) { clearTimeout(vhide); showVfly(b, tb); } });
    m.addEventListener('mouseleave', () => { vhide = setTimeout(closeVfly, 400); });
    m.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); const b = e.target.closest('.vm-it'); if (b) showVfly(b, tb); });
    document.body.appendChild(m);
  }
  document.addEventListener('mousedown', e => { if ((vfly || document.getElementById('vmenu')) && !(e.target.closest && e.target.closest('#vfly, #vmenu, .vdots'))) closeVmenu(); }, true);
  $('#pls').addEventListener('click', e => {
    const dl = e.target.closest('.vdel'); // 「×」: 再生リストから削除
    if (dl) {
      e.preventDefault(); e.stopPropagation();
      const card = dl.closest('.card'), listId = dl.dataset.list, vid = dl.dataset.vid;
      if (dl.disabled) return; // 確認なしで、すぐ削除する
      dl.disabled = true; dl.textContent = '…';
      chrome.runtime.sendMessage({ type: 'plRemove', listId, videoId: vid, setId: dl.dataset.set }, r => {
        void chrome.runtime.lastError;
        if (!r || r.error) { dl.disabled = false; dl.textContent = '×'; alert('削除できませんでした: ' + ((r && r.error) || '拡張機能に接続できません(ページを更新してください)')); return; }
        if (card) card.remove();
        if (am.listId && listId === am.listId) chrome.storage.local.get('autoMusic').then(({ autoMusic: a0 = {} }) => { // 「🎵 音楽🎵」で ×: すぐ「削除して入れない」に記録する
          const removed = { ...(a0.removed || {}), [vid]: Date.now() }, added = { ...(a0.added || {}) }, keep = { ...(a0.keep || {}) }; delete added[vid]; delete keep[vid];
          return chrome.storage.local.set({ autoMusic: { ...a0, removed, added, keep, snap: (a0.snap || []).filter(i => i !== vid) } });
        }).catch(() => {});
        const arr = cache.get(listId); if (arr) { const i = arr.findIndex(y => y.id === vid); if (i >= 0) arr.splice(i, 1); sums.set(listId, sumOf(arr)); const sec = document.querySelector(`#pls .pl[data-id="${CSS.escape(listId)}"]`); if (sec) showSum(sec.querySelector(':scope > .plb') || sec, listId); }
      });
      return;
    }
    const mvb = e.target.closest('.mv button[data-mv]'); // ▲▼: 再生リストの順番を1つ動かす(スマホなど、ドラッグできないとき用)。順番は設定 plOrder に保存(Drive同期の対象)
    if (mvb) {
      e.preventDefault(); e.stopPropagation();
      const sec = mvb.closest('.pl'), box = $('#pls'), sib = +mvb.dataset.mv < 0 ? sec.previousElementSibling : sec.nextElementSibling;
      if (sec && sib && sib.matches('.pl')) { box.insertBefore(sec, +mvb.dataset.mv < 0 ? sib : sib.nextSibling); saveOrder('mine')([...box.children].filter(c => c.matches('.pl')).map(c => c.dataset.id)); }
      return;
    }
    const sb = e.target.closest('.sortseg button[data-sort]');
    if (sb) { // 並び順の切り替え(その再生リストだけ、開き直して並べ替える)
      e.preventDefault(); e.stopPropagation();
      const id = sb.closest('.sortseg').dataset.id, mode = sb.dataset.sort; plSort = { ...plSort, [id]: mode };
      chrome.storage.local.get('settings').then(r => { const s = r.settings || {}; s.plSort = { ...(s.plSort || {}), [id]: mode }; return chrome.storage.local.set({ settings: s }); });
      const sec = document.querySelector(`#pls .pl[data-id="${CSS.escape(id)}"]`), body = sec && sec.querySelector(':scope > .plb');
      if (body) { loaded.delete(id); load(id, body, (sec.querySelector(':scope > .plh b') || {}).textContent || ''); }
      return;
    }
    if (e.target.closest('.vtb')) { e.preventDefault(); e.stopPropagation(); showVmenu(e.target.closest('.vtb')); return; }
    const pn = e.target.closest('.pin'); // 「最初から開く / 最初は閉じる」の切り替え(設定 plOpen。Drive同期の対象)
    if (pn) { e.stopPropagation(); const id = pn.dataset.pin, on = !pn.classList.contains('on'); pn.classList.toggle('on', on); pn.textContent = on ? '▣ 最初から開く' : '□ 最初は閉じる'; chrome.storage.local.get('settings').then(r => { const s = r.settings || {}; s.plOpen = { ...(s.plOpen || {}), [id]: on }; return chrome.storage.local.set({ settings: s }); }); return; }
    const tb = e.target.closest('.pltools button[data-a]'); // 見出しの操作(ぴったり再生・就寝時間まで・連続再生・ランダム再生)
    if (tb) {
      const box = tb.closest('.pltools'), id = box.dataset.id, list = cache.get(id) || [], msg = box.querySelector('.fmsg'), inp = box.querySelector('.fmin'), a = tb.dataset.a;
      const warn = text => { msg.textContent = text; msg.classList.add('warn'); clearTimeout(msg._t); msg._t = setTimeout(() => msg.classList.remove('warn'), 8000); try { if (window !== window.top) parent.postMessage({ tfToast: '⚠ ' + text }, 'https://www.youtube.com'); else alert(text); } catch (e2) { /* なし */ } };
      msg.classList.remove('warn');
      const fit = (min, label) => { const pick = pickFit(list, min * 60); if (!pick.length) { const sh = list.filter(x => secOf(x.len) > 0 && (x.pct || 0) < 90).reduce((m, x) => Math.min(m, secOf(x.len)), Infinity); warn(`${label}に収まる動画がありません。` + (isFinite(sh) ? `いちばん短い動画は ${hmt(sh)} です。` : '長さが分かる未視聴の動画がありません。') + '(再生しませんでした)'); return; } msg.textContent = `${label}: ${pick.length}本(${hmt(pick.reduce((s, x) => s + secOf(x.len), 0))})を再生します`; playIds(pick, label); };
      if (a === 'fit') { freeMin = Math.max(5, Math.min(600, parseInt(String(inp.value).replace(/[^\d]/g, ''), 10) || 30)); saveSet('freeMin', freeMin); fit(freeMin, `空き時間 ${freeMin}分`); }
      else if (a === 'bed') { const m = minToBed(); if (m < 1) { warn(`もう就寝時間(${sleepFrom}〜${sleepTo})です。おやすみなさい🌙(再生しませんでした)`); return; } fit(m, `就寝時間(${sleepFrom})まで ${hmt(m * 60)}`); }
      else { let l = list.filter(x => (x.pct || 0) < 90); if (!l.length) l = list.slice(); if (!l.length) { msg.textContent = '再生できる動画がありません'; return; } if (a === 'rnd') { l = l.slice().sort(() => Math.random() - 0.5); playIds(l, 'ランダム再生'); } else playList(id, list); }
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

// ショートのサムネが無い(404 / 灰色の代用画像)ときは、別の画像に順に差し替える(インラインの onerror は使えないので、まとめて監視)
{ const TH = ['oardefault', 'hq2', 'mqdefault', 'hqdefault'];
  const nx = im => { const id = im.dataset.vid; if (!id) return; const c = TH.findIndex(n => im.src.includes('/' + n + '.')), n = TH[c + 1]; if (n) im.src = `https://i.ytimg.com/vi/${id}/${n}.jpg`; };
  document.addEventListener('error', e => { if (e.target.tagName === 'IMG') nx(e.target); }, true);
  document.addEventListener('load', e => { const im = e.target; if (im.tagName === 'IMG' && im.dataset.vid && im.naturalWidth <= 140) nx(im); }, true); }
