// 再生画面の追加機能
//   ・フォルダ別の再生速度（folderRates: { フォルダID: 倍率 }。サブフォルダに無ければ親フォルダの設定）
//   ・⏪⏩ ボタン（マウスを乗せたときに〇秒戻る・進む）
//   ・自動ミニプレイヤー（下へスクロールしてプレイヤーが隠れたら右下に小さく表示）
//   ・休憩・就寝のリマインダー
//   設定 px: { seek, seekSec, mini, brk（分・0＝オフ）, bed }、sleepWin: { on, from, to }（視聴パターンの就寝時間と共通）
const TGPlayerX = (() => {
  const esc = TG.esc;
  const DEF = { seek: true, seekSec: 10, mini: true, brk: 60, bed: true, autoJa: true, jaOff: true, seekOp: 40, frameBtn: true, alwaysProg: false, alwaysCtl: false, adFast: true, saver: false, exact: true, tags: true, nth: true, echo: true, bedExt: 30 };
  let cfg = { ...DEF }, rates = {}, sleep = { on: true, from: '23:00', to: '07:00' }, D = null;
  let chSet = {}; // チャンネル別：{ キー: { s: 冒頭スキップ秒, e: 最後スキップ秒, mid: サムネを途中の画面に, name } }

  const load = async () => {
    const r = await chrome.storage.local.get(['px', 'folderRates', 'sleepWin', 'chSet']);
    chSet = r.chSet || {};
    cfg = { ...DEF, ...(r.px || {}) };
    rates = r.folderRates || {};
    sleep = { on: true, from: '23:00', to: '07:00', ...(r.sleepWin || {}) };
  };
  load();
  chrome.storage.onChanged.addListener(ch => {
    if (ch.px || ch.folderRates || ch.sleepWin || ch.chSet) {
      const was = cfg.saver, wasMeta = [cfg.exact, cfg.tags].join();
      load().then(() => { rateFor = null; if (was !== cfg.saver) applySaver(true); if (wasMeta !== [cfg.exact, cfg.tags].join()) { metaFor = null; document.querySelectorAll('.tg-exact, .tg-tags').forEach(e => e.remove()); } tick(); });
    }
    if (ch.folders || ch.channels) D = null;
  });

  const player = () => document.querySelector('#movie_player');
  const video = () => player()?.querySelector('video');
  const curVid = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
  const adShowing = () => !!document.querySelector('#movie_player.ad-showing');

  function flash(text) {
    const p = player();
    if (!p) return;
    let d = p.querySelector('.tg-px-flash');
    if (!d) { d = document.createElement('div'); d.className = 'tg-px-flash'; p.appendChild(d); }
    d.textContent = text;
    d.classList.remove('on'); void d.offsetWidth; d.classList.add('on');
  }

  // ---------- フォルダ別の再生速度 ----------
  let rateFor = null, rateAt = 0, rateVal = null, baseRate = null;
  async function folderRate() {
    const ch = globalThis.TGPage?.currentChannel?.();
    if (!ch?.key) return undefined; // まだ分からない
    if (!D) { const d = await TG.load(); D = { folders: d.folders, fmap: TG.folderMap(d.channels, d.folders) }; }
    const fs = D.fmap.get(ch.key) || (ch.id && D.fmap.get('channel/' + ch.id)) || [];
    for (const f of fs) {
      let x = f, guard = 0;
      while (x && guard++ < 20) {
        if (rates[x.id]) return { r: +rates[x.id], name: x.name };
        x = D.folders.find(y => y.id === x.parent);
      }
    }
    return null;
  }
  async function applyRate() {
    const v = curVid(), vEl = video();
    if (!v || !vEl || adShowing()) return;
    if (rateFor !== v) {
      const fr = await folderRate();
      if (fr === undefined) return;
      rateFor = v; rateAt = Date.now();
      if (fr) { if (baseRate == null) baseRate = vEl.playbackRate || 1; rateVal = fr.r; flash(`⏩ ${fr.r}倍速（${fr.name}）`); }
      else if (baseRate != null) { rateVal = baseRate; baseRate = null; } // 前の動画でだけ変えていたら戻す
      else rateVal = null;
    }
    // YouTubeが読み込み直後に自分の速度へ戻すことがあるので、最初の5秒は合わせ直す（その後は手で変えたものを優先）
    if (rateVal && Date.now() - rateAt < 5000 && Math.abs(vEl.playbackRate - rateVal) > 0.01) vEl.playbackRate = rateVal;
  }

  // ---------- ⏪⏩ ボタン（操作バーの再生ボタンの隣） ----------
  const ICON_B = '<svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>';
  const ICON_F = '<svg viewBox="0 0 24 24"><path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/></svg>';
  function seekBy(d) {
    const vEl = video();
    if (!vEl) return;
    vEl.currentTime = Math.max(0, Math.min((vEl.duration || Infinity) - 0.5, vEl.currentTime + d));
    flash(d > 0 ? `+${d}秒` : `−${-d}秒`);
  }
  // ⏪ ⏯ ⏩：スマホ版のように動画の真ん中へ（操作バーが出ているあいだだけ表示・押せる）
  const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const ICON_FRB = '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>';
  const ICON_FRF = '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
  function ensureSeek() {
    const p = player();
    let box = p?.querySelector(':scope > .tg-px-mseek');
    p?.querySelector('.ytp-left-controls .tg-px-seek')?.remove(); // 以前の操作バーの中のボタン
    if (!cfg.seek || !p || !curVid()) { box?.remove(); return; }
    const n = cfg.seekSec;
    if (!box || box.dataset.sec !== String(n)) {
      box?.remove();
      box = document.createElement('div');
      box.className = 'tg-px-mseek';
      box.dataset.sec = n;
      box.innerHTML = `<button class="fr" data-fr="-1" title="1コマ戻る（一時停止して）">${ICON_FRB}</button><button data-d="-${n}" title="${n}秒戻る">${ICON_B}<span class="n">${n}</span></button><span class="gap"></span><button data-d="${n}" title="${n}秒進む">${ICON_F}<span class="n">${n}</span></button><button class="fr" data-fr="1" title="1コマ進む（一時停止して）">${ICON_FRF}</button>`;
      // YouTube のプレイヤーの「押したら一時停止」「ダブルクリックで全画面」を起こさない
      ['mousedown', 'mouseup', 'dblclick', 'pointerdown', 'pointerup', 'keydown'].forEach(t => box.addEventListener(t, e => { if (e.target.closest('button')) e.stopPropagation(); }));
      box.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        e.stopPropagation(); e.preventDefault();
        if (b.dataset.pp) { const v = video(); if (v) { if (v.paused) v.play().catch(() => {}); else v.pause(); } paintPP(box); return; }
        if (b.dataset.fr) { frameStep(+b.dataset.fr); return; }
        seekBy(+b.dataset.d);
      });
      p.appendChild(box);
    }
    paintPP(box);
    box.style.setProperty('--tg-seek-op', Math.min(1, Math.max(0.05, (+cfg.seekOp || 40) / 100)));
    box.classList.toggle('tg-nofr', cfg.frameBtn === false);
    applyBars();
  }
  // コマ送り：一時停止して 1 コマ（30fps とみなす）ずつ
  function frameStep(dir) {
    const v = video();
    if (!v) return;
    if (!v.paused) v.pause();
    v.currentTime = Math.max(0, Math.min((v.duration || Infinity) - 0.05, v.currentTime + dir / 30));
  }
  // 進行状況バーを常に表示（操作バーが隠れても、動画の一番下に細い赤い線）／再生バーを常に表示（動画の下に置く）
  let progEl = null;
  function applyBars() {
    const p = player();
    if (!p) return;
    p.classList.toggle('tg-ctl-always', !!cfg.alwaysCtl);
    if (!cfg.alwaysProg || cfg.alwaysCtl) { progEl?.remove(); progEl = null; return; }
    if (!progEl || !p.contains(progEl)) { progEl?.remove(); progEl = document.createElement('div'); progEl.className = 'tg-px-prog'; progEl.innerHTML = '<i></i>'; p.appendChild(progEl); }
  }
  document.addEventListener('timeupdate', e => {
    if (!progEl || e.target !== video()) return;
    const v = e.target;
    progEl.firstChild.style.width = (v.duration ? (v.currentTime / v.duration) * 100 : 0) + '%';
  }, true);
  function paintPP(box) {
    const b = box?.querySelector('.pp');
    const v = video();
    if (!b) return;
    const html = v && !v.paused ? ICON_PAUSE : ICON_PLAY;
    if (b.dataset.st !== html) { b.dataset.st = html; b.innerHTML = html; }
  }
  ['play', 'pause'].forEach(t => document.addEventListener(t, e => { if (e.target === video()) paintPP(player()?.querySelector('.tg-px-mseek')); }, true));

  // ---------- 自動ミニプレイヤー ----------
  //   YouTubeのプレイヤーは動かさず、映像を右下の小窓（canvas）に映す。音はそのまま
  let miniOff = null, mini = null, miniRaf = 0; // miniOff … ✕で閉じた動画（プレイヤーが見える位置に戻るまで出さない）
  function anchorRect() {
    const a = document.querySelector('ytd-watch-flexy[theater] #full-bleed-container') || document.querySelector('ytd-watch-flexy #player-container-outer') || document.querySelector('ytd-watch-flexy ytd-player') || player();
    return a?.getBoundingClientRect();
  }
  function buildMini() {
    const m = document.createElement('div');
    m.id = 'tg-mini';
    m.innerHTML = `<canvas width="480" height="270"></canvas>
      <div class="tg-mini-bar"><button data-m="up" title="プレイヤーの位置へ戻る">↑</button><button data-m="pip" title="ピクチャー・イン・ピクチャー（ほかのタブでも表示）">⧉</button><button data-m="x" title="ミニプレイヤーを閉じる">✕</button></div>
      <div class="tg-mini-ctl"><button data-m="b" title="戻る">${ICON_B}</button><button data-m="pp" class="pp" title="再生／一時停止"></button><button data-m="f" title="進む">${ICON_F}</button></div>
      <div class="tg-mini-prog"><i></i></div>`;
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-m]');
      const vEl = video();
      if (!b) { if (e.target.tagName === 'CANVAS' && vEl) vEl.paused ? vEl.play() : vEl.pause(); return; }
      const k = b.dataset.m;
      if (k === 'up') window.scrollTo({ top: 0, behavior: 'smooth' });
      if (k === 'x') { miniOff = curVid(); setMini(false); }
      if (k === 'pip') { vEl?.requestPictureInPicture?.().then(() => setMini(false)).catch(() => {}); }
      if (k === 'b') seekBy(-cfg.seekSec);
      if (k === 'f') seekBy(cfg.seekSec);
      if (k === 'pp' && vEl) vEl.paused ? vEl.play() : vEl.pause();
    });
    m.querySelector('.tg-mini-prog').addEventListener('click', e => {
      const vEl = video(), r = e.currentTarget.getBoundingClientRect();
      if (vEl?.duration) vEl.currentTime = ((e.clientX - r.left) / r.width) * vEl.duration;
    });
    document.body.appendChild(m);
    return m;
  }
  function drawMini() {
    miniRaf = 0;
    if (!mini) return;
    const vEl = video();
    const c = mini.querySelector('canvas');
    if (vEl && vEl.readyState >= 2) {
      const ctx = c.getContext('2d');
      const vw = vEl.videoWidth || 16, vh = vEl.videoHeight || 9;
      const sc = Math.min(c.width / vw, c.height / vh), w = vw * sc, h = vh * sc;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
      try { ctx.drawImage(vEl, (c.width - w) / 2, (c.height - h) / 2, w, h); } catch { /* 保護された動画は映せない */ }
      mini.querySelector('.tg-mini-prog i').style.width = (vEl.duration ? (vEl.currentTime / vEl.duration) * 100 : 0) + '%';
      mini.classList.toggle('paused', vEl.paused);
    }
    miniRaf = requestAnimationFrame(drawMini);
  }
  function setMini(on) {
    if (!!mini === on) return;
    if (on) { mini = buildMini(); drawMini(); }
    else { cancelAnimationFrame(miniRaf); miniRaf = 0; mini?.remove(); mini = null; }
  }
  function checkMini() {
    const v = curVid(), vEl = video();
    const can = cfg.mini && v && vEl && !document.fullscreenElement && !document.pictureInPictureElement && !adShowing();
    const r = can && anchorRect();
    if (!r || !r.height) { setMini(false); return; }
    const hidden = r.bottom < r.height * 0.35 + 56; // 6割以上が上へ隠れた
    if (!hidden && miniOff === v) miniOff = null;
    setMini(hidden && miniOff !== v && (!vEl.paused || !!mini)); // 再生中に隠れたら出す。出ている間に止めても消さない
  }
  let scT = 0;
  window.addEventListener('scroll', () => { if (!scT) scT = requestAnimationFrame(() => { scT = 0; checkMini(); }); }, { passive: true });

  // ---------- チャンネル別：冒頭・最後のスキップ、設定のポップアップ ----------
  const chKeys = ch => [...new Set([ch.key, ch.pageKey, ch.id && 'channel/' + ch.id].filter(Boolean))];
  const chCfg = ch => { for (const k of chKeys(ch)) if (chSet[k]) return chSet[k]; return null; };
  let skipFor = null, endFor = null;
  function applySkip() {
    const v = curVid(), vEl = video();
    if (!v || !vEl || adShowing() || !(vEl.duration > 0)) return;
    const ch = globalThis.TGPage?.currentChannel?.();
    if (!ch?.key) return;
    const c = chCfg(ch);
    if (skipFor !== v) {
      skipFor = v;
      if (c?.s > 0 && vEl.currentTime < c.s - 1 && vEl.currentTime < 8 && !/[?&]t=/.test(location.search)) {
        vEl.currentTime = c.s;
        flash(`⏭ 冒頭 ${c.s} 秒をスキップ`);
      }
    }
    // 最後：残り e 秒になったら動画の終わりへ（終わったときの動き＝連続再生・再生リスト・自動再生で次へ）
    if (c?.e > 0 && endFor !== v && vEl.duration > c.e + 20 && !vEl.paused) {
      const left = vEl.duration - vEl.currentTime;
      if (left <= c.e && left > 1) { endFor = v; flash(`⏭ 最後の ${c.e} 秒をスキップ`); vEl.currentTime = vEl.duration - 0.2; }
    }
  }
  async function saveCh(ch, patch) {
    const { chSet: cs = {} } = await chrome.storage.local.get('chSet');
    const keys = chKeys(ch);
    const cur = keys.map(k => cs[k]).find(Boolean) || {};
    const next = { ...cur, ...patch, name: ch.name || cur.name || '' };
    const empty = !(next.s > 0) && !(next.e > 0) && !next.mid;
    keys.forEach(k => { if (empty) delete cs[k]; else cs[k] = next; });
    await chrome.storage.local.set({ chSet: cs, prefsAt: Date.now() });
    TG.log('チャンネル設定', `${ch.name || ch.key}：冒頭 ${next.s || 0} 秒・最後 ${next.e || 0} 秒・サムネ ${next.mid ? '途中の画面' : 'そのまま'}`);
  }
  function ensureChBtn() {
    const p = player(), ctr = p?.querySelector('.ytp-right-controls-left') || p?.querySelector('.ytp-right-controls');
    let b = ctr?.querySelector('.tg-px-chbtn');
    if (!ctr || !curVid()) { b?.remove(); return; }
    const ch = globalThis.TGPage?.currentChannel?.();
    const on = !!(ch && chCfg(ch));
    if (b) { b.classList.toggle('on', on); return; }
    b = document.createElement('button');
    b.className = 'ytp-button tg-px-chbtn' + (on ? ' on' : '');
    b.title = 'このチャンネルの設定（冒頭・最後のスキップ、サムネ）';
    b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg>';
    ['mousedown', 'keydown'].forEach(t => b.addEventListener(t, e => e.stopPropagation()));
    b.addEventListener('click', e => { e.stopPropagation(); toggleChPop(); });
    ctr.insertBefore(b, ctr.firstChild);
  }
  function toggleChPop() {
    const p = player();
    p.querySelector('.tg-px-pop')?.remove();
    let pop = p.querySelector('.tg-px-chpop:not(.tg-px-pop)');
    if (pop) { pop.remove(); return; }
    const ch = globalThis.TGPage?.currentChannel?.();
    if (!ch?.key) return;
    const c = chCfg(ch) || {};
    pop = document.createElement('div');
    pop.className = 'tg-px-chpop';
    pop.innerHTML = `<div class="h">⚙ ${esc(ch.name || ch.key)} の設定<button data-c="x">✕</button></div>
      <label>冒頭をスキップ<span><input type="number" min="0" max="600" data-c="s" value="${c.s || ''}" placeholder="0"> 秒<button data-c="snow" title="今の再生位置を入れる">今の位置</button></span></label>
      <label>最後をスキップ<span><input type="number" min="0" max="600" data-c="e" value="${c.e || ''}" placeholder="0"> 秒<button data-c="enow" title="今の位置から最後までを入れる">今の位置から</button></span></label>
      <label class="ck"><input type="checkbox" data-c="mid" ${c.mid ? 'checked' : ''}> サムネを動画の途中の画面にする<small>（派手なサムネの代わりに、YouTubeが作る中盤のコマを表示）</small></label>
      <p>最後のスキップは、残りの時間になったら動画を終わらせて次へ進みます（連続再生・再生リスト・自動再生）。</p>`;
    ['mousedown', 'mouseup', 'dblclick', 'click', 'keydown', 'keyup', 'keypress', 'wheel'].forEach(t => pop.addEventListener(t, e => e.stopPropagation()));
    const num = k => Math.max(0, Math.min(600, Math.round(+pop.querySelector(`[data-c="${k}"]`).value || 0)));
    const save = () => saveCh(ch, { s: num('s'), e: num('e'), mid: pop.querySelector('[data-c="mid"]').checked });
    pop.addEventListener('change', save);
    pop.addEventListener('click', e => {
      const k = e.target.closest('[data-c]')?.dataset.c;
      const vEl = video();
      if (k === 'x') pop.remove();
      if (k === 'snow' && vEl) { pop.querySelector('[data-c="s"]').value = Math.floor(vEl.currentTime); save(); }
      if (k === 'enow' && vEl) { pop.querySelector('[data-c="e"]').value = Math.ceil(vEl.duration - vEl.currentTime); save(); }
    });
    p.appendChild(pop);
  }


  // ---------- YouTubeのページ側（mainworld.js）に頼む ----------
  let mSeq = 0;
  function main(op, args) {
    return new Promise(res => {
      const id = ++mSeq;
      const on = e => { let d; try { d = JSON.parse(e.detail); } catch { return; } if (d.id !== id) return; document.removeEventListener('tg-res', on); clearTimeout(t); res(d.result); };
      const t = setTimeout(() => { document.removeEventListener('tg-res', on); res(null); }, 2000);
      document.addEventListener('tg-res', on);
      document.dispatchEvent(new CustomEvent('tg-cmd', { detail: JSON.stringify({ id, op, args }) }));
    });
  }

  // ---------- 字幕：日本語を一発で・英語などの動画は自動で日本語・2か国語同時 ----------
  let subMode = 'off', subFor = null, autoFor = null, dual = null; // dual: { v, ev: [{s, e, t}] }
  const spokenOf = tr => tr?.spoken || (tr?.tracks?.length && !tr.tracks.some(t => t.lc === 'ja') ? tr.tracks[0].lc : '');
  async function setSub(mode) {
    const v = curVid();
    if (!v) return;
    subMode = mode; subFor = v;
    dual = null; document.querySelector('.tg-dual')?.remove();
    if (mode === 'off') { await main('show', { lang: null }); flash('字幕：オフ'); paintSubBtn(); return; }
    const tr = await main('tracks');
    if (!tr?.tracks?.length) { flash('この動画には字幕がありません'); subMode = 'off'; paintSubBtn(); return; }
    const spoken = spokenOf(tr) || tr.tracks[0].lc;
    if (mode === 'ja') {
      const r = await main('show', { lang: 'ja' });
      flash(r === 'exact' ? '字幕：日本語' : '字幕：日本語（自動翻訳）');
    } else {
      // 2か国語：YouTubeの字幕は話している言語、上に日本語（日本語の動画なら英語）を重ねる
      const second = spoken === 'ja' ? 'en' : 'ja';
      await main('show', { lang: spoken });
      flash(`字幕：${spoken.toUpperCase()} ＋ ${second === 'ja' ? '日本語' : '英語'}`);
      loadDual(v, second);
    }
    paintSubBtn();
  }
  async function loadDual(v, lang) {
    let url = null;
    for (let i = 0; i < 12 && !url; i++) { url = await main('ttUrl', { v }); if (!url) await new Promise(r => setTimeout(r, 500)); }
    if (!url || curVid() !== v || subMode !== 'dual') { if (!url) flash('2つ目の字幕を読み込めませんでした'); return; }
    const u = new URL(url);
    u.searchParams.set('fmt', 'json3');
    u.searchParams.set('tlang', lang);
    try {
      const j = await (await fetch(u.href, { credentials: 'include' })).json();
      const ev = (j.events || []).filter(e => e.segs).map(e => ({ s: e.tStartMs / 1000, e: (e.tStartMs + (e.dDurationMs || 2000)) / 1000, t: e.segs.map(x => x.utf8).join('').trim() })).filter(x => x.t);
      dual = { v, ev };
    } catch { flash('2つ目の字幕を読み込めませんでした'); }
  }
  function paintDual() {
    const p = player(), vEl = video();
    let box = p?.querySelector('.tg-dual');
    if (!dual || dual.v !== curVid() || !vEl || subMode !== 'dual') { box?.remove(); return; }
    const t = vEl.currentTime;
    const cur = dual.ev.filter(x => t >= x.s && t < x.e).map(x => x.t).join('\n');
    if (!box) { box = document.createElement('div'); box.className = 'tg-dual'; p.appendChild(box); }
    if (box.textContent !== cur) box.textContent = cur;
    box.hidden = !cur;
  }
  document.addEventListener('timeupdate', e => { if (dual && e.target === video()) paintDual(); }, true);
  // 日本語の動画かどうか：
  //   ① 今流れている音声トラックが日本語（自動吹き替え・多言語音声で日本語を選んでいる）なら日本語
  //   ② タイトルにひらがな・カタカナがあれば日本語（自動字幕の言語が間違っていることがあるので、こちらを優先）
  //   ③ YouTube の自動字幕（音声認識）の言語
  //   ④ 自動字幕が無ければ、字幕の一覧
  const KANA = /[\u3040-\u309f\u30a0-\u30ff]/;
  const base = l => String(l || '').toLowerCase().split(/[-_]/)[0];
  function langOf(tr) {
    if (base(tr.audio) === 'ja') return { lang: 'ja', why: '音声トラックが日本語' };
    if (KANA.test(tr.title || '')) return { lang: 'ja', why: 'タイトルにかな' + (tr.spoken && base(tr.spoken) !== 'ja' ? `（自動字幕は ${tr.spoken}）` : '') };
    if (tr.spoken) return { lang: base(tr.spoken), why: '自動字幕の言語' };
    if (!(tr.title || '').trim() && KANA.test(tr.desc || '')) return { lang: 'ja', why: '概要欄にかな' };
    if (tr.tracks?.some(t => base(t.lc) === 'ja')) return { lang: 'ja', why: '日本語の字幕あり' };
    if (tr.tracks?.length) return { lang: base(tr.tracks[0].lc), why: '字幕の一覧' };
    return { lang: '', why: '' };
  }
  // 自分で字幕ボタン（CC・c キー）を押したら、その動画では自動で消さない
  let manualFor = null;
  document.addEventListener('click', e => { if (e.target.closest?.('.ytp-subtitles-button')) manualFor = curVid(); }, true);
  document.addEventListener('keydown', e => { if ((e.key === 'c' || e.key === 'C') && !e.target.closest?.('input, textarea, [contenteditable]')) manualFor = curVid(); }, true);
  const ccOn = () => player()?.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') === 'true';
  let langFor = null, langInfo = null, jaWatchUntil = 0;
  async function autoSub() {
    const v = curVid();
    if (!v || (!cfg.autoJa && !cfg.jaOff) || adShowing()) return;
    if (langFor !== v) {
      const tr = await main('tracks');
      if (!tr || tr.v !== v || curVid() !== v) return; // まだ前の動画の情報
      langFor = v; langInfo = langOf(tr);
      jaWatchUntil = Date.now() + 30000; // YouTube があとから字幕を付けることがあるので、始まって30秒は見張る
      if (subFor !== v) { subMode = 'off'; dual = null; }
      TG.log('字幕', `言語の判定：${langInfo.lang || '不明'}（${langInfo.why || '手がかりなし'}）／音声 ${tr.audio || '-'}${tr.audioOrig && tr.audioOrig !== tr.audio ? `（元 ${tr.audioOrig}）` : ''}・自動字幕 ${tr.spoken || '-'}・字幕 ${(tr.tracks || []).map(t => t.lc).join(',') || 'なし'}／${(tr.title || '').slice(0, 40)}`);
    }
    const isJa = langInfo?.lang === 'ja';
    // 日本語以外：1回だけ日本語字幕に
    if (autoFor !== v) {
      autoFor = v;
      if (cfg.autoJa && langInfo?.lang && !isJa && subMode === 'off') { await setSub('ja'); TG.log('字幕', `話している言語が ${langInfo.lang} なので日本語字幕を表示`); }
    }
    // 日本語：YouTube が字幕を出していたら消す（自分で字幕ボタンから付けた分はそのまま）
    if (cfg.jaOff && isJa && Date.now() < jaWatchUntil && manualFor !== v && !(subFor === v && subMode !== 'off') && ccOn()) {
      await main('show', { lang: null });
      subMode = 'off'; subFor = v;
      TG.log('字幕', '日本語の動画なので字幕を非表示');
    }
    paintSubBtn();
  }
  function paintSubBtn() {
    const b = player()?.querySelector('.tg-px-sub');
    if (b) { b.classList.toggle('on', subMode !== 'off' && subFor === curVid()); b.dataset.mode = subFor === curVid() ? subMode : 'off'; }
  }

  // ---------- A-B 区間リピート ----------
  let ab = { v: null, a: null, b: null };
  function abMark() {
    const p = player(), vEl = video(), bar = p?.querySelector('.ytp-progress-bar');
    let m = bar?.querySelector('.tg-ab');
    const on = ab.v === curVid() && ab.a != null && vEl?.duration;
    if (!on || !bar) { m?.remove(); return; }
    if (!m) { m = document.createElement('div'); m.className = 'tg-ab'; bar.appendChild(m); }
    const d = vEl.duration, a = ab.a, b = ab.b ?? a;
    m.style.left = (a / d) * 100 + '%';
    m.style.width = Math.max(0.3, ((b - a) / d) * 100) + '%';
    m.classList.toggle('half', ab.b == null);
  }
  document.addEventListener('timeupdate', e => {
    const vEl = e.target;
    if (vEl !== video() || ab.v !== curVid() || ab.a == null || ab.b == null) return;
    if (vEl.currentTime >= ab.b || vEl.currentTime < ab.a - 1) vEl.currentTime = ab.a;
  }, true);
  const clock = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
  function abSet(k) {
    const vEl = video(), v = curVid();
    if (!vEl || !v) return;
    if (ab.v !== v) ab = { v, a: null, b: null };
    if (k === 'clear') { ab = { v, a: null, b: null }; flash('A-B リピートを解除'); }
    if (k === 'a') { ab.a = vEl.currentTime; if (ab.b != null && ab.b <= ab.a) ab.b = null; flash(`A：${clock(ab.a)}`); }
    if (k === 'b') {
      if (ab.a == null) ab.a = 0;
      if (vEl.currentTime <= ab.a + 0.5) { flash('B は A より後ろにしてください'); return; }
      ab.b = vEl.currentTime; vEl.currentTime = ab.a;
      flash(`🔁 ${clock(ab.a)}〜${clock(ab.b)} をくり返し`);
    }
    abMark();
  }

  // ---------- スクリーンショット（UIなし・元の解像度）：S キー ----------
  function shot() {
    const vEl = video();
    if (!vEl?.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = vEl.videoWidth; c.height = vEl.videoHeight;
    try { c.getContext('2d').drawImage(vEl, 0, 0); } catch { flash('この動画は保存できません'); return; }
    const title = (document.querySelector('ytd-watch-metadata h1')?.textContent || document.title.replace(/ - YouTube$/, '')).trim().replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
    const name = `${title}_${clock(vEl.currentTime).replace(/:/g, '-')}.png`;
    c.toBlob(b => {
      if (!b) { flash('この動画は保存できません'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      flash(`📷 ${c.width}×${c.height} で保存しました`);
      TG.log('スクリーンショット', name);
    }, 'image/png');
  }
  document.addEventListener('keydown', e => {
    if ((e.key !== 's' && e.key !== 'S') || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!curVid() || !video()) return;
    e.preventDefault(); e.stopPropagation();
    shot();
  }, true);

  // ---------- 音量ブースト・明るさ／コントラスト／彩度 ----------
  const adj = { vol: 100, br: 100, ct: 100, sat: 100 };
  let actx = null;
  const gains = new WeakMap();
  function applyVol() {
    const vEl = video();
    if (!vEl) return;
    let g = gains.get(vEl);
    if (!g && adj.vol === 100) return;
    try {
      if (!actx) actx = new AudioContext();
      if (!g) { const src = actx.createMediaElementSource(vEl); g = actx.createGain(); src.connect(g).connect(actx.destination); gains.set(vEl, g); }
      if (actx.state === 'suspended') actx.resume();
      g.gain.value = adj.vol / 100;
    } catch { flash('この動画では音量ブーストを使えません'); }
  }
  function applyFilter() {
    const vEl = video();
    if (!vEl) return;
    const f = adj.br === 100 && adj.ct === 100 && adj.sat === 100 ? '' : `brightness(${adj.br / 100}) contrast(${adj.ct / 100}) saturate(${adj.sat / 100})`;
    if (vEl.style.filter !== f) vEl.style.filter = f;
  }

  // ---------- 🎛 まとめボタン（A-B・スクショ・音量・画質）と「字」ボタン ----------
  function ensureTools() {
    const p = player(), ctr = p?.querySelector('.ytp-right-controls-left') || p?.querySelector('.ytp-right-controls');
    if (!ctr || !curVid()) return;
    if (!ctr.querySelector('.tg-px-sub')) {
      const b = document.createElement('button');
      b.className = 'ytp-button tg-px-sub';
      b.title = '字幕（日本語・2か国語）';
      b.innerHTML = '<span>字</span>';
      ['mousedown', 'keydown'].forEach(t => b.addEventListener(t, e => e.stopPropagation()));
      b.addEventListener('click', e => { e.stopPropagation(); togglePop('sub'); });
      ctr.insertBefore(b, ctr.firstChild);
      paintSubBtn();
    }
    if (!ctr.querySelector('.tg-px-tool')) {
      const b = document.createElement('button');
      b.className = 'ytp-button tg-px-tool';
      b.title = 'A-B リピート・スクリーンショット・音量ブースト・明るさ';
      b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>';
      ['mousedown', 'keydown'].forEach(t => b.addEventListener(t, e => e.stopPropagation()));
      b.addEventListener('click', e => { e.stopPropagation(); togglePop('tool'); });
      ctr.insertBefore(b, ctr.firstChild);
    }
    const tb = ctr.querySelector('.tg-px-tool');
    tb?.classList.toggle('on', (ab.v === curVid() && ab.a != null) || adj.vol !== 100 || adj.br !== 100 || adj.ct !== 100 || adj.sat !== 100);
  }
  function togglePop(kind) {
    const p = player();
    const old = p.querySelector('.tg-px-pop');
    old?.remove();
    p.querySelector('.tg-px-chpop:not(.tg-px-pop)')?.remove();
    if (old?.dataset.kind === kind) return;
    const pop = document.createElement('div');
    pop.className = 'tg-px-pop tg-px-chpop';
    pop.dataset.kind = kind;
    const sl = (k, label, min, max) => `<label class="sl">${label}<input type="range" min="${min}" max="${max}" step="5" data-adj="${k}" value="${adj[k]}"><b>${adj[k]}%</b></label>`;
    if (kind === 'sub') {
      const m = subFor === curVid() ? subMode : 'off';
      pop.innerHTML = `<div class="h">字幕<button data-c="x">✕</button></div>
        <div class="seg">${[['ja', '日本語'], ['dual', '2か国語（原語＋日本語）'], ['off', 'オフ']].map(([k, l]) => `<button data-sub="${k}" class="${m === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <label class="ck"><input type="checkbox" data-c="autoJa" ${cfg.autoJa ? 'checked' : ''}> 日本語以外の動画は、自動で日本語字幕にする</label>
        <label class="ck"><input type="checkbox" data-c="jaOff" ${cfg.jaOff ? 'checked' : ''}> 日本語の動画は、字幕を非表示にする</label>
        <p>日本語の字幕が無い動画は、YouTubeの自動翻訳を使います。</p>`;
    } else {
      const on = ab.v === curVid();
      pop.innerHTML = `<div class="h">ツール<button data-c="x">✕</button></div>
        <div class="row"><span>🔁 A-B リピート</span><span class="ab">${on && ab.a != null ? clock(ab.a) : '—'} 〜 ${on && ab.b != null ? clock(ab.b) : '—'}</span></div>
        <div class="seg"><button data-ab="a">A：ここから</button><button data-ab="b">B：ここまで</button><button data-ab="clear">解除</button></div>
        <div class="row"><span>📷 スクリーンショット</span><button data-c="shot">保存（S キー）</button></div>
        <div class="row"><span>🎧 省データ（144p・映像を隠す）</span><button data-c="saver" class="${cfg.saver ? 'on' : ''}">${cfg.saver ? 'オン' : 'オフ'}</button></div>
        ${sl('vol', '🔊 音量', 100, 300)}${sl('br', '☀ 明るさ', 50, 200)}${sl('ct', '◐ コントラスト', 50, 200)}${sl('sat', '🎨 彩度', 0, 200)}
        <div class="row"><span></span><button data-c="reset">音量・画質を元に戻す</button></div>`;
    }
    ['mousedown', 'mouseup', 'dblclick', 'click', 'keydown', 'keyup', 'keypress', 'wheel'].forEach(t => pop.addEventListener(t, e => e.stopPropagation()));
    pop.addEventListener('click', async e => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.c === 'x') { pop.remove(); return; }
      if (t.dataset.sub) { await setSub(t.dataset.sub); pop.remove(); return; }
      if (t.dataset.ab) { abSet(t.dataset.ab); pop.remove(); togglePop('tool'); return; }
      if (t.dataset.c === 'shot') shot();
      if (t.dataset.c === 'saver') { const { px = {} } = await chrome.storage.local.get('px'); await chrome.storage.local.set({ px: { ...px, saver: !cfg.saver }, prefsAt: Date.now() }); pop.remove(); flash(!cfg.saver ? '🎧 省データモード：オン' : '🎧 省データモード：オフ'); }
      if (t.dataset.c === 'reset') { Object.assign(adj, { vol: 100, br: 100, ct: 100, sat: 100 }); applyVol(); applyFilter(); pop.remove(); togglePop('tool'); }
    });
    pop.addEventListener('input', e => {
      const i = e.target.closest('[data-adj]');
      if (!i) return;
      adj[i.dataset.adj] = +i.value;
      i.nextElementSibling.textContent = i.value + '%';
      if (i.dataset.adj === 'vol') applyVol(); else applyFilter();
    });
    pop.addEventListener('change', e => {
      if (e.target.dataset.c === 'autoJa' || e.target.dataset.c === 'jaOff') { const k = e.target.dataset.c; chrome.storage.local.get('px').then(({ px = {} }) => chrome.storage.local.set({ px: { ...px, [k]: e.target.checked }, prefsAt: Date.now() })); }
    });
    p.appendChild(pop);
  }


  // ---------- 広告の早送り：広告中は16倍速・ミュートにし、スキップできれば押す ----------
  let adSaved = null;
  function adFast() {
    const p = player(), vEl = video();
    if (!p || !vEl) return;
    const ad = p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting');
    if (ad && cfg.adFast) {
      if (!adSaved) { adSaved = { muted: vEl.muted, rate: vEl.playbackRate }; TG.log('広告', '広告を早送り'); }
      if (!vEl.muted) vEl.muted = true;
      if (vEl.playbackRate !== 16) try { vEl.playbackRate = 16; } catch { /* なし */ }
      const sk = p.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-container button, button[id^="skip-button"]');
      if (sk) { sk.click(); TG.log('広告', 'スキップを押した'); }
    } else if (adSaved) {
      vEl.muted = adSaved.muted;
      vEl.playbackRate = adSaved.rate || 1;
      adSaved = null;
      rateFor = null; // フォルダ別の速度を合わせ直す
    }
  }
  document.addEventListener('playing', e => { if (e.target === video()) adFast(); }, true);
  document.addEventListener('ratechange', e => { if (e.target === video() && adSaved) adFast(); }, true);
  // 広告中だけ 150ms ごとに見回る（tick は1秒周期で、16倍速だとスキップボタンを逃すため）
  setInterval(() => {
    if (!cfg.adFast) return;
    const p = document.querySelector('#movie_player');
    if (p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))) adFast();
  }, 150);

  // ---------- 省データ（音声中心）モード：画質を最低（144p）にして映像を隠す ----------
  let saverFor = null;
  async function applySaver(force) {
    const v = curVid();
    if (!v) return;
    const p = player();
    p?.classList.toggle('tg-saver', !!cfg.saver);
    if (saverFor === v && !force) return;
    saverFor = v;
    if (cfg.saver) { await main('quality', { q: 'tiny' }); }
    else if (force) { await main('quality', { q: 'auto' }); }
    if (cfg.saver) {
      let cover = p?.querySelector('.tg-saver-cover');
      if (p && !cover) {
        cover = document.createElement('div');
        cover.className = 'tg-saver-cover';
        p.appendChild(cover);
      }
      if (cover) cover.innerHTML = `<img src="https://i.ytimg.com/vi/${v}/hqdefault.jpg" alt=""><span>🎧 省データモード（144p・映像を隠しています）</span>`;
    } else p?.querySelector('.tg-saver-cover')?.remove();
  }

  // ---------- 正確な投稿日時・再生数、投稿者が設定したタグ（＋タグからフォルダの候補） ----------
  let metaFor = null, metaShown = false;
  async function showMeta() {
    const v = curVid();
    if (!v || adShowing()) return;
    // YouTubeが説明欄を描き直して消えていたら付け直す
    if (metaFor === v && (!metaShown || document.querySelector('.tg-exact, .tg-tags'))) return;
    const box0 = document.querySelector('ytd-watch-metadata #description-inner, ytd-watch-metadata #description, ytd-watch-metadata');
    if (!box0) return;
    const m = await main('meta');
    if (!m || m.v !== v) return;
    metaFor = v;
    metaShown = false;
    document.querySelectorAll('.tg-exact, .tg-tags').forEach(e => e.remove());
    const host = document.querySelector('ytd-watch-metadata #title') || document.querySelector('ytd-watch-metadata');
    if (cfg.exact && host && (m.publish || m.views)) {
      const d = m.liveStart || m.publish ? new Date(m.liveStart || m.publish) : null;
      const p2 = n => String(n).padStart(2, '0');
      const ds = d && !isNaN(d) ? `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}` : '';
      const el = document.createElement('div');
      el.className = 'tg-exact';
      el.textContent = [ds && `📅 ${ds}${m.liveStart ? ' 配信開始' : ' 公開'}`, m.views && `▶ ${m.views.toLocaleString('ja-JP')} 回視聴${m.live ? '（配信中）' : ''}`, m.category && `🏷 ${m.category}`].filter(Boolean).join('　・　');
      host.after(el);
      metaShown = true;
    }
    // 投稿者が設定した検索キーワード（隠しタグ）と、概要欄に書かれたハッシュタグ（#〇〇）の両方を出す
    const kw = m.kw || [];
    const hs = hashtags(m.desc || '');
    if (cfg.tags && (kw.length || hs.length)) {
      const desc = document.querySelector('ytd-watch-metadata #description') || document.querySelector('ytd-watch-metadata #bottom-row') || host;
      const el = document.createElement('div');
      el.className = 'tg-tags';
      el.innerHTML = (kw.length ? `<div class="tg-tags-h">🏷 タグ（投稿者が設定した検索キーワード）<small>${kw.length}個・押すと検索</small></div>
        <div class="tg-tags-list">${kw.map(k => `<a href="/results?search_query=${encodeURIComponent(k)}">${esc(k)}</a>`).join('')}</div>` : '')
        + (hs.length ? `<div class="tg-tags-h tg-tags-h2"># 概要欄のハッシュタグ<small>${hs.length}個・押すとハッシュタグのページ</small></div>
        <div class="tg-tags-list tg-tags-hash">${hs.map(h => `<a href="/hashtag/${encodeURIComponent(h)}">#${esc(h)}</a>`).join('')}</div>` : '')
        + '<div class="tg-tags-sugg"></div>';
      desc.after(el);
      metaShown = true;
      suggestFolder(el.querySelector('.tg-tags-sugg'), [...kw, ...hs], document.querySelector('ytd-watch-metadata h1')?.textContent || '');
    }
  }
  // 概要欄のハッシュタグ（「#PR#キャラぶ」のように続けて書かれたものも分ける）。URLの中の # は除く
  function hashtags(text) {
    const out = [];
    const t = String(text).replace(/https?:\/\/\S+/g, ' ');
    for (const m of t.matchAll(/[#＃]([^\s#＃、。，,.!！?？「」『』（）()【】\[\]<>"'`/\\|]+)/gu)) {
      const h = m[1].replace(/[・ー~〜]+$/u, '');
      if (h && !/^\d+$/.test(h) && !out.includes(h)) out.push(h);
      if (out.length >= 30) break;
    }
    return out;
  }
  // タグとタイトルを、フォルダのキーワード（振り分け補助）と照らし合わせて候補を出す
  async function suggestFolder(box, kw, title) {
    const S = globalThis.TGPage?.state?.();
    const ch = globalThis.TGPage?.currentChannel?.();
    if (!S || !ch?.key) return;
    const fm = TG.folderMap(S.channels, S.folders);
    const inNow = new Set((fm.get(ch.key) || (ch.id && fm.get('channel/' + ch.id)) || []).map(f => f.id));
    const text = (kw.join(' ') + ' ' + title).toLowerCase();
    const scored = S.folders.map(f => {
      const { inc, exc } = TG.folderKw(f);
      if (exc.some(w => text.includes(w.toLowerCase()))) return null;
      const hits = [...new Set([f.name, ...inc])].filter(w => w && w.length >= 2 && text.includes(w.toLowerCase()));
      return hits.length ? { f, hits } : null;
    }).filter(Boolean).sort((a, b) => b.hits.length - a.hits.length).slice(0, 3);
    if (!scored.length) return;
    box.innerHTML = `<span>🪄 タグから見たフォルダの候補：</span>` + scored.map(({ f, hits }) => inNow.has(f.id)
      ? `<span class="tg-sg in" title="一致：${esc(hits.join('・'))}">✓ ${esc(f.name)}（登録済み）</span>`
      : `<button class="tg-sg" data-fid="${esc(f.id)}" title="一致：${esc(hits.join('・'))}">＋ ${esc(f.name)} に入れる<small>${esc(hits.slice(0, 3).join('・'))}</small></button>`).join('');
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-fid]');
      if (!b) return;
      await globalThis.TGPage.addToFolder(b.dataset.fid);
      b.outerHTML = `<span class="tg-sg in">✓ ${esc(b.textContent.replace(/^＋\s*/, '').replace(/ に入れる.*/, ''))} に入れました</span>`;
      TG.log('振り分け', `タグから「${ch.name}」をフォルダに追加`);
    });
  }


  // ---------- 🧭 少しズレた関連動画（関連の関連の関連＝3次リンク）を横の一覧の上に ----------
  let nthFor = null, nthBusy = false;
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const okVid = x => x?.v && !x.short && !x.live && !x.upcoming;
  async function nthRelated(v) {
    const L1 = (await YTAPI.related(v)).filter(okVid);
    const seen = new Set([v, ...L1.map(x => x.v)]);
    const lv2 = [];
    for (const s of shuffle(L1.slice(0, 15)).slice(0, 3)) {
      try { const r = (await YTAPI.related(s.v)).filter(x => okVid(x) && !seen.has(x.v)); r.forEach(x => seen.add(x.v)); lv2.push(...shuffle(r).slice(0, 2)); } catch { /* 飛ばす */ }
    }
    const out = [], chs = new Set();
    for (const s of shuffle(lv2).slice(0, 3)) {
      try {
        const r = shuffle((await YTAPI.related(s.v)).filter(x => okVid(x) && !seen.has(x.v)));
        let n = 0;
        for (const x of r) { if (out.length >= 9 || n >= 3) break; if (chs.has(x.chKey || x.chName)) continue; seen.add(x.v); chs.add(x.chKey || x.chName); out.push(x); n++; }
      } catch { /* 飛ばす */ }
    }
    return out;
  }
  // 関連動画の欄（画面が狭いと YouTube はこれを動画の下へ移すので、見えている方を使う）
  function sideHost() {
    const vis = el => el && el.getClientRects().length > 0;
    const rel = document.querySelector('ytd-watch-flexy:not([hidden]) #related');
    if (vis(rel)) return rel;
    const inner = document.querySelector('ytd-watch-flexy:not([hidden]) #secondary-inner');
    if (vis(inner)) return inner;
    const below = document.querySelector('ytd-watch-flexy:not([hidden]) #below');
    return vis(below) ? below : null;
  }
  // 再生画面を離れたら片付ける（戻るボタンでホームに出てしまわないように）
  function clearSide() {
    document.getElementById('tg-nth')?.remove();
    document.getElementById('tg-echo')?.remove();
    nthFor = null;
  }
  async function showNth(force) {
    const v = curVid();
    let box = document.getElementById('tg-nth');
    if (!cfg.nth || !v) { box?.remove(); return; }
    const host = sideHost();
    if (!host) return;
    // 同じ動画のまま画面の幅が変わって置き場所が移ったら、作り直さずに移すだけ
    if (box && box.dataset.v === v && !force && !host.contains(box)) { host.prepend(box); document.getElementById('tg-echo') && host.prepend(document.getElementById('tg-echo')); return; }
    if ((nthFor === v && box && host.contains(box) && !force) || nthBusy) return;
    if (!box || !host.contains(box)) { box?.remove(); box = document.createElement('div'); box.id = 'tg-nth'; host.prepend(box); }
    if (nthFor === v && !force && box.dataset.v === v) return;
    nthFor = v; nthBusy = true;
    box.dataset.v = v;
    box.innerHTML = '<div class="tg-nth-h">🧭 少しズレた関連<small>関連動画の、さらに関連の、さらに関連（3次）を探しています…</small></div>';
    try {
      const list = await nthRelated(v);
      if (curVid() !== v) return;
      const dur = s => { s = Math.round(s || 0); if (!s) return ''; const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
      box.innerHTML = `<div class="tg-nth-h">🧭 少しズレた関連<small>関連の関連の関連（3次リンク）</small><button class="tg-nth-re" title="別の脱線先を探す">↻</button><button class="tg-nth-x" title="たたむ">▾</button></div>
        <div class="tg-nth-list">${list.length ? list.map(x => `<a class="tg-nth-it" href="/watch?v=${esc(x.v)}"><span class="th"><img src="https://i.ytimg.com/vi/${esc(x.v)}/mqdefault.jpg" alt="" loading="lazy">${x.dur ? `<i>${dur(x.dur)}</i>` : ''}</span><span class="tx"><b>${esc(x.t || '')}</b><small>${esc(x.chName || '')}</small></span></a>`).join('') : '<p>見つかりませんでした。↻ で探し直せます。</p>'}</div>`;
      TG.log('関連', `3次リンクの動画を ${list.length} 本表示`);
    } catch (e) {
      box.innerHTML = `<div class="tg-nth-h">🧭 少しズレた関連<small>読み込めませんでした</small><button class="tg-nth-re">↻</button></div>`;
    } finally { nthBusy = false; }
  }
  document.addEventListener('click', e => {
    if (e.target.closest('#tg-nth .tg-nth-re')) { e.preventDefault(); showNth(true); }
    const x = e.target.closest('#tg-nth .tg-nth-x');
    if (x) { e.preventDefault(); const box = document.getElementById('tg-nth'); box.classList.toggle('folded'); x.textContent = box.classList.contains('folded') ? '▸' : '▾'; }
  });


  // ---------- 🧨 エコーチェンバー破壊：真逆の意見と、まったく関係ないジャンルの動画を横の一覧に ----------
  const GENRES = ['深海生物', '伝統工芸 職人', '天文学 入門', '民族音楽', '盆栽', '鉄道 車窓', '古代文明', '数学 解説', '昆虫 観察', '建築 解説', '自然音 森', 'チェス 解説', '詩 朗読', '手話', '養蜂', '世界の朝ごはん', '気象 解説', '登山 記録', '書道', '鉱物 標本', '世界の市場', 'ジャズ 歴史', '落語', '宇宙 ドキュメンタリー'];
  const POS = /レビュー|review|おすすめ|オススメ|最高|神|買って良かった|best|recommend|愛用|絶賛|名作|最強/i;
  function mainWord(m, title) {
    const kw = (m.kw || []).filter(k => k.length >= 2 && k.length <= 20);
    if (kw.length) return kw[0];
    return title.replace(/【[^】]*】|\[[^\]]*\]|「|」|[#＃]\S+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' ').slice(0, 20);
  }
  async function echoBreak() {
    const v = curVid();
    const box = document.getElementById('tg-echo');
    if (!v || !box) return;
    box.innerHTML = '<div class="tg-nth-h">🧨 エコーチェンバー破壊<small>真逆の意見と、まったく関係ないジャンルを探しています…</small></div>';
    const m = (await main('meta')) || {};
    const title = (document.querySelector('ytd-watch-metadata h1')?.textContent || '').trim();
    const word = mainWord(m, title);
    const opp = POS.test(title + ' ' + (m.kw || []).join(' ')) ? ['最悪', '買って後悔', 'デメリット'] : ['反論', '批判', '逆の意見'];
    const cat = (m.category || '').toLowerCase();
    const far = shuffle(GENRES.filter(g => !title.includes(g.split(' ')[0]) && !cat.includes(g))).slice(0, word ? 2 : 4);
    const ch = globalThis.TGPage?.currentChannel?.();
    const groups = [
      ...(word ? opp.map(o => ({ q: `${word} ${o}`, kind: '真逆の意見', n: 2 })) : []),
      ...far.map(g => ({ q: g, kind: '無関係なジャンル', n: 2 }))
    ];
    const out = [], seen = new Set([v]), chs = new Set([ch?.name || '']);
    for (const g of groups) {
      try {
        const { items } = await YTAPI.search(g.q);
        let n = 0;
        for (const x of items.filter(okVid)) { if (n >= g.n) break; if (seen.has(x.v) || chs.has(x.chName)) continue; seen.add(x.v); chs.add(x.chName); out.push({ ...x, kind: g.kind, q: g.q }); n++; }
      } catch { /* 飛ばす */ }
    }
    if (curVid() !== v) return;
    const dur = s => { s = Math.round(s || 0); if (!s) return ''; const h = Math.floor(s / 3600), mm = Math.floor(s % 3600 / 60); return (h ? h + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(s % 60).padStart(2, '0'); };
    box.innerHTML = `<div class="tg-nth-h">🧨 エコーチェンバー破壊<small>「${esc(word)}」の真逆の意見 ＋ 関係ないジャンル</small><button class="tg-echo-go" title="別の組み合わせで探す">↻</button><button class="tg-echo-x" title="閉じる">✕</button></div>
      <div class="tg-nth-list">${out.length ? out.map(x => `<a class="tg-nth-it" href="/watch?v=${esc(x.v)}"><span class="th"><img src="https://i.ytimg.com/vi/${esc(x.v)}/mqdefault.jpg" alt="" loading="lazy">${x.dur ? `<i>${dur(x.dur)}</i>` : ''}</span><span class="tx"><b>${esc(x.t || '')}</b><small>${esc(x.chName || '')}</small><em class="${x.kind === '真逆の意見' ? 'op' : 'far'}">${x.kind}：${esc(x.q)}</em></span></a>`).join('') : '<p>見つかりませんでした。↻ で探し直せます。</p>'}</div>`;
    TG.log('関連', `エコーチェンバー破壊：「${word}」の逆の意見・関係ないジャンルを ${out.length} 本`);
  }
  function ensureEcho() {
    const v = curVid();
    let box = document.getElementById('tg-echo');
    const host = sideHost();
    if (!cfg.echo || !v) { box?.remove(); return; }
    if (!host) return;
    if (box && box.dataset.v === v) { if (!host.contains(box)) host.prepend(box); return; } // 結果を出したままで移す
    box?.remove();
    box = document.createElement('div');
    box.id = 'tg-echo';
    box.dataset.v = v;
    box.innerHTML = '<button class="tg-echo-go tg-echo-big" title="今の動画のタグ・カテゴリから、真逆の意見や関係ないジャンルの動画を出して、好みの偏りを崩す">🧨 エコーチェンバーを壊す<small>真逆の意見・関係ないジャンルを出す</small></button>';
    host.prepend(box);
  }
  document.addEventListener('click', e => {
    if (e.target.closest('#tg-echo .tg-echo-go')) { e.preventDefault(); echoBreak(); }
    if (e.target.closest('#tg-echo .tg-echo-x')) { e.preventDefault(); const b = document.getElementById('tg-echo'); if (b) { b.dataset.v = ''; b.remove(); } ensureEcho(); }
  });

  // ---------- 休憩・就寝リマインダー ----------
  let cont = 0, lastPlay = 0, nextBrk = 0, nextBed = 0;
  const hm = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  function inSleep() {
    if (!sleep.on || !cfg.bed) return false;
    const d = new Date(), x = d.getHours() * 60 + d.getMinutes(), a = hm(sleep.from), b = hm(sleep.to);
    return a <= b ? x >= a && x < b : x >= a || x < b;
  }
  // お知らせは、プレーヤーの中ではなく、ページのいちばん手前(position: fixed)に、プレーヤーに重ねて出す。
  //   プレーヤーの中に置くと、ページの読み込み中に YouTube がプレーヤーを作り直したり、フォーカスを取ったりして、ボタンが押せなくなることがある。
  //   延長の時間は、リスト(select)ではなく、ボタンを並べる(リストは、ページが動くと勝手に閉じてしまう)。ボタンは、押した瞬間(pointerdown)に動く
  function remind(kind, html, later) {
    const p = player();
    if (!p || document.querySelector('.tg-px-rem')) return;
    const d = document.createElement('div');
    d.className = 'tg-px-rem ' + kind;
    const def = cfg.bedExt || 30;
    const ext = kind === 'bed'
      ? `<div class="tg-px-rem-ext"><span>延長する</span>${[[10, '10分'], [15, '15分'], [30, '30分'], [45, '45分'], [60, '1時間'], [90, '1.5時間'], [120, '2時間']].map(([m, l]) => `<button data-r="ext" data-m="${m}"${m === def ? ' class="def"' : ''} title="${l}あとに、もう一度お知らせします">${l}</button>`).join('')}</div>`
      : '';
    d.innerHTML = `<div class="tg-px-rem-t">${html}</div><div class="tg-px-rem-b"><button data-r="pause">⏸ 一時停止する</button>${kind === 'bed' ? '' : `<button data-r="later">あと${later}分</button>`}<button data-r="x">閉じる</button></div>${ext}`;
    ['mousedown', 'mouseup', 'dblclick', 'click', 'keydown', 'keyup', 'pointerdown', 'pointerup', 'wheel'].forEach(t => d.addEventListener(t, e => e.stopPropagation()));
    // 位置: プレーヤーの見えている部分の中央(プレーヤーが画面の外なら、画面の中央)。画面からはみ出さないようにする
    const place = () => {
      const host = document.fullscreenElement || document.documentElement;
      if (d.parentElement !== host) host.appendChild(d);
      const pl = player(), r = pl ? pl.getBoundingClientRect() : null, W = innerWidth, H = innerHeight;
      let x = W / 2, y = H / 2;
      if (r && r.width > 80 && r.bottom > 40 && r.top < H - 40 && r.right > 40 && r.left < W - 40) { x = (Math.max(0, r.left) + Math.min(W, r.right)) / 2; y = (Math.max(0, r.top) + Math.min(H, r.bottom)) / 2; }
      const w = d.offsetWidth / 2 + 8, h = d.offsetHeight / 2 + 8;
      x = Math.round(Math.max(w, Math.min(W - w, x))); y = Math.round(Math.max(h, Math.min(H - h, y)));
      if (d.style.left !== x + 'px') d.style.left = x + 'px';
      if (d.style.top !== y + 'px') d.style.top = y + 'px';
    };
    const pt = setInterval(place, 250);
    addEventListener('scroll', place, true); addEventListener('resize', place); document.addEventListener('fullscreenchange', place);
    let done = false;
    const act = b => {
      if (done) return; done = true;
      const r = b.dataset.r;
      if (r === 'pause') { video()?.pause(); if (kind === 'brk') cont = 0; }
      if (kind === 'brk') nextBrk = cont + (r === 'later' ? later : cfg.brk) * 60;
      else {
        const m = r === 'ext' ? +(b.dataset.m || 30) : 30;
        nextBed = Date.now() + m * 60e3;
        if (r === 'ext') TG.log('リマインダー', `就寝のお知らせを ${m} 分延長`);
      }
      d.classList.add('out');
      setTimeout(() => { clearInterval(pt); removeEventListener('scroll', place, true); removeEventListener('resize', place); document.removeEventListener('fullscreenchange', place); d.remove(); }, 400);
    };
    d.addEventListener('pointerdown', e => { const b = e.button === 0 && e.target.closest('[data-r]'); if (b) { e.preventDefault(); act(b); } });
    d.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) act(b); }); // キーボード(Enter / スペース)で押したとき
    place(); place(); // 2回目: 大きさが決まってから、はみ出しを直す
    TG.log('リマインダー', kind === 'brk' ? `連続 ${Math.round(cont / 60)} 分で休憩をお知らせ` : '就寝時間をお知らせ');
  }
  function checkRemind(dt) {
    const vEl = video();
    const playing = vEl && !vEl.paused && !vEl.ended && !adShowing() && curVid();
    const now = Date.now();
    if (playing) {
      if (now - lastPlay > 10 * 60e3) { cont = 0; nextBrk = 0; } // 10分以上止めていたら区切り直す
      cont += dt; lastPlay = now;
    }
    if (!playing) return;
    if (cfg.brk > 0) {
      if (!nextBrk) nextBrk = cfg.brk * 60;
      if (cont >= nextBrk) { nextBrk = cont + cfg.brk * 60; remind('brk', `☕ 続けて <b>${Math.round(cont / 60)}分</b> 見ています。<br>少し目と体を休めませんか？`, 15); }
    }
    if (inSleep() && now >= nextBed) {
      nextBed = now + 30 * 60e3;
      remind('bed', `🌙 就寝時間（${esc(sleep.from)}〜${esc(sleep.to)}）です。<br>そろそろ区切りをつけて、おやすみの準備をしませんか？`, 15);
    }
  }

  // ---------- まとめて見回る ----------
  const tickErrSeen = new Set();
  const tickErr = (name, e) => { const k = name + ':' + String((e && e.message) || e); if (tickErrSeen.has(k)) return; tickErrSeen.add(k); try { TG.log('再生画面', `「${name}」でエラー(ほかの機能は続けます): ${String((e && e.message) || e)}`, 'warn'); } catch (e2) { /* なし */ } }; // 同じエラーは1回だけ動作ログに残す
  let lastT = Date.now();
  function tick() {
    const now = Date.now(), dt = Math.min(5, (now - lastT) / 1000);
    lastT = now;
    if (!curVid()) { setMini(false); clearSide(); return; }
    // 1つの機能が失敗しても(スマホのブラウザなどで、部品の形が違うとき)、後ろの機能(タグ・元の概要欄など)が止まらないように、1つずつ守って呼ぶ
    const run = (name, fn) => { try { const r = fn(); if (r && r.catch) r.catch(e => tickErr(name, e)); } catch (e) { tickErr(name, e); } };
    run('再生速度', () => applyRate());
    run('戻る・進む', ensureSeek);
    run('バー', applyBars);
    run('チャンネル設定', ensureChBtn);
    run('ツール', ensureTools);
    run('スキップ', applySkip);
    run('フィルター', applyFilter);
    run('A-B', abMark);
    run('字幕', autoSub);
    run('広告', adFast);
    run('省データ', () => applySaver());
    run('タグ', () => showMeta());
    run('ズレた関連', () => { if (!adShowing()) return showNth(); });
    run('エコー', ensureEcho);
    run('ミニ', checkMini);
    run('休憩', () => checkRemind(dt));
  }
  setInterval(tick, 1000);
  document.addEventListener('yt-navigate-finish', () => { if (!curVid()) clearSide(); rateFor = null; document.querySelector('.tg-px-chpop')?.remove(); setTimeout(tick, 300); });
  // 冒頭スキップは読み込み直後に素早く
  document.addEventListener('loadedmetadata', e => { if (e.target === video()) setTimeout(applySkip, 50); }, true);
  return { tick };
})();
