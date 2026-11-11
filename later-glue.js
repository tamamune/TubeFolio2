// 連続再生の表示(キュー・次に見る動画)を、再生画面にそろえる。中身は extras.js(TGX)が行う。
// 以前ここにあった、再生画面の右下の「🕒 後で見る」ボタンは、やめた。代わりに、⚙ の登録メニュー(watchadd.js)から
// 「TubeFolio2 後で見る」へ登録 / 削除・再生リストへ登録・フォルダ登録 ができる。
(() => {
  if (window.__tfLaterGlue) return; window.__tfLaterGlue = true;
  try { TGX.syncQueue(); } catch (e) { /* 無視 */ }
  chrome.storage.onChanged.addListener(ch => { if (ch.queue) { try { TGX.syncQueue(); } catch (e) { /* 無視 */ } } });
})();
