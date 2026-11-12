// ページ本体(MAINワールド)で動く小さなスクリプト。
// 拡張機能(content.js)からの依頼で、YouTube自身のページ遷移(SPA)を使ってチャンネル/動画を開く。
// ページ全体を再読み込みせずに、メイン領域だけが切り替わる。
window.addEventListener('message', e => {
  if (e.source !== window || !e.data || !e.data.tfGo) return;
  const g = e.data.tfGo;
  const app = document.querySelector('ytd-app');
  if (!app || !g.id || !g.url) return;
  const endpoint = g.type === 'watch'
    ? { commandMetadata: { webCommandMetadata: { url: g.url, webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } }, watchEndpoint: { videoId: g.id, ...(g.list ? { playlistId: g.list } : {}) } }
    : { commandMetadata: { webCommandMetadata: { url: g.url, webPageType: 'WEB_PAGE_TYPE_CHANNEL', rootVe: 3611, apiUrl: '/youtubei/v1/browse' } }, browseEndpoint: { browseId: g.id, canonicalBaseUrl: g.url } };
  app.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint } }));
});
