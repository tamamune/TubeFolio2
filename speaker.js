// CaptionSpeaker：日本語字幕を、ブラウザの音声合成（speechSynthesis）で読み上げる
//   ・字幕データ（timedtext）を先に取り、動画の時刻に合わせて読む（先読み）。画面の字幕を待たないので出だしが遅れない
//   ・字幕の表示時間に収まるように読む速さを自動で上げる。それでも間に合わないときだけ動画を一時停止して、読み終わるのを待つ
//   ・字幕データが取れないとき（字幕がオフなど）は、画面に出ている字幕（.ytp-caption-segment）を読む（従来の方法）
//   ・一時停止・シーク・広告・動画の切り替えで止める
//   設定 px: { speak, speakRate（基本の速さ）, speakDuck（読み上げ中の元の音量・%）, speakHide（字幕を隠す） }
(() => {
  if (window.__tgSpeaker) return;
  window.__tgSpeaker = true;
  const DEF = { speak: false, speakRate: 1.2, speakDuck: 15, speakHide: false };
  let cfg = { ...DEF };
  const synth = window.speechSynthesis;
  if (!synth) return;

  const MAX_RATE = 2.4;   // 自動で上げる速さの上限
  const LEAD = 0.3;       // 字幕の開始より少し前に読み始める（秒）。音声合成の立ち上がり分
  const HOLD_MAX = 8000;  // 1回の一時停止の上限（ミリ秒）
  const player = () => document.querySelector('#movie_player');
  const video = () => player()?.querySelector('video');
  const curVid = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
  const adShowing = () => !!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting');
  const JA = /[぀-ヿ一-鿿]/;

  const load = async () => { const { px = {} } = await chrome.storage.local.get('px'); cfg = { ...DEF, ...px }; };
  const ready = load();
  chrome.storage.onChanged.addListener(ch => {
    if (!ch.px) return;
    const was = cfg.speak;
    load().then(() => { if (was && !cfg.speak) stop(); paint(); });
  });

  // ---------- YouTubeのページ側（mainworld.js）に頼む（playerx.js と番号がぶつからないよう大きい数から） ----------
  let mSeq = 1e9;
  function main(op, args) {
    return new Promise(res => {
      const id = ++mSeq;
      const on = e => { let d; try { d = JSON.parse(e.detail); } catch { return; } if (d.id !== id) return; document.removeEventListener('tg-res', on); clearTimeout(t); res(d.result); };
      const t = setTimeout(() => { document.removeEventListener('tg-res', on); res(null); }, 2000);
      document.addEventListener('tg-res', on);
      document.dispatchEvent(new CustomEvent('tg-cmd', { detail: JSON.stringify({ id, op, args }) }));
    });
  }

  // ---------- 声 ----------
  let voice = null;
  function pickVoice() {
    if (voice) return voice;
    const vs = synth.getVoices().filter(v => /^ja/i.test(v.lang));
    voice = vs.find(v => /natural|online/i.test(v.name)) || vs.find(v => /nanami|google|kyoko|haruka/i.test(v.name)) || vs[0] || null;
    return voice;
  }
  synth.addEventListener?.('voiceschanged', () => { voice = null; });

  // ---------- 読み上げ（1行ずつ） ----------
  let speaking = false, duckVol = null, idleT = null, gen = 0, cps = 5.5; // gen：stop() で増える（止めたあとに遅れて来る onend を無視する）／cps：速さ1倍で1秒に読める文字数（読んだ実績で補正）
  let holding = false, holdAt = 0;
  function duck(on) {
    const v = video();
    if (!v) return;
    if (on && duckVol == null && cfg.speakDuck < 100) { duckVol = v.volume; v.volume = Math.max(0, Math.min(1, duckVol * cfg.speakDuck / 100)); }
    if (!on && duckVol != null) { v.volume = duckVol; duckVol = null; }
  }
  const splitText = text => text.split(/(?<=[。！？!?])/).flatMap(s => s.match(/.{1,80}/gs) || []).map(s => s.trim()).filter(Boolean); // 長いと途中で止まることがある
  // text を rate の速さで読む。読み終わったら done(実際にかかった秒数)
  function say(text, rate, done) {
    const parts = splitText(text);
    const t0 = Date.now(), my = gen;
    speaking = true;
    clearTimeout(idleT);
    duck(true);
    const step = () => {
      if (my !== gen) return;
      if (!cfg.speak) { stop(); return; }
      const p = parts.shift();
      if (p == null) { speaking = false; done?.((Date.now() - t0) / 1000); return; }
      const u = new SpeechSynthesisUtterance(p);
      u.lang = 'ja-JP';
      const vo = pickVoice();
      if (vo) u.voice = vo;
      u.rate = rate;
      u.onend = step;
      u.onerror = e => { if (e.error && e.error !== 'canceled' && e.error !== 'interrupted') TG.log('読み上げ', '読み上げに失敗：' + e.error, 'warn'); if (e.error === 'canceled' || e.error === 'interrupted') return; step(); };
      synth.speak(u);
    };
    step();
  }
  function idle() { clearTimeout(idleT); idleT = setTimeout(() => { if (!speaking) duck(false); }, 800); }
  function stop() {
    gen++;
    queue = [];
    pending = [];
    speaking = false;
    try { synth.cancel(); } catch { /* なし */ }
    clearTimeout(idleT);
    duck(false);
    release();
  }

  // ---------- 動画を止めて待つ・再開 ----------
  function hold() {
    const v = video();
    if (!v || holding || v.paused) return;
    holding = true; holdAt = Date.now();
    v.pause();
  }
  function release() {
    if (!holding) return;
    holding = false;
    const v = video();
    if (v?.paused) v.play()?.catch(() => { /* なし */ });
  }

  // ---------- 先読み：字幕データ全体を取る ----------
  let ev = null, evFor = null, evBusy = null, evRetryAt = 0; // ev: [{ s, e, t }]
  let nextIdx = 0, pending = [], lastT = 0;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // 伸びていく自動字幕：前の字幕に続きを足しただけなら、足した分だけにする
  function grow(prev, cur, loose) {
    if (!prev) return cur;
    if (cur.startsWith(prev)) return cur.slice(prev.length).trim();
    if (cur.length >= 4 && prev.includes(cur)) return '';
    if (loose) for (let k = Math.min(prev.length, cur.length) - 1; k >= 4; k--) { if (cur.startsWith(prev.slice(-k))) return cur.slice(k).trim(); } // 画面の字幕は端が重なって伸びていく
    return cur;
  }
  async function loadTrack(v) {
    evBusy = v;
    try {
      let url = null;
      for (let i = 0; i < 12 && !url && curVid() === v && cfg.speak; i++) { url = await main('ttUrl', { v }); if (!url) await sleep(500); }
      if (!url || curVid() !== v) return;
      const u = new URL(url);
      u.searchParams.set('fmt', 'json3');
      if (!/^ja/i.test(u.searchParams.get('lang') || '')) u.searchParams.set('tlang', 'ja');
      const j = await (await fetch(u.href, { credentials: 'include' })).json();
      const raw = (j.events || []).filter(x => x.segs).map(x => ({ s: x.tStartMs / 1000, e: (x.tStartMs + (x.dDurationMs || 2000)) / 1000, t: x.segs.map(g => g.utf8).join('').replace(/\s+/g, ' ').trim() })).filter(x => x.t).sort((a, b) => a.s - b.s);
      const list = [];
      let prev = '';
      for (const x of raw) {
        const add = grow(prev, x.t);
        prev = x.t;
        if (add && JA.test(add)) list.push({ s: x.s, e: x.e, t: add });
      }
      if (curVid() !== v) return;
      if (!list.length) { TG.log('読み上げ', '日本語の字幕データがありません。画面の字幕を読みます'); return; }
      ev = list; evFor = v;
      resync(video()?.currentTime || 0);
      TG.log('読み上げ', `字幕データを先読み：${list.length} 行`);
    } catch (err) {
      TG.log('読み上げ', '字幕データを取れませんでした。画面の字幕を読みます：' + (err?.message || err), 'warn');
    } finally {
      if (evBusy === v) evBusy = null;
      if (evFor !== v && curVid() === v) evRetryAt = Date.now() + 5000; // 字幕があとから付くこともあるので、少ししたらまた試す
    }
  }
  function resync(t) {
    stop();
    pending = [];
    const i = ev ? ev.findIndex(x => x.s >= t - 0.3) : -1;
    nextIdx = i < 0 ? (ev ? ev.length : 0) : i;
    lastT = t;
  }

  // ---------- 先読み：時刻に合わせて読む ----------
  function startItem(vEl, t) {
    const it = pending.shift();
    if (!it) return;
    const chars = it.t.replace(/\s/g, '').length;
    const nxt = pending[0] || ev[nextIdx];
    const deadline = nxt ? Math.max(nxt.s, it.s + 0.8) : it.e + 1; // この字幕を読み終えたい時刻（動画の時刻）
    const avail = Math.max(0.6, (deadline - Math.max(t, it.s)) / (vEl.playbackRate || 1));
    const rate = Math.min(MAX_RATE, Math.max(cfg.speakRate, chars / (cps * avail)));
    say(it.t, rate, sec => {
      if (sec > 0.4 && chars >= 4) cps = Math.min(12, Math.max(3, cps * 0.5 + (chars / (sec * rate)) * 0.5)); // 実際にかかった時間で見積もりを直す
      idle();
      release(); // 待っていた動画を再開（次の字幕はこの速さの計算で収まるように読む）
      tickTimed();
    });
  }
  function tickTimed() {
    const vEl = video();
    if (!cfg.speak || !vEl || evFor !== curVid()) return;
    if (adShowing()) { stop(); return; }
    if (vEl.paused && !holding) return;
    const t = vEl.currentTime;
    if (t < lastT - 0.5 || t > lastT + 3) { resync(t); return; } // シーク
    lastT = t;
    while (nextIdx < ev.length && ev[nextIdx].s <= t + LEAD) {
      const it = ev[nextIdx++];
      if (it.s >= t - 1.5) pending.push(it); // 大きく過ぎたものは読まない
    }
    if (!speaking) {
      if (pending.length) startItem(vEl, t);
      else release();
      return;
    }
    // 読み終わる前に次の字幕の時刻が来た：動画を止めて待つ
    if (pending.length && pending[0].s <= t && !holding) hold();
    if (holding && Date.now() - holdAt > HOLD_MAX) { release(); pending = pending.filter(x => x.e > t - 1); } // 待ちすぎ：再開して、古い字幕は読み飛ばす
  }

  // ---------- 従来の方法：画面に出ている字幕を読む（字幕データが取れないとき） ----------
  let queue = [], lastText = '', pend = '', pendAt = 0, vidFor = null;
  const norm = s => s.replace(/\s+/g, ' ').trim();
  function captionText() {
    const segs = document.querySelectorAll('#movie_player .ytp-caption-window-container .ytp-caption-segment');
    return norm([...segs].map(s => s.textContent).join(' '));
  }
  function nextQueued() {
    if (!cfg.speak) { stop(); return; }
    const t = queue.shift();
    if (!t) { speaking = false; idle(); return; }
    say(t, cfg.speakRate, nextQueued);
  }
  function enqueue(text) {
    queue.push(...splitText(text));
    while (queue.length > 4) queue.shift(); // 遅れたら古い分を捨てる
    if (!speaking) nextQueued();
  }
  function poll() {
    const v = curVid();
    if (v !== vidFor) { vidFor = v; stop(); lastText = ''; pend = ''; ev = null; evFor = null; evBusy = null; evRetryAt = 0; nextIdx = 0; }
    if (!cfg.speak) return;
    // 字幕データを取りに行く（動画ごとに1回。取れなければ少し待って再挑戦）
    if (v && !ev && !evBusy && Date.now() >= evRetryAt) loadTrack(v);
    if (evFor === v && ev) return; // 先読みで読んでいる
    const vEl = video();
    if (!v || !vEl || vEl.paused || adShowing()) { if (adShowing()) stop(); return; }
    const cur = captionText();
    if (!cur) { pend = ''; return; }
    const now = Date.now();
    if (cur !== pend) { pend = cur; pendAt = now; return; }
    if (now - pendAt < 350 || cur === lastText) return; // 字幕が落ち着くまで少し待つ
    const add = grow(lastText, cur, true);
    lastText = cur;
    if (add && JA.test(add)) enqueue(add); // 日本語以外の字幕は読まない
  }

  // ---------- 止める・ボタン ----------
  const onVideo = (name, fn) => document.addEventListener(name, e => { if (e.target === video()) fn(); }, true);
  onVideo('pause', () => {
    if (holding && Date.now() - holdAt < 400) return; // 自分で止めた分
    holding = false; // 自分で止めたのではない（利用者が止めた）
    stop();
  });
  onVideo('play', () => { if (holding) holding = false; }); // 待っている間に利用者が再生したら、待つのをやめる
  onVideo('seeking', () => { lastText = ''; pend = ''; if (ev) resync(video()?.currentTime || 0); else stop(); });
  onVideo('emptied', () => { stop(); lastText = ''; pend = ''; });
  window.addEventListener('pagehide', () => { try { synth.cancel(); } catch { /* なし */ } });

  function paint() {
    const p = player();
    const b = p?.querySelector('.tg-px-spk');
    if (b) b.classList.toggle('on', !!cfg.speak);
    p?.classList.toggle('tg-spk-hide', !!(cfg.speak && cfg.speakHide));
  }
  function ensureBtn() {
    const p = player(), ctr = p?.querySelector('.ytp-right-controls-left') || p?.querySelector('.ytp-right-controls');
    if (!ctr || !curVid()) return;
    if (!ctr.querySelector('.tg-px-spk')) {
      const b = document.createElement('button');
      b.className = 'ytp-button tg-px-spk';
      b.title = '字幕の読み上げ（CaptionSpeaker）';
      b.innerHTML = '<span>読</span>';
      ['mousedown', 'keydown'].forEach(t => b.addEventListener(t, e => e.stopPropagation()));
      b.addEventListener('click', async e => {
        e.stopPropagation();
        const { px = {} } = await chrome.storage.local.get('px');
        const speak = !(px.speak ?? DEF.speak);
        await chrome.storage.local.set({ px: { ...px, speak }, prefsAt: Date.now() });
      });
      ctr.insertBefore(b, ctr.firstChild);
    }
    paint();
  }

  ready.then(() => {
    setInterval(() => { if (!document.hidden) { ensureBtn(); poll(); } }, 400);
    setInterval(tickTimed, 100);
  });
})();
