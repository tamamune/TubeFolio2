// YouTube のサムネのホバープレビューを、音声あり・倍速に(元のTubeFolioの content.js から移した部分)。
// 設定は px: hoverSound / hoverVol / hoverFast(⚙ 設定 → 再生・動画 →「サムネのプレビュー」)
(() => {
  if (window.__tfHoverTune) return; window.__tfHoverTune = true;
  const PXH0 = { hoverSound: true, hoverVol: 30, hoverFast: true };
  let PXH = { ...PXH0 };
  chrome.storage.local.get('px').then(r => { PXH = { ...PXH0, ...(r.px || {}) }; });
  chrome.storage.onChanged.addListener(ch => { if (ch.px) PXH = { ...PXH0, ...(ch.px.newValue || {}) }; });
  const hoverVol = () => Math.min(1, Math.max(0.01, (+PXH.hoverVol || 30) / 100));
  const isPreview = v => v.tagName === 'VIDEO' && !v.closest('ytd-shorts, ytd-reel-video-renderer, #shorts-player, #tg-mini, ytd-watch-flexy #player-container, ytd-miniplayer')
    && (!!v.closest('#inline-preview-player, ytd-video-preview, #video-preview, ytd-moving-thumbnail-renderer, [id*="preview" i]') || !v.closest('#movie_player'));
  const hovStart = new WeakMap();
  function tuneHover(v) {
    if (!hovStart.has(v)) hovStart.set(v, Date.now());
    if (Date.now() - hovStart.get(v) > 1500) return; // 始まってすぐだけ合わせる（そのあと自分で変えたものは尊重）
    if (PXH.hoverFast && v.playbackRate !== 2) try { v.playbackRate = 2; } catch { /* なし */ }
    if (PXH.hoverSound) {
      const vol = hoverVol();
      if (Math.abs(v.volume - vol) > 0.005) v.volume = vol; // 設定の音量に（大きすぎないように）
      if (v.muted) v.muted = false;
    }
  }
  ['playing', 'loadeddata', 'ratechange', 'volumechange'].forEach(t => document.addEventListener(t, e => {
    const v = e.target;
    if (!isPreview(v)) return;
    if (t === 'loadeddata') hovStart.delete(v);
    tuneHover(v);
  }, true));

})();
