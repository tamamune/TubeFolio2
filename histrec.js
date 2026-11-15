// 視聴履歴の記録(hist)。この拡張機能を入れたブラウザで、実際に再生した時間を、再生のたびに記録する。
//   hist: { v: { 動画ID: [タイトル, チャンネル名, チャンネルのキー(@ハンドル or UC…), 長さ(秒), ショートなら1,
//                         カテゴリ, 公開日(YYYY-MM-DD), ライブ(1=ライブ配信・配信だった), タグ(最大8個)] },   ← 5つ目より後は、項目を足したあとの再生から入る(それ以前は無し)
//           p: [[再生を始めた時刻(秒), 動画ID, 見た秒数, いちばん先まで進んだ位置(秒), デバイス(pc/ph/tb), 流入経路(home/search/sub/channel/watch/list/hist/shorts/ext/direct/other)], …] }   ← 再生1回ごとに1件(古い順)
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
  // 視聴デバイス・流入経路(どのページから来て見始めたか)
  const DEV = /iPad|Tablet/i.test(navigator.userAgent) ? 'tb' : /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'ph' : 'pc';
  const kindOf = l => { const p = l.pathname; return p === '/' ? 'home' : p.startsWith('/results') ? 'search' : p.startsWith('/feed/subscriptions') ? 'sub' : p.startsWith('/feed/history') ? 'hist' : p.startsWith('/playlist') ? 'list' : /^\/(@|channel\/|c\/|user\/)/.test(p) ? 'channel' : p.startsWith('/shorts') ? 'shorts' : p === '/watch' ? (/[?&]list=/.test(l.search) ? 'list' : 'watch') : 'other'; };
  let prevKind = document.referrer && !/(^|\.)youtube\.com$/.test(new URL(document.referrer).hostname) ? 'ext' : 'direct';
  // YouTube のページ側(mainworld.js)に頼んで、カテゴリ・公開日・タグ・ライブかどうかを読む(通信しない)
  let mSeq = 0;
  const pageMeta = () => new Promise(res => {
    const id = 'hr' + (++mSeq), on = e => { let d; try { d = JSON.parse(e.detail); } catch { return; } if (d.id !== id) return; document.removeEventListener('tg-res', on); clearTimeout(t); res(d.result); };
    const t = setTimeout(() => { document.removeEventListener('tg-res', on); res(null); }, 2000);
    document.addEventListener('tg-res', on);
    document.dispatchEvent(new CustomEvent('tg-cmd', { detail: JSON.stringify({ id, op: 'meta', args: {} }) }));
  });
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
    dirty = 0; const row = [c.start, c.v, Math.round(c.sec), Math.round(c.pos || 0), c.dev, c.ref], meta = c.meta ? c.meta.slice(0, 5).concat(c.x || []) : null; // 4つ目 = いちばん先まで進んだ位置(一覧の「途中 ◯%」「視聴済み」に使う。倍速で見ても、どこまで見たかが分かる)
    saving = saving.then(async () => {
      const h = (await chrome.storage.local.get('hist')).hist || {}, v = h.v || {}, p = Array.isArray(h.p) ? h.p : [];
      let i = p.length - 1; while (i >= 0 && !(p[i][0] === row[0] && p[i][1] === row[1])) { if (p[i][0] < row[0] - 86400) { i = -1; break; } i--; }
      if (i >= 0) p[i] = row; else p.push(row);
      if (meta && (meta[0] || !v[row[1]])) { const old = v[row[1]] || []; v[row[1]] = meta.length > 5 || old.length <= 5 ? meta : meta.concat(old.slice(5)); } // 今回カテゴリなどが読めなかったときは、前に記録した分を残す
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
    if (!cur) cur = { v, start: Math.floor(now / 1000), sec: 0, pos: 0, meta: null, dev: DEV, ref: prevKind, x: null, xTry: 0 };
    cur.sec += 1; cur.last = now; dirty++;
    // カテゴリ・公開日・ライブ・タグ: 8秒以上見たら読む(読めなければ、何度か試す)
    if (cur.sec >= 8 && !cur.x && !cur.xBusy && cur.xTry < 3 && cur.sec % 4 === 0) {
      const c0 = cur; c0.xBusy = 1; c0.xTry++;
      pageMeta().then(m => { c0.xBusy = 0; if (m && m.v === c0.v && (m.category || m.publish)) { c0.x = [String(m.category || '').slice(0, 40), String(m.publish || '').slice(0, 10), m.live || m.liveStart ? 1 : 0, (m.kw || []).slice(0, 8).map(s => String(s).slice(0, 30))]; dirty++; } }).catch(() => { c0.xBusy = 0; });
    }
    if (isFinite(el.currentTime) && el.currentTime > cur.pos) cur.pos = el.currentTime;
    // タイトル・チャンネルは、移った直後は前の動画のままのことがあるので、少し見てから読み、何度か読み直す
    if ([3, 10, 30].includes(cur.sec) || (cur.sec > 3 && (!cur.meta || !cur.meta[0] || !cur.meta[2] || !cur.meta[3]) && cur.sec % 5 === 0)) { try { const m = metaNow(el); if (!cur.meta || m[0]) cur.meta = m; } catch (e) { /* 次の回に */ } }
    if (dirty >= 30) save();
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', () => { save(); });
  document.addEventListener('yt-navigate-start', () => { save(); prevKind = kindOf(location); });
})();
