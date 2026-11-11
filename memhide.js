// 動画の一覧(ホーム・検索・登録チャンネル・チャンネルのページ)で、メンバー限定の動画を隠す／表示する
//   切り替えは、上のガラスバーの 👁(表示の切り替え)→「メンバー限定の動画を隠す」(content.js)。設定は storage の hideMembers（登録チャンネル画面と共通・Drive同期の対象）
//   メンバー限定の判定：サムネの「メンバー限定」バッジ。タイトルの文字だけでは判定しない（タイトルに「メンバー限定」と書いてあるだけの動画を隠さないため）
(() => {
  if (window.__tgMemHide) return;
  window.__tgMemHide = true;
  const ITEM = 'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, yt-lockup-view-model';
  const BADGE = '[class*="members-only" i], [class*="membership" i], ytd-badge-supported-renderer, .yt-badge-shape, badge-shape, yt-thumbnail-badge-view-model, #badges';
  const TXT = /メンバー限定|メンバーシップ限定|Members[\s-]*only|Members first/i;
  const isList = () => !/^\/(watch|shorts|playlist)/.test(location.pathname); // 再生画面・再生リストの中身では、隠さない
  let hide = false;

  const apply = () => document.documentElement.classList.toggle('tg-hidemem', hide && isList());
  chrome.storage.local.get('hideMembers').then(r => { hide = !!r.hideMembers; apply(); });
  chrome.storage.onChanged.addListener(ch => { if (ch.hideMembers) { hide = !!ch.hideMembers.newValue; apply(); } });

  function isMember(item) {
    for (const b of item.querySelectorAll(BADGE)) {
      if (/members-only|membership/i.test(String(b.className?.baseVal ?? b.className ?? ''))) return true;
      if (TXT.test(b.textContent || '') || TXT.test(b.getAttribute('aria-label') || '')) return true;
    }
    return false;
  }

  function scan() {
    apply();
    if (!hide || !isList() || document.hidden) return;
    for (const it of document.querySelectorAll(ITEM)) {
      if (it.closest('#tg-feed, #tg-hf-list')) continue;
      if (isMember(it)) { if (it.dataset.tgMem !== '1') it.dataset.tgMem = '1'; }
      else if (it.dataset.tgMem) delete it.dataset.tgMem;
    }
  }
  setInterval(scan, 1000);
})();
