// チャプター：動画のチャプター（概要欄の目次）と、再生中の動画のコメントの「0:25」などの時間を集めて
//   ・シークバーに印（押すとその場面へ、乗せるとコメントの内容）
//   ・操作バーの ⏱ ボタンで一覧（チャプターのように飛べる）
//   設定 cchap: { on }（⚙ → 💬 再生画面）
const TGChapters = (() => {
  const esc = TG.esc;
  const PAGES = 5;          // 読むコメントのページ数（1ページ約20件）
  const TS = /(^|[^\d:])((?:(\d{1,2}):)?(\d{1,2}):([0-5]\d))(?![\d:])/g;
  let on = true, vid = null, ctl = null, groups = [], loading = false, btn = null, list = null, marks = null, tip = null;
  let bms = []; // この動画のブックマーク（🔖 B キーで保存したもの）
  let vch = []; // 動画のチャプター（投稿者が概要欄に書いた目次。YouTube のチャプターと同じもの）

  chrome.storage.local.get('cchap').then(({ cchap }) => { on = cchap?.on !== false; check(); });
  chrome.storage.onChanged.addListener(ch => {
    if (ch.cchap) { on = ch.cchap.newValue?.on !== false; vid = null; clear(); check(); }
    if (ch.bookmarks && vid) loadBms(vid).then(paint);
  });
  async function loadBms(v) {
    const { bookmarks = [] } = await chrome.storage.local.get('bookmarks');
    bms = bookmarks.filter(b => b.v === v).map(b => ({ sec: b.sec, label: b.note || 'ブックマーク', bm: true })).sort((a, b) => a.sec - b.sec);
    if (marks) marks.dataset.sig = '';
  }
  // 動画のチャプター・コメントの時間・ブックマークをまとめた一覧（時間順。同じ時間なら動画のチャプターを先に）
  const entries = dur => [...vch.filter(c => c.sec < dur), ...groups.filter(g => g.sec < dur), ...bms.filter(b => b.sec < dur)]
    .sort((a, b) => a.sec - b.sec || (b.vc ? 1 : 0) - (a.vc ? 1 : 0));

  // YouTube のページ側（mainworld.js）から概要欄を読む
  let mSeq = 0;
  function main(op) {
    return new Promise(res => {
      const id = 'c' + (++mSeq);
      const on2 = e => { let d; try { d = JSON.parse(e.detail); } catch { return; } if (d.id !== id) return; document.removeEventListener('tg-res', on2); clearTimeout(t); res(d.result); };
      const t = setTimeout(() => { document.removeEventListener('tg-res', on2); res(null); }, 2000);
      document.addEventListener('tg-res', on2);
      document.dispatchEvent(new CustomEvent('tg-cmd', { detail: JSON.stringify({ id, op, args: {} }) }));
    });
  }
  // 動画のチャプター：概要欄の「0:00 はじめに」のような行（YouTube と同じく 0:00 から始まり、3つ以上あるもの）。
  // 無ければ、YouTube が出しているチャプターの一覧（画面の中の目次）から読む
  async function loadVideoChapters(v) {
    let m = null;
    for (let i = 0; i < 6 && !m; i++) { const r = await main('meta'); if (r?.v === v) m = r; else await new Promise(r2 => setTimeout(r2, 700)); }
    if (v !== vid) return;
    const out = [];
    for (const line of String(m?.desc || '').split('\n')) {
      const mm = [...line.matchAll(TS)][0];
      if (!mm) continue;
      const sec = (+mm[3] || 0) * 3600 + +mm[4] * 60 + +mm[5];
      const label = line.replace(/https?:\/\/\S+/g, ' ').replace(TS, ' ').replace(/^[\s\-–—:：・|｜>＞\[\]【】()（）]+|[\s\-–—:：・|｜]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!out.some(c => c.sec === sec)) out.push({ sec, label: label || 'チャプター', vc: true });
    }
    out.sort((a, b) => a.sec - b.sec);
    let list = out[0]?.sec === 0 && out.length >= 3 ? out : [];
    if (!list.length) { // 画面の中の目次（「チャプター」の欄）
      const rows = [...document.querySelectorAll('ytd-macro-markers-list-item-renderer')];
      for (const r of rows) {
        const t = r.querySelector('#time')?.textContent?.trim() || '';
        const mm = [...(' ' + t).matchAll(TS)][0];
        if (!mm) continue;
        const sec = (+mm[3] || 0) * 3600 + +mm[4] * 60 + +mm[5];
        const label = r.querySelector('#details h4, h4')?.textContent?.trim() || 'チャプター';
        if (!list.some(c => c.sec === sec)) list.push({ sec, label, vc: true });
      }
      list.sort((a, b) => a.sec - b.sec);
    }
    vch = list;
    if (vch.length) { TG.log('チャプター', `動画のチャプター ${vch.length} か所`); if (marks) marks.dataset.sig = ''; paint(); }
  }

  const player = () => document.querySelector('#movie_player');
  const video = () => player()?.querySelector('video');
  const curVid = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
  const clock = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  const likesOf = t => TG.parseCount(t) || 0;

  function clear() {
    ctl?.abort();
    groups = [];
    btn?.remove(); btn = null;
    list?.remove(); list = null;
    marks?.remove(); marks = null;
    tip?.remove(); tip = null;
  }

  async function check() {
    const v = curVid();
    if (!on || !v) { if (vid) { vid = null; clear(); } return; }
    if (v !== vid) { vid = v; clear(); bms = []; vch = []; await loadBms(v); load(v); loadVideoChapters(v); return; }
    if (groups.length || bms.length || vch.length) paint(); // 操作バーが作り直されたときは付け直す
  }

  async function load(v) {
    ctl = new AbortController();
    const { signal } = ctl;
    loading = true;
    const stamps = [];
    try {
      let r = await YTAPI.comments(v, signal, 'top');
      for (let page = 0; ; page++) {
        for (const c of r.items || []) collect(c, stamps);
        if (!r.token || page + 1 >= PAGES || signal.aborted) break;
        r = await YTAPI.commentsMore(r.token, signal);
      }
    } catch { /* 読めなければ印は付けない */ }
    loading = false;
    if (signal.aborted || v !== vid) return;
    groups = group(stamps);
    if (groups.length) TG.log('チャプター', `コメントから ${groups.length} か所の時間を見つけました`);
    paint();
  }

  // コメント1件から時間と、その行の文を集める
  function collect(c, out) {
    const text = c.text || '';
    const found = [...text.matchAll(TS)];
    if (!found.length) return;
    const lines = text.split('\n');
    const many = found.length >= 3; // 時間の一覧を書いたコメント（目次コメント）
    for (const m of found) {
      const sec = (+m[3] || 0) * 3600 + +m[4] * 60 + +m[5];
      const line = lines.find(l => l.includes(m[2])) || text;
      const label = line.replace(/https?:\/\/\S+/g, ' ').replace(TS, ' ').replace(/^[\s\-–—:：・|｜>＞]+|[\s\-–—:：・|｜]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 50);
      out.push({ sec, label, author: c.author, likes: likesOf(c.likes), many });
    }
  }
  // 近い時間（3秒以内）をまとめる。文は「いいね」が多いコメントのものを使う
  function group(stamps) {
    stamps.sort((a, b) => a.sec - b.sec);
    const out = [];
    for (const s of stamps) {
      const g = out[out.length - 1];
      if (g && s.sec - g.sec <= 3) g.items.push(s);
      else out.push({ sec: s.sec, items: [s] });
    }
    for (const g of out) {
      const best = g.items.filter(x => x.label).sort((a, b) => (b.many - a.many) || (b.likes - a.likes))[0];
      g.label = best?.label || '';
      g.n = g.items.length;
      g.likes = g.items.reduce((a, x) => a + x.likes, 0);
    }
    return out;
  }

  // ---------- 表示 ----------
  function paint() {
    const p = player(), v = video();
    if (!p || !v || (!groups.length && !bms.length && !vch.length)) return;
    const dur = v.duration;
    if (!(dur > 0) || !isFinite(dur) || p.classList.contains('ad-showing')) { setTimeout(paint, 1500); return; }
    const gs = entries(dur);
    if (!gs.length) { marks?.remove(); marks = null; btn?.remove(); btn = null; return; }
    const maxN = Math.max(1, ...gs.filter(g => !g.bm && !g.vc).map(g => g.n));
    // シークバーの印
    const bar = p.querySelector('.ytp-progress-bar');
    if (bar && (!marks || !bar.contains(marks))) {
      marks?.remove();
      marks = document.createElement('div');
      marks.className = 'tg-cc-marks';
      bar.appendChild(marks);
      ['mousedown', 'pointerdown', 'click'].forEach(t => marks.addEventListener(t, e => {
        const m = e.target.closest('[data-sec]');
        if (!m) return;
        e.stopPropagation(); e.preventDefault();
        if (t === 'click') seek(+m.dataset.sec);
      }, true));
      marks.addEventListener('mouseover', e => { const m = e.target.closest('[data-sec]'); if (m) showTip(m); });
      marks.addEventListener('mouseout', e => { if (e.target.closest('[data-sec]')) tip?.classList.remove('on'); });
    }
    if (marks && marks.dataset.sig !== vid + gs.length + '|' + bms.length + '|' + vch.length) {
      marks.dataset.sig = vid + gs.length + '|' + bms.length + '|' + vch.length;
      marks.innerHTML = gs.map((g, i) => g.vc ? '' : `<i data-sec="${g.sec}" data-i="${i}" class="${g.bm ? 'bm' : g.n >= Math.max(2, maxN * 0.5) ? 'hot' : ''}" style="left:${(g.sec / dur) * 100}%"></i>`).join(''); // 動画のチャプターは YouTube が区切りを出すので印は付けない
    }
    // ⏱ ボタンと一覧
    const ctr = p.querySelector('.ytp-right-controls-left') || p.querySelector('.ytp-right-controls'); // 新しいプレイヤーは左側のまとまりに入れる
    if (ctr && (!btn || !ctr.contains(btn))) {
      btn?.remove();
      btn = document.createElement('button');
      btn.className = 'ytp-button tg-cc-btn';
      btn.title = 'チャプター（動画のチャプター・コメントの時間・ブックマーク）';
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 5h11v2H3V5zm0 4h8v2H3V9zm0 4h6v2H3v-2zm13-4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm-.75 1h1.5v2.6l1.9 1.1-.75 1.3-2.65-1.55V12z"/></svg><span class="tg-cc-n"></span>`;
      ['mousedown', 'keydown'].forEach(t => btn.addEventListener(t, e => e.stopPropagation()));
      btn.addEventListener('click', e => { e.stopPropagation(); toggleList(); });
      ctr.insertBefore(btn, ctr.firstChild);
    }
    if (btn) btn.querySelector('.tg-cc-n').textContent = gs.length;
    if (list) renderList();
  }
  function showTip(m) {
    const p = player();
    const g = entries(video()?.duration || Infinity)[+m.dataset.i];
    if (!p || !g) return;
    if (!tip || !p.contains(tip)) { tip = document.createElement('div'); tip.className = 'tg-cc-tip'; p.appendChild(tip); }
    tip.innerHTML = g.bm ? `<b>🔖 ${clock(g.sec)}</b> ${esc(g.label)}<small>ブックマーク</small>` : `<b>${clock(g.sec)}</b> ${esc(g.label || '（' + (g.items[0].author || 'コメント') + '）')}<small>💬 ${g.n}</small>`;
    const pr = p.getBoundingClientRect(), mr = m.getBoundingClientRect();
    tip.style.left = Math.min(Math.max(8, mr.left - pr.left - 120), pr.width - 260) + 'px';
    tip.style.bottom = (pr.bottom - mr.top + 14) + 'px';
    tip.classList.add('on');
  }
  function toggleList() {
    if (list) { list.remove(); list = null; return; }
    const p = player();
    list = document.createElement('div');
    list.className = 'tg-cc-list';
    ['mousedown', 'keydown', 'wheel', 'dblclick'].forEach(t => list.addEventListener(t, e => e.stopPropagation()));
    list.addEventListener('click', e => {
      e.stopPropagation();
      if (e.target.closest('.tg-cc-x')) { list.remove(); list = null; return; }
      const r = e.target.closest('[data-sec]');
      if (r) seek(+r.dataset.sec);
    });
    p.appendChild(list);
    renderList();
  }
  function renderList() {
    const dur = video()?.duration || Infinity;
    const gs = entries(dur);
    // 中身が変わっていなければ作り直さない（2秒ごとの見回りでスクロールが上に戻らないように）
    const sig = gs.map(g => g.sec + (g.vc ? 'v' : g.bm ? 'b' : 'c')).join(',');
    if (list.dataset.sig === sig) { hilite(); return; }
    const keep = list.querySelector('.tg-cc-rows')?.scrollTop || 0;
    list.dataset.sig = sig;
    list.innerHTML = `<div class="tg-cc-h">⏱ チャプター <small>${gs.length} か所${vch.length ? `（📑 動画 ${vch.length}）` : ''}${bms.length ? `（🔖 ${bms.length}）` : ''}・押すとその場面へ</small><button class="tg-cc-x" title="閉じる">✕</button></div>
      <div class="tg-cc-rows">${gs.map(g => g.vc
        ? `<button class="tg-cc-row vc" data-sec="${g.sec}"><b>${clock(g.sec)}</b><span>${esc(g.label)}</span><small>📑</small></button>`
        : g.bm
        ? `<button class="tg-cc-row bm" data-sec="${g.sec}"><b>${clock(g.sec)}</b><span>${esc(g.label)}</span><small>🔖</small></button>`
        : `<button class="tg-cc-row" data-sec="${g.sec}"><b>${clock(g.sec)}</b><span>${esc(g.label || '（' + (g.items[0].author || 'コメント') + '）')}</span><small>💬${g.n}</small></button>`).join('')}</div>`;
    const rows = list.querySelector('.tg-cc-rows');
    if (rows) rows.scrollTop = keep;
    hilite();
  }
  function hilite() {
    if (!list) return;
    const t = video()?.currentTime || 0;
    let cur = null;
    list.querySelectorAll('.tg-cc-row').forEach(r => { if (+r.dataset.sec <= t + 0.5) cur = r; r.classList.remove('cur'); });
    cur?.classList.add('cur');
  }
  function seek(sec) {
    const v = video();
    if (!v) return;
    v.currentTime = sec;
    v.play?.();
    hilite();
  }

  // 一覧にできるチャプター（📑 動画のチャプター、無ければ 💬 コメントの時間）がある動画は、再生が始まったときに効果音（水滴）を1回。
  //   両方あるときは動画のチャプターとして1回だけ鳴らす。広告中は待つ
  let dingFor = null;
  document.addEventListener('timeupdate', e => {
    if (e.target !== video()) return;
    if (list) hilite();
    if (!vid || vid !== curVid() || dingFor === vid || e.target.paused || document.querySelector('#movie_player.ad-showing')) return;
    if (vch.length || groups.length) { dingFor = vid; TG.sfx('chapter'); }
  }, true);
  document.addEventListener('yt-navigate-finish', () => setTimeout(check, 300));
  setInterval(check, 2000);
  return { check };
})();
