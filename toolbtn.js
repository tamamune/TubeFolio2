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
    // プレイヤーが小さい(スマホなど)ときは、メニューがプレイヤーからはみ出して切れるので、画面に固定して真ん中に出す(全画面のときは、プレイヤーの中)
    const pr = p.getBoundingClientRect(), small = (pr.width < 440 || pr.height < 300) && !document.fullscreenElement;
    if (small) { m.classList.add('tg-tb-fix'); document.body.appendChild(m); } else p.appendChild(m);
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
  document.addEventListener('pointerdown', e => { if (!e.target.closest?.('.tg-tb-menu, .tg-tb-btn')) closeMenu(); }, true);

  // ---- タッチ操作(スマホのブラウザ): プレイヤーの中に足したボタンが「押せない」のを直す ----
  //   YouTube のプレイヤーは、指で触れたときの動き(touchstart / touchend)を自分で処理して、ブラウザが作る「クリック」を止めてしまう。
  //   そのため、拡張機能が足したボタン(クリックで動く)は、指で押しても何も起きなかった。
  //   → 拡張機能のボタン(クラス名が tg- / tf- で始まるもの)に指で触れたときは、プレイヤーに渡さず、指を離したところで、こちらでクリックを起こす。
  //   マウスの操作には関係しない(タッチのときだけ)。スライダー・入力欄・選択は、ブラウザの動きのまま
  const OURS = '[class^="tg-"], [class*=" tg-"], [class^="tf-"], [class*=" tf-"], [id^="tg-"], [id^="tf-"]';
  const tapTarget = t => {
    if (!t || !t.closest) return null;
    if (t.closest('input, select, textarea, [contenteditable="true"]')) return null;
    const b = t.closest('button, [role="button"], a, label, summary'); if (!b || !b.closest(OURS)) return null;
    return b.closest('#movie_player, .tg-tb-menu') ? b : null;
  };
  let tap = null;
  document.addEventListener('touchstart', e => { const b = tapTarget(e.target), t = e.changedTouches[0]; tap = b && e.touches.length === 1 ? { b, x: t.clientX, y: t.clientY, at: Date.now() } : null; if (tap) e.stopPropagation(); }, { capture: true, passive: true });
  document.addEventListener('touchmove', e => { if (!tap) return; const t = e.changedTouches[0]; if (Math.abs(t.clientX - tap.x) + Math.abs(t.clientY - tap.y) > 14) tap = null; else e.stopPropagation(); }, { capture: true, passive: true });
  document.addEventListener('touchcancel', () => { tap = null; }, true);
  document.addEventListener('touchend', e => {
    const c = tap; tap = null; if (!c || !c.b.isConnected || Date.now() - c.at > 800) return;
    e.stopPropagation(); if (e.cancelable) e.preventDefault(); // ブラウザが作るクリック(二重になる)は止めて、こちらで1回だけ起こす
    c.b.click();
  }, { capture: true, passive: false });
  setInterval(() => { if (!(window.tfQuiet && window.tfQuiet())) tick(); }, 500);
})();
