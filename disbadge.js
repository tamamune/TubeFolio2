// TubeFolio2 のページ(新着動画・ライブ・ショート・視聴・検索)のサムネに、低評価の割合(👎 12%)を出す。
// 元のTubeFolioの xtra.js(YouTube側の一覧に出す機能)と同じ表示。割合は Return YouTube Dislike の推定を、バックグラウンド経由('ryd')で取る。
// 設定は px.disBadge(⚙ 設定 → 再生・動画 →「サムネに低評価率」。YouTube側の一覧と共通)
(() => {
  if (window.__tfDisb) return; window.__tfDisb = true;
  let on = true; const mem = new Map(), q = []; let busy = 0, scanT = 0;
  chrome.storage.local.get('px').then(r => { on = !r.px || r.px.disBadge !== false; apply(); });
  chrome.storage.onChanged.addListener(ch => { if (ch.px) { on = !ch.px.newValue || ch.px.newValue.disBadge !== false; apply(); } });
  const vidOf = a => ((a.getAttribute('href') || '').match(/[?&]v=([\w-]{11})/) || [])[1];
  function paint(card, v) {
    const r = mem.get(v); if (!on || r == null) return; // -1 = 評価が少なくて推定できない(新しい動画など): 「👎 -」と灰色で出す
    const th = card.querySelector('.th'); if (!th) return;
    let b = th.querySelector(':scope > .tg-disb');
    if (!b) { b = document.createElement('span'); b.className = 'tg-disb'; th.appendChild(b); }
    const na = r < 0; b.textContent = na ? '👎 -' : `👎 ${Math.round(r * 100)}%`; b.classList.toggle('hi', !na && r >= 0.3); b.classList.toggle('na', na);
    b.title = na ? '評価の数が少なくて、低評価の割合を推定できません(新しい動画など)' : `低評価の割合(Return YouTube Dislike の推定)${r >= 0.3 ? '・30% 以上' : ''}`;
  }
  function apply() {
    if (!on) { document.querySelectorAll('.tg-disb').forEach(e => e.remove()); return; }
    // 再表示: 前に処理した印(data-tgdis)を外して、全カードを見直す(覚えてある割合は、すぐ描く)
    document.querySelectorAll('a.card[data-tgdis]').forEach(c => { c.removeAttribute('data-tgdis'); const v = vidOf(c); if (v && mem.has(v)) paint(c, v); });
    scan();
  }
  async function pump() {
    while (q.length && busy < 3) {
      const { card, v } = q.shift();
      if (mem.has(v)) { paint(card, v); continue; }
      busy++;
      chrome.runtime.sendMessage({ type: 'ryd', v }).catch(() => null).then(r => { if (!r) return; mem.set(v, r.likes + r.dislikes >= 5 ? r.dislikes / (r.likes + r.dislikes) : -1); paint(card, v); }).finally(() => { busy--; pump(); });
    }
  }
  const io = new IntersectionObserver(es => { es.forEach(e => { if (!e.isIntersecting) return; io.unobserve(e.target); const v = vidOf(e.target); if (!v) return; if (mem.has(v)) paint(e.target, v); else { q.push({ card: e.target, v }); pump(); } }); }, { rootMargin: '600px' });
  function scan() { document.querySelectorAll('a.card[href*="watch?v="]:not([data-tgdis])').forEach(c => { c.dataset.tgdis = '1'; io.observe(c); }); }
  new MutationObserver(() => { if (!scanT && !/^\/(watch|shorts)/.test(location.pathname)) scanT = setTimeout(() => { scanT = 0; if (on) scan(); }, 300); }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
