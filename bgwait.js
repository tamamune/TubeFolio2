// 裏のタブでは、表示されるまで再生しない(px.bgWait。既定はオン。Drive同期の対象)。
//   ブラウザは「開いてから一度も表示していないタブ」の再生を止めておくが、一度表示したタブを再読み込みしたとき
//   (F5・ツールバーの更新ボタン・セッションの復元など)は、裏にあっても再生が始まってしまう。
//   ページを読み込んだ時点でタブが裏にあれば、表示されるまで再生を止めておき、表示されたら再生する。
(() => {
  if (window.__tfBgWait) return; window.__tfBgWait = true;
  let on = true, waiting = document.hidden, held = false;
  const read = px => { on = (px || {}).bgWait !== false; };
  try { chrome.storage.local.get('px').then(r => read(r.px)); chrome.storage.onChanged.addListener(ch => { if (ch.px) read(ch.px.newValue); }); } catch { /* なし */ }
  const isPage = () => location.pathname === '/watch' || location.pathname.startsWith('/shorts/');
  const isMain = v => !!(v && v.closest && v.closest('#movie_player, #shorts-player, ytd-reel-video-renderer'));
  document.addEventListener('play', e => {
    if (!on || !waiting || !document.hidden || !isPage() || !isMain(e.target)) return;
    e.target.pause(); held = true;
  }, true);
  // このスクリプトが動く前(読み込みの途中)に、もう再生が始まっていたら止める
  const sweep = () => { if (!on || !waiting || !document.hidden || !isPage()) return; const v = document.querySelector('#movie_player video, #shorts-player video'); if (v && !v.paused) { v.pause(); held = true; } };
  try { chrome.storage.local.get('px').then(r => { read(r.px); sweep(); }); } catch { /* なし */ }
  sweep();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !waiting) return;
    waiting = false; // 一度表示したら、あとは何もしない
    if (!held || !on) return;
    const v = document.querySelector('#movie_player video, #shorts-player video');
    if (v && v.paused) v.play().catch(() => { /* ブラウザに止められたら、そのまま */ });
  });
})();
