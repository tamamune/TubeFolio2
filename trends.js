// Google トレンドの急上昇ワード(日本)を、画面の右端からスライドして出す。元のTubeFolio の trends.js から移した部分。
//   ・ワードにマウスを乗せると、そのワードのニュースを3件ほど出す(押すと記事を別タブで開く)
//   ・ワードを押すと YouTube の検索欄に入れる(設定で「入れて検索」にもできる)
//   ・開く・閉じるは下バーの 🔥 ボタン(content.js が tg-trend-toggle を送る)
//   ・設定(⚙ 設定 → 一覧・サムネ →「急上昇ワード・急上昇動画」): px.trendGo(入れるだけ/入れて検索)
//   データは trends-bg.js(背景)が Google トレンドのページから取ってくる(30分ほど覚えておく)。見た目は trends.css
(() => {
  if (window.__tgTrends) return;
  window.__tgTrends = true;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let cfg = { trendGo: false };
  let data = null, open = false, hideT = 0, hours = 24;
  const onWatch = () => /^\/(watch|shorts)(\/|$)/.test(location.pathname);
  try { chrome.storage.local.get('trendHours').then(r => { if (r.trendHours === 4) { hours = 4; syncHours(); } }); } catch { /* なし */ }

  // ---- 画面 ----
  // 開くのは下バーの 🔥 ボタンから(右端のタブは無し)
  const panel = document.createElement('div');
  panel.id = 'tg-trend';
  panel.innerHTML = '<div class="tgt-h"><b>🔥 急上昇ワード<small>Google トレンド・日本</small></b><button class="tgt-g" title="地球儀で見る(色 = 検索ボリューム・ニュース・カテゴリ・48時間)">🌐</button><button class="tgt-r" title="取り直す">↻</button><button class="tgt-x" title="閉じる">✕</button></div><div class="tgt-h2"><span class="tgt-hs"><button data-hr="4">過去4時間</button><button data-hr="24">過去24時間</button></span></div><div class="tgt-l"><div class="tgt-m">読み込み中…</div></div>';
  const news = document.createElement('div');
  news.id = 'tg-trend-news';
  document.documentElement.append(panel, news);
  const list = panel.querySelector('.tgt-l');

  function setOpen(v) {
    open = v;
    panel.classList.toggle('on', v);
    if (v) document.dispatchEvent(new CustomEvent('tg-panel-open', { detail: 'words' }));
    if (!v) news.style.display = 'none';
    if (v && !data) load();
    document.dispatchEvent(new CustomEvent('tg-trend-state', { detail: { k: 'words', open: v } })); // 下バーの 🔥 ボタンの表示用(content.js)
  }
  document.addEventListener('tg-trend-toggle', e => { if (e.detail === 'words' && !onWatch()) setOpen(!open); }); // 下バーの 🔥 ボタン
  document.addEventListener('tg-panel-open', e => { if (e.detail !== 'words' && open) setOpen(false); });
  panel.querySelector('.tgt-x').addEventListener('click', () => setOpen(false));
  panel.querySelector('.tgt-r').addEventListener('click', () => load(true));
  panel.querySelector('.tgt-g').addEventListener('click', () => { setOpen(false); document.dispatchEvent(new CustomEvent('tg-open-sphere')); }); // 🌐: パネルは閉じて、地球儀だけを出す (trwsphere.js)
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) setOpen(false); });

  // ---- データ ----
  const byHours = {};
  function syncHours() { panel.querySelectorAll('[data-hr]').forEach(b => b.classList.toggle('on', +b.dataset.hr === hours)); }
  panel.querySelectorAll('[data-hr]').forEach(b => b.addEventListener('click', () => {
    const h = +b.dataset.hr; if (h === hours) return;
    hours = h; syncHours(); news.style.display = 'none';
    try { chrome.storage.local.set({ trendHours: h }); } catch { /* なし */ }
    data = byHours[h] || null;
    if (data) draw(); else load();
  }));
  syncHours();
  function load(force) {
    const h = hours;
    list.innerHTML = '<div class="tgt-m">読み込み中…</div>';
    chrome.runtime.sendMessage({ type: 'tg-trends', force: !!force, hours: h }, r => {
      if (h !== hours) return; // 読み込み中に切り替えられた
      if (chrome.runtime.lastError || !r || r.error || !r.items) {
        list.innerHTML = `<div class="tgt-m">取得できませんでした:${esc(chrome.runtime.lastError?.message || r?.error || '')}</div>`;
        return;
      }
      data = byHours[h] = r; draw();
    });
  }
  // 数字・時間の見せ方
  const fmtVol = n => n >= 10000 ? `${n / 10000}万+` : n > 0 ? `${n}+` : '';
  const fmtAgo = t => { if (!t) return ''; const m = Math.max(0, Math.floor((Date.now() / 1000 - t) / 60)); return m < 60 ? `${m}分前` : m < 1440 ? `${Math.floor(m / 60)}時間前` : `${Math.floor(m / 1440)}日前`; };
  function draw() {
    list.textContent = '';
    if (!data.items.length) { list.innerHTML = '<div class="tgt-m">急上昇ワードがありません</div>'; return; }
    data.items.forEach((it, i) => {
      const b = document.createElement('button');
      b.className = 'tgt-i';
      const vol = it.traffic || fmtVol(it.vol), pct = it.pctText || (it.pct ? it.pct.toLocaleString('en-US') + '%' : ''), ago = it.agoText || fmtAgo(it.start);
      const sub = [vol && `検索 ${esc(vol)}`, pct && `<span class="up">▲${esc(pct)}</span>`, esc(ago), it.end ? '終了' : ''].filter(Boolean).join(' ・ ');
      b.innerHTML = `<span class="tgt-n">${i + 1}</span><span class="tgt-b"><span class="tgt-t">${esc(it.title)}</span>${sub ? `<span class="tgt-s">${sub}</span>` : ''}${it.related?.length ? `<span class="tgt-s">${esc(it.related.slice(0, 4).join('　'))}</span>` : ''}</span>`;
      b.addEventListener('click', () => useTerm(it.title));
      b.addEventListener('mouseenter', () => showNews(it, b));
      b.addEventListener('mouseleave', () => { hideT = setTimeout(() => { news.style.display = 'none'; hoverIt = null; }, 400); });
      list.appendChild(b);
    });
  }

  // ---- マウスを乗せたときのニュース ----
  let hoverIt = null;
  function renderNews(it, el) {
    const hasN = it.news?.length, hasR = it.related?.length;
    if (!hasN && !hasR && !it.newsLoading) { news.style.display = 'none'; return; }
    news.innerHTML = (hasN ? `<div class="tgt-nh">「${esc(it.title)}」のニュース</div>` + it.news.slice(0, 3).map(n =>
      `<a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${n.picture ? `<img src="${esc(n.picture)}" alt="" referrerpolicy="no-referrer">` : ''}<span>${esc(n.title)}<small>${esc(n.source || '')}</small></span></a>`).join('')
      : `<div class="tgt-nh">${it.newsLoading ? `「${esc(it.title)}」のニュースを探しています…` : `「${esc(it.title)}」のニュースは見つかりませんでした`}</div>`)
      + (hasR ? `<div class="tgt-nh">関連ワード(押すと検索ワードに入れる)</div><div class="tgt-rel">${it.related.map(w => `<span data-w="${esc(w)}">${esc(w)}</span>`).join('')}</div>` : '');
    news.style.display = 'block';
    const r = el.getBoundingClientRect();
    // パネルにぴったり付けて出す(マウスを動かす途中で消えないように)
    news.style.right = (innerWidth - panel.getBoundingClientRect().left) + 'px';
    news.style.top = Math.max(60, Math.min(r.top, innerHeight - news.offsetHeight - 8)) + 'px';
  }
  function showNews(it, el) {
    clearTimeout(hideT);
    hoverIt = it;
    if (!it.news?.length && !it.newsTried) { // ニュースは、乗せたときに Bing / Google ニュースで探す
      it.newsTried = true; it.newsLoading = true;
      chrome.runtime.sendMessage({ type: 'tg-trend-news', q: it.title }, r => {
        it.newsLoading = false;
        if (!chrome.runtime.lastError && r?.news?.length) it.news = r.news;
        if (hoverIt === it && news.style.display !== 'none') renderNews(it, el);
      });
    }
    renderNews(it, el);
  }
  news.addEventListener('click', e => { const w = e.target.closest('[data-w]'); if (w) useTerm(w.dataset.w); });
  news.addEventListener('mouseenter', () => clearTimeout(hideT));
  news.addEventListener('mouseleave', () => { news.style.display = 'none'; });

  // ---- ワードを押したとき(パネルのワード・地球儀のワード どちらも) ----
  //   ホーム(TubeFolio2 の画面を開いていない) = YouTube の上の検索欄に入れる(設定で「入れて検索」も)
  //   ほかのページ = TubeFolio2 の検索画面を開いて、キーワードに入れて探す(対象 = すべて・種類 = 動画。content.js の tg-open-search)
  function useTerm(term) {
    const html = document.documentElement, home = location.pathname === '/' && !html.hasAttribute('data-tf-view') && !html.hasAttribute('data-tf-pg');
    if (!home) { document.dispatchEvent(new CustomEvent('tg-open-search', { detail: term })); return; }
    const go = !!cfg.trendGo;
    const inp = document.querySelector('yt-searchbox input[name="search_query"], ytd-searchbox input[name="search_query"], input[name="search_query"], input#search');
    if (!inp) { if (go) location.href = '/results?search_query=' + encodeURIComponent(term); return; }
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, term);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.focus();
    if (go) {
      const btn = document.querySelector('button.ytSearchboxComponentSearchButton, ytd-searchbox #search-icon-legacy, #search-icon-legacy, button[aria-label="検索"]');
      if (btn) btn.click(); else location.href = '/results?search_query=' + encodeURIComponent(term);
    }
  }
  document.addEventListener('tg-use-term', e => { if (e.detail) useTerm(String(e.detail)); }); // 地球儀から

  // ---- 設定 ----
  // 再生画面(/watch・ショート)では出さない
  function apply() {
    const watch = onWatch();
    if (watch) { if (open) setOpen(false); panel.style.display = 'none'; } else panel.style.display = '';
  }
  document.addEventListener('yt-navigate-finish', apply);
  window.addEventListener('popstate', apply);
  const read = px => { cfg = { trendGo: false, ...(px || {}) }; apply(); };
  try {
    chrome.storage.local.get('px').then(r => read(r.px));
    chrome.storage.onChanged.addListener(ch => { if (ch.px) read(ch.px.newValue); });
  } catch { /* なし */ }
  apply();
})();
