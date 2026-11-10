// 再生画面のツールパネル：関連動画の上（右上）に、1行のタブとしてまとめる
//   ⏩ SponsorBlock の案内 / 📖 Wikipedia の事実確認 / 🧭 少しズレた関連 / 🧨 エコーチェンバー / 🏷 タグ
//   中身は、それぞれの機能（xtra.js・playerx.js）が作る要素をここへ移すだけ。初期はぜんぶたたむ（押したタブだけ開く）
//   設定：px.toolPanel（既定オン・Drive 同期の対象）。オフなら、要素を元の場所へ戻す
(() => {
  if (window.__tgToolPanel) return;
  window.__tgToolPanel = true;
  const TABS = [
    ['sb', '⏩ SponsorBlock', '.tg-sbinfo'],
    ['wiki', '📖 事実確認', '#tg-wiki'],
    ['nth', '🧭 ズレた関連', '#tg-nth'],
    ['echo', '🧨 エコーチェンバー', '#tg-echo'],
    ['tags', '🏷 タグ', '.tg-tags'],
    ['desc', '📝 元の概要欄', '.tg-origdesc']
  ];
  let on = true, open = '', lastV = '', sig = '';
  const curV = () => (location.pathname.startsWith('/watch') ? new URLSearchParams(location.search).get('v') || '' : '');
  const load = () => chrome.storage.local.get('px').then(r => { on = r.px?.toolPanel !== false; tick(); });
  load();
  chrome.storage.onChanged.addListener(ch => { if (ch.px) load(); });

  // 関連動画の欄（画面が狭いと YouTube はこれを動画の下へ移すので、見えている方を使う）
  function host() {
    const vis = el => el && el.getClientRects().length > 0;
    const rel = document.querySelector('ytd-watch-flexy:not([hidden]) #related');
    if (vis(rel)) return rel;
    const inner = document.querySelector('ytd-watch-flexy:not([hidden]) #secondary-inner');
    if (vis(inner)) return inner;
    const below = document.querySelector('ytd-watch-flexy:not([hidden]) #below');
    return vis(below) ? below : null;
  }

  function dismantle(panel, h) { // オフにしたら、要素を元の場所へ戻す
    panel.querySelectorAll('.tg-tp-pane').forEach(b => {
      b.classList.remove('tg-tp-pane', 'tg-on');
      if (b.classList.contains('tg-sbinfo')) document.querySelector('ytd-watch-metadata #title')?.after(b);
      else if (h) h.prepend(b);
      else b.remove();
    });
    panel.remove();
  }

  function tick() {
    const v = curV();
    let panel = document.getElementById('tg-tools');
    const h = host();
    if (!v || !on) { if (panel) dismantle(panel, h); return; }
    if (v !== lastV) { lastV = v; open = ''; sig = ''; }
    if (!h) return;
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'tg-tools';
      panel.innerHTML = '<div class="tg-tp-bar"></div><div class="tg-tp-body"></div>';
      panel.addEventListener('click', e => {
        const b = e.target.closest('.tg-tp-tab');
        if (!b) return;
        open = open === b.dataset.tp ? '' : b.dataset.tp;
        sig = '';
        tick();
      });
      // 動画の再生キーなどが拾わないように
      ['keydown', 'keyup'].forEach(t => panel.addEventListener(t, e => e.stopPropagation()));
    }
    if (h.firstElementChild !== panel) h.prepend(panel);
    const body = panel.querySelector('.tg-tp-body'), bar = panel.querySelector('.tg-tp-bar');
    const tabs = [];
    for (const [id, label, sel] of TABS) {
      const box = document.querySelector(sel);
      if (!box) continue;
      if (box.parentElement !== body) body.appendChild(box);
      box.classList.add('tg-tp-pane');
      box.dataset.tp = id;
      let lb = label, cls = '';
      if (id === 'sb') { // 登録の有無を、タブの名前と色で
        const st = box.classList.contains('found') ? 'found' : box.classList.contains('none') ? 'none' : 'error';
        lb += st === 'found' ? ' ✓' : st === 'none' ? '（なし）' : '（?）';
        cls = ' sb-' + st;
      }
      if (id === 'wiki' && box.querySelectorAll('.tg-wiki-it').length > 1 && !box.querySelector('.tg-wk-btn')) {
        const n = box.querySelectorAll('.tg-wiki-it').length;
        const bt = document.createElement('button');
        bt.className = 'tg-wk-btn';
        bt.textContent = `もっと見る（残り ${n - 1} 件）`;
        bt.addEventListener('click', e => { e.preventDefault(); const m = box.classList.toggle('tg-wk-more'); bt.textContent = m ? '閉じる' : `もっと見る（残り ${n - 1} 件）`; });
        box.appendChild(bt);
      }
      tabs.push([id, lb, cls]);
    }
    if (open && !tabs.some(t => t[0] === open)) open = '';
    body.querySelectorAll('.tg-tp-pane').forEach(b => b.classList.toggle('tg-on', b.dataset.tp === open));
    const dd = body.querySelector('.tg-origdesc'); if (dd) dd.open = open === 'desc'; // 元の概要欄は、タブを開いたら中身も開く
    panel.hidden = !tabs.length;
    const s = tabs.map(t => t.join('|')).join('/') + '#' + open;
    if (s !== sig) {
      sig = s;
      bar.innerHTML = tabs.map(([id, lb, cls]) => `<button class="tg-tp-tab${cls}${open === id ? ' on' : ''}" data-tp="${id}">${lb}</button>`).join('');
    }
  }
  setInterval(tick, 700);
})();
