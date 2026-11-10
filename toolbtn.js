// プレイヤーのボタンをまとめる：右下に並ぶ TubeFolio のボタン5個（コメント・ツール・字幕・読み上げ・チャンネル設定）を、
//   「TubeFolio」ボタン1個にして、押すと小さなメニューを開く（2×3 のポップアップ）
//   中身は作り直さず、元のボタンを押す（元のボタンは見えなくするだけで残す）
//   設定：px.tbMerge（既定オン）。Drive 同期の対象（px の中）
(() => {
  if (window.__tgToolBtn) return;
  window.__tgToolBtn = true;
  const ITEMS = [
    // [id, 元のボタン, アイコン, 名前, 補足]
    ['cm', '.tg-c-btn', '💬', 'コメント', () => ''],
    ['tool', '.tg-px-tool', '⚡', 'ツール', b => (b.classList.contains('on') ? '変更中' : 'A-B・スクショ')],
    ['sub', '.tg-px-sub', '字', '字幕', b => (b.classList.contains('on') ? 'オン' : '')],
    ['spk', '.tg-px-spk', '読', '読み上げ', b => (b.classList.contains('on') ? 'ON' : 'OFF')],
    ['ch', '.tg-px-chbtn', '⚙', 'チャンネル', b => (b.classList.contains('on') ? '設定あり' : '')]
  ];
  let merge = true;
  const load = () => chrome.storage.local.get('px').then(r => { merge = r.px?.tbMerge !== false; tick(); });
  load();
  chrome.storage.onChanged.addListener(ch => { if (ch.px) load(); });

  const player = () => document.getElementById('movie_player');
  const bar = p => p?.querySelector('.ytp-right-controls-left') || p?.querySelector('.ytp-right-controls');
  const origOf = (p, sel) => bar(p)?.querySelector(sel) || p?.querySelector(sel);

  function closeMenu() { document.querySelector('.tg-tb-menu')?.remove(); document.querySelector('.tg-tb-btn')?.classList.remove('open'); }

  function openMenu() {
    const p = player();
    if (!p) return;
    closeMenu();
    const items = ITEMS.map(([id, sel, ic, name, info]) => {
      const b = origOf(p, sel);
      return b ? { id, sel, ic, name, sub: info(b), on: b.classList.contains('on') } : null;
    }).filter(Boolean);
    if (!items.length) return;
    const m = document.createElement('div');
    m.className = 'tg-tb-menu tg-tb-grid';
    m.innerHTML = '<div class="tg-tb-h">TubeFolio<button class="tg-tb-x" title="閉じる">✕</button></div>' + items.map(x =>
      `<button class="tg-tb-it${x.on ? ' on' : ''}" data-id="${x.id}"><i>${x.ic}</i><b>${x.name}</b>${x.sub ? `<small>${x.sub}</small>` : ''}</button>`).join('');
    ['mousedown', 'mouseup', 'dblclick', 'keydown', 'keyup'].forEach(t => m.addEventListener(t, e => e.stopPropagation()));
    m.addEventListener('click', e => {
      e.stopPropagation();
      if (e.target.closest('.tg-tb-x')) { closeMenu(); return; }
      const it = e.target.closest('.tg-tb-it');
      if (!it) return;
      const def = ITEMS.find(x => x[0] === it.dataset.id);
      closeMenu();
      origOf(p, def[1])?.click(); // 元のボタンを押す（それぞれの画面が開く）
    });
    p.appendChild(m);
    document.querySelector('.tg-tb-btn')?.classList.add('open');
  }

  function tick() {
    const p = player();
    const root = document.documentElement;
    const on = merge && !!p && /^\/watch/.test(location.pathname);
    root.classList.toggle('tg-tbm', on);
    const ctr = bar(p);
    let b = p?.querySelector('.tg-tb-btn');
    if (!on || !ctr) { b?.remove(); closeMenu(); if (!on) return; if (!ctr) return; }
    if (b && !ctr.contains(b)) { b.remove(); b = null; }
    if (!b) {
      b = document.createElement('button');
      b.className = 'ytp-button tg-tb-btn';
      b.title = 'TubeFolio のツール（コメント・ツール・字幕・読み上げ・チャンネル設定）';
      b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"/></svg>';
      ['mousedown', 'keydown'].forEach(t => b.addEventListener(t, e => e.stopPropagation()));
      b.addEventListener('click', e => { e.stopPropagation(); document.querySelector('.tg-tb-menu') ? closeMenu() : openMenu(); });
      ctr.insertBefore(b, ctr.firstChild);
    }
    // 変更中・オンのものがあれば、ボタンに印
    b.classList.toggle('on', ITEMS.some(([, sel, , , ]) => { const o = origOf(p, sel); return o && o.classList.contains('on') && sel !== '.tg-px-chbtn'; }));
  }
  document.addEventListener('mousedown', e => { if (!e.target.closest?.('.tg-tb-menu, .tg-tb-btn')) closeMenu(); }, true);
  setInterval(tick, 500);
})();
