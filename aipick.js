// 視聴の「✨ AIおすすめ(試作)」: 丸い半透明の背景の真ん中に、点と線でできた球(ネットワークの球)を回し、
//   その下に「検索中…」と 0%→100% のシークバー。進むにつれて、散らばった点が集まって球になる。
//   100% になったら、球が小さくなって真ん中に残り、おすすめ10本が、球の周りを囲むように並ぶ(球から各カードへ、光る線でつなぐ)。
//   画面が狭いときは、球の下にカードを並べる(線は出さない)。
//   候補を集める・10本を選ぶのは、🎞 おすすめ10本(reel.js)と同じ(reelGather / reelPick)。
//   色は --aq-* (page.css)。ダークは黒地に水色の光、ライトは白地に深い青。球の色も、この変数から読む
function openAiPick() {
  document.getElementById('aip')?.remove();
  const E = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const calm = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  const box = document.createElement('div'); box.id = 'aip'; box.className = 'thinking';
  box.innerHTML = `<div class="ai-bg"></div>
    <div class="ai-top"><b class="ai-ttl">✨ AIおすすめ<small>試作</small></b><span class="ai-sp"></span><button type="button" class="ai-x" title="閉じる(Esc)">✕</button></div>
    <svg class="ai-links" aria-hidden="true"></svg>
    <div class="ai-orb" role="dialog" aria-label="AIおすすめ"><canvas class="ai-cv" aria-hidden="true"></canvas>
      <div class="ai-txt"><b>検索中<span class="ai-dots"><i>.</i><i>.</i><i>.</i></span></b><small class="ai-step">準備しています</small>
        <div class="ai-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i class="ai-fill"></i><span class="ai-head"></span></div><div class="ai-pct">0%</div></div>
      <div class="ai-mid"><b class="ai-cnt"></b><small>あなたへのおすすめ</small><button type="button" class="ai-re">🔄 もう一度探す</button></div></div>
    <div class="ai-cards"></div>`;
  document.body.appendChild(box);
  const $b = s => box.querySelector(s);
  const orb = $b('.ai-orb'), cv = $b('.ai-cv'), cards = $b('.ai-cards'), links = $b('.ai-links');
  const fill = $b('.ai-fill'), head = $b('.ai-head'), pctEl = $b('.ai-pct'), stepEl = $b('.ai-step'), bar = $b('.ai-bar');
  const STEPS = [[0, '視聴履歴を読み込んでいます'], [18, '途中まで見た動画を探しています'], [38, '「後で見る」を確認しています'], [56, 'まだ登録していないチャンネルを探しています'], [72, '急上昇と照らし合わせています'], [88, 'あなたへの10本を選んでいます']];
  let alive = true, pool = null, prog = 0, raf = 0, sRaf = 0, list = [];

  // ---- 点と線の球(canvas)。点は球の表面にほぼ均等に置き(少しずらす)、近い点どうしを線でつなぐ。
  //      回しても点どうしの距離は変わらないので、つなぐ組は最初に1回だけ決める。prog(0〜100)が小さいほど、点は外へ散らばる
  const N = 300, P = [], PAIRS = [], FLY = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i + .5) / N * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963 + (Math.random() - .5) * .35;
    const v = [Math.cos(th) * r, y + (Math.random() - .5) * .04, Math.sin(th) * r], L = Math.hypot(...v);
    const s = [v[0] / L, v[1] / L, v[2] / L], far = 1.6 + Math.random() * 1.4;
    P.push({ s, d: [s[0] * far + (Math.random() - .5) * .6, s[1] * far + (Math.random() - .5) * .6, s[2] * far + (Math.random() - .5) * .6], tw: Math.random() * 6.28 });
  }
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const a = P[i].s, b = P[j].s; if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 < 0.034) PAIRS.push([i, j]); }
  for (let i = 0; i < 40; i++) FLY.push({ a: Math.random() * 6.28, r: 1.08 + Math.random() * .35, y: (Math.random() - .5) * 1.8, sp: (Math.random() - .5) * .4 });
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, col = '170,230,255', ang = 0, last = 0;
  const fit = () => { const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); W = Math.max(1, r.width); H = Math.max(1, r.height); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); col = (getComputedStyle(box).getPropertyValue('--aq-p') || '170,230,255').trim(); };
  const ro = new ResizeObserver(() => { fit(); if (box.classList.contains('done')) layout(); }); ro.observe(cv); ro.observe(box);
  const ease = t => 1 - Math.pow(1 - t, 3);
  function frame(t) {
    if (!alive) return; sRaf = requestAnimationFrame(frame);
    const dt = last ? Math.min(60, t - last) : 16; last = t;
    ang += dt * (calm ? 0.00006 : box.classList.contains('done') ? 0.00018 : 0.00035);
    const k = ease(Math.min(1, prog / 100)), R = Math.min(W, H) * 0.36, cx = W / 2, cy = H * (box.classList.contains('done') ? 0.5 : 0.42);
    const ca = Math.cos(ang), sa = Math.sin(ang), tilt = 0.32, ct = Math.cos(tilt), st = Math.sin(tilt);
    const pr = new Array(N);
    for (let i = 0; i < N; i++) {
      const p = P[i], x0 = p.d[0] + (p.s[0] - p.d[0]) * k, y0 = p.d[1] + (p.s[1] - p.d[1]) * k, z0 = p.d[2] + (p.s[2] - p.d[2]) * k;
      const x1 = x0 * ca + z0 * sa, z1 = -x0 * sa + z0 * ca, y1 = y0 * ct - z1 * st, z2 = y0 * st + z1 * ct;
      const f = 2.6 / (2.6 + z2); pr[i] = [cx + x1 * R * f, cy + y1 * R * f, z2];
    }
    ctx.clearRect(0, 0, W, H);
    // 球の中の、ほのかな光
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.3); g.addColorStop(0, `rgba(${col},${0.10 * k})`); g.addColorStop(1, `rgba(${col},0)`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 0.7;
    const la = 0.08 + 0.42 * k;
    for (const [i, j] of PAIRS) { const a = pr[i], b = pr[j], depth = (2 - (a[2] + b[2]) / 2) / 3; ctx.strokeStyle = `rgba(${col},${(la * depth).toFixed(3)})`; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    for (let i = 0; i < N; i++) { const a = pr[i], depth = (2 - a[2]) / 3, tw = 0.6 + 0.4 * Math.sin(t / 400 + P[i].tw); ctx.fillStyle = `rgba(${col},${(0.35 + 0.65 * depth * tw).toFixed(3)})`; ctx.beginPath(); ctx.arc(a[0], a[1], 0.6 + 1.4 * depth, 0, 6.283); ctx.fill(); }
    // 球の外を漂う、小さな点
    for (const q of FLY) { q.a += q.sp * dt * 0.001; const x = Math.cos(q.a + ang) * q.r, z = Math.sin(q.a + ang) * q.r, f = 2.6 / (2.6 + z); ctx.fillStyle = `rgba(${col},${(0.25 + 0.4 * k).toFixed(2)})`; ctx.fillRect(cx + x * R * f, cy + q.y * R * f, 1.4, 1.4); }
  }
  sRaf = requestAnimationFrame(frame);

  const setP = p => {
    prog = p = Math.max(0, Math.min(100, p)); const s = p.toFixed(1) + '%';
    fill.style.width = s; head.style.left = s; pctEl.textContent = Math.floor(p) + '%'; bar.setAttribute('aria-valuenow', String(Math.floor(p)));
    let t = STEPS[0][1]; for (const [at, msg] of STEPS) if (p >= at) t = msg; if (stepEl.textContent !== t) { stepEl.textContent = t; stepEl.classList.remove('in'); void stepEl.offsetWidth; stepEl.classList.add('in'); }
  };
  // 0%→100% の演出。work = 実際の処理(Promise)。min = 最短の時間(ミリ秒)。集めている間は 92% まで、終わったら 100% へ
  function run(work, min) {
    cancelAnimationFrame(raf); box.classList.remove('done'); box.classList.add('thinking'); cards.innerHTML = ''; links.innerHTML = ''; setP(0);
    const t0 = performance.now(); let done = false, endAt = 0, from = 0, p = 0, val;
    return new Promise(res => {
      work.then(v => { done = true; val = v; }).catch(() => { done = true; });
      const step = t => {
        if (!alive) return;
        const el = t - t0;
        if (!done || el < min) { p = Math.max(p, Math.min(92 * (1 - Math.exp(-el / (min * 0.45))), 92)); }
        else {
          if (!endAt) { endAt = t; from = p; }
          const k = Math.min(1, (t - endAt) / 600); p = from + (100 - from) * ease(k);
          if (k >= 1) { setP(100); setTimeout(() => alive && res(val), calm ? 0 : 450); return; }
        }
        setP(p); raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
  }

  // ---- 結果: 球の周りを囲むように、10本を並べる(楕円の上に等間隔)。狭いときは、球の下に並べる ----
  const card = (x, i) => { const [ic, nm] = (typeof REEL_SRC !== 'undefined' && REEL_SRC[x.src]) || ['', ''];
    const url = `https://www.youtube.com/watch?v=${E(x.id)}${x.list ? '&list=' + E(x.list) : ''}${x.pos ? '&t=' + Math.max(0, x.pos - 3) + 's' : ''}`;
    return `<a class="ai-c" data-i="${i}" href="${url}" target="_top" title="${E(x.title)}" style="--d:${calm ? 0 : 120 + i * 90}ms"><span class="ai-th"><img loading="lazy" src="${E(x.thumb || `https://i.ytimg.com/vi/${x.id}/mqdefault.jpg`)}" alt="">${x.len ? `<span class="ai-len">${E(x.len)}</span>` : ''}${x.pct ? `<span class="ai-pb"><i style="width:${Math.min(100, x.pct)}%"></i></span>` : ''}</span>
      <span class="ai-tx"><em class="ai-src">${String(i + 1).padStart(2, '0')} ・ ${ic} ${nm}${x.rank ? ` ${x.rank}位` : ''}${x.pct ? ` ${x.pct}%` : ''}</em><b>${E(x.title)}</b><small>${E(x.ch || '')}${x.views ? ' ・ ' + E(x.views) : ''}</small></span></a>`; };
  function layout() {
    const els = [...cards.querySelectorAll('.ai-c')]; if (!els.length) { links.innerHTML = ''; return; }
    // 並べ方: 球を囲む枠の形(上に3・右に2・下に3・左に2)。1番は上の真ん中から、時計回り
    const vw = box.clientWidth, vh = box.clientHeight, cw = Math.max(150, Math.min(190, vw * 0.15));
    box.classList.remove('grid'); els.forEach(el => { el.style.width = cw + 'px'; });
    const ch = Math.max(...els.map(el => el.offsetHeight || 0), cw * 9 / 16 + 70);
    const rx = (vw - cw) / 2 - 16, top = 56 + ch / 2, bot = vh - 16 - ch / 2, cx = vw / 2, cy = (top + bot) / 2, dTop = Math.min(cw + 28, rx - cw - 14);
    const orbit = dTop >= cw + 12 && bot - top >= ch + 210 && cy - ch - 8 > 0;
    box.classList.toggle('grid', !orbit);
    if (!orbit) { els.forEach(el => { el.style.left = el.style.top = el.style.width = ''; }); links.innerHTML = ''; return; }
    const sy = ch / 2 + 8;
    const SPOT = [[cx, top], [cx + dTop, top], [cx + rx, cy - sy], [cx + rx, cy + sy], [cx + dTop, bot], [cx, bot], [cx - dTop, bot], [cx - rx, cy + sy], [cx - rx, cy - sy], [cx - dTop, top]];
    box.style.setProperty('--aq-cy', cy + 'px');
    links.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    let svg = '';
    els.forEach((el, i) => {
      const [x, y] = SPOT[i % SPOT.length], a = Math.atan2(y - cy, x - cx);
      el.style.left = (x - cw / 2) + 'px'; el.style.top = (y - ch / 2) + 'px';
      const ox = cx + Math.cos(a) * 104, oy = cy + Math.sin(a) * 104;
      svg += `<line class="ai-ln" data-i="${i}" x1="${ox.toFixed(1)}" y1="${oy.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" style="--d:${calm ? 0 : 60 + i * 90}ms"/><circle class="ai-nd" data-i="${i}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/>`;
    });
    links.innerHTML = svg;
  }
  function show(l) {
    if (!alive) return;
    list = l || [];
    box.classList.remove('thinking'); box.classList.add('done');
    $b('.ai-cnt').textContent = list.length ? `${list.length}本` : '0本';
    cards.innerHTML = list.length ? list.map(card).join('') : '<p class="ai-msg">おすすめできる動画が見つかりませんでした(YouTube にログインしているか、確認してください)</p>';
    layout();
  }
  // カードに乗せたら、そのカードへの線を光らせる
  cards.addEventListener('mouseover', e => { const c = e.target.closest('.ai-c'); links.querySelectorAll('.on').forEach(x => x.classList.remove('on')); if (c) links.querySelectorAll(`[data-i="${c.dataset.i}"]`).forEach(x => x.classList.add('on')); });
  cards.addEventListener('mouseleave', () => links.querySelectorAll('.on').forEach(x => x.classList.remove('on')));
  const pick = () => (typeof reelPick === 'function' && pool ? reelPick(pool) : []);
  $b('.ai-re').addEventListener('click', () => run(new Promise(r => setTimeout(r, 300)), calm ? 300 : 2000).then(() => show(pick())));
  const close = () => { alive = false; cancelAnimationFrame(raf); cancelAnimationFrame(sRaf); ro.disconnect(); box.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
  $b('.ai-bg').addEventListener('click', close);
  $b('.ai-x').addEventListener('click', close);
  fit();
  const work = typeof reelGather === 'function' ? reelGather() : Promise.resolve(null);
  run(work.then(p => { pool = p; return p; }), calm ? 600 : 4500).then(() => show(pick()));
}
