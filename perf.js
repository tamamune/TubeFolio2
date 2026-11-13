// 再生の負荷軽減・操作(設定は px。Drive 同期の対象)
//   h264(VP9/AV1を避ける) / qLock・qRes(画質の固定) / wheelVol(ホイールで音量) / pvNoHist(プレビューを履歴に入れない)
//   → perf-main.js(YouTubeのページ側)が読めるよう、localStorage の tgPerf に写す(再読み込みなしで反映。h264 だけは次の読み込みから)
//   noEndCard(終了画面カードを隠す) / noNativeCmt(YouTube標準のコメント欄を出さない) / hideShortsHome(ホームのショートを隠す)
//   lazyRel(関連動画を、再生して10秒たってから出す) / extPlayer(外部プレイヤーで開く: mpv・VLC・自分で指定)
(() => {
  if (window.__tgPerf) return;
  window.__tgPerf = true;
  const DEF = { h264: false, qLock: false, qRes: 'hd1080', wheelVol: true, pvNoHist: true, noEndCard: true, origAudio: true, noNativeCmt: false, hideShortsHome: false, lazyRel: false, relSec: 10, extPlayer: 'mpv', extTpl: '' };
  let cfg = { ...DEF };
  const root = document.documentElement;
  const curV = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') || '' : '');

  let prevQ = '';
  function apply() {
    try { localStorage.setItem('tgPerf', JSON.stringify({ h264: !!cfg.h264, qLock: !!cfg.qLock, qRes: cfg.qRes, wheelVol: cfg.wheelVol !== false, pvNoHist: cfg.pvNoHist !== false, saver: !!cfg.saver, origAudio: cfg.origAudio !== false }));
    if (prevQ !== cfg.qLock + '|' + cfg.qRes) { prevQ = cfg.qLock + '|' + cfg.qRes; window.dispatchEvent(new Event('tgperf-quality')); } } catch { /* なし */ }
    root.classList.toggle('tg-noend', cfg.noEndCard !== false);
    root.classList.toggle('tg-nocmt', !!cfg.noNativeCmt);
    root.classList.toggle('tg-noshorts', !!cfg.hideShortsHome);
    if (!cfg.lazyRel) root.classList.remove('tg-lazy-rel');
    else if (lazyFor !== curV()) startLazy();
  }
  const load = () => chrome.storage.local.get('px').then(r => { cfg = { ...DEF, ...(r.px || {}) }; apply(); });
  load();
  chrome.storage.onChanged.addListener(ch => { if (ch.px) load(); });

  // ---- 関連動画を遅れて出す ----
  let lazyFor = null, playedSec = 0, navAt = 0;
  function startLazy() {
    lazyFor = curV(); playedSec = 0; navAt = Date.now();
    root.classList.toggle('tg-lazy-rel', !!(cfg.lazyRel && lazyFor));
  }
  document.addEventListener('yt-navigate-finish', () => { if (cfg.lazyRel) startLazy(); else lazyFor = null; });
  setInterval(() => {
    if (!cfg.lazyRel || !lazyFor || !root.classList.contains('tg-lazy-rel')) return;
    if (lazyFor !== curV()) { startLazy(); return; }
    const v = document.querySelector('#movie_player video');
    if (v && !v.paused && v.currentTime > 0) playedSec++;
    if (playedSec >= (+cfg.relSec || 10) || Date.now() - navAt > 60000) root.classList.remove('tg-lazy-rel'); // 再生して10秒(止めたままでも1分で)出す
  }, 1000);

  // ---- 外部プレイヤー(mpv / VLC など)で開く ----
  //   ブラウザの拡張機能は、PCのアプリを直接起動できない。そのため、「ytdl://」「vlc://」のような独自の URL を開き、
  //   Windows に登録した受け口(external-player フォルダの .reg)が、プレイヤーを起動する
  function toast(t) {
    let d = document.getElementById('tg-mini-toast');
    d?.remove();
    d = document.createElement('div'); d.id = 'tg-mini-toast'; d.textContent = t; document.body.appendChild(d);
    setTimeout(() => d.classList.add('out'), 2500); setTimeout(() => d.remove(), 3100);
  }
  function openExternal() {
    const id = curV();
    if (!id) { toast('動画の再生画面で使います'); return; }
    const vEl = document.querySelector('#movie_player video'), t = vEl ? Math.floor(vEl.currentTime) : 0;
    const url = 'https://www.youtube.com/watch?v=' + id + (t > 5 ? '&t=' + t : '');
    const tpl = cfg.extPlayer === 'vlc' ? 'vlc://{url}' : cfg.extPlayer === 'custom' && cfg.extTpl ? cfg.extTpl : 'ytdl://{url}';
    const target = tpl.replace('{eurl}', encodeURIComponent(url)).replace('{id}', id).replace('{url}', url);
    if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) { toast('外部プレイヤーの書式が正しくありません'); return; }
    try { vEl?.pause(); } catch { /* なし */ }
    const a = document.createElement('a'); a.href = target; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
    toast('▶ ' + (cfg.extPlayer === 'vlc' ? 'VLC' : cfg.extPlayer === 'custom' ? '外部プレイヤー' : 'mpv') + ' で開きます(動かないときは external-player フォルダの手順を)');
  }
  window.TGPerf = { openExternal };
})();
