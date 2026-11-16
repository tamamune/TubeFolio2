// ショート(/shorts/…)の操作パネル。画面の左に浮かべる(パソコン: マウスで押す / スマホ: 指で押す。同じボタンで、指のときは大きくなる)
//   ⏪5 / 5⏩ : 5秒戻る・進む(押し続けると、くり返す)
//   🎞 コマ送り: 入れると一時停止して、◀コマ・コマ▶ が出る(1コマ = 1/30秒。押し続けると、くり返す)
//   ▲ ▼ : 前の動画 / 次の動画(パソコンでは、YouTube の上下の矢印を消して、これに置き換える)
//   ⏭ 自動で次へ: 入れると、動画の最後まで来たら、次のショートへ移る(ショートは、ふだんは繰り返し再生される)。設定は px.shAuto(Drive で同期)
//   🕒 後で見る: 再生リスト「TubeFolio2 後で見る」に、今のショートを追加(登録済みなら ✓ になり、押すと外す)
//   🖥 クリア: 動画以外の表示(題名・ボタン・上のバー・矢印)を隠す。画面の左の小さなボタンか Esc で戻る
//   時間: 「今回」= ショートを開いてから、実際に再生した時間 / 「本日」= 今日、この端末で見たショートの合計(shDay。端末ごとの数なので同期しない)
// www.youtube.com と m.youtube.com の両方で動く(スマホ版 Vivaldi は、background.js が www をパソコン表示で開くので、ふだんは www)。
// ダーク / ライト: YouTube の html[dark] に合わせる。色は --sh-* の変数で持つ
(() => {
  if (window.__tfShTools) return; window.__tfShTools = true;
  const onShorts = () => location.pathname.startsWith('/shorts');
  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } };
  const sget = k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  const sset = (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* 無視 */ } };
  const E = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const ymd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fmt = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  const curId = () => { const m = location.pathname.match(/^\/shorts\/([\w-]{11})/); return m ? m[1] : ''; };

  // ---- 状態 ----
  let auto = false, clear = sget('tfShClear') === '1', frame = false, folded = sget('tfShFold') === '1';
  let sess = 0, pending = 0, todayBase = 0, todayDay = ymd(), laterIds = new Set(), laterList = '', busy = false, armed = true;

  // ---- 見た目 ----
  const css = `
#tfsh{--sh-bg:rgba(255,255,255,.9);--sh-fg:#111;--sh-sub:#555;--sh-line:rgba(0,0,0,.2);--sh-chip:rgba(0,0,0,.08);--sh-hv:rgba(0,0,0,.16);--sh-on:#1a73e8;--sh-onfg:#fff;--sh-ok:#1e8e3e;
  position:fixed;left:84px;top:50%;transform:translateY(-50%);z-index:3000;display:flex;flex-direction:column;gap:6px;width:132px;padding:8px;box-sizing:border-box;border-radius:14px;background:var(--sh-bg);color:var(--sh-fg);border:1px solid var(--sh-line);box-shadow:0 2px 12px rgba(0,0,0,.35);backdrop-filter:blur(8px);font:12px/1.3 Roboto,Arial,"Noto Sans JP",sans-serif;user-select:none;-webkit-user-select:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
html[dark] #tfsh{--sh-bg:rgba(32,32,32,.88);--sh-fg:#f1f1f1;--sh-sub:#bdbdbd;--sh-line:rgba(255,255,255,.22);--sh-chip:rgba(255,255,255,.12);--sh-hv:rgba(255,255,255,.24);--sh-on:#3ea6ff;--sh-onfg:#0b0b0b;--sh-ok:#5fd68a}
#tfsh[hidden]{display:none}
#tfsh .sh-r{display:flex;gap:6px}
#tfsh .sh-r[hidden]{display:none}
#tfsh button{flex:1 1 0;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:3px;box-sizing:border-box;height:34px;padding:0 4px;border:1px solid var(--sh-line);border-radius:10px;background:var(--sh-chip);color:var(--sh-fg);font:600 13px/1 Roboto,Arial,"Noto Sans JP",sans-serif;white-space:nowrap;cursor:pointer;touch-action:manipulation}
#tfsh button:hover{background:var(--sh-hv)}
#tfsh button:active{transform:scale(.96)}
#tfsh button.on{background:var(--sh-on);color:var(--sh-onfg);border-color:var(--sh-on)}
#tfsh button.done{border-color:var(--sh-ok);color:var(--sh-ok)}
#tfsh button[disabled]{opacity:.55;cursor:default}
#tfsh .sh-t{font:600 11px/1.5 Roboto,Arial,"Noto Sans JP",sans-serif;color:var(--sh-sub);font-variant-numeric:tabular-nums;text-align:center}
#tfsh .sh-t b{color:var(--sh-fg);font-size:13px}
#tfsh .sh-n{min-height:14px;text-align:center;color:var(--sh-sub);font-size:11px}
#tfsh .sh-fold{height:22px;font-size:11px}
#tfsh.fold{width:auto;padding:6px}
#tfsh.fold > :not(.sh-head){display:none}
#tfsh.fold .sh-fold{height:34px;width:34px;flex:none}
#tfsh.clr{width:auto;padding:4px;background:transparent;border-color:transparent;box-shadow:none;backdrop-filter:none;opacity:.35}
#tfsh.clr:hover,#tfsh.clr:focus-within{opacity:1}
#tfsh.clr > :not(.sh-clrrow){display:none}
#tfsh.clr .sh-clr{width:38px;flex:none;background:var(--sh-bg)}
/* スマホ・狭い画面: 文字を隠して、アイコンだけの細い縦の帯にする(動画をじゃましない。指で押しやすい大きさ) */
@media all{
#tfsh{width:62px;gap:8px;padding:8px 6px;border-radius:31px;align-items:center}
#tfsh .sh-r{flex-direction:column;align-items:center}
#tfsh button{flex:none;width:46px;height:46px;padding:0;font-size:20px;border-radius:50%}
#tfsh .l{display:none}
#tfsh .sh-t{font-size:10px;line-height:1.3}#tfsh .sh-t b{display:block;font-size:12px}#tfsh .sh-t br{display:none}
#tfsh .sh-fold{height:46px;width:46px;font-size:18px}
#tfsh.fold{width:auto;border-radius:31px}#tfsh.fold .sh-fold{height:46px;width:46px}
#tfsh.clr{border-radius:50%}#tfsh.clr .sh-clr{width:46px}
#tfsh [data-a=prev],#tfsh [data-a=next]{font-size:17px}
#tfsh [data-a=back],#tfsh [data-a=fwd]{font-size:15px}
#tfsh .sh-t{font-size:11px}#tfsh .sh-t b{font-size:13px}
#tfsh .sh-n{font-size:10px;word-break:break-all}}
/* スマホ・狭い画面: 右の端に固定。右の端のぶんだけ、YouTubeの動画の領域を狭めて、重ならないようにする。指で押す大きさ */
@media (pointer:coarse),(max-width:900px){
#tfsh{left:auto;right:4px}
#tfsh button{font-size:19px}
#tfsh [data-a=back],#tfsh [data-a=fwd]{font-size:14px}
html[data-tfsh-m] ytd-shorts #shorts-container{width:calc(100% - 68px) !important}}
/* パソコン: 動画のすぐ右・下揃えに置く(YouTube の👍💬ボタンは、その右へずらす = --tfsh-aw)。窓が狭くて入らないときは、動画ごと左へずらす(--tfsh-shift)。YouTube の上下の矢印は消す(▲▼で置き換え) */
html[data-tfsh-d] ytd-shorts #shorts-container{transform:translateX(calc(var(--tfsh-shift,0) * -1px))}
html[data-tfsh-d] #tfsh{top:auto;transform:none}
html[data-tfsh-d] ytd-shorts ytd-reel-player-overlay-renderer #actions{transform:translateX(var(--tfsh-aw,0px))}
html[data-tfsh-d] ytd-shorts #navigation-container,html[data-tfsh-d] ytd-shorts #navigation-button-up,html[data-tfsh-d] ytd-shorts #navigation-button-down{opacity:0 !important;pointer-events:none !important}
/* クリアスクリーン: 動画だけにする(場所は変えない = 消さずに透明にして、押しても動画に届くようにする) */
html[data-tfsh-clear] ytd-shorts #experiment-overlay,html[data-tfsh-clear] ytd-shorts #cinematic-shorts-scrim,html[data-tfsh-clear] ytd-shorts ytd-reel-player-overlay-renderer,html[data-tfsh-clear] ytd-shorts ytd-shorts-player-controls,html[data-tfsh-clear] ytd-shorts #navigation-container,html[data-tfsh-clear] ytd-shorts #navigation-button-up,html[data-tfsh-clear] ytd-shorts #navigation-button-down,
html[data-tfsh-clear] ytd-shorts ytd-reel-player-header-renderer,html[data-tfsh-clear] ytd-masthead,html[data-tfsh-clear] #masthead-container,html[data-tfsh-clear] ytd-mini-guide-renderer,
html[data-tfsh-clear] ytm-reel-player-overlay-renderer,html[data-tfsh-clear] ytm-shorts-player-controls,html[data-tfsh-clear] ytm-reel-player-header-renderer,html[data-tfsh-clear] .reel-player-overlay-actions,html[data-tfsh-clear] #tf-toast{opacity:0 !important;pointer-events:none !important}`;
  const st = E('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);

  // ---- パネル ----
  const bar = E('div'); bar.id = 'tfsh'; bar.hidden = true;
  bar.innerHTML = `
    <div class="sh-r sh-head"><button type="button" class="sh-fold" title="パネルをたたむ / ひらく">🛠<span class="l"> ショート</span></button></div>
    <div class="sh-t"><span>今回</span> <b class="sh-s">0:00</b><br><span>本日</span> <b class="sh-d">0:00</b></div>
    <div class="sh-r"><button type="button" data-a="prev" title="前の動画">▲</button><button type="button" data-a="next" title="次の動画">▼</button></div>
    <div class="sh-r"><button type="button" data-a="back" title="5秒戻る">⏪ 5</button><button type="button" data-a="fwd" title="5秒進む">5 ⏩</button></div>
    <div class="sh-r"><button type="button" data-a="frame" title="コマ送りモード(一時停止して、1コマずつ動かす)">🎞<span class="l"> コマ送り</span></button></div>
    <div class="sh-r sh-fr" hidden><button type="button" data-a="fb" title="1コマ戻る">◀<span class="l"> コマ</span></button><button type="button" data-a="ff" title="1コマ進む"><span class="l">コマ </span>▶</button></div>
    <div class="sh-r"><button type="button" data-a="auto" title="動画の最後まで来たら、自動で次のショートへ">⏭<span class="l"> 自動で次へ</span></button></div>
    <div class="sh-r"><button type="button" data-a="later" title="再生リスト「TubeFolio2 後で見る」に追加">🕒<span class="l"> 後で見る</span></button></div>
    <div class="sh-r sh-clrrow"><button type="button" class="sh-clr" data-a="clear" title="クリアスクリーン(動画以外を隠す。もう一度押すか Esc で戻る)">🖥 クリア</button></div>
    <div class="sh-n"></div>`;
  const q = s => bar.querySelector(s);
  const note = (() => { let t = 0; return (m, ms = 2500) => { const n = q('.sh-n'); n.textContent = m; clearTimeout(t); t = setTimeout(() => { n.textContent = ''; }, ms); }; })();

  // ---- 動画 ----
  const vid = () => {
    const a = document.querySelector('ytd-reel-video-renderer[is-active] video'); if (a) return a;
    let best = null, area = 0;
    document.querySelectorAll('video').forEach(v => { const r = v.getBoundingClientRect(), w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)), h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)); if (w * h > area) { area = w * h; best = v; } });
    return best;
  };
  const seek = d => { const v = vid(); if (!v || !isFinite(v.duration)) return; v.currentTime = Math.min(Math.max(0, v.currentTime + d), Math.max(0, v.duration - 0.05)); };
  const STEP = 1 / 30; // 1コマ(動画のコマ数は読めないので、30コマ/秒として動かす)
  const step = d => { const v = vid(); if (!v) return; if (!v.paused) v.pause(); seek(d * STEP); };
  const goNav = down => {
    const before = curId(), sel = down ? '#navigation-button-down' : '#navigation-button-up';
    const key = () => { const k = down ? { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 } : { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38 }; [document, window].forEach(t => t.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true, cancelable: true }))); };
    const b = document.querySelector(sel + ' button') || document.querySelector(sel);
    if (b) b.click(); else key(); // 矢印が無い画面(スマホ版)は、↓↑キーと同じ
    if (b) setTimeout(() => { if (onShorts() && curId() === before) key(); }, 600); // 矢印を押しても動かなかったら、キーでも試す
  };
  const goNext = () => goNav(true), goPrev = () => goNav(false);

  // ---- ボタン ----
  const paint = () => {
    q('[data-a=frame]').classList.toggle('on', frame); q('.sh-fr').hidden = !frame;
    q('[data-a=auto]').classList.toggle('on', auto);
    const cb = q('[data-a=clear]'); cb.classList.toggle('on', clear && false); cb.innerHTML = clear ? '🖥' : '🖥<span class="l"> クリア</span>';
    const id = curId(), inl = !!id && laterIds.has(id), lb = q('[data-a=later]');
    lb.classList.toggle('done', inl); lb.innerHTML = inl ? '✓<span class="l"> 登録済み</span>' : '🕒<span class="l"> 後で見る</span>'; lb.title = inl ? '「TubeFolio2 後で見る」に登録済み(押すと外す)' : '再生リスト「TubeFolio2 後で見る」に追加';
    bar.classList.toggle('fold', folded && !clear); bar.classList.toggle('clr', clear);
    document.documentElement.toggleAttribute('data-tfsh-clear', clear && onShorts());
  };
  const setAuto = on => { auto = on; paint(); chrome.storage.local.get('px').then(r => { const px = r.px || {}; if (!!px.shAuto === on) return; px.shAuto = on; return chrome.storage.local.set({ px, prefsAt: Date.now() }); }).catch(() => {}); note(on ? '最後まで来たら、次へ移ります' : '自動で次へ: 切りました'); };
  const setClear = on => { clear = on; sset('tfShClear', on ? '1' : '0'); paint(); };
  const later = () => {
    const id = curId(); if (!id || busy) return;
    if (!alive()) return note('YouTubeのページを更新(F5)してください', 5000);
    const has = laterIds.has(id), lb = q('[data-a=later]'); busy = true; lb.disabled = true; lb.textContent = '…';
    const fin = () => { busy = false; lb.disabled = false; paint(); };
    try {
      if (has) {
        if (!laterList) { fin(); return note('再生リストを確認中です。少し待ってください'); }
        chrome.runtime.sendMessage({ type: 'plRemove', listId: laterList, videoId: id }, r => { void chrome.runtime.lastError; if (r && r.ok) { laterIds.delete(id); note('「後で見る」から外しました'); chrome.storage.local.set({ plAddedAt: Date.now() }).catch(() => {}); } else note('外せませんでした: ' + ((r && r.error) || '不明'), 5000); fin(); });
      } else {
        chrome.runtime.sendMessage({ type: 'plAdd', videoId: id }, r => { const le = chrome.runtime.lastError; if (r && r.ok) { laterIds.add(id); note('「後で見る」に追加しました'); } else note(le ? '拡張機能に接続できません(F5で更新)' : '追加できませんでした: ' + ((r && r.error) || '不明'), 5000); fin(); });
      }
    } catch (e) { fin(); note('YouTubeのページを更新(F5)してください', 5000); }
  };
  // 押し続けると、くり返す(マウス・指どちらも pointer イベント)。キーボード(Enter / Space)でも押せる
  const hold = (btn, fn, gap) => {
    let t1 = 0, t2 = 0; const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = 0; };
    btn.addEventListener('pointerdown', e => { if (e.button) return; e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch (x) { /* 無視 */ } fn(); stop(); t1 = setTimeout(() => { t2 = setInterval(fn, gap); }, 450); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => btn.addEventListener(n, stop));
    btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fn(); } });
    btn.addEventListener('contextmenu', e => e.preventDefault());
  };
  hold(q('[data-a=back]'), () => seek(-5), 220); hold(q('[data-a=fwd]'), () => seek(5), 220);
  hold(q('[data-a=fb]'), () => step(-1), 90); hold(q('[data-a=ff]'), () => step(1), 90);
  q('[data-a=frame]').addEventListener('click', () => { frame = !frame; if (frame) { const v = vid(); if (v) v.pause(); } paint(); });
  q('[data-a=next]').addEventListener('click', goNext); q('[data-a=prev]').addEventListener('click', goPrev);
  q('[data-a=auto]').addEventListener('click', () => setAuto(!auto));
  q('[data-a=later]').addEventListener('click', later);
  q('[data-a=clear]').addEventListener('click', () => setClear(!clear));
  q('.sh-fold').addEventListener('click', () => { folded = !folded; sset('tfShFold', folded ? '1' : '0'); paint(); place(); });
  // パネルの上の操作が、YouTube の上下のスワイプ・キー操作に伝わらないようにする(スマホで押したときに、次の動画へ動かないように)
  ['touchstart', 'touchmove', 'pointerdown', 'mousedown', 'keydown', 'keyup'].forEach(n => bar.addEventListener(n, e => { if (n === 'keydown' && e.defaultPrevented) return; e.stopPropagation(); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && clear && onShorts()) { setClear(false); } }, true);

  // ---- 自動で次へ ----
  document.addEventListener('timeupdate', e => { // 動画の再生位置の変化(バブリングしないので、capture で受ける)
    if (!auto || !onShorts()) return;
    const v = e.target; if (!(v instanceof HTMLVideoElement) || v !== vid()) return;
    const d = v.duration; if (!(d > 0) || !isFinite(d)) return;
    const left = d - v.currentTime, th = Math.min(0.5, d * 0.2);
    if (left > th + 0.4) { armed = true; return; }
    if (armed && left <= th && !v.paused) { armed = false; goNext(); }
  }, true);
  document.addEventListener('ended', e => { if (auto && onShorts() && e.target === vid() && armed) { armed = false; goNext(); } }, true);

  // ---- 時間(1秒ごと。再生中だけ数える) ----
  const todayShown = () => (todayDay === ymd() ? todayBase : 0) + pending;
  const draw = () => { q('.sh-s').textContent = fmt(sess); q('.sh-d').textContent = fmt(todayShown()); };
  async function flush() {
    if (!pending || !alive()) return; const n = pending; pending = 0;
    try {
      const r = await chrome.storage.local.get('shDay'); let d = r.shDay; const t = ymd();
      if (!d || d.d !== t) d = { d: t, s: 0 };
      d.s += n; await chrome.storage.local.set({ shDay: d }); todayBase = d.s; todayDay = d.d; // 別のタブの分も入っているので、保存した値を読み直さずにそのまま使う
    } catch (e) { pending += n; }
  }
  const loadToday = () => chrome.storage.local.get(['shDay', 'px', 'plLaterIds']).then(r => {
    const d = r.shDay; if (d && d.d === ymd()) { todayBase = d.s; todayDay = d.d; } else { todayBase = 0; todayDay = ymd(); }
    auto = !!(r.px && r.px.shAuto); const c = r.plLaterIds; laterIds = new Set((c && c.ids) || []); laterList = (c && c.id) || ''; paint(); draw();
  }).catch(() => {});
  try {
    chrome.storage.onChanged.addListener((ch, a) => {
      if (a !== 'local') return;
      if (ch.shDay) { const d = ch.shDay.newValue; if (d && d.d === ymd()) { todayBase = d.s; todayDay = d.d; } }
      if (ch.px) { auto = !!(ch.px.newValue && ch.px.newValue.shAuto); paint(); }
      if (ch.plLaterIds) { const c = ch.plLaterIds.newValue; laterIds = new Set((c && c.ids) || []); laterList = (c && c.id) || ''; paint(); }
    });
  } catch (e) { /* 無視 */ }
  let was = false, ticks = 0, lastId = '';
  const tick = () => {
    if (!alive()) return;
    const on = onShorts();
    if (!bar.isConnected && document.body) document.body.appendChild(bar);
    if (on !== was) { was = on; bar.hidden = !on; if (!on) { sess = 0; frame = false; document.documentElement.removeAttribute('data-tfsh-clear'); flush(); } paint(); }
    if (!on) return;
    const id = curId(); if (id !== lastId) { lastId = id; armed = true; paint(); }
    const v = vid();
    if (v && !v.paused && !v.ended && v.readyState > 2 && !document.hidden) { sess++; pending++; if (++ticks % 5 === 0) flush(); }
    draw();
  };
  // パソコン: 動画のすぐ左に寄せる(窓の幅が変わっても、動画から離れない)。スマホ・狭い画面は、CSS で左端に固定
  let shift = 0;
  const place = () => {
    const de = document.documentElement, mob = matchMedia('(pointer:coarse),(max-width:900px)').matches, on = onShorts();
    de.toggleAttribute('data-tfsh-m', mob && on); de.toggleAttribute('data-tfsh-d', !mob && on);
    const v = !mob && on ? vid() : null;
    if (!v || bar.hidden) { bar.style.left = ''; bar.style.bottom = ''; de.style.removeProperty('--tfsh-shift'); de.style.removeProperty('--tfsh-aw'); shift = 0; return; }
    const r = v.getBoundingClientRect(); if (r.width < 50) return;
    const base = r.right + shift, bw = bar.offsetWidth, ACT = 74, GAP = 14, NAV = 100; // ACT = YouTube の👍💬ボタンの列 / NAV = 右端の↑↓ボタンの列
    const need = base + ACT + GAP + bw + 8 - (innerWidth - NAV), ns = Math.max(0, Math.min(Math.round(need), Math.max(0, Math.round(r.left + shift - 80)))); // 入らないぶんだけ、動画を左へ(左の余白は残す)
    if (ns !== shift) { shift = ns; de.style.setProperty('--tfsh-shift', String(ns)); }
    bar.style.left = Math.round(base - shift + GAP) + 'px'; // 動画のすぐ右
    // 動画の下端に揃える。たたむときは、ひらいたときの上端(🛠ボタンの位置)を動かさず、上に向かってたたむ
    let extra = 0;
    if (bar.classList.contains('fold') && !bar.classList.contains('clr')) { const h0 = bar.offsetHeight; bar.classList.remove('fold'); extra = Math.max(0, bar.offsetHeight - h0); bar.classList.add('fold'); }
    bar.style.bottom = Math.max(8, Math.round(innerHeight - r.bottom + extra)) + 'px';
    de.style.setProperty('--tfsh-aw', (bw + GAP) + 'px'); // YouTube の👍💬ボタンを、パネルのぶん右へ
  };
  window.addEventListener('resize', place);
  loadToday(); setInterval(() => { tick(); place(); }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  window.addEventListener('pagehide', () => { flush(); });
  document.addEventListener('yt-navigate-finish', tick);
  tick();
})();
