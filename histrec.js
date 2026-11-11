// 視聴履歴の記録(hist)。この拡張機能を入れたブラウザで、実際に再生した時間を、再生のたびに記録する。
//   hist: { v: { 動画ID: [タイトル, チャンネル名, チャンネルのキー(@ハンドル or UC…), 長さ(秒), ショートなら1] },
//           p: [[再生を始めた時刻(秒), 動画ID, 見た秒数, いちばん先まで進んだ位置(秒)], …] }   ← 再生1回ごとに1件(古い順)
//   ← storage。Drive同期の対象(store.js の TF.SYNC_KEYS)。PCどうしは、sync.js が中身を合わせる(どちらの分も残る)
//   見るページ: 上のバーの「視聴履歴」(page.js → histpage.js)。一覧のサムネを薄くする目印(content.js / page.js)にも使う
//   広告の間・止めている間は数えない。5秒以上見たものだけ残す。30秒ごとと、止めたとき・別の動画へ移るときに保存する
(() => {
  if (window.__tfHistRec) return; window.__tfHistRec = true;
  const MAX = 30000; // 再生の記録の上限(sync.js の HIST_MAX と同じ)
  let cur = null, dirty = 0, saving = Promise.resolve();
  const vidNow = () => {
    if (location.pathname === '/watch') return new URLSearchParams(location.search).get('v');
    const m = location.pathname.match(/^\/shorts\/([\w-]{11})/); return m ? m[1] : null;
  };
  const isShort = () => location.pathname.startsWith('/shorts/');
  const videoEl = () => isShort()
    ? (document.querySelector('ytd-reel-video-renderer[is-active] video') || [...document.querySelectorAll('ytd-shorts video')].find(v => !v.paused) || null)
    : document.querySelector('#movie_player video');
  const txt = e => ((e && e.textContent) || '').replace(/\s+/g, ' ').trim();
  function metaNow(el) {
    let title = '', name = '', key = '';
    if (isShort()) {
      const r = document.querySelector('ytd-reel-video-renderer[is-active]') || document;
      const a = r.querySelector('ytd-channel-name a[href], a[href^="/@"], a[href^="/channel/UC"]');
      title = txt(r.querySelector('yt-shorts-video-title-view-model h2, h2.title, #title')) || document.title.replace(/ - YouTube$/, '');
      if (a) { key = TF.keyFromHref(a.getAttribute('href')) || ''; name = txt(a).replace(/^@/, '') || key; }
    } else {
      const ch = (globalThis.TGPage && TGPage.currentChannel && TGPage.currentChannel()) || null;
      title = txt(document.querySelector('ytd-watch-metadata h1, #title h1')) || document.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '');
      if (ch) { key = String(ch.key || '').replace(/^channel\//, ''); name = ch.name || ''; }
    }
    const d = el && isFinite(el.duration) ? Math.round(el.duration) : 0;
    return [title.slice(0, 200), name.slice(0, 80), key, d, isShort() ? 1 : 0];
  }
  function save() {
    const c = cur; if (!c || c.sec < 5 || !dirty) return saving;
    dirty = 0; const row = [c.start, c.v, Math.round(c.sec), Math.round(c.pos || 0)], meta = c.meta; // 4つ目 = いちばん先まで進んだ位置(一覧の「途中 ◯%」「視聴済み」に使う。倍速で見ても、どこまで見たかが分かる)
    saving = saving.then(async () => {
      const h = (await chrome.storage.local.get('hist')).hist || {}, v = h.v || {}, p = Array.isArray(h.p) ? h.p : [];
      let i = p.length - 1; while (i >= 0 && !(p[i][0] === row[0] && p[i][1] === row[1])) { if (p[i][0] < row[0] - 86400) { i = -1; break; } i--; }
      if (i >= 0) p[i] = row; else p.push(row);
      if (meta && (meta[0] || !v[row[1]])) v[row[1]] = meta;
      if (p.length > MAX) { p.splice(0, p.length - MAX); const used = new Set(p.map(x => x[1])); for (const id of Object.keys(v)) if (!used.has(id)) delete v[id]; }
      await chrome.storage.local.set({ hist: h.g ? { v, p, g: h.g } : { v, p } }); // g(最後に削除した時刻。sync.js が使う)は、そのまま残す
    }).catch(() => {});
    return saving;
  }
  setInterval(() => {
    const v = vidNow(), el = v && videoEl();
    if (cur && cur.v !== v) { save(); cur = null; }
    if (!v || !el || el.paused || el.ended || el.readyState < 2 || document.querySelector('#movie_player.ad-showing')) { if (cur && dirty) save(); return; }
    const now = Date.now();
    if (cur && now - cur.last > 600e3) { save(); cur = null; } // 10分以上止めていたら、別の再生として数える
    if (!cur) cur = { v, start: Math.floor(now / 1000), sec: 0, pos: 0, meta: null };
    cur.sec += 1; cur.last = now; dirty++;
    if (isFinite(el.currentTime) && el.currentTime > cur.pos) cur.pos = el.currentTime;
    // タイトル・チャンネルは、移った直後は前の動画のままのことがあるので、少し見てから読み、何度か読み直す
    if ([3, 10, 30].includes(cur.sec) || (cur.sec > 3 && (!cur.meta || !cur.meta[0] || !cur.meta[2] || !cur.meta[3]) && cur.sec % 5 === 0)) { try { const m = metaNow(el); if (!cur.meta || m[0]) cur.meta = m; } catch (e) { /* 次の回に */ } }
    if (dirty >= 30) save();
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', () => { save(); });
  document.addEventListener('yt-navigate-start', () => { save(); });
})();
