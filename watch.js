// 再生画面(/watch)の追加機能。
//   ツールバー(プレイヤーの右下。設定で左にも置ける): チャプター ⏱ / コメントの時刻 💬 / AB間リピート / スクショ / 字幕 / 流れるコメント / 読み上げ(仮) / チャンネル設定
//   設定は settings.watch と settings.chSet に保存(Drive同期の対象)。
(() => {
  if (window.__tfWatch) return;
  window.__tfWatch = true;
  const DEF = { side: 'right', flow: false, flowTr: true, subAuto: true, speak: false, speakRate: 1.2, recTags: true, autoPip: true };
  let W = { ...DEF }, CH = {};
  const JA = /[぀-ヿ一-鿿]/;
  const TS = /(^|[^\d:])((?:(\d{1,2}):)?(\d{1,2}):([0-5]\d))(?![\d:])/g; // 1:15 / 01:15 / 1:02:03
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clock = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  const player = () => document.querySelector('#movie_player');
  const video = () => { const p = player(); return p && p.querySelector('video'); };
  const vid = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
  const adShowing = () => !!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const bg = msg => new Promise(res => { try { chrome.runtime.sendMessage(msg, r => res(chrome.runtime.lastError ? null : r)); } catch (e) { res(null); } });

  // ---------- 設定 ----------
  const loadS = async () => { const s = await TF.get(); W = { ...DEF, ...(s.settings.watch || {}) }; CH = s.settings.chSet || {}; tick(); };
  const saveW = patch => TF.mutate(s => { s.settings.watch = { ...DEF, ...(s.settings.watch || {}), ...patch }; });
  chrome.storage.onChanged.addListener(ch => { if (ch.settings) loadS(); });
  loadS();

  // ---------- ページ側(watch-main.js)に頼む ----------
  let mSeq = 0;
  function main(op, args) {
    return new Promise(res => {
      const id = ++mSeq;
      const on = e => { let d; try { d = JSON.parse(e.detail); } catch (err) { return; } if (d.id !== id) return; document.removeEventListener('tf-res', on); clearTimeout(t); res(d.result); };
      const t = setTimeout(() => { document.removeEventListener('tf-res', on); res(null); }, 2500);
      document.addEventListener('tf-res', on);
      document.dispatchEvent(new CustomEvent('tf-cmd', { detail: JSON.stringify({ id, op, args }) }));
    });
  }

  // ---------- 状態(動画ごと) ----------
  let st = { v: null };
  const fresh = v => ({ v, chapters: [], cmts: [], groups: [], ab: { a: null, b: null }, ready: [], prepIdx: 0, prepOn: false, flowIdx: 0, skipDone: false, subDone: false, cmtDone: false });
  const flash = text => {
    const p = player(); if (!p) return;
    let d = p.querySelector('.tf-wflash');
    if (!d) { d = document.createElement('div'); d.className = 'tf-wflash'; p.appendChild(d); }
    d.textContent = text; d.classList.remove('on'); void d.offsetWidth; d.classList.add('on');
  };
  const seek = sec => { const v = video(); if (v) { v.currentTime = sec; } };

  // ---------- チャプター(概要欄の目次。YouTubeのチャプターと同じ) ----------
  async function loadChapters(v) {
    let info = null;
    for (let i = 0; i < 8 && st.v === v; i++) { info = await main('info'); if (info && info.v === v) break; info = null; await sleep(700); }
    if (st.v !== v) return;
    st.info = info;
    const out = [];
    for (const line of String((info && info.desc) || '').split('\n')) {
      const m = [...line.matchAll(TS)][0]; if (!m) continue;
      const sec = (+m[3] || 0) * 3600 + +m[4] * 60 + +m[5];
      const label = line.replace(/https?:\/\/\S+/g, ' ').replace(TS, ' ').replace(/^[\s\-–—:：・|｜>＞\[\]【】()（）]+|[\s\-–—:：・|｜]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (!out.some(c => c.sec === sec)) out.push({ sec, label: label || 'チャプター' });
    }
    out.sort((a, b) => a.sec - b.sec);
    let list = out[0] && out[0].sec === 0 && out.length >= 3 ? out : [];
    if (!list.length) { // 画面の中の目次
      for (const r of document.querySelectorAll('ytd-macro-markers-list-item-renderer')) {
        const t = (r.querySelector('#time') || {}).textContent || '';
        const m = [...(' ' + t.trim()).matchAll(TS)][0]; if (!m) continue;
        const sec = (+m[3] || 0) * 3600 + +m[4] * 60 + +m[5];
        const label = ((r.querySelector('#details h4, h4') || {}).textContent || 'チャプター').trim();
        if (!list.some(c => c.sec === sec)) list.push({ sec, label });
      }
      list.sort((a, b) => a.sec - b.sec);
    }
    st.chapters = list;
    paintBar();
  }

  // ---------- コメント(時刻リスト・流れるコメント) ----------
  async function loadComments(v) {
    let token = null;
    const stamps = [];
    for (let page = 0; page < 4 && st.v === v; page++) {
      const r = await bg({ type: 'cmtPage', videoId: v, token });
      if (!r || r.error || st.v !== v) break;
      for (const c of r.items || []) { st.cmts.push(c); stampsOf(c, stamps); }
      token = r.token;
      if (!token) break;
    }
    if (st.v !== v) return;
    // 同じ秒をまとめる(コメントが多いほうを代表に)
    const map = new Map();
    stamps.forEach(s => { const g = map.get(s.sec) || { sec: s.sec, n: 0, label: s.label }; g.n++; if (s.label.length > g.label.length && s.label.length < 70) g.label = s.label; map.set(s.sec, g); });
    st.groups = [...map.values()].sort((a, b) => a.sec - b.sec);
    st.cmtDone = true;
    paintBar(); if (W.flow) prep();
  }
  function stampsOf(c, out) {
    const text = c.text || '', found = [...text.matchAll(TS)]; if (!found.length) return;
    const lines = text.split('\n');
    for (const m of found) {
      const sec = (+m[3] || 0) * 3600 + +m[4] * 60 + +m[5];
      const line = lines.find(l => l.includes(m[2])) || text;
      const label = line.replace(TS, ' ').replace(/^[\s\-–—:：・|｜>＞\[\]【】()（）]+|[\s\-–—:：・|｜]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
      out.push({ sec, label: label || text.slice(0, 40) });
    }
  }
  // 外国語のコメントは、日本語へ(翻訳したものは印を付ける)
  const trMemo = new Map();
  async function toJa(c) {
    if (c.ja != null) return c;
    if (JA.test(c.text)) { c.ja = c.text; c.tr = false; return c; }
    let r = trMemo.get(c.text);
    if (!r) { r = await bg({ type: 'translate', q: c.text, to: 'ja' }); if (r && !r.error) trMemo.set(c.text, r); }
    if (r && r.text && !/^ja/.test(r.src || '')) { c.ja = r.text; c.tr = true; } else { c.ja = c.text; c.tr = false; }
    return c;
  }
  async function prep() { // 流す順に、翻訳しながら先読み(最大 12 件先まで)
    if (st.prepOn) return; st.prepOn = true; const my = st.v;
    try {
      while (st.v === my && W.flow) {
        if (st.ready.length >= 12 || st.prepIdx >= st.cmts.length) { await sleep(1000); if (st.prepIdx >= st.cmts.length && st.ready.length < 12 && st.cmts.length) st.prepIdx = 0; continue; }
        const c = st.cmts[st.prepIdx++];
        if (!c || c.text.length > 160) continue;
        if (W.flowTr) await toJa(c); else { c.ja = c.text; c.tr = false; }
        st.ready.push(c);
      }
    } finally { st.prepOn = false; }
  }
  function flowBox() {
    const p = player(); if (!p) return null;
    let f = p.querySelector('.tf-flow');
    if (!f) { f = document.createElement('div'); f.className = 'tf-flow'; p.appendChild(f); }
    return f;
  }
  let laneAt = [];
  function spawn() {
    const v = video(), f = flowBox();
    if (!f) return;
    if (!W.flow || !v) { f.textContent = ''; return; }
    f.classList.toggle('paused', v.paused);
    if (v.paused || adShowing() || !st.ready.length) return;
    // 縦に流れる(上から下へ。縦書き)。画面の幅をレーン(縦の列)に分け、同じ列に重ならないように出す
    const c = st.ready.shift(), w = f.clientWidth || 800, h = f.clientHeight || 400, LW = 40, lanes = Math.max(1, Math.floor(w / LW)), now = Date.now();
    const txt = (c.ja || c.text).replace(/\s+/g, ' ').slice(0, 36), dur = Math.max(8, Math.min(13, h / 45)), speed = h / dur, occupy = ((txt.length + (c.tr ? 3 : 0)) * 24 / speed + 0.6) * 1000;
    let lane = -1;
    for (let k = 0; k < lanes; k++) { const i = (Math.floor(Math.random() * lanes) + k) % lanes; if ((laneAt[i] || 0) < now) { lane = i; break; } }
    if (lane < 0) { st.ready.unshift(c); return; }
    laneAt[lane] = now + occupy;
    const s = document.createElement('span');
    s.className = 'tf-fc' + (c.tr ? ' tr' : '');
    s.style.left = Math.min(w - LW, lane * LW + (w - lanes * LW) / 2) + 'px'; s.style.setProperty('--h', h + 'px'); s.style.animationDuration = dur + 's';
    s.innerHTML = (c.tr ? '<i>翻訳</i>' : '') + esc(txt);
    if (c.tr) s.title = '原文: ' + c.text;
    s.addEventListener('animationend', () => s.remove());
    f.appendChild(s);
  }

  // ---------- 字幕: 音声が日本語以外なら、YouTubeの字幕を日本語(自動翻訳)で表示 / 日本語なら、字幕を非表示 ----------
  //  日本語の動画かどうかの判定(旧TubeFolioと同じ順):
  //   ① 今流れている音声トラックが日本語  ② タイトルにひらがな・カタカナ(自動字幕の言語が間違っていることがあるので、こちらを優先)
  //   ③ YouTubeの自動字幕(音声認識)の言語  ④ 自動字幕が無ければ、概要欄のかな・字幕の一覧
  //  YouTubeは、字幕をあとから付けることがあるので、動画が始まって30秒ほどは、見張って、整える。自分で字幕ボタン(CC・cキー)を押したら、その動画では、触らない。
  const KANA = /[぀-ゟ゠-ヿ]/;
  const baseLang = l => String(l || '').toLowerCase().split(/[-_]/)[0];
  function langOf(tr) {
    if (baseLang(tr.audio) === 'ja') return 'ja';
    if (KANA.test(tr.title || '')) return 'ja';
    if (tr.spoken) return baseLang(tr.spoken);
    if (!(tr.title || '').trim() && KANA.test(tr.desc || '')) return 'ja';
    if (tr.tracks && tr.tracks.some(t => baseLang(t.lc) === 'ja')) return 'ja';
    if (tr.tracks && tr.tracks.length) return baseLang(tr.tracks[0].lc);
    return '';
  }
  const ccOn = () => { const b = document.querySelector('#movie_player .ytp-subtitles-button'); return !!b && b.getAttribute('aria-pressed') === 'true'; };
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.ytp-subtitles-button')) st.manualSub = true; }, true);
  document.addEventListener('keydown', e => { if ((e.key === 'c' || e.key === 'C') && !(e.target.closest && e.target.closest('input, textarea, [contenteditable]'))) st.manualSub = true; }, true);
  let subBusy = false;
  async function autoSub(v) {
    if (!W.subAuto || subBusy) return;
    subBusy = true;
    try {
      let info = null;
      for (let i = 0; i < 12 && st.v === v; i++) { info = await main('info'); if (info && info.v === v && (info.tracks.length || i > 5)) break; await sleep(800); }
      if (st.v !== v || !info) return;
      st.lang = langOf(info); st.subUntil = Date.now() + 30000;
    } finally { subBusy = false; }
  }
  async function subWatch() { // 動画が始まって30秒ほど、日本語の動画は字幕を消し、そのほかは、日本語の字幕にそろえる
    const v = st.v; if (!v || !W.subAuto || subBusy || !st.lang || Date.now() > (st.subUntil || 0) || st.manualSub || adShowing()) return;
    subBusy = true;
    try {
      const info = await main('info'); if (!info || info.v !== v || st.v !== v) return;
      if (st.lang === 'ja') { if (ccOn()) { await main('show', { lang: null }); } return; }
      const tl = info.cur && (info.cur.tl === 'ja' || (info.cur.lc === 'ja' && !info.cur.tl));
      if (!ccOn() || !tl) { if (!info.tracks.length) return; const r = await main('show', { lang: 'ja' }); if (r && !st.subFlashed) { st.subFlashed = true; flash(r === 'exact' ? '字幕: 日本語' : '字幕: 日本語(自動翻訳)'); } }
    } finally { subBusy = false; }
  }

  // ---------- AB間リピート ----------
  function abClick() {
    const v = video(); if (!v) return; const ab = st.ab;
    if (ab.a == null) { ab.a = v.currentTime; flash('A点: ' + clock(ab.a)); }
    else if (ab.b == null) { if (v.currentTime <= ab.a + 0.5) return flash('B点は、A点より後ろで指定してください'); ab.b = v.currentTime; flash(`AB間リピート: ${clock(ab.a)} 〜 ${clock(ab.b)}`); }
    else { ab.a = ab.b = null; flash('AB間リピート: 解除'); }
    paintBar();
  }
  function abTick() {
    const v = video(), ab = st.ab;
    if (!v || ab.a == null || ab.b == null || v.seeking) return;
    if (v.currentTime >= ab.b) v.currentTime = ab.a;
  }

  // ---------- スクショ(ツール・字幕が写らない。動画の映像だけ) ----------
  function shot() {
    const v = video(); if (!v || !v.videoWidth) return flash('スクショできませんでした');
    try {
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      c.toBlob(b => {
        if (!b) return flash('スクショできませんでした');
        const name = ((document.title || 'youtube').replace(/ - YouTube$/, '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)) + '_' + clock(v.currentTime).replace(/:/g, '-') + '.png';
        const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        try { navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).catch(() => {}); } catch (e) { /* なし */ }
        flash('📷 スクショを保存しました(クリップボードにもコピー)');
      }, 'image/png');
    } catch (e) { flash('スクショできませんでした(保護された動画)'); }
  }



  // ---------- 再生した動画のタグを記録(30秒以上見た動画ごとに1回。playedTags。管理は「TubeFolio2 設定 → 再生した動画のタグ」) ----------
  async function recordTags() {
    st.tagRec = true; const v = st.v;
    try {
      let info = st.info && st.info.v === v && st.info.kw ? st.info : null;
      for (let i = 0; i < 6 && !info && st.v === v; i++) { const r = await main('info'); if (r && r.v === v) info = r; else await sleep(600); }
      if (!info || st.v !== v) return;
      const S = await TF.get(), chNames = new Set(Object.values(S.channels || {}).map(c => String(c.name || '').toLowerCase()));
      const { playedTags = {} } = await chrome.storage.local.get('playedTags'), seen = new Set();
      for (let t of info.kw || []) {
        t = String(t).trim(); const k = t.toLowerCase();
        if (t.length < 2 || t.length > 20 || seen.has(k) || chNames.has(k) || /^(youtube|video|動画|vlog|shorts?)$/i.test(t)) continue;
        seen.add(k);
        const e = playedTags[k] || { t, n: 0 };
        if (e.ng) continue;
        e.n = (e.n || 0) + 1; e.at = Date.now(); playedTags[k] = e;
      }
      const keys = Object.keys(playedTags), auto = keys.filter(k => !playedTags[k].own && !playedTags[k].pin && !playedTags[k].ng);
      if (keys.length > 800) auto.sort((a, b) => (playedTags[a].at || 0) - (playedTags[b].at || 0)).slice(0, keys.length - 800).forEach(k => delete playedTags[k]); // 多すぎたら、古いものから捨てる(自分で追加・表示・除外したものは残す)
      await chrome.storage.local.set({ playedTags });
    } catch (e) { st.tagRec = false; }
  }
  setInterval(() => { // 再生している秒数を数える
    const v = video(); if (!st.v || st.tagRec || !W.recTags || !v || v.paused || adShowing()) return;
    st.secs = (st.secs || 0) + 1; if (st.secs >= 30) recordTags();
  }, 1000);

  // ---------- ブックマーク: Bキーで、その瞬間の位置・サムネ・一言メモを登録(ブックマークページで見られる。storage の bookmarks。Drive同期の対象) ----------
  const titleDom = () => ((document.querySelector('ytd-watch-metadata h1') || {}).textContent || document.title.replace(/ - YouTube$/, '')).trim();
  function frame() { // 今の映像のコマ(小さく縮めて保存)。保護された動画などで取れなければ空
    const v = video(); if (!v || !v.videoWidth) return '';
    try { const w = 320, h = Math.max(1, Math.round(w * v.videoHeight / v.videoWidth)), c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(v, 0, 0, w, h); return c.toDataURL('image/jpeg', 0.72); } catch (e) { return ''; }
  }
  async function bmSave(b) { const { bookmarks = [] } = await chrome.storage.local.get('bookmarks'); bookmarks.unshift(b); await chrome.storage.local.set({ bookmarks }); }
  function bmStart() {
    const p = player(), v = video(); if (!p || !v || !st.v || p.querySelector('.tf-bmq')) return;
    const sec = Math.floor(v.currentTime), thumb = frame(), was = !v.paused, vidNow = st.v;
    v.pause();
    const q = document.createElement('div'); q.className = 'tf-bmq';
    q.innerHTML = `<div class="h">🔖 ブックマーク ${clock(sec)}</div><input type="text" maxlength="200" placeholder="一言メモ(空でもOK)"><div class="k">Enter: 保存 / Esc: やめる</div>`;
    ['mousedown', 'mouseup', 'click', 'dblclick', 'keyup', 'keypress'].forEach(t => q.addEventListener(t, e => e.stopPropagation()));
    const inp = q.querySelector('input');
    const end = save => {
      q.remove(); if (was) v.play && v.play();
      if (!save) return;
      bmSave({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), v: vidNow, t: sec, note: inp.value.trim(), title: titleDom(), ch: chName(), at: Date.now(), thumb });
      flash(`🔖 ブックマークしました(${clock(sec)})`);
    };
    q.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); end(true); } else if (e.key === 'Escape') { e.preventDefault(); end(false); } });
    p.appendChild(q); inp.focus();
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'b' && e.key !== 'B') return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!st.v || !video()) return;
    e.preventDefault(); e.stopPropagation(); bmStart();
  }, true);

  // ---------- 読み上げ(仮): 画面に出ている日本語字幕を、音声合成で読む ----------
  const synth = window.speechSynthesis;
  let spLast = '', spPend = '', spAt = 0, spQ = [], spBusy = false, voice = null;
  const grow = (prev, cur) => { if (!prev) return cur; if (cur.startsWith(prev)) return cur.slice(prev.length).trim(); if (cur.length >= 4 && prev.includes(cur)) return ''; for (let k = Math.min(prev.length, cur.length) - 1; k >= 4; k--) if (cur.startsWith(prev.slice(-k))) return cur.slice(k).trim(); return cur; };
  function spStop() { spQ = []; spBusy = false; spLast = ''; spPend = ''; try { synth && synth.cancel(); } catch (e) { /* なし */ } }
  function spNext() {
    if (!W.speak || !synth) { spBusy = false; return; }
    const t = spQ.shift(); if (!t) { spBusy = false; return; }
    spBusy = true;
    const u = new SpeechSynthesisUtterance(t); u.lang = 'ja-JP'; u.rate = W.speakRate || 1.2;
    if (!voice) { const vs = synth.getVoices().filter(x => /^ja/i.test(x.lang)); voice = vs.find(x => /natural|online/i.test(x.name)) || vs[0] || null; }
    if (voice) u.voice = voice;
    u.onend = spNext; u.onerror = e => { if (e.error !== 'canceled' && e.error !== 'interrupted') spNext(); };
    synth.speak(u);
  }
  function spPoll() {
    if (!W.speak || !synth) return;
    const v = video(); if (!v || v.paused || adShowing()) return;
    const cur = [...document.querySelectorAll('#movie_player .ytp-caption-window-container .ytp-caption-segment')].map(s => s.textContent).join(' ').replace(/\s+/g, ' ').trim();
    if (!cur) { spPend = ''; return; }
    const now = Date.now();
    if (cur !== spPend) { spPend = cur; spAt = now; return; }
    if (now - spAt < 350 || cur === spLast) return;
    const add = grow(spLast, cur); spLast = cur;
    if (add && JA.test(add)) { spQ.push(...(add.match(/.{1,80}/gs) || [])); while (spQ.length > 4) spQ.shift(); if (!spBusy) spNext(); }
  }
  ['pause', 'seeking', 'emptied'].forEach(n => document.addEventListener(n, e => { if (e.target === video()) spStop(); }, true));

  // ---------- チャンネル別の設定(冒頭・最後のスキップ / 再生速度) ----------
  const chKey = () => { const a = document.querySelector('ytd-watch-metadata ytd-video-owner-renderer a[href^="/@"], ytd-watch-metadata ytd-video-owner-renderer a[href^="/channel/"], #owner a[href^="/@"], #owner a[href^="/channel/"]'); return a ? TF.keyFromHref(a.getAttribute('href')) : null; };
  const chName = () => { const a = document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a'); return a ? a.textContent.trim() : ''; };
  function applySkip() {
    const v = video(), k = chKey(); if (!v || !k || adShowing() || !(v.duration > 0)) return;
    const c = CH[k]; if (!c) return;
    if (!st.skipDone) {
      st.skipDone = true;
      if (c.rate > 0) v.playbackRate = c.rate;
      if (c.s > 0 && v.currentTime < c.s - 1 && v.currentTime < 8 && !/[?&]t=/.test(location.search)) { v.currentTime = c.s; flash(`⏭ 冒頭 ${c.s} 秒をスキップ`); }
    }
    if (c.e > 0 && !st.endDone && v.duration > c.e + 20 && !v.paused) {
      const left = v.duration - v.currentTime;
      if (left <= c.e && left > 1) { st.endDone = true; flash(`⏭ 最後の ${c.e} 秒をスキップ`); v.currentTime = v.duration - 0.2; }
    }
  }


  // ---------- 下へスクロールして動画が隠れたら、ピクチャインピクチャー(小窓)で表示 ----------
  //  ブラウザの決まりで、PiPは「クリック・キー入力の直後」にしか開けない。マウスホイールだけのスクロールでは、断られることがある。
  //  断られたときは、ページの右下に、小さな窓(映像のコピー)を出す。↑ を押すと、動画の位置へ戻る。
  let pipOff = null, mini = null, miniRaf = 0, pipWarned = false;
  const pipAnchor = () => { const p = player(); return p && p.getBoundingClientRect(); };
  async function pipOpen(v) {
    try { await v.requestPictureInPicture(); st.autoPip = true; return true; } catch (e) { return false; }
  }
  function miniDraw() {
    const c = mini && mini.querySelector('canvas'), v = video(); if (!c || !v) return;
    if (v.videoWidth && (c.width !== 480 || c.height !== Math.round(480 * v.videoHeight / v.videoWidth))) { c.width = 480; c.height = Math.round(480 * v.videoHeight / v.videoWidth); }
    try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); } catch (e) { /* なし */ }
    mini.classList.toggle('paused', v.paused);
    miniRaf = requestAnimationFrame(miniDraw);
  }
  function miniSet(on) {
    if (!!mini === on) return;
    if (!on) { cancelAnimationFrame(miniRaf); miniRaf = 0; mini.remove(); mini = null; return; }
    mini = document.createElement('div'); mini.id = 'tf-mini';
    mini.innerHTML = '<canvas width="480" height="270"></canvas><div class="bar"><button data-m="up" title="動画の位置へ戻る">↑</button><button data-m="pip" title="ピクチャインピクチャーで開く">🗔</button><button data-m="x" title="閉じる">✕</button></div><div class="ctl"><button data-m="pp" class="pp"></button></div>';
    mini.addEventListener('click', e => {
      const b = e.target.closest('[data-m]'), v = video(); if (!v) return;
      const k = b ? b.dataset.m : 'pp';
      if (k === 'pp') (v.paused ? v.play() : v.pause());
      else if (k === 'x') { pipOff = st.v; miniSet(false); }
      else if (k === 'up') { miniSet(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else if (k === 'pip') v.requestPictureInPicture().then(() => { st.autoPip = false; miniSet(false); }).catch(() => {});
    });
    document.body.appendChild(mini); miniDraw();
  }
  async function pipCheck() {
    const v = video(), r = pipAnchor();
    if (!st.v || !v || !r || !r.height || !W.autoPip || document.fullscreenElement || adShowing()) { if (mini) miniSet(false); return; }
    const hidden = r.bottom < r.height * 0.35 + 56; // 6割以上が上へ隠れた
    if (!hidden) { // 動画が見える位置へ戻った: 自動で開いた小窓は閉じる
      if (pipOff === st.v) pipOff = null;
      if (mini) miniSet(false);
      if (st.autoPip && document.pictureInPictureElement === v) { try { await document.exitPictureInPicture(); } catch (e) { /* なし */ } }
      st.autoPip = false; return;
    }
    if (pipOff === st.v || document.pictureInPictureElement || mini || (v.paused && !st.autoPip)) return;
    if (v.paused) return;
    if (await pipOpen(v)) return;
    miniSet(true);
    if (!pipWarned) { pipWarned = true; flash('ブラウザの決まりで、ピクチャインピクチャーは、クリックやキー入力の直後でないと開けません。右下の小窓を出しました(🗔 で、PiPに切り替え)'); }
  }
  document.addEventListener('leavepictureinpicture', () => { if (st.v) { const r = pipAnchor(); if (r && r.bottom < r.height * 0.35 + 56) pipOff = st.v; st.autoPip = false; } }, true); // 小窓を自分で閉じたら、スクロールで戻るまで、また開かない
  let pipT = 0; window.addEventListener('scroll', () => { if (!pipT) pipT = requestAnimationFrame(() => { pipT = 0; pipCheck(); }); }, { passive: true });
  setInterval(pipCheck, 1500);
  function pipToggle() { const v = video(); if (!v) return; if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {}); else v.requestPictureInPicture().then(() => { st.autoPip = false; miniSet(false); }).catch(() => flash('ピクチャインピクチャーを開けませんでした')); }

  // ---------- ツールバー ----------
  const BTN = [
    ['ch', '⏱', 'チャプター'], ['cm', '💬', 'コメントの時刻'], ['ab', 'A-B', 'AB間リピート(1回目: A点 / 2回目: B点 / 3回目: 解除)'], ['shot', '📷', 'スクショ(ツール・字幕なし)'], ['pip', '🗔', '小窓(ピクチャインピクチャー)で表示'],
    ['sub', '字', '字幕(日本語以外の音声は日本語字幕)'], ['flow', '流', '流れるコメント'], ['spk', '読', '字幕の読み上げ(仮)'], ['chs', '⚙', 'このチャンネルの設定'], ['side', '⇄', 'ツールバーを左右に移動']
  ];
  function ensureBar() {
    const p = player(); if (!p) return null;
    const left = W.side === 'left';
    const host = left ? p.querySelector('.ytp-left-controls') : (p.querySelector('.ytp-right-controls-left') || p.querySelector('.ytp-right-controls'));
    if (!host) return null;
    let bar = p.querySelector('.tf-wbar');
    if (bar && bar.parentElement !== host) { bar.remove(); bar = null; }
    if (!bar) {
      bar = document.createElement('div'); bar.className = 'tf-wbar';
      bar.innerHTML = BTN.map(([k, ic, tt]) => `<button class="tf-wb" data-k="${k}" title="${esc(tt)}"><span>${ic}</span><em></em></button>`).join('');
      ['mousedown', 'keydown', 'dblclick'].forEach(t => bar.addEventListener(t, e => e.stopPropagation()));
      bar.addEventListener('click', e => { e.stopPropagation(); const b = e.target.closest('.tf-wb'); if (b) onBtn(b.dataset.k, b); });
      if (left) host.appendChild(bar); else host.insertBefore(bar, host.firstChild);
    }
    bar.classList.toggle('left', left);
    return bar;
  }
  function paintBar() {
    const bar = ensureBar(); if (!bar) return;
    const set = (k, o) => { const b = bar.querySelector(`[data-k="${k}"]`); if (!b) return; b.hidden = o.hide === true; b.classList.toggle('on', !!o.on); b.querySelector('em').textContent = o.n != null ? o.n : ''; };
    set('ch', { hide: !st.chapters.length, n: st.chapters.length });
    set('cm', { hide: !st.groups.length, n: st.groups.length });
    const ab = st.ab; set('ab', { on: ab.a != null, n: ab.a == null ? '' : ab.b == null ? 'A' : 'AB' });
    set('pip', { on: !!document.pictureInPictureElement || W.autoPip }); set('flow', { on: W.flow }); set('spk', { on: W.speak }); set('sub', { on: W.subAuto });
    set('chs', { on: !!CH[chKey()] });
  }
  function onBtn(k, b) {
    if (k === 'ab') return abClick();
    if (k === 'shot') return shot();
    if (k === 'pip') return pipToggle();
    if (k === 'flow') { saveW({ flow: !W.flow }); return; }
    if (k === 'spk') { const on = !W.speak; saveW({ speak: on }); if (on) { main('show', { lang: 'ja' }); flash('読み上げ: オン(日本語字幕を読みます)'); } else spStop(); return; }
    if (k === 'side') { saveW({ side: W.side === 'left' ? 'right' : 'left' }); return; }
    menu(k, b);
  }

  // ---------- メニュー ----------
  function closeMenu() { const m = document.querySelector('.tf-wmenu'); if (m) m.remove(); }
  function menu(kind, btn) {
    const old = document.querySelector('.tf-wmenu'); const same = old && old.dataset.k === kind; closeMenu(); if (same) return;
    const p = player(); if (!p) return;
    const m = document.createElement('div'); m.className = 'tf-wmenu' + (W.side === 'left' ? ' left' : ''); m.dataset.k = kind;
    ['mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'keypress', 'wheel'].forEach(t => m.addEventListener(t, e => e.stopPropagation()));
    const v = video(), cur = v ? v.currentTime : 0;
    if (kind === 'ch' || kind === 'cm') {
      const list = kind === 'ch' ? st.chapters : st.groups;
      m.innerHTML = `<div class="h">${kind === 'ch' ? `チャプター ${list.length}` : `コメントの時刻 ${list.length}`}<button data-x>✕</button></div><div class="ls">` + list.map((c, i) => {
        const next = list[i + 1], now = cur >= c.sec && (!next || cur < next.sec);
        return `<button class="it${now ? ' now' : ''}" data-s="${c.sec}"><b>${clock(c.sec)}</b><span>${esc(c.label)}</span>${c.n > 1 ? `<small>×${c.n}</small>` : ''}</button>`;
      }).join('') + '</div>';
      m.addEventListener('click', e => { if (e.target.closest('[data-x]')) return closeMenu(); const it = e.target.closest('.it'); if (it) { seek(+it.dataset.s); closeMenu(); } });
    } else if (kind === 'sub') {
      m.innerHTML = `<div class="h">字幕<button data-x>✕</button></div><div class="ls">
        <button class="it${W.subAuto ? ' now' : ''}" data-a="auto"><span>自動: 音声が日本語以外なら日本語字幕、日本語なら非表示</span><small>${W.subAuto ? 'ON' : 'OFF'}</small></button>
        <button class="it" data-a="ja"><span>この動画で、日本語字幕を出す</span></button>
        <button class="it" data-a="off"><span>この動画で、字幕を消す</span></button></div>`;
      m.addEventListener('click', async e => {
        if (e.target.closest('[data-x]')) return closeMenu();
        const a = (e.target.closest('.it') || {}).dataset; if (!a) return; closeMenu();
        if (a.a !== 'auto') st.manualSub = true;
        if (a.a === 'auto') { const on = !W.subAuto; await saveW({ subAuto: on }); if (on) setTimeout(() => { st.manualSub = false; st.subFlashed = false; autoSub(st.v); }, 400); } else if (a.a === 'ja') { const r = await main('show', { lang: 'ja' }); flash(r ? '字幕: 日本語' : 'この動画には字幕がありません'); } else { await main('show', { lang: null }); flash('字幕: オフ'); }
        paintBar();
      });
    } else if (kind === 'chs') {
      const k = chKey(), c = CH[k] || {};
      if (!k) { flash('チャンネルを特定できませんでした'); return; }
      m.innerHTML = `<div class="h">⚙ ${esc(chName() || k)} の設定<button data-x>✕</button></div><div class="fm">
        <label>冒頭をスキップ<span><input type="number" min="0" max="600" data-f="s" value="${c.s || ''}" placeholder="0"> 秒 <button data-n="s">今の位置</button></span></label>
        <label>最後をスキップ<span><input type="number" min="0" max="600" data-f="e" value="${c.e || ''}" placeholder="0"> 秒 <button data-n="e">今の位置から</button></span></label>
        <label>再生速度<span><select data-f="rate"><option value="">そのまま</option>${[0.75, 1, 1.25, 1.5, 1.75, 2].map(r => `<option value="${r}"${c.rate === r ? ' selected' : ''}>${r}倍</option>`).join('')}</select></span></label>
        <p>最後のスキップは、残りの時間になったら動画を終わらせて、次へ進みます。</p></div>`;
      const num = f => Math.max(0, Math.min(600, Math.round(+(m.querySelector(`[data-f="${f}"]`).value) || 0)));
      const save = () => { const next = { s: num('s'), e: num('e'), rate: +m.querySelector('[data-f="rate"]').value || 0, name: chName() }; TF.mutate(s => { const cs = s.settings.chSet = s.settings.chSet || {}; if (!next.s && !next.e && !next.rate) delete cs[k]; else cs[k] = next; }); };
      m.addEventListener('change', save);
      m.addEventListener('click', e => {
        if (e.target.closest('[data-x]')) return closeMenu();
        const n = (e.target.closest('[data-n]') || {}).dataset; const vv = video(); if (!n || !vv) return;
        m.querySelector(`[data-f="${n.n}"]`).value = n.n === 's' ? Math.floor(vv.currentTime) : Math.ceil(vv.duration - vv.currentTime); save();
      });
    }
    p.appendChild(m);
    const it = m.querySelector('.it.now'); if (it) it.scrollIntoView({ block: 'center' });
  }
  document.addEventListener('mousedown', e => { if (!(e.target.closest && e.target.closest('.tf-wmenu, .tf-wbar'))) closeMenu(); }, true);

  // ---------- 更新ループ ----------
  function tick() {
    const v = vid();
    if (!v) { if (st.v) { st = { v: null }; spStop(); closeMenu(); } document.querySelectorAll('.tf-wbar, .tf-flow, .tf-wmenu').forEach(e => e.remove()); return; }
    if (v !== st.v) {
      if (mini) miniSet(false); pipOff = null;
      st = fresh(v); laneAt = []; spStop(); closeMenu();
      const f = document.querySelector('.tf-flow'); if (f) f.textContent = '';
      loadChapters(v); loadComments(v); autoSub(v);
    }
    paintBar(); applySkip();
    if (W.flow && !st.prepOn && st.cmts.length) prep();
    subWatch();
    if (!W.speak && spBusy) spStop();
  }
  setInterval(tick, 700);
  setInterval(abTick, 100);
  setInterval(() => { if (st.v) spawn(); }, 900);
  setInterval(() => { if (st.v) spPoll(); }, 250);
})();
