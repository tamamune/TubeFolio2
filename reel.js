// 視聴の「🎞 おすすめ10本」: TubeFolio2 後で見る・非登録チャンネル(YouTube のおすすめのうち、登録していないチャンネル)・急上昇(日本)から、
//   合わせて10本を選び、横に流れ続ける帯(リール)にして、画面の上に浮かべて出す。page.js の viewPage() のボタンから openReel() で開く。
//   選び方: ▶ 続きから 3本(途中まで見た動画。新しい順で先頭に。テスト)・後で見る 3本・非登録 2本・急上昇 2本。足りない分は、ほかから補う。
//           続きから以外は、並びを混ぜる。8割以上見た動画・ショート・ライブ中は入れない
//   ▶ 続きから: 1%〜80%まで見て、最後に見てから30日以内の動画。
//     YouTube の再生履歴(どの端末で見た分も。並び = 新しい順・何％見たか)と、TubeFolio2 の視聴履歴(hist。Drive で全端末を同期。止めた位置(秒)が分かる)を合わせる。
//     止めた位置が分かる動画は、その位置から開く(&t=)。YouTube の履歴が取れないときは、TubeFolio2 の視聴履歴だけで選ぶ
//   操作: マウスのホイールで左右に動かせる(回したあと2.5秒は、自動で流さない) / カードに乗せると止まる / 押すとその動画へ / 🔄 で選び直す(取り直さずに、集めた中から) / ✕・背景・Esc で閉じる
//   流れる位置は、自分で数えて動かす(ブラウザのアニメーションに任せると、ホイールで途中の位置を動かせないため)。端はつながっていて、どちらへ動かしても終わらない
const REEL_SRC = { resume: ['▶', '続きから'], later: ['🕒', '後で見る'], non: ['🧭', '非登録チャンネル'], trd: ['📈', '急上昇'] };
let reelPool = null, reelDiag = ''; // 集めた候補(開いている間は使い回す)・▶ 続きからの段階ごとの数(調べるため)
// 候補を集める・10本を選ぶ(🎞 おすすめ10本 と ✨ AIおすすめ(aipick.js)で共通)
const reelSend = m => new Promise(res => { try { chrome.runtime.sendMessage(m, r => { void chrome.runtime.lastError; res(r); }); } catch (e) { res(null); } });
const reelShuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const reelYmd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const reelOk = x => x && /^[\w-]{11}$/.test(x.id || '') && !x.live && !/^\s*$/.test(x.title || '');
// 候補を集める(3つを同時に。どれかが失敗しても、ほかで出す)
async function reelGather(onlyResume) {
  const pool = { resume: [], later: [], non: [], trd: [] };
  const histRaw = await chrome.storage.local.get('hist').then(r => r.hist || null).catch(() => null);
  const played = histRaw && typeof TF !== 'undefined' && TF.playedInfo ? TF.playedInfo(histRaw) : new Map();
  const seenPct = id => { const e = played.get(id); return e && typeof TF !== 'undefined' && TF.isPlayed ? TF.isPlayed(e) : false; };
  await Promise.all([
    (async () => { // ▶ 続きから: 途中まで見た動画(1%〜80%・30日以内)
      const now = Date.now(), DAY30 = 30 * 864e5, pctOf = (e, len) => (typeof TF !== 'undefined' && TF.pctOf ? TF.pctOf(e, len) : -1);
      // TubeFolio2 の視聴履歴: 動画ごとの最後に見た時刻・止めた位置
      const tf = new Map(), v = (histRaw && histRaw.v) || {};
      ((histRaw && histRaw.p) || []).forEach(x => { if (!Array.isArray(x)) return; const o = tf.get(x[1]); if (!o || x[0] > o.at) tf.set(x[1], { at: x[0], pos: Math.round(x[3] || 0) }); });
      const tfItem = (id, o) => { const e = played.get(id), d = v[id] || []; if (!e || e.short || d[4]) return null; const p = pctOf(e, 0); if (!(p >= 1 && p <= 80)) return null; if (now - o.at * 1000 > DAY30) return null; return { id, title: d[0] || '', ch: d[1] || '', len: d[3] ? `${Math.floor(d[3] / 60)}:${String(d[3] % 60).padStart(2, '0')}` : '', pct: p, pos: o.pos, at: o.at * 1000, src: 'resume' }; };
      const list = [];
      // YouTube の再生履歴(どの端末で見た分も。新しい順)
      const t0 = Date.now(), r = await Promise.race([reelSend({ type: 'ytResume', pages: 3 }), new Promise(res => setTimeout(() => res({ error: '8秒で返事がありません' }), 8000))]).catch(e => ({ error: String(e) })), yt = (r && r.items) || [];
      const ytWhy = !r ? '返事なし(拡張機能を再読み込みしていない?)' : r.error ? r.error : '';
      yt.forEach(x => { if (!reelOk(x)) return; const o = tf.get(x.id), p = Math.max(+x.pct || 0, o ? Math.max(0, pctOf(played.get(x.id), 0)) : 0); if (!(p >= 1 && p <= 80)) return; if (o && now - o.at * 1000 > DAY30) return; list.push({ id: x.id, title: x.title, ch: x.ch, len: x.len, thumb: x.thumb, pct: Math.round(p), pos: o && o.pos > 5 ? o.pos : 0, src: 'resume', from: 'yt' }); });
      // YouTube の履歴に無い分(履歴を止めている・取れなかった等)は、TubeFolio2 の視聴履歴から、新しい順に足す
      const have = new Set(list.map(x => x.id));
      [...tf.entries()].sort((a, b) => b[1].at - a[1].at).forEach(([id, o]) => { if (have.has(id) || !/^[\w-]{11}$/.test(id)) return; const it = tfItem(id, o); if (it && it.title) { list.push({ ...it, pos: it.pos > 5 ? it.pos : 0, from: 'tf' }); have.add(id); } });
      pool.resume = list;
      // 調べるため: 段階ごとの数(どこで0になっているか)を、動作ログと見出しに出す
      const tfCand = [...tf.entries()].filter(([id, o]) => tfItem(id, o)).length;
      reelDiag = `YouTube の履歴 ${yt.length}本(途中 ${yt.filter(x => x.pct >= 1 && x.pct <= 80).length}本${ytWhy ? '・' + ytWhy : ''}・${Math.round((Date.now() - t0) / 100) / 10}秒) / TubeFolio2 の履歴 ${tf.size}本(途中 ${tfCand}本) → 続きから ${list.length}本`;
      try { if (typeof TG !== 'undefined') TG.log('続きから', reelDiag); } catch (e) { /* なし */ }
    })().catch(e => { reelDiag = '続きからでエラー: ' + String((e && e.message) || e); try { if (typeof TG !== 'undefined') TG.log('続きから', reelDiag, 'warn'); } catch (e2) { /* なし */ } }),
    onlyResume ? null : (async () => { // 🕒 TubeFolio2 後で見る
      const t = await reelSend({ type: 'plTargetInfo' }); if (!t || !t.id) return;
      const r = await reelSend({ type: 'plVideos', ids: [t.id], order: 'new' });
      pool.later = ((r && r.items) || []).filter(x => reelOk(x) && (x.pct || 0) < 80 && !seenPct(x.id)).map(x => ({ id: x.id, title: x.title, ch: x.ch, len: x.len, thumb: x.thumb, src: 'later', list: t.id }));
    })().catch(() => {}),
    onlyResume ? null : (async () => { // 🧭 非登録チャンネル: YouTube のおすすめから、登録していないチャンネルの動画
      const [r, st] = await Promise.all([reelSend({ type: 'ytHome', kind: 'v' }), chrome.storage.local.get(['channels', 'meta'])]);
      const ids = new Set(), names = new Set();
      Object.entries(st.channels || {}).forEach(([k, c]) => { if (/^UC/.test(k)) ids.add(k); if (c && c.name) names.add(c.name); const m = (st.meta || {})[k]; if (m && m.id) ids.add(m.id); });
      pool.non = ((r && r.items) || []).filter(x => reelOk(x) && !(x.chId && ids.has(x.chId)) && !(x.ch && names.has(x.ch)) && !seenPct(x.id)).map(x => ({ id: x.id, title: x.title, ch: x.ch, len: x.len, thumb: x.thumb, views: x.views, src: 'non' }));
    })().catch(() => {}),
    onlyResume ? null : (async () => { // 📈 急上昇(今日 → 無ければ昨日)
      let r = await reelSend({ type: 'trendDay', date: reelYmd(new Date()) });
      if (!r || r.error) r = await reelSend({ type: 'trendDay', date: reelYmd(new Date(Date.now() - 864e5)) });
      pool.trd = ((r && r.videos) || []).filter(x => reelOk(x) && !seenPct(x.id)).map(x => ({ id: x.id, title: x.title, ch: x.ch, len: x.len, views: x.views ? x.views + ' 回視聴' : '', rank: x.rank, src: 'trd' }));
    })().catch(() => {})
  ]);
  return pool;
}
// 10本を選ぶ: 後で見る4・非登録3・急上昇3。足りない分は、残りから補う
function reelPick(pool) {
  const head = (pool.resume || []).slice(0, 3), used = new Set(head.map(x => x.id)); // ▶ 続きから: 新しい順で、いちばん前に
  const want = { later: 3, non: 2, trd: 2 }, out = [], rest = [];
  for (const k of Object.keys(want)) if (!(pool[k] || []).length) want[k] = 0; // 取れなかった出どころの分は、ほかで補う
  for (const k of Object.keys(want)) { const s = reelShuffle(pool[k] || []); s.forEach(x => { if (used.has(x.id)) return; if (out.filter(y => y.src === k).length < want[k]) { out.push(x); used.add(x.id); } else rest.push(x); }); }
  (pool.resume || []).slice(3).forEach(x => { if (!used.has(x.id) && out.length + head.length < 10) rest.push(x); });
  for (const x of reelShuffle(rest)) { if (out.length + head.length >= 10) break; if (!used.has(x.id) && !out.includes(x)) { out.push(x); used.add(x.id); } }
  return [...head, ...reelShuffle(out)].slice(0, 10);
}
// opts.mode = 'resume': 視聴の「▶ 続きから」ボタン。途中まで見た動画だけを、新しい順に最大20本(同じ浮かぶパネル・流れる帯)
function openReel(opts = {}) {
  const R = opts.mode === 'resume';
  document.getElementById('reel')?.remove();
  const send = m => new Promise(res => { try { chrome.runtime.sendMessage(m, r => { void chrome.runtime.lastError; res(r); }); } catch (e) { res(null); } });
  const E = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const box = document.createElement('div'); box.id = 'reel';
  box.innerHTML = `<div class="rl-bg"></div><div class="rl-pan" role="dialog" aria-label="${R ? '続きから' : 'おすすめ10本'}">
    <div class="rl-h"><b>${R ? '▶ 続きから' : '🎞 おすすめ10本'}</b><span class="rl-n">${R ? '途中まで見た動画(1%〜80%・30日以内)を、新しい順に' : Object.values(REEL_SRC).map(([i, t]) => `${i} ${t}`).join(' ・ ') + ' から'}</span><span class="rl-sp"></span>
      <button type="button" class="rl-re" title="${R ? 'もう一度、履歴から取り直す' : '別の10本を選ぶ'}">${R ? '↻ 取り直す' : '🔄 選び直す'}</button><button type="button" class="rl-x" title="閉じる(Esc)">✕</button></div>
    <div class="rl-view"><div class="rl-track"><p class="rl-msg">選んでいます…</p></div></div>
    <div class="rl-f">マウスのホイールで動かせます ・ カードに乗せると止まります ・ 押すとその動画へ</div></div>`;
  document.body.appendChild(box);
  const track = box.querySelector('.rl-track'), view = box.querySelector('.rl-view');
  // ---- 流れる動き: x = 左へずらした量(px)。half = 10本ぶんの幅(同じ並びを2回つなげているので、half を超えたら 0 に戻すと、つなぎ目が見えない)
  const SPEED = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches ? 10 : 32; } catch (e) { return 32; } })(); // 1秒に何px流すか
  let x = 0, half = 0, last = 0, holdUntil = 0, hover = false, raf = 0;
  const wrap = () => { if (half > 0) x = ((x % half) + half) % half; };
  const paint = () => { track.style.transform = `translateX(${-x.toFixed(1)}px)`; };
  const tick = t => {
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min(100, t - last) : 16; last = t;
    if (!half || hover || performance.now() < holdUntil) return;
    x += SPEED * dt / 1000; wrap(); paint();
  };
  const measure = () => { const cs = track.querySelectorAll('.rl-c'), n = cs.length / 2; half = n >= 4 && Number.isInteger(n) ? cs[n].offsetLeft - cs[0].offsetLeft : 0; wrap(); paint(); };
  view.addEventListener('wheel', e => { // ホイール: 縦でも横でも、左右に動かす
    if (!half) return; e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    x += d * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? view.clientWidth : 1); wrap(); paint();
    holdUntil = performance.now() + 2500;
  }, { passive: false });
  track.addEventListener('mouseover', e => { hover = !!e.target.closest('.rl-c'); });
  track.addEventListener('mouseleave', () => { hover = false; });
  raf = requestAnimationFrame(tick);
  const onResize = () => measure(); // 幅が変わると、カードの幅も変わる(スマホ)
  window.addEventListener('resize', onResize);
  const close = () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); box.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
  box.querySelector('.rl-bg').addEventListener('click', close);
  box.querySelector('.rl-x').addEventListener('click', close);

  const card = x => { const [ic, nm] = REEL_SRC[x.src] || ['', '']; const url = `https://www.youtube.com/watch?v=${E(x.id)}${x.list ? '&list=' + E(x.list) : ''}${x.pos ? '&t=' + Math.max(0, x.pos - 3) + 's' : ''}`;
    return `<a class="rl-c" href="${url}" target="_top" title="${E(x.title)}"><span class="rl-th"><img loading="lazy" src="${E(x.thumb || `https://i.ytimg.com/vi/${x.id}/mqdefault.jpg`)}" alt=""><em class="rl-src rl-${x.src}">${ic} ${nm}${x.rank ? ` ${x.rank}位` : ''}${x.pct ? ` ${x.pct}%` : ''}</em>${x.pct ? `<span class="rl-pb"><i style="width:${Math.min(100, x.pct)}%"></i></span>` : ''}${x.len ? `<i class="rl-len">${E(x.len)}</i>` : ''}</span><b>${E(x.title)}</b><small>${E(x.ch || '')}${x.views ? ' ・ ' + E(x.views) : ''}</small></a>`; };
  function draw() {
    const list = R ? ((resumePool && resumePool.resume) || []).slice(0, 20) : reelPick(reelPool || { later: [], non: [], trd: [] });
    if (!list.length) { half = 0; x = 0; paint(); track.innerHTML = `<p class="rl-msg">${R ? '途中まで見た動画が見つかりませんでした' : 'おすすめできる動画が見つかりませんでした(YouTube にログインしているか、確認してください)'}</p>`; box.querySelector('.rl-f').textContent = reelDiag ? '▶ ' + reelDiag : ''; return; }
    const html = list.map(card).join('');
    // 同じ並びを2回つなげて、終わりなく流れるようにする(半分まで流れたら、最初に戻ると、つなぎ目が見えない)
    track.innerHTML = html + (list.length >= 4 ? html.replace(/<a class="rl-c"/g, '<a class="rl-c" aria-hidden="true" tabindex="-1"') : '');
    x = 0; measure(); // 選び直したら、先頭から
    box.querySelector('.rl-n').textContent = R ? `途中まで見た動画 ${list.length}本 ・ 新しい順` : Object.entries(REEL_SRC).map(([k, [i, t]]) => `${i} ${t} ${list.filter(x => x.src === k).length}本`).join(' ・ ');
    box.querySelector('.rl-f').textContent = (reelDiag ? '▶ ' + reelDiag + ' ・ ' : '') + 'マウスのホイールで動かせます ・ カードに乗せると止まります ・ 押すとその動画へ';
  }
  let resumePool = null;
  const loadResume = () => { track.innerHTML = '<p class="rl-msg">途中まで見た動画を探しています…</p>'; half = 0; paint(); reelGather(true).then(p => { resumePool = p; if (box.isConnected) draw(); }); };
  box.querySelector('.rl-re').addEventListener('click', () => (R ? loadResume() : draw())); // 続きから: 取り直す / おすすめ: 集めた中から選び直す
  if (R) loadResume(); // 続きからは、開くたびに取り直す(見たばかりの動画を出すため)
  else if (reelPool) draw();
  else reelGather().then(p => { reelPool = p; if (box.isConnected) draw(); });
}
