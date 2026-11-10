// 急上昇動画(日本・Top 50)を、画面の右端からスライドして出す。日付を前後に動かせる。元のTubeFolio の trendvid.js から移した部分。
//   データは trends-bg.js(背景)が Top1Trend(t1trend.com)の日別ランキングから読む。
//   直近10日ほどは日付ごとの保存が無く、最新と同じ一覧が返るので、その日は注意を出す。
//   「🕒 後で見る」は TubeFolio2 の「後で見る」(extras.js の TGX.toggleLater)に入れる。
//   開く・閉じるは下バーの 📈 ボタン(content.js が tg-trend-toggle を送る)。見た目は trends.css
(() => {
  if (window.__tgTrendVid) return;
  window.__tgTrendVid = true;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayStr = () => ymd(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
  let open = false, date = todayStr(), seq = 0;
  const onWatch = () => /^\/(watch|shorts)(\/|$)/.test(location.pathname);

  // 開くのは下バーの 📈 ボタンから(右端のタブは無し)
  const panel = document.createElement('div');
  panel.id = 'tg-tv';
  panel.innerHTML = '<div class="tv-h"><b>📈 急上昇動画<small>日本・Top 50(Top1Trend)</small></b><button class="tv-r2" title="取り直す">↻</button><button class="tv-x" title="閉じる">✕</button></div>'
    + '<div class="tv-n"><button class="tv-prev" title="前の日">◀</button><input type="date" class="tv-d"><button class="tv-next" title="次の日">▶</button><button class="tv-now" title="最新">最新</button></div>'
    + '<div class="tv-wrap"></div><div class="tv-l"><div class="tv-m">読み込み中…</div></div>';
  document.documentElement.append(panel);
  const list = panel.querySelector('.tv-l'), wrap = panel.querySelector('.tv-wrap'), inp = panel.querySelector('.tv-d');
  inp.max = todayStr(); inp.min = '2026-01-01';

  function setOpen(v) {
    open = v;
    panel.classList.toggle('on', v);
    if (v) { document.dispatchEvent(new CustomEvent('tg-panel-open', { detail: 'tv' })); if (!list.dataset.loaded) go(date); }
    document.dispatchEvent(new CustomEvent('tg-trend-state', { detail: { k: 'tv', open: v } })); // 下バーの 📈 ボタンの表示用(content.js)
  }
  document.addEventListener('tg-trend-toggle', e => { if (e.detail === 'tv' && !onWatch()) setOpen(!open); }); // 下バーの 📈 ボタン
  panel.querySelector('.tv-x').addEventListener('click', () => setOpen(false));
  document.addEventListener('tg-panel-open', e => { if (e.detail !== 'tv' && open) setOpen(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) setOpen(false); });
  panel.querySelector('.tv-r2').addEventListener('click', () => go(date, true));
  panel.querySelector('.tv-prev').addEventListener('click', () => go(addDays(date, -1)));
  panel.querySelector('.tv-next').addEventListener('click', () => { if (date < todayStr()) go(addDays(date, 1)); });
  panel.querySelector('.tv-now').addEventListener('click', () => go(todayStr()));
  inp.addEventListener('change', () => { if (inp.value) go(inp.value > todayStr() ? todayStr() : inp.value); });

  // ---- TubeFolio2 の「後で見る」に追加 ----
  let laterSet = new Set();
  const byId = new Map();
  const secOf = d => String(d || '').split(':').reduce((a, x) => a * 60 + (+x || 0), 0);
  const paintLater = b => {
    const on = laterSet.has(b.dataset.v);
    b.classList.toggle('on', on);
    b.textContent = on ? '✓ 後で見る' : '🕒 後で見る';
    b.title = on ? 'TubeFolio2の「後で見る」から外す' : 'TubeFolio2の「後で見る」に追加';
  };
  const paintAll = () => list.querySelectorAll('.tv-later').forEach(paintLater);
  try {
    chrome.storage.local.get('later').then(r => { laterSet = new Set((r.later || []).map(x => x.v)); paintAll(); });
    chrome.storage.onChanged.addListener(ch => { if (ch.later) { laterSet = new Set((ch.later.newValue || []).map(x => x.v)); paintAll(); } });
  } catch { /* なし */ }
  list.addEventListener('click', async e => {
    const b = e.target.closest('.tv-later'); if (!b) return;
    e.preventDefault(); e.stopPropagation(); // 動画のリンクを開かない
    const it = byId.get(b.dataset.v); if (!it || b.dataset.busy) return;
    b.dataset.busy = '1';
    try {
      const added = await TGX.toggleLater({ v: it.id, t: it.title, p: 0, th: `https://i.ytimg.com/vi/${it.id}/mqdefault.jpg`, d: secOf(it.dur), ch: { key: '', name: it.channel, unsub: true } });
      laterSet[added ? 'add' : 'delete'](it.id); paintAll();
    } catch (err) { b.title = '追加できませんでした:' + (err?.message || err); }
    finally { delete b.dataset.busy; }
  });

  function go(d, force) {
    date = d; inp.value = d; inp.max = todayStr();
    panel.querySelector('.tv-next').disabled = d >= todayStr();
    const my = ++seq;
    wrap.textContent = '';
    list.innerHTML = '<div class="tv-m">読み込み中…</div>';
    chrome.runtime.sendMessage({ type: 'tg-t1', date: d >= todayStr() ? 'latest' : d, force: !!force }, r => {
      if (my !== seq) return; // 読み込み中に別の日へ移った
      if (chrome.runtime.lastError || !r || r.error || !r.items) {
        list.innerHTML = `<div class="tv-m">取得できませんでした:${esc(chrome.runtime.lastError?.message || r?.error || '')}</div>`;
        return;
      }
      list.dataset.loaded = '1';
      if (r.same) wrap.innerHTML = '<div class="tv-w">この日の一覧はまだ保存されていないようです(10日ほど前までの日は、最新と同じ一覧が出ます)。</div>';
      list.textContent = ''; byId.clear();
      for (const it of r.items) {
        byId.set(it.id, it);
        const a = document.createElement('a');
        a.className = 'tv-i'; a.href = '/watch?v=' + it.id; a.dataset.v = it.id;
        a.innerHTML = `<span class="tv-r ${it.rank <= 3 ? 'top' : ''}">${esc(it.rank)}</span><span class="tv-t"><img src="https://i.ytimg.com/vi/${esc(it.id)}/mqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer"><i>${esc(it.dur)}</i></span>`
          + `<span class="tv-b"><span class="tv-ti">${esc(it.title)}</span><span class="tv-s">${esc(it.channel)}</span><span class="tv-s">${[it.views && `再生 ${esc(it.views)}`, it.score && `${esc(it.score)} pts`].filter(Boolean).join(' ・ ')}</span></span><button class="tv-later" data-v="${esc(it.id)}"></button>`;
        paintLater(a.querySelector('.tv-later'));
        list.appendChild(a);
      }
      list.scrollTop = 0;
    });
  }

  // ---- 設定 ----
  // 再生画面(/watch・ショート)では出さない
  function apply() {
    const watch = onWatch();
    panel.style.display = watch ? 'none' : '';
    if (watch && open) setOpen(false);
  }
  document.addEventListener('yt-navigate-finish', apply);
  window.addEventListener('popstate', apply);
  apply();
})();
