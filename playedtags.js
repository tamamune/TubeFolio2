// 再生した動画のタグの記録(playedTags)。30秒以上見た動画(ショート以外)ごとに1回、投稿者が設定したタグを溜める。
// 管理は tagmgr.js(⚙ 設定 →「🏷 タグを管理する」)。元のTubeFolioの content.js から移した部分。
(() => {
  if (window.__tfPlayedTags) return; window.__tfPlayedTags = true;
  const tagRecorded = new Set(), tagSecs = {};
  // YouTube のページ側(mainworld.js)に頼んで、今のプレイヤーが持っている動画の情報(タグ)を読む。通信しないので確実で速い
  let mSeq = 0;
  const pageMeta = () => new Promise(res => {
    const id = 'pt' + (++mSeq);
    const on = e => { let d; try { d = JSON.parse(e.detail); } catch { return; } if (d.id !== id) return; document.removeEventListener('tg-res', on); clearTimeout(t); res(d.result); };
    const t = setTimeout(() => { document.removeEventListener('tg-res', on); res(null); }, 2000);
    document.addEventListener('tg-res', on);
    document.dispatchEvent(new CustomEvent('tg-cmd', { detail: JSON.stringify({ id, op: 'meta', args: {} }) }));
  });
  const log = m => { try { TG.log('ランダムタグ', m); } catch { /* なし */ } };
  async function recordPlayedTags(id) {
    if (!id || tagRecorded.has(id)) return;
    tagRecorded.add(id);
    try {
      // タグ: 再生中の動画の情報(ページ側) → 取れなければ YouTube に問い合わせる
      const m = await pageMeta();
      // 読む順: ①ページ側のプレイヤーの情報 → ②YouTube に問い合わせ → ③動画ページの中身。①が「タグなし」でも、②③で確かめる
      //   (以前は、①が空(プレイヤーがタグを持っていない・スマホのブラウザなど)だと、そこで「タグがありません」として、登録されなかった)
      let kw = m && m.v === id && m.kw && m.kw.length ? m.kw : null, title = '', src = kw ? 'ページ' : '';
      if (!kw) { try { const o = await YTAPI.videoOwner(id); if (o && o.kw && o.kw.length) { kw = o.kw; src = '問い合わせ'; } title = (o && o.t) || ''; } catch (e) { /* ③へ */ } }
      if (!kw) { try { const h = await (await fetch('/watch?v=' + encodeURIComponent(id), { credentials: 'include' })).text(), mm = h.match(/"keywords":(\[(?:"(?:[^"\\]|\\.)*",?)*\])/); if (mm) { const a = JSON.parse(mm[1]); if (a.length) { kw = a; src = '動画ページ'; } } } catch (e) { /* なし */ } }
      if (!kw) { if (!m || m.v !== id) throw new Error('動画の情報がまだ読めません'); kw = []; }
      if (!title) title = (document.querySelector('ytd-watch-metadata h1, #title h1')?.textContent || '').trim() || id;
      const chNames = new Set(Object.values(((globalThis.TGPage && TGPage.state()) || {}).channels || {}).map(c => (c.name || '').toLowerCase()));
      const seen = new Set(), added = [], skipped = [];
      const { playedTags = {} } = await chrome.storage.local.get('playedTags');
      for (let t of kw || []) {
        t = String(t).trim(); const k = t.toLowerCase();
        if (t.length < 2 || t.length > 20 || seen.has(k) || chNames.has(k) || /^(youtube|video|動画|vlog|shorts?)$/i.test(t)) { if (t && !seen.has(k)) skipped.push(t); continue; }
        seen.add(k);
        const isNew = !playedTags[k] || !!playedTags[k].x;
        const e = playedTags[k] || { t, n: 0 };
        if (e.ng) continue;                    // 「追加しないタグ」に入れたもの
        if (e.x) { e.x = false; e.n = 0; }      // 一度消しただけのタグは、また見たら増やす
        if (isNew) e.first = Date.now();        // 初めて(または消したあと再び)入った時刻。🆕 の目印と「新しい順」に使う
        e.n++; e.at = Date.now(); playedTags[k] = e; added.push(t);
      }
      log(added.length ? `「${title}」から ${added.length}個(${src}): ${added.join('、')}` : `「${title}」はタグがありません${skipped.length ? `(長すぎる・チャンネル名などで除外 ${skipped.length}個)` : '(投稿者がタグを設定していない動画)'}`);
      const keys = Object.keys(playedTags);
      // 多すぎたら古いものから捨てる（自分で追加したもの・📌 消さないタグ・追加しないタグは残す）
      const auto = keys.filter(k => !playedTags[k].own && !playedTags[k].keep && !playedTags[k].ng);
      if (keys.length > 500) auto.sort((a, b) => playedTags[a].at - playedTags[b].at).slice(0, keys.length - 500).forEach(k => delete playedTags[k]);
      await chrome.storage.local.set({ playedTags });
    } catch (err) { tagRecorded.delete(id); tagSecs[id] = 0; log(`タグを読めませんでした(30秒後にもう一度): ${String((err && err.message) || err)}`); } // 毎秒やり直さず、また30秒見たら
  }
  // 再生中の秒数を数える(動画が再生されている間、1秒ごとに加算)
  setInterval(() => {
    if (location.pathname !== '/watch') return;
    const v = new URLSearchParams(location.search).get('v'), el = document.querySelector('#movie_player video');
    if (!v || !el || el.paused || el.ended || document.querySelector('#movie_player.ad-showing')) return;
    if (!tagRecorded.has(v) && ((tagSecs[v] = (tagSecs[v] || 0) + 1) >= 30)) recordPlayedTags(v);
  }, 1000);
})();
