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

if (!KIND[P]) { // まだ中身のないページ
  main.innerHTML = `<h1>${esc(TITLE)}</h1><p class="empty">このページは、まだ中身がありません。</p>`;
} else {
  const kind = KIND[P];
  const sortKey = 'tfPageSort_' + P;
  let sorts = {}; try { sorts = JSON.parse(localStorage.getItem(sortKey) || '{}'); } catch (e) { /* 無視 */ }
  let data = null, timer = 0;

  main.innerHTML = `<div class="head"><h1>${esc(TITLE)}</h1><span class="sub">登録チャンネルの新着(直近${DAYS}日)</span><span class="sp"></span><span id="st"></span><button id="rf" class="btn">⟳ 更新</button></div><div id="list"></div>`;

  const ymd = d => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${'日月火水木金土'[d.getDay()]})`;
  const dkey = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const url = it => it.kind === 's' ? `https://www.youtube.com/shorts/${it.id}` : `https://www.youtube.com/watch?v=${it.id}`;

  function draw() {
    const box = $('#list');
    if (!data) { box.innerHTML = '<p class="empty">読み込み中…</p>'; return; }
    const all = (data.items || []).filter(x => x.kind === kind);
    const liveNow = kind === 'l' ? all.filter(x => x.live) : []; // ライブ中は、日付ごとの一覧とは別に、先頭に出す
    const items = kind === 'l' ? all.filter(x => !x.live) : all;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: DAYS }, (_, i) => new Date(today.getTime() - i * 86400000));
    const byDay = new Map(days.map(d => [dkey(d), []]));
    items.forEach(x => { const a = byDay.get(dkey(new Date(x.published))); if (a) a.push(x); });
    const liveSec = liveNow.length ? `<section class="day livenow"><div class="dh"><h2>🔴 ライブ中</h2><span class="cnt">${liveNow.length}件</span></div><div class="grid">${liveNow.map(x => card(x)).join('')}</div></section>` : '';
    box.innerHTML = liveSec + days.map((d, i) => {
      const k = dkey(d), list = byDay.get(k), asc = sorts[k] === 'asc';
      list.sort((a, b) => asc ? a.published.localeCompare(b.published) : b.published.localeCompare(a.published));
      const label = ymd(d) + (i === 0 ? ' ・今日' : i === 1 ? ' ・昨日' : '');
      return `<section class="day" data-k="${k}"><div class="dh"><h2>${label}</h2><span class="cnt">${list.length}件</span><span class="sp"></span>
        <div class="seg"><button data-s="desc" class="${asc ? '' : 'act'}">新しい順</button><button data-s="asc" class="${asc ? 'act' : ''}">古い順</button></div></div>
        ${list.length ? `<div class="grid ${kind === 's' ? 'shorts' : ''}">${list.map(x => card(x)).join('')}</div>` : '<p class="none">この日の新着はありません。</p>'}</section>`;
    }).join('');
  }
  function card(x) {
    const t = new Date(x.published), th = `https://i.ytimg.com/vi/${x.id}/${x.kind === 's' ? 'oardefault' : 'mqdefault'}.jpg`;
    return `<a class="card" href="${url(x)}" target="_top" title="${esc(x.title)}"><div class="th"><img loading="lazy" src="${th}" onerror="this.src='https://i.ytimg.com/vi/${x.id}/mqdefault.jpg'"><span class="tm">${hm(t)}</span></div>
      <div class="inf">${x.avatar ? `<img class="av" loading="lazy" src="${esc(x.avatar)}">` : '<span class="av"></span>'}<div class="tx"><b>${esc(x.title)}</b><small>${esc(x.ch)}</small></div></div></a>`;
  }

  $('#list').addEventListener('click', e => {
    const b = e.target.closest('.seg button'); if (!b) return;
    const k = b.closest('.day').dataset.k; sorts[k] = b.dataset.s;
    try { localStorage.setItem(sortKey, JSON.stringify(sorts)); } catch (e2) { /* 無視 */ }
    draw();
  });

  function status() {
    chrome.runtime.sendMessage({ type: 'feedStatus', kind }, r => {
      const st = $('#st'); if (!st) return;
      if (r && r.running) { st.textContent = `${r.phase} ${r.done}/${r.total}(取得できた分から表示)`; if (r.items && r.items.length) { data = { items: r.items, t: 0 }; draw(); } timer = setTimeout(status, 1500); } else st.textContent = data && data.t ? `更新: ${new Date(data.t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}` : '';
    });
  }
  function load(force) {
    $('#rf').disabled = true; clearTimeout(timer); status();
    chrome.runtime.sendMessage({ type: 'feedAll', days: DAYS, force: !!force, kind }, r => {
      $('#rf').disabled = false; clearTimeout(timer);
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
  $('#rf').onclick = () => load(true);
  draw();
  // 前回の結果があれば、すぐに表示する(古くても先に見せて、裏で最新に更新する)
  try { chrome.storage.local.get('feedCache_' + kind).then(r => { const fc = r['feedCache_' + kind]; if (fc && fc.items && !data) { data = fc; draw(); const st = $('#st'); if (st && !st.textContent) st.textContent = '前回の結果を表示中(更新しています)'; } }); } catch (e) { /* 無視 */ }
  load(false);
}
// ページの中をクリックしたことを、YouTube側(親)へ知らせる(親で開いているメニューを閉じるため)
document.addEventListener('mousedown', () => { try { parent.postMessage({ tfClick: 1 }, '*'); } catch (e) { /* 無視 */ } }, true);
