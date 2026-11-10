// ブックマーク: 再生中に B キーで、その瞬間の位置を保存(元のTubeFolioの content.js から移した部分)。
// 保存先は storage の bookmarks(Drive同期の対象)。一覧は、ツールバーの「ブックマーク」ページ。
(() => {
  if (window.__tfBmKey) return; window.__tfBmKey = true;
  const esc = TG.esc;
  const isWatchPage = () => location.pathname === '/watch';
  const isShortsPage = () => location.pathname.startsWith('/shorts/');
  const currentChannel = () => (globalThis.TGPage && TGPage.currentChannel()) || null;

  // ---------- ブックマーク：再生中に B キーで、その瞬間の時間を保存 ----------
  document.addEventListener('keydown', async e => {
    if (e.key !== 'b' && e.key !== 'B') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const v = isWatchPage() ? new URLSearchParams(location.search).get('v') : isShortsPage() ? location.pathname.split('/')[2] : null;
    const video = document.querySelector('#movie_player video, ytd-reel-video-renderer[is-active] video, video');
    if (!v || !video) return;
    e.preventDefault();
    e.stopPropagation();
    const sec = Math.floor(video.currentTime || 0);
    const ch = currentChannel();
    const title = (document.querySelector('ytd-watch-metadata h1, #title h1')?.textContent || document.title.replace(/ - YouTube$/, '')).trim();
    const shot = grabFrame(video); // その瞬間の画面（サムネ用・このPCだけに保存）
    const id = v + '@' + sec + '@' + Date.now().toString(36);
    const { bookmarks = [] } = await chrome.storage.local.get('bookmarks');
    bookmarks.unshift({ id, v, t: title, ch: ch?.name || '', k: ch?.key || '', sec, d: Math.round(video.duration || 0), at: Date.now() });
    await chrome.storage.local.set({ bookmarks: bookmarks.slice(0, 3000), ...(shot ? { ['bmt:' + id]: shot } : {}) });
    // 概要欄はあとから取得して書き足す
    YTAPI.videoText(v).then(async ({ desc }) => {
      if (!desc) return;
      const { bookmarks: bs = [] } = await chrome.storage.local.get('bookmarks');
      const b = bs.find(x => x.id === id);
      if (b) { b.desc = desc.slice(0, 1500); await chrome.storage.local.set({ bookmarks: bs }); }
    }).catch(() => {});
    const mm = s => (s >= 3600 ? Math.floor(s / 3600) + ':' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') : Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0');
    bmMemo(id, `🔖 ${mm(sec)} をブックマークしました`);
    TG.log('ブックマーク', `${title}（${mm(sec)}）`);
  }, true);
  // 1行メモ（Enterで保存・Escか空のままならメモなし）。動画はそのまま再生を続ける
  function bmMemo(id, msg) {
    document.getElementById('tg-bmtoast')?.remove();
    const d = document.createElement('div');
    d.id = 'tg-bmtoast';
    d.className = 'tg-bmmemo';
    d.innerHTML = `<div class="tg-bmm-h">${esc(msg)}</div><input class="tg-bmm-in" maxlength="120" placeholder="1行メモ（Enterで保存・Escでメモなし）">`;
    (document.querySelector('#movie_player') || document.body).appendChild(d);
    const inp = d.querySelector('input');
    let closed = false;
    const close = async save => {
      if (closed) return;
      closed = true;
      const note = inp.value.trim();
      if (save && note) {
        const { bookmarks = [] } = await chrome.storage.local.get('bookmarks');
        const b = bookmarks.find(x => x.id === id);
        if (b) { b.note = note; b.noteAt = Date.now(); await chrome.storage.local.set({ bookmarks }); }
        d.querySelector('.tg-bmm-h').textContent = '📝 メモを保存しました';
        inp.remove();
        setTimeout(() => d.classList.add('out'), 900);
        setTimeout(() => d.remove(), 1500);
      } else { d.classList.add('out'); setTimeout(() => d.remove(), 400); }
      document.querySelector('#movie_player')?.focus?.();
    };
    ['keydown', 'keyup', 'keypress'].forEach(t => inp.addEventListener(t, ev => {
      ev.stopPropagation();
      if (t !== 'keydown' || ev.isComposing) return;
      if (ev.key === 'Enter') { ev.preventDefault(); close(true); }
      if (ev.key === 'Escape') { ev.preventDefault(); close(false); }
    }));
    ['click', 'mousedown', 'dblclick'].forEach(t => d.addEventListener(t, ev => ev.stopPropagation()));
    inp.addEventListener('blur', () => setTimeout(() => close(true), 150));
    setTimeout(() => inp.focus(), 30);
    // 何も打たずに12秒たったら閉じる
    setTimeout(() => { if (!closed && !inp.value) close(false); }, 12000);
  }
  function grabFrame(video) {
    try {
      const w = 480, h = Math.round(w * (video.videoHeight / video.videoWidth || 9 / 16));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(video, 0, 0, w, h);
      const url = c.toDataURL('image/jpeg', 0.72);
      return url.length > 1000 ? url : null;
    } catch { return null; } // 取り込めない動画（保護されたもの）は通常のサムネ
  }
})();
