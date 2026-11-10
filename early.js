// document_start で実行。リロード時のレイアウトのガタつき対策:
//  1) 保存済みの列数などの設定を、YouTubeが最初に描画する前に反映する
//  2) 拡張機能の整形(左メニューのフォルダ・ツールバー・文字サイズ調整など)が終わるまで、画面を一時的に隠す
// 解除は content.js(整形後) か、下のタイマー(最大2.5秒)のどちらか早い方。
// ※ THUMBS のキーは content.js と同じにしておくこと。
(() => {
  const root = document.documentElement;
  const p = location.pathname;
  const hideMain = p !== '/watch' && !p.startsWith('/shorts');
  // リロード時に、前のスクロール位置へ戻さない(戻すと、上のガラスバーの下に一覧の先頭が隠れた位置から始まってしまう)
  if (hideMain) { try { history.scrollRestoration = 'manual'; } catch (e) {} }
  if (hideMain) { root.setAttribute('data-tf-boot', ''); setTimeout(() => root.removeAttribute('data-tf-boot'), 2500); }
  const THUMBS = ['cols', 'scols'];
  try {
    chrome.storage.local.get('settings').then(r => {
      const s = r.settings || {}, g = s.thumb || {};
      THUMBS.forEach(k => root.toggleAttribute('data-tf-g-' + k, !!g[k]));
      const n = g.colsN || 5;
      root.style.setProperty('--tf-cols', n); root.style.setProperty('--tf-scols', g.sN || 6);
      root.style.setProperty('--tf-title-lines', 3);
      root.style.setProperty('--tf-title-fs', (n >= 7 ? 11.5 : n >= 6 ? 12 : n >= 5 ? 13 : 14) + 'px');
      root.style.setProperty('--tf-meta-fs', (n >= 6 ? 11 : 12) + 'px');
      root.toggleAttribute('data-tf-hide-create', s.hideCreate === true);
    }).catch(() => {});
  } catch (e) {}
})();
