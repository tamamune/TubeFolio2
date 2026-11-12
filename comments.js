// 再生画面：動画の右側／左側にコメントを下から上へ自動スクロールで表示
//   設定 cmt: { side: 'right'|'left'|'off', speed: 1..3, width: 'narrow'|'normal'|'wide', sort: 'top'|'new', end: 'hide'|'loop'|'stay' }
//   設定はすべての動画で共通（chrome.storage に保存。Drive同期の「その他の設定」にも含まれる）
const TGComments = (() => {
  const SPEED = { 1: 18, 2: 36, 3: 70 };          // 1秒あたりのスクロール量(px)
  const WIDTH = { narrow: 22, normal: 30, wide: 40 }; // 動画の幅に対する割合(%)
  const esc = TG.esc;
  // mode: 'cmt'＝コメント ／ 'tr'＝文字起こし（動画の再生位置に合わせて流れる）
  let cfg = { side: 'right', speed: 2, width: 'normal', sort: 'top', end: 'hide', mode: 'cmt', tr: 'ja' }; // tr：外国語のコメントを日本語に
  let segs = null, segIdx = -1;
  let vid = null, token = null, loading = false, ctl = null, raf = 0, last = 0, hover = false, userUntil = 0, ended = false, acc = 0, pos = null, chkAt = 0;
  let panel = null, list = null, btn = null, menu = null;

  chrome.storage.local.get('cmt').then(({ cmt }) => { cfg = { ...cfg, ...(cmt || {}) }; sync(); });
  chrome.storage.onChanged.addListener(ch => {
    if (!ch.cmt) return;
    const old = cfg;
    cfg = { ...cfg, ...(ch.cmt.newValue || {}) };
    if (old.sort !== cfg.sort || old.mode !== cfg.mode || old.tr !== cfg.tr) vid = null; // 並び順・内容が変わったら取り直す
    if (old.end !== cfg.end) panel?.classList.remove('tg-c-done');
    sync();
  });
  const save = patch => chrome.storage.local.set({ cmt: { ...cfg, ...patch } });

  const player = () => document.querySelector('#movie_player');
  const curVid = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
  const video = () => player()?.querySelector('video');

  // ---------- 表示の準備 ----------
  function sync() {
    const p = player();
    const v = curVid();
    if (!p || !v) { teardown(); return; }
    ensureButton(p);
    btn?.classList.toggle('tg-c-off', cfg.side === 'off');
    if (cfg.side === 'off') { removePanel(); return; }
    ensurePanel(p);
    panel.classList.toggle('tg-c-left', cfg.side === 'left');
    panel.style.setProperty('--tg-cw', WIDTH[cfg.width] + '%');
    applyPos();
    if (v !== vid) load(v);
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function teardown() {
    removePanel();
    btn?.remove(); btn = null;
    menu?.remove(); menu = null;
    vid = null;
  }

  function removePanel() {
    ctl?.abort();
    cancelAnimationFrame(raf); raf = 0;
    panel?.remove(); panel = null; list = null;
    vid = null;
  }

  // 💬ボタンは動画下の操作バー（字幕・設定ボタンの並び）に入れる。見つからなければ右上に置く
  function ensureButton(p) {
    const bar = p.querySelector('.ytp-right-controls-left') || p.querySelector('.ytp-right-controls');
    if (btn && p.contains(btn) && (!bar || bar.contains(btn))) return;
    btn?.remove();
    btn = document.createElement('button');
    btn.className = bar ? 'ytp-button tg-c-btn tg-c-inbar' : 'tg-c-btn tg-c-float';
    btn.title = 'コメントの表示設定';
    btn.setAttribute('aria-label', 'コメントの表示設定');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12zM7 9h10v2H7zm0-3h10v2H7zm0 6h7v2H7z"/></svg>';
    stopEvents(btn);
    btn.addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
    if (bar) bar.insertBefore(btn, bar.firstChild);
    else p.appendChild(btn);
    btn.classList.toggle('tg-c-off', cfg.side === 'off');
  }

  function ensurePanel(p) {
    if (panel && p.contains(panel)) return;
    panel = document.createElement('div');
    panel.className = 'tg-c-panel';
    panel.innerHTML = '<div class="tg-c-grip" title="ドラッグで好きな場所へ移動（ダブルクリックで元の右側／左側へ）">⠿ 移動</div><div class="tg-c-list"><div class="tg-c-pad"></div></div>';
    list = panel.querySelector('.tg-c-list');
    bindGrip(panel.querySelector('.tg-c-grip'));
    stopEvents(panel);
    panel.addEventListener('mouseenter', () => { hover = true; });
    panel.addEventListener('mouseleave', () => { hover = false; });
    list.addEventListener('wheel', () => { userUntil = performance.now() + 2500; }, { passive: true });
    list.addEventListener('scroll', () => maybeMore(), { passive: true });
    // 一番上の余白を表示エリアと同じ高さにして、コメントが下から出てくるようにする
    new ResizeObserver(() => {
      const pad = list?.querySelector('.tg-c-pad');
      if (pad) pad.style.height = list.clientHeight + 'px';
    }).observe(panel);
    p.appendChild(panel);
  }

  // ---------- ドラッグで好きな場所へ（cmt.pos: { l, t } はプレイヤーに対する ％。右側／左側の設定は残す） ----------
  function applyPos() {
    if (!panel) return;
    const pos = cfg.pos;
    panel.classList.toggle('tg-c-free', !!pos);
    if (!pos) { ['left', 'top', 'right', 'bottom', 'height'].forEach(k => panel.style.removeProperty(k)); return; }
    panel.style.left = pos.l + '%';
    panel.style.top = pos.t + '%';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.height = (pos.h || 70) + '%';
  }
  function bindGrip(g) {
    g.addEventListener('dblclick', e => { e.stopPropagation(); save({ pos: null }); });
    g.addEventListener('pointerdown', e => {
      const p = player();
      if (!p || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const pr = p.getBoundingClientRect(), r = panel.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const h = Math.min(95, (r.height / pr.height) * 100);
      g.setPointerCapture(e.pointerId);
      panel.classList.add('tg-c-dragging');
      let last = null;
      const move = ev => {
        const l = Math.max(0, Math.min(100 - (r.width / pr.width) * 100, ((ev.clientX - dx - pr.left) / pr.width) * 100));
        const t = Math.max(0, Math.min(100 - h, ((ev.clientY - dy - pr.top) / pr.height) * 100));
        last = { l: +l.toFixed(2), t: +t.toFixed(2), h: +h.toFixed(2) };
        cfg.pos = last; applyPos();
      };
      const up = () => {
        g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
        panel.classList.remove('tg-c-dragging');
        if (last) save({ pos: last });
      };
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
    });
  }

  // 動画の再生／一時停止にクリックが伝わらないようにする
  function stopEvents(el) {
    ['click', 'dblclick', 'mousedown', 'mouseup', 'keydown'].forEach(t => el.addEventListener(t, e => e.stopPropagation()));
  }

  // ---------- 設定メニュー ----------
  function toggleMenu() {
    if (menu) { menu.remove(); menu = null; return; }
    menu = document.createElement('div');
    menu.className = 'tg-c-menu';
    stopEvents(menu);
    const row = (label, key, opts) => `<div class="tg-c-row"><span>${label}</span><div>${opts.map(([v, t]) =>
      `<button data-k="${key}" data-v="${v}" class="${String(cfg[key]) === String(v) ? 'on' : ''}">${t}</button>`).join('')}</div></div>`;
    menu.innerHTML = '<div class="tg-c-h">💬 コメントの表示<button class="tg-c-x" title="閉じる">✕</button></div>' + row('内容', 'mode', [['cmt', 'コメント'], ['tr', '文字起こし']]) +
      row('表示', 'side', [['right', '右側'], ['left', '左側'], ['off', 'オフ']]) +
      row('速さ', 'speed', [[1, '遅い'], [2, '普通'], [3, '速い']]) +
      row('幅', 'width', [['narrow', '狭い'], ['normal', '普通'], ['wide', '広い']]) +
      row('並び', 'sort', [['top', '評価順'], ['new', '新しい順']]) +
      row('外国語', 'tr', [['ja', '日本語に翻訳'], ['off', 'そのまま']]) +
      row('最後まで流れたら', 'end', [['hide', '隠す'], ['loop', 'ループ'], ['stay', 'そのまま']]) +
      '<div class="tg-c-hint">設定はほかの動画でも共通で、次に開いたときも同じです</div>';
    menu.addEventListener('click', async e => {
      if (e.target.closest('.tg-c-x')) { menu?.remove(); menu = null; return; }
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      const v = b.dataset.k === 'speed' ? +b.dataset.v : b.dataset.v;
      await save({ [b.dataset.k]: v, ...(b.dataset.k === 'side' ? { pos: null } : {}) });
      menu?.remove(); menu = null;
    });
    player()?.appendChild(menu);
  }
  document.addEventListener('click', e => { if (menu && !menu.contains(e.target) && e.target !== btn) { menu.remove(); menu = null; } });

  // ---------- 読み込み ----------
  async function load(v) {
    vid = v;
    ctl?.abort();
    ctl = new AbortController();
    token = null; ended = false; loading = true; endAt = 0; segs = null; segIdx = -1; stamps = [];
    panel?.classList.remove('tg-c-done');
    panel?.classList.toggle('tg-c-tr', cfg.mode === 'tr');
    if (cfg.mode === 'tr') return loadTr(v);
    list.innerHTML = '<div class="tg-c-pad"></div><div class="tg-c-note">コメントを読み込み中…</div>';
    list.scrollTop = 0;
    try {
      const r = await YTAPI.comments(v, ctl.signal, cfg.sort);
      if (v !== vid) return;
      list.querySelector('.tg-c-note')?.remove();
      if (r.disabled || !r.items.length) {
        list.insertAdjacentHTML('beforeend', `<div class="tg-c-note">${r.disabled ? 'コメントはオフになっています' : 'コメントはまだありません'}</div>`);
        ended = true;
        return;
      }
      append(r.items);
      const pad = list.querySelector('.tg-c-pad');
      if (pad) pad.style.height = list.clientHeight + 'px';
      token = r.token;
      if (!token) markEnded();
    } catch (e) {
      if (!ctl.signal.aborted && v === vid) {
        list.querySelector('.tg-c-note')?.remove();
        list.insertAdjacentHTML('beforeend', '<div class="tg-c-note">コメントを読み込めませんでした</div>');
      }
    } finally {
      loading = false;
    }
  }

  // コメントの「12:34」「1:02:03」を押せるようにする（その時間へ移動）。目次は chapters.js
  const TS = /(^|[^\d:])((?:(\d{1,2}):)?(\d{1,2}):([0-5]\d))(?![\d:])/g;
  let stamps = [];
  function linkTimes(text, author, noStamp) {
    const dur = video()?.duration || Infinity;
    return esc(text).replace(TS, (m, pre, all, h, mi, se) => {
      const sec = (+h || 0) * 3600 + +mi * 60 + +se;
      if (!(sec < dur + 1)) return m;
      const line = text.split('\n').find(l => l.includes(all)) || text;
      if (!noStamp) stamps.push({ sec, label: all, text: line.replace(all, '').trim().slice(0, 60), author });
      return `${pre}<button class="tg-ts" data-sec="${sec}">${all}</button>`;
    });
  }
  function append(items) {
    const start = list.querySelectorAll('.tg-c-item').length;
    list.insertAdjacentHTML('beforeend', items.map(c => `<div class="tg-c-item">
      <div class="tg-c-meta"><span class="tg-c-author"${c.chId ? ` data-chid="${esc(c.chId)}"` : ''}>${esc(c.author)}</span>${c.likes && c.likes !== '0' ? `<span class="tg-c-like">♥ ${esc(c.likes)}</span>` : ''}${c.time ? `<span class="tg-c-time">${esc(c.time)}</span>` : ''}</div>
      <div class="tg-c-text">${linkTimes(c.text, c.author)}</div></div>`).join(''));
    if (cfg.tr !== 'off') {
      const els = [...list.querySelectorAll('.tg-c-item')].slice(start);
      items.forEach((c, i) => { if (els[i] && isForeign(c.text)) trQueue.push({ el: els[i], text: c.text, author: c.author, v: vid }); });
      trPump();
    }
  }

  // ---------- 外国語のコメントを日本語に（Google 翻訳。同じ文は覚えておく） ----------
  const KANA = /[\u3040-\u30ff\uff66-\uff9f]/;
  const isForeign = t => { const s = String(t || '').replace(/https?:\S+|@\S+|[\d:：]+/g, ''); return !KANA.test(s) && (s.match(/\p{L}/gu) || []).length >= 3; };
  const trMem = new Map(), trQueue = [];
  let trBusy = 0;
  async function trPump() {
    while (trBusy < 3 && trQueue.length) {
      const job = trQueue.shift();
      if (job.v !== vid || !job.el.isConnected) continue;
      trBusy++;
      (async () => {
        let ja = trMem.get(job.text);
        if (ja === undefined) {
          try { ja = await chrome.runtime.sendMessage({ type: 'tgTranslate', q: job.text.slice(0, 1500), to: 'ja' }); } catch { ja = null; }
          trMem.set(job.text, ja || null);
        }
        const box = job.el.querySelector('.tg-c-text');
        if (ja && box && job.v === vid && ja.trim() !== job.text.trim()) {
          box.innerHTML = linkTimes(ja, job.author, true);
          box.insertAdjacentHTML('afterend', `<div class="tg-c-orig"><button class="tg-c-trbtn" title="原文を表示">🌐 翻訳</button><span hidden>${esc(job.text)}</span></div>`);
        }
      })().finally(() => { trBusy--; trPump(); });
    }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest?.('.tg-c-trbtn');
    if (!b || !panel?.contains(b)) return;
    e.preventDefault(); e.stopPropagation();
    const sp = b.nextElementSibling; sp.hidden = !sp.hidden;
    b.textContent = sp.hidden ? '🌐 翻訳' : '🌐 原文を隠す';
  }, true);
  // 時間を押したら、その場面へ
  document.addEventListener('click', e => {
    const b = e.target.closest?.('.tg-ts');
    if (!b || !panel?.contains(b)) return;
    e.preventDefault(); e.stopPropagation();
    const v = video();
    if (v) { v.currentTime = +b.dataset.sec; v.play?.(); }
  }, true);

  // 全部読み込んだら、最後のコメントが上へ流れきるよう下にも余白を入れる
  function markEnded() {
    ended = true;
    if (list && list.querySelector('.tg-c-item') && !list.querySelector('.tg-c-tail')) {
      list.insertAdjacentHTML('beforeend', `<div class="tg-c-pad tg-c-tail" style="height:${list.clientHeight}px"></div>`);
    }
  }
  // 最後まで流れたとき：隠す／先頭からループ／そのまま
  let endAt = 0;
  function onEnd(t) {
    if (!ended || loading || !list.querySelector('.tg-c-tail')) return;
    if (!endAt) { endAt = t; return; }
    if (t - endAt < 1200) return;
    endAt = 0;
    if (cfg.end === 'loop') { list.scrollTop = 0; acc = 0; }
    else if (cfg.end === 'hide') panel.classList.add('tg-c-done');
  }

  async function maybeMore() {
    if (!list || loading || !token) return;
    if (list.scrollHeight - list.scrollTop - list.clientHeight > 800) return;
    loading = true;
    const v = vid;
    try {
      const r = await YTAPI.commentsMore(token, ctl.signal);
      if (v !== vid) return;
      append(r.items);
      token = r.token;
      if (!token) markEnded();
    } catch { token = null; markEnded(); } finally { loading = false; }
  }

  // ---------- 自動スクロール ----------
  // 止まっている間は毎フレーム動かさず、0.5秒ごとに再開を確認するだけにする
  let idleT = null;
  function idle() {
    cancelAnimationFrame(raf); raf = 0; last = 0; pos = null;
    if (idleT) return;
    idleT = setTimeout(() => { idleT = null; if (list && !raf) raf = requestAnimationFrame(tick); }, 500);
  }
  // ---------- 文字起こし ----------
  async function loadTr(v) {
    list.innerHTML = '<div class="tg-c-pad"></div><div class="tg-c-note">文字起こしを読み込み中…</div>';
    list.scrollTop = 0;
    try {
      const r = await YTAPI.transcript(v, ctl.signal);
      if (v !== vid) return;
      list.querySelector('.tg-c-note')?.remove();
      if (!r?.length) { list.insertAdjacentHTML('beforeend', '<div class="tg-c-note">この動画には文字起こし（字幕）がありません</div>'); ended = true; return; }
      segs = r;
      const mm = s => { s = Math.floor(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
      list.insertAdjacentHTML('beforeend', r.map((x, i) => `<div class="tg-c-item tg-tr" data-i="${i}" data-s="${x.s}"><span class="tg-tr-time">${mm(x.s)}</span><span class="tg-c-text">${esc(x.t)}</span></div>`).join('') + '<div class="tg-c-pad tg-c-tail"></div>');
      const h = list.clientHeight;
      list.querySelectorAll('.tg-c-pad').forEach(p => { p.style.height = h + 'px'; });
      ended = true;
    } catch (e) {
      if (!ctl.signal.aborted && v === vid) { list.querySelector('.tg-c-note')?.remove(); list.insertAdjacentHTML('beforeend', '<div class="tg-c-note">文字起こしを読み込めませんでした</div>'); }
    } finally { loading = false; }
  }
  // 今の再生位置の行を、表示エリアの下から3分の1あたりに来るようにゆっくり合わせる
  function tickTr(dt) {
    const v = video();
    if (!v || !segs) return false;
    let i = segIdx;
    const now = v.currentTime;
    if (i < 0 || segs[i].s > now || (segs[i + 1] && segs[i + 1].s <= now)) {
      i = segs.findIndex((x, k) => x.s <= now && (!segs[k + 1] || segs[k + 1].s > now));
      if (i !== segIdx) {
        list.querySelector('.tg-tr.cur')?.classList.remove('cur');
        list.querySelector(`.tg-tr[data-i="${i}"]`)?.classList.add('cur');
        segIdx = i;
      }
    }
    const row = i >= 0 ? list.querySelector(`.tg-tr[data-i="${i}"]`) : list.querySelector('.tg-c-pad');
    if (!row) return false;
    const target = Math.max(0, row.offsetTop - list.clientHeight * 0.66);
    const diff = target - list.scrollTop;
    if (Math.abs(diff) > list.clientHeight * 2) { list.scrollTop = target; return true; } // シークしたときは一気に
    if (Math.abs(diff) >= 1) { list.scrollTop += diff * Math.min(1, dt / 400); return true; }
    return false;
  }
  // 文字起こしの行を押すと、その位置へ
  document.addEventListener('click', e => {
    const r = e.target.closest?.('.tg-tr');
    if (!r || !panel?.contains(r)) return;
    const v = video();
    if (v) { v.currentTime = +r.dataset.s; userUntil = 0; }
  });

  function tick(t) {
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min(100, t - last) : 16;
    last = t;
    if (!list || document.hidden) return;
    if ((window.tfQuiet && window.tfQuiet())) { idle(); return; } // 再生画面を開いた直後は、動かさない
    if (cfg.mode === 'tr') {
      const v = video();
      if (!v || hover || t < userUntil) { idle(); return; }
      const moved = tickTr(dt);
      if (v.paused && !moved) idle(); // 止めている間は休む（シークすると0.5秒以内に追いつく）
      return;
    }
    const v = video();
    const playing = v && !v.paused && !v.ended;
    if (!playing || hover || t < userUntil) { idle(); return; }
    // 位置・高さを読むと、そのたびに画面の組み立て直しが起きる(YouTube が絶えず画面を書き換えているため重い)。読むのは0.5秒に1回だけにして、あいだは自分で数えた位置を書くだけにする
    if (pos == null || t - chkAt > 500) {
      chkAt = t; pos = list.scrollTop;
      if (pos + list.clientHeight >= list.scrollHeight - 1) { if (!loading) maybeMore(); onEnd(t); return; }
    }
    endAt = 0;
    acc += (SPEED[cfg.speed] || 36) * dt / 1000;
    if (acc >= 1) { const n = Math.floor(acc); acc -= n; pos += n; list.scrollTop = pos; }
  }

  // ページの切り替え・プレーヤーの作り直しに追従
  document.addEventListener('yt-navigate-finish', () => setTimeout(sync, 500));
  // プレーヤーの作り直しは、再生ページにいる間だけ1.5秒ごとに確認（画面全体の監視はしない）
  setInterval(() => {
    if (document.hidden) return;
    const p = player();
    if (curVid() && p) {
      if ((cfg.side !== 'off' && !p.contains(panel)) || !p.contains(btn) || (btn && !btn.isConnected)) sync();
      else if (cfg.side !== 'off' && curVid() !== vid) sync();
    } else if (!curVid() && (panel || btn)) teardown();
  }, 1500);

  return { sync };
})();
