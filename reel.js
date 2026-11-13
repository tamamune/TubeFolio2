// 視聴の「🎞 おすすめ10本」: TubeFolio2 後で見る・非登録チャンネル(YouTube のおすすめのうち、登録していないチャンネル)・急上昇(日本)から、
//   合わせて10本を選び、横に流れ続ける帯(リール)にして、画面の上に浮かべて出す。page.js の viewPage() のボタンから openReel() で開く。
//   選び方: 後で見る 4本・非登録 3本・急上昇 3本を、それぞれランダムに。足りない分は、ほかから補う。並びも混ぜる。8割以上見た動画・ショート・ライブ中は入れない
//   操作: マウスのホイールで左右に動かせる(回したあと2.5秒は、自動で流さない) / カードに乗せると止まる / 押すとその動画へ / 🔄 で選び直す(取り直さずに、集めた中から) / ✕・背景・Esc で閉じる
//   流れる位置は、自分で数えて動かす(ブラウザのアニメーションに任せると、ホイールで途中の位置を動かせないため)。端はつながっていて、どちらへ動かしても終わらない
const REEL_SRC = { later: ['🕒', '後で見る'], non: ['🧭', '非登録チャンネル'], trd: ['📈', '急上昇'] };
let reelPool = null; // 集めた候補(開いている間は使い回す)
function openReel() {
  document.getElementById('reel')?.remove();
  const send = m => new Promise(res => { try { chrome.runtime.sendMessage(m, r => { void chrome.runtime.lastError; res(r); }); } catch (e) { res(null); } });
  const E = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const box = document.createElement('div'); box.id = 'reel';
  box.innerHTML = `<div class="rl-bg"></div><div class="rl-pan" role="dialog" aria-label="おすすめ10本">
    <div class="rl-h"><b>🎞 おすすめ10本</b><span class="rl-n">${Object.values(REEL_SRC).map(([i, t]) => `${i} ${t}`).join(' ・ ')} から</span><span class="rl-sp"></span>
      <button type="button" class="rl-re" title="別の10本を選ぶ">🔄 選び直す</button><button type="button" class="rl-x" title="閉じる(Esc)">✕</button></div>
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

  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ok = x => x && /^[\w-]{11}$/.test(x.id || '') && !x.live && !/^\s*$/.test(x.title || '');
  // 候補を集める(3つを同時に。どれかが失敗しても、ほかで出す)
  async function gather() {
    const pool = { later: [], non: [], trd: [] };
    const [played] = await Promise.all([chrome.storage.local.get('hist').then(r => (typeof TF !== 'undefined' && TF.playedInfo) ? TF.playedInfo(r.hist) : new Map()).catch(() => new Map())]);
    const seenPct = id => { const e = played.get(id); return e && typeof TF !== 'undefined' && TF.isPlayed ? TF.isPlayed(e) : false; };
    await Promise.all([
      (async () => { // 🕒 TubeFolio2 後で見る
        const t = await send({ type: 'plTargetInfo' }); if (!t || !t.id) return;
        const r = await send({ type: 'plVideos', ids: [t.id], order: 'new' });
        pool.later = ((r && r.items) || []).filter(x => ok(x) && (x.pct || 0) < 80 && !seenPct(x.id)).map(x => ({ id: x.id, title: x.title, ch: x.ch, len: x.len, thumb: x.thumb, src: 'later', list: t.id }));
      })().catch(() => {}),
      (async () => { // 🧭 非登録チャンネル: YouTube のおすすめから、登録していないチャンネルの動画
        const [r, st] = await Promise.all([send({ type: 'ytHome', kind: 'v' }), chrome.storage.local.get(['channels', 'meta'])]);
        const ids = new Set(), names = new Set();
        Object.entries(st.channels || {}).forEach(([k, c]) => { if (/^UC/.test(k)) ids.add(k); if (c && c.name) names.add(c.name); const m = (st.meta || {})[k]; if (m && m.id) ids.add(m.id); });
        pool.non = ((r && r.items) || []).filter(x => ok(x) && !(x.chId && ids.has(x.chId)) && !(x.ch && names.has(x.ch)) && !seenPct(x.id)).map(x => ({ id: x.id, title: x.title, ch: x.ch, len: x.len, thumb: x.thumb, views: x.views, src: 'non' }));
      })().catch(() => {}),
      (async () => { // 📈 急上昇(今日 → 無ければ昨日)
        let r = await send({ type: 'trendDay', date: ymd(new Date()) });
        if (!r || r.error) r = await send({ type: 'trendDay', date: ymd(new Date(Date.now() - 864e5)) });
        pool.trd = ((r && r.videos) || []).filter(x => ok(x) && !seenPct(x.id)).map(x => ({ id: x.id, title: x.title, ch: x.ch, len: x.len, views: x.views ? x.views + ' 回視聴' : '', rank: x.rank, src: 'trd' }));
      })().catch(() => {})
    ]);
    return pool;
  }
  // 10本を選ぶ: 後で見る4・非登録3・急上昇3。足りない分は、残りから補う
  function pick(pool) {
    const want = { later: 4, non: 3, trd: 3 }, used = new Set(), out = [], rest = [];
    for (const k of Object.keys(want)) { const s = shuffle(pool[k] || []); s.forEach(x => { if (used.has(x.id)) return; if (out.filter(y => y.src === k).length < want[k]) { out.push(x); used.add(x.id); } else rest.push(x); }); }
    for (const x of shuffle(rest)) { if (out.length >= 10) break; if (!used.has(x.id)) { out.push(x); used.add(x.id); } }
    return shuffle(out).slice(0, 10);
  }
  const card = x => { const [ic, nm] = REEL_SRC[x.src] || ['', '']; const url = `https://www.youtube.com/watch?v=${E(x.id)}${x.list ? '&list=' + E(x.list) : ''}`;
    return `<a class="rl-c" href="${url}" target="_top" title="${E(x.title)}"><span class="rl-th"><img loading="lazy" src="${E(x.thumb || `https://i.ytimg.com/vi/${x.id}/mqdefault.jpg`)}" alt=""><em class="rl-src rl-${x.src}">${ic} ${nm}${x.rank ? ` ${x.rank}位` : ''}</em>${x.len ? `<i class="rl-len">${E(x.len)}</i>` : ''}</span><b>${E(x.title)}</b><small>${E(x.ch || '')}${x.views ? ' ・ ' + E(x.views) : ''}</small></a>`; };
  function draw() {
    const list = pick(reelPool || { later: [], non: [], trd: [] });
    if (!list.length) { half = 0; x = 0; paint(); track.innerHTML = '<p class="rl-msg">おすすめできる動画が見つかりませんでした(YouTube にログインしているか、確認してください)</p>'; return; }
    const html = list.map(card).join('');
    // 同じ並びを2回つなげて、終わりなく流れるようにする(半分まで流れたら、最初に戻ると、つなぎ目が見えない)
    track.innerHTML = html + (list.length >= 4 ? html.replace(/<a class="rl-c"/g, '<a class="rl-c" aria-hidden="true" tabindex="-1"') : '');
    x = 0; measure(); // 選び直したら、先頭から
    box.querySelector('.rl-n').textContent = Object.entries(REEL_SRC).map(([k, [i, t]]) => `${i} ${t} ${list.filter(x => x.src === k).length}本`).join(' ・ ');
  }
  box.querySelector('.rl-re').addEventListener('click', () => draw());
  if (reelPool) draw();
  else gather().then(p => { reelPool = p; if (box.isConnected) draw(); });
}
