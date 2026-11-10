// 再生した動画のタグの記録(playedTags)。30秒以上見た動画(ショート以外)ごとに1回、投稿者が設定したタグを溜める。
// 管理は tagmgr.js(⚙ 設定 →「🏷 タグを管理する」)。元のTubeFolioの content.js から移した部分。
(() => {
  if (window.__tfPlayedTags) return; window.__tfPlayedTags = true;
  const tagRecorded = new Set(), tagSecs = {};
  async function recordPlayedTags(id) {
    if (!id || tagRecorded.has(id)) return;
    tagRecorded.add(id);
    try {
      const o = await YTAPI.videoOwner(id);
      const chNames = new Set(Object.values(((globalThis.TGPage && TGPage.state()) || {}).channels || {}).map(c => (c.name || '').toLowerCase()));
      const seen = new Set();
      const { playedTags = {} } = await chrome.storage.local.get('playedTags');
      for (let t of o?.kw || []) {
        t = String(t).trim(); const k = t.toLowerCase();
        if (t.length < 2 || t.length > 20 || seen.has(k) || chNames.has(k) || /^(youtube|video|動画|vlog|shorts?)$/i.test(t)) continue;
        seen.add(k);
        const e = playedTags[k] || { t, n: 0 };
        if (e.ng) continue;                    // 「追加しないタグ」に入れたもの
        if (e.x) { e.x = false; e.n = 0; }      // 一度消しただけのタグは、また見たら増やす
        e.n++; e.at = Date.now(); playedTags[k] = e;
      }
      const keys = Object.keys(playedTags);
      // 多すぎたら古いものから捨てる（自分で追加したもの・📌 消さないタグ・追加しないタグは残す）
      const auto = keys.filter(k => !playedTags[k].own && !playedTags[k].keep && !playedTags[k].ng);
      if (keys.length > 500) auto.sort((a, b) => playedTags[a].at - playedTags[b].at).slice(0, keys.length - 500).forEach(k => delete playedTags[k]);
      await chrome.storage.local.set({ playedTags });
    } catch { tagRecorded.delete(id); }
  }
  // 再生中の秒数を数える(動画が再生されている間、1秒ごとに加算)
  setInterval(() => {
    if (location.pathname !== '/watch') return;
    const v = new URLSearchParams(location.search).get('v'), el = document.querySelector('#movie_player video');
    if (!v || !el || el.paused || el.ended || document.querySelector('#movie_player.ad-showing')) return;
    if (!tagRecorded.has(v) && ((tagSecs[v] = (tagSecs[v] || 0) + 1) >= 30)) recordPlayedTags(v);
  }, 1000);
})();
