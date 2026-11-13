// YouTubeのページ側(MAIN world)で動く、負荷軽減・操作の小さな部品(perf.js が設定を localStorage の tgPerf に写してくれる)
//   ・プレビュー(ホーム・検索で乗せたとき)が視聴履歴・おすすめに入らないよう、再生の記録の送信を止める
//   ・H.264 優先: VP9 / AV1 を「再生できない」と答えて、YouTube に軽い H.264 を選ばせる(読み込み時に効く。変えたら再読み込み)
//   ・画質の固定(1080p など): YouTube が勝手に下げても、選んだ画質へ戻す
//   ・プレイヤーの上でマウスホイール → 音量
(() => {
  if (window.__tgPerfMain) return;
  window.__tgPerfMain = true;
  const cfg = () => { try { return JSON.parse(localStorage.getItem('tgPerf') || '{}'); } catch { return {}; } };
  const onWatch = () => /^\/(watch|shorts|live|embed)/.test(location.pathname);

  // ---- H.264 優先 ----
  const CODEC = /vp9|vp09|av01|av1/i;
  try {
    const its = MediaSource.isTypeSupported.bind(MediaSource);
    MediaSource.isTypeSupported = t => (cfg().h264 && CODEC.test(String(t)) ? false : its(t));
    const cpt = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (t) { return cfg().h264 && CODEC.test(String(t)) ? '' : cpt.call(this, t); };
  } catch { /* なし */ }

  // ---- プレビューの再生記録を送らない(再生画面・ショート以外のページで出る「再生の記録」は、ぜんぶプレビュー) ----
  const STATS = /\/api\/stats\/(playback|watchtime|atr|delayplay)/;
  const block = u => { try { return cfg().pvNoHist !== false && !onWatch() && STATS.test(String(u)); } catch { return false; } };
  try {
    const fo = window.fetch;
    window.fetch = function (input, ...a) { if (block(typeof input === 'string' ? input : input?.url)) return Promise.resolve(new Response('', { status: 204 })); return fo.call(this, input, ...a); };
    const xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u, ...a) { this.__tgBlk = block(u); return xo.call(this, m, u, ...a); };
    XMLHttpRequest.prototype.send = function (...a) { if (this.__tgBlk) return; return xs.apply(this, a); };
    const sb = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (u, d) => (block(u) ? true : sb(u, d));
  } catch { /* なし */ }

  // ---- 画質の固定 ----
  //   タイマーで見張り続けない(YouTube が元へ戻す → こちらが戻す、の綱引きでバッファが切れるため)。
  //   動画の読み込み・再生開始のイベントで、少し間をおいて最大3回だけ合わせる
  const RANK = ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
  const player = () => document.querySelector('#movie_player');
  let qTries = 0, qFor = '', qT = 0;
  function fitQuality() {
    const c = cfg();
    if (!c.qLock || c.saver || !/^\/(watch|live)/.test(location.pathname)) return;
    const p = player();
    if (!p || !p.getAvailableQualityLevels || p.classList.contains('ad-showing')) return;
    const want = RANK.includes(c.qRes) ? c.qRes : 'hd1080';
    const av = (p.getAvailableQualityLevels() || []).filter(q => RANK.includes(q));
    if (!av.length) return;
    const best = av.find(q => RANK.indexOf(q) >= RANK.indexOf(want)) || av[av.length - 1]; // 選んだ画質(無ければ、それより低い中で一番高いもの)
    if (p.getPlaybackQuality && p.getPlaybackQuality() === best) return;
    try { p.setPlaybackQualityRange && p.setPlaybackQualityRange(best, best); p.setPlaybackQuality && p.setPlaybackQuality(best); } catch { /* なし */ }
  }
  function qualityEvent(e) {
    if (!(e.target instanceof HTMLVideoElement) || !e.target.closest('#movie_player')) return;
    const v = new URLSearchParams(location.search).get('v') || '';
    if (v !== qFor) { qFor = v; qTries = 0; }
    if (qTries >= 3) return;
    qTries++; clearTimeout(qT); qT = setTimeout(fitQuality, qTries === 1 ? 300 : 1500);
  }
  document.addEventListener('loadedmetadata', qualityEvent, true);
  document.addEventListener('playing', qualityEvent, true);
  window.addEventListener('tgperf-quality', () => { qTries = 0; fitQuality(); }); // 設定を変えたときは、すぐ1回合わせる

  // ---- 音声: 最初から元の言語の音声を既定にする(自動吹き替えの動画)。プレイヤーに渡す前に、データの既定の印を書き換える ----
  function origAudio(pr) {
    try {
      if (cfg().origAudio === false) return;
      const fm = pr && pr.streamingData && pr.streamingData.adaptiveFormats;
      if (!fm) return;
      const au = fm.filter(f => f.audioTrack);
      const orig = au.find(f => /original|オリジナル|元の/i.test(f.audioTrack.displayName || ''));
      if (!orig || new Set(au.map(f => f.audioTrack.id)).size < 2) return;
      au.forEach(f => { f.audioTrack.audioIsDefault = f.audioTrack.id === orig.audioTrack.id; });
    } catch { /* なし */ }
  }
  try { // 最初の読み込み(ページに埋め込まれた情報)
    let v = window.ytInitialPlayerResponse;
    Object.defineProperty(window, 'ytInitialPlayerResponse', { configurable: true, get: () => v, set: x => { origAudio(x); v = x; } });
  } catch { /* なし */ }
  try { // 動画を移ったあと(/youtubei/v1/player の応答)
    const f2 = window.fetch;
    window.fetch = async function (input, ...a) {
      const r = await f2.call(this, input, ...a);
      try {
        const u = typeof input === 'string' ? input : input && input.url;
        if (cfg().origAudio !== false && /\/youtubei\/v1\/player(\?|$)/.test(String(u))) {
          const j = await r.clone().json(); origAudio(j);
          return new Response(JSON.stringify(j), { status: r.status, statusText: r.statusText, headers: r.headers });
        }
      } catch { /* なし */ }
      return r;
    };
  } catch { /* なし */ }

  // ---- ホイールで音量 ----
  let hud = null, hudT = 0;
  function showVol(p, v, muted) {
    if (!hud || !hud.isConnected || hud.parentElement !== p) { hud?.remove(); hud = document.createElement('div'); hud.className = 'tg-volhud'; p.appendChild(hud); }
    hud.textContent = (muted ? '🔇 ' : '🔊 ') + v + '%';
    hud.classList.add('on'); clearTimeout(hudT); hudT = setTimeout(() => hud && hud.classList.remove('on'), 900);
  }
  document.addEventListener('wheel', e => {
    if (cfg().wheelVol === false || e.ctrlKey || e.shiftKey || e.altKey || !/^\/watch/.test(location.pathname)) return;
    const p = player();
    if (!p || !p.setVolume || !p.contains(e.target)) return;
    if (e.target.closest('.tg-px-pop, .tg-tb-menu, .ytp-popup, .ytp-settings-menu, .tg-c-box, .tg-c-list, [class*="tg-cm"], input, select, textarea')) return;
    e.preventDefault(); e.stopPropagation();
    const step = e.deltaY < 0 ? 5 : -5;
    let v = Math.max(0, Math.min(100, Math.round((p.isMuted && p.isMuted() ? 0 : p.getVolume()) + step)));
    if (v > 0 && p.isMuted && p.isMuted()) p.unMute();
    p.setVolume(v);
    showVol(p, v, v === 0);
  }, { capture: true, passive: false });
})();
