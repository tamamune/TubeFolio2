// 🧪 テスト: 急上昇ワード(ワードクラウド版)。page.html?p=trw(ガラスバーの 🧪 から開く)
//   ふつうの「急上昇ワード」パネル(trends.js)とは別に、見た目を試すためのページ。同じデータ(背景の tg-trends)を使う。
//   ワードを、検索数の多さで大きさを変えて雲のように並べる。▲の割合が大きいほど、色が濃い。押すと YouTube で検索する。乗せると、細かい数字を出す。
function trwPage() {
  main.style.position = 'relative'; let hours = 4, items = [];
  try { hours = +(localStorage.getItem('tfTrwHours') || 4) === 24 ? 24 : 4; } catch (e) { /* なし */ }
  main.innerHTML = `<div class="head"><h1>${esc(TITLE)}</h1><span class="sub">Google トレンド・日本(テスト)</span><span class="sp"></span>
    <span class="trw-seg" id="trw-hr"><button data-h="4">過去4時間</button><button data-h="24">過去24時間</button></span><button id="trw-re" class="trw-re" title="取り直す">↻</button><button id="trw-sp" class="trw-re" title="球で見る(おすすめ動画と同じ見た目)">🌐</button></div>
    <div id="trw-cloud" class="trw-cloud"><p class="empty">読み込み中…</p></div><div id="trw-tip" class="trw-tip" hidden></div>`;
  const cloud = $('#trw-cloud'), tip = $('#trw-tip');
  const num = it => { const t = String(it.traffic || ''); let n = +it.vol || 0; if (!n) { const m = /([\d,.]+)\s*(万)?/.exec(t); if (m) n = parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 10000 : 1); } return n || 0; };
  const pctN = it => { const m = /([\d,]+)/.exec(String(it.pctText || (it.pct != null ? it.pct : ''))); return m ? +m[1].replace(/,/g, '') : 0; };
  function draw() {
    if (!items.length) { cloud.innerHTML = '<p class="empty">急上昇ワードがありません</p>'; return; }
    const vs = items.map(num), lg = v => Math.log10(Math.max(1, v)), lmax = Math.max(...vs.map(lg)), lmin = Math.min(...vs.map(lg));
    cloud.innerHTML = items.map((it, i) => {
      const k = lmax === lmin ? .5 : (lg(num(it)) - lmin) / (lmax - lmin), size = 13 + Math.round(k * 17), p = pctN(it), heat = Math.min(1, p / 1500);
      return `<button type="button" class="trw-w${i < 3 ? ' top' : ''}" data-i="${i}" style="--sz:${size}px;--heat:${heat.toFixed(2)}"><i>${i + 1}</i>${esc(it.title)}</button>`;
    }).join('');
  }
  function load(force) {
    cloud.innerHTML = '<p class="empty">読み込み中…</p>'; const h = hours;
    chrome.runtime.sendMessage({ type: 'tg-trends', force: !!force, hours: h }, r => {
      if (h !== hours) return; void chrome.runtime.lastError;
      if (!r || r.error || !r.items) { cloud.innerHTML = `<p class="empty">取得できませんでした${r && r.error ? '(' + esc(r.error) + ')' : ''}</p>`; return; }
      items = r.items; draw();
    });
  }
  const syncH = () => main.querySelectorAll('#trw-hr [data-h]').forEach(b => b.classList.toggle('on', +b.dataset.h === hours));
  $('#trw-hr').addEventListener('click', e => { const b = e.target.closest('[data-h]'); if (!b || +b.dataset.h === hours) return; hours = +b.dataset.h; try { localStorage.setItem('tfTrwHours', String(hours)); } catch (x) { /* なし */ } syncH(); load(); });
  $('#trw-re').addEventListener('click', () => load(true));
  cloud.addEventListener('click', e => { const b = e.target.closest('.trw-w'); if (b) window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent((items[+b.dataset.i] || {}).title || ''), '_top'); });
  cloud.addEventListener('mousemove', e => {
    const b = e.target.closest('.trw-w'); if (!b) { tip.hidden = true; return; }
    const it = items[+b.dataset.i] || {}, rel = (it.related || []).slice(0, 4).join(' / ');
    tip.innerHTML = `<b>${esc(it.title)}</b><span>${[it.traffic && '検索 ' + esc(it.traffic), it.pctText && '▲' + esc(it.pctText), esc(it.agoText || '')].filter(Boolean).join(' ・ ')}</span>${rel ? `<small>${esc(rel)}</small>` : ''}`;
    tip.hidden = false; const r = main.getBoundingClientRect(); tip.style.left = Math.max(0, Math.min(e.clientX - r.left + 14, r.width - 260)) + 'px'; tip.style.top = (e.clientY - r.top + 18) + 'px';
  });
  cloud.addEventListener('mouseleave', () => { tip.hidden = true; });
  $('#trw-sp').addEventListener('click', () => { if (typeof openTrendSphere === 'function') openTrendSphere(); });
  syncH(); load();
  if (typeof openTrendSphere === 'function') openTrendSphere(); // 開いたら、まず球で見せる(閉じると、雲の表示)
}
