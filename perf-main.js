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
  const RANK = ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
  const player = () => document.querySelector('#movie_player');
  setInterval(() => {
    const c = cfg();
    if (!c.qLock || c.saver || !/^\/(watch|live)/.test(location.pathname) || document.hidden) return;
    const p = player();
    if (!p || !p.getAvailableQualityLevels || p.classList.contains('ad-showing')) return;
    const want = RANK.includes(c.qRes) ? c.qRes : 'hd1080';
    const av = (p.getAvailableQualityLevels() || []).filter(q => RANK.includes(q));
    if (!av.length) return;
    const best = av.find(q => RANK.indexOf(q) >= RANK.indexOf(want)) || av[av.length - 1]; // 選んだ画質(無ければ、それより低い中で一番高いもの)
    if (p.getPlaybackQuality && p.getPlaybackQuality() === best) return;
    try { p.setPlaybackQualityRange && p.setPlaybackQualityRange(best, best); p.setPlaybackQuality && p.setPlaybackQuality(best); } catch { /* なし */ }
  }, 1500);

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
