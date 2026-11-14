// 視聴の「✨ おすすめ動画(試作)」
//   検索中: 画面全体を半透明で覆い、真ん中に点と線でできた球(ネットワークの球)を回す。その下に「検索中…」と 0%→100% のシークバー。
//           進むにつれて、散らばった点が集まって球になる。
//   結果:   たくさんの動画(最大36本)を、球の表面に並べたカードにして、後ろの点の球と一緒に回す。
//           ドラッグで上下左右に回せる(離すと、勢いで少し回り続ける)・矢印キーでも回せる・ホイールで大きさを変える・カードに乗せると止まる・押すとその動画へ。
//           手前のカードほど大きく・はっきり、奥のカードは小さく・薄く(押せない)。
//   🔄 違う動画を探す: もう一度、候補を集め直して(YouTube のおすすめなどは毎回変わる)、これまでに出した動画を避けて、ランダムに選び直す。
//   候補を集めるのは、🎞 おすすめ10本(reel.js)と同じ reelGather(続きから・後で見る・非登録チャンネル・急上昇)。
//   色は --aq-* (page.css)。ダークは黒地に水色の光、ライトは白地に深い青。球の色も、この変数から読む
function openAiPick() {
  document.getElementById('aip')?.remove();
  const E = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const calm = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  const MAXN = 36;
  const box = document.createElement('div'); box.id = 'aip'; box.className = 'thinking';
  box.innerHTML = `<div class="ai-bg"></div><canvas class="ai-cv" aria-hidden="true"></canvas>
    <div class="ai-top"><b class="ai-ttl">✨ おすすめ動画<small>試作</small></b><span class="ai-cnt"></span><span class="ai-sp"></span><button type="button" class="ai-re" hidden>🔄 違う動画を探す</button><button type="button" class="ai-x" title="閉じる(Esc)">✕</button></div>
    <div class="ai-txt"><b>検索中<span class="ai-dots"><i>.</i><i>.</i><i>.</i></span></b><small class="ai-step">準備しています</small>
      <div class="ai-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i class="ai-fill"></i><span class="ai-head"></span></div><div class="ai-pct">0%</div></div>
    <div class="ai-cards" role="list" aria-label="おすすめの動画"></div>
    <div class="ai-hint">周りをクリックで閉じる ・ ドラッグ・矢印キーで回せます ・ ホイールで大きさ ・ カードに乗せると止まります ・ 押すとその動画へ</div>`;
  document.body.appendChild(box);
  const $b = s => box.querySelector(s);
  const cv = $b('.ai-cv'), cards = $b('.ai-cards'), reBtn = $b('.ai-re');
  const fill = $b('.ai-fill'), head = $b('.ai-head'), pctEl = $b('.ai-pct'), stepEl = $b('.ai-step'), bar = $b('.ai-bar');
  const STEPS = [[0, '視聴履歴を読み込んでいます'], [18, '途中まで見た動画を探しています'], [38, '「後で見る」を確認しています'], [56, 'まだ登録していないチャンネルを探しています'], [72, '急上昇と照らし合わせています'], [88, 'あなたへの動画を選んでいます']];
  let alive = true, prog = 0, raf = 0, sRaf = 0, items = [];
  const shown = new Set(); // これまでに出した動画(🔄 で避ける)

  // ---- 回転: 3×3 の行列 M。ドラッグ・矢印キー・自動の回転で、画面の横軸/縦軸のまわりに少しずつ回す ----
  let M = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const mul = (a, b) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
  const rotY = t => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)], rotX = t => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
  const turn = (dx, dy) => { if (dx) M = mul(rotY(dx), M); if (dy) M = mul(rotX(dy), M); };
  turn(0, 0.32);
  const app = v => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
  let vx = 0, vy = 0, hold = false, hoverCard = false, zoom = 1;

  // ---- 点と線の球(canvas。画面全体)。点は球の表面にほぼ均等に置き、近い点どうしを線でつなぐ(つなぐ組は最初に1回だけ決める)。
  //      prog(0〜100)が小さいほど、点は外へ散らばる
  const N = 300, P = [], PAIRS = [], FLY = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i + .5) / N * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963 + (Math.random() - .5) * .35;
    const v = [Math.cos(th) * r, y + (Math.random() - .5) * .04, Math.sin(th) * r], L = Math.hypot(...v);
    const s = [v[0] / L, v[1] / L, v[2] / L], far = 1.6 + Math.random() * 1.4;
    P.push({ s, d: [s[0] * far + (Math.random() - .5) * .6, s[1] * far + (Math.random() - .5) * .6, s[2] * far + (Math.random() - .5) * .6], tw: Math.random() * 6.28 });
  }
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const a = P[i].s, b = P[j].s; if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 < 0.034) PAIRS.push([i, j]); }
  for (let i = 0; i < 50; i++) FLY.push({ v: [Math.random() - .5, Math.random() - .5, Math.random() - .5], r: 1.1 + Math.random() * .5 });
  FLY.forEach(q => { const L = Math.hypot(...q.v) || 1; q.v = q.v.map(c => c / L * q.r); });
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, col = '170,230,255', last = 0;
  const fit = () => { const dpr = Math.min(2, devicePixelRatio || 1); W = Math.max(1, box.clientWidth); H = Math.max(1, box.clientHeight); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); col = (getComputedStyle(box).getPropertyValue('--aq-p') || '170,230,255').trim(); };
  const ro = new ResizeObserver(fit); ro.observe(box);
  const ease = t => 1 - Math.pow(1 - t, 3);
  // 球の大きさと中心: 検索中は少し上・小さめ、結果では真ん中・大きく(0.8秒で移る)
  let morph = 0, morphFrom = 0, morphAt = 0;
  const geo = () => {
    const k = ease(Math.min(1, (performance.now() - morphAt) / 800)), m = morphFrom + ((box.classList.contains('done') ? 1 : 0) - morphFrom) * k; morph = m;
    const r0 = Math.min(W, H) * 0.27, r1 = Math.min(W * 0.4, H * 0.44) * zoom;
    return { R: r0 + (r1 - r0) * m, cx: W / 2, cy: H * (0.42 + 0.1 * m) };
  };
  // カード(結果)の位置: 球の表面にほぼ均等に
  let CP = [], CPAIR = [], cardH = 0;
  const cardW = () => Math.max(130, Math.min(240, Math.min(W, H) * 0.28));
  const placeCards = n => {
    CP = []; for (let i = 0; i < n; i++) { const y = 1 - (i + .5) / n * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963; CP.push([Math.cos(th) * r, y, Math.sin(th) * r]); }
    CPAIR = []; CP.forEach((a, i) => { const ds = CP.map((b, j) => [j, (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2]).filter(x => x[0] !== i).sort((p, q) => p[1] - q[1]).slice(0, 2); ds.forEach(([j]) => { if (i < j) CPAIR.push([i, j]); }); });
  };
  function frame(t) {
    if (!alive) return; sRaf = requestAnimationFrame(frame);
    const dt = last ? Math.min(60, t - last) : 16; last = t;
    const done = box.classList.contains('done');
    // 回転: ドラッグ中は手の動き。離したら勢い(だんだん弱まる)。止まったら、ゆっくり自動で回る
    if (!hold) {
      const auto = calm ? 0.00004 : done ? 0.00012 : 0.00035;
      if (!(done && hoverCard)) turn(vx * dt + auto * dt, vy * dt);
      vx *= Math.pow(0.94, dt / 16); vy *= Math.pow(0.94, dt / 16);
    }
    const { R, cx, cy } = geo(), k = ease(Math.min(1, prog / 100));
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.35); g.addColorStop(0, `rgba(${col},${0.10 * k})`); g.addColorStop(1, `rgba(${col},0)`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const proj = v => { const p = app(v), f = 3.2 / (3.2 + p[2]); return [cx + p[0] * R * f, cy + p[1] * R * f, p[2], f]; };
    const pr = new Array(N);
    for (let i = 0; i < N; i++) { const p = P[i]; pr[i] = proj([p.d[0] + (p.s[0] - p.d[0]) * k, p.d[1] + (p.s[1] - p.d[1]) * k, p.d[2] + (p.s[2] - p.d[2]) * k]); }
    const dim = done ? 0.55 : 1; // 結果では、カードが主役なので、点と線を少し控えめに
    ctx.lineWidth = 0.7;
    const la = (0.08 + 0.42 * k) * dim;
    for (const [i, j] of PAIRS) { const a = pr[i], b = pr[j], depth = (2 - (a[2] + b[2]) / 2) / 3; ctx.strokeStyle = `rgba(${col},${(la * depth).toFixed(3)})`; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    for (let i = 0; i < N; i++) { const a = pr[i], depth = (2 - a[2]) / 3, tw = 0.6 + 0.4 * Math.sin(t / 400 + P[i].tw); ctx.fillStyle = `rgba(${col},${((0.35 + 0.65 * depth * tw) * dim).toFixed(3)})`; ctx.beginPath(); ctx.arc(a[0], a[1], 0.6 + 1.4 * depth, 0, 6.283); ctx.fill(); }
    for (const q of FLY) { const a = proj(q.v); ctx.fillStyle = `rgba(${col},${((0.25 + 0.4 * k) * dim).toFixed(2)})`; ctx.fillRect(a[0], a[1], 1.4, 1.4); }
    // 結果: カードを、球の少し外側に。カードどうしを光る線でつなぐ
    if (done && items.length) {
      const cr = 1.12, cp = CP.map(v => proj([v[0] * cr, v[1] * cr, v[2] * cr]));
      ctx.lineWidth = 1;
      for (const [i, j] of CPAIR) { const a = cp[i], b = cp[j], depth = (2 - (a[2] + b[2]) / 2) / 3; ctx.strokeStyle = `rgba(${col},${(0.45 * depth * depth).toFixed(3)})`; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      const cw = cardW();
      items.forEach((el, i) => {
        const a = cp[i], depth = Math.max(0, Math.min(1, (1 - a[2] / 1.12) / 2)), s = (0.28 + 0.37 * depth) * a[3]; // 手前で約1倍・奥で約0.2倍 // depth: 1 = いちばん手前
        el.style.transform = `translate(${(a[0] - cw / 2).toFixed(1)}px, ${(a[1] - cardH / 2).toFixed(1)}px) scale(${s.toFixed(3)})`;
        el.style.zIndex = String(Math.round(depth * 1000));
        el.style.opacity = (0.12 + 0.88 * Math.pow(depth, 1.6)).toFixed(3);
        el.classList.toggle('back', depth < 0.42);
      });
    }
  }
  sRaf = requestAnimationFrame(frame);

  // ---- ドラッグ・矢印キー・ホイールで回す ----
  let dragFrom = null, moved = 0, lastMove = 0, onCard = false;
  box.addEventListener('pointerdown', e => {
    if (!box.classList.contains('done') || e.button !== 0 || e.target.closest('.ai-top')) return;
    onCard = !!e.target.closest('.ai-c, .ai-msg'); dragFrom = [e.clientX, e.clientY]; moved = 0; hold = true; vx = vy = 0; lastMove = performance.now();
  });
  box.addEventListener('pointermove', e => {
    if (!dragFrom) return;
    const dx = e.clientX - dragFrom[0], dy = e.clientY - dragFrom[1], now = performance.now(), dt = Math.max(8, now - lastMove);
    moved += Math.abs(dx) + Math.abs(dy); dragFrom = [e.clientX, e.clientY]; lastMove = now;
    const k = 1 / Math.max(160, geo().R); turn(-dx * k, dy * k); vx = -dx * k / dt; vy = dy * k / dt; // 手の動きと同じ向きに、手前の面が動く
    if (moved > 6 && !box.classList.contains('drag')) { box.classList.add('drag'); try { box.setPointerCapture(e.pointerId); } catch (x) { /* なし */ } }
  });
  const endDrag = e => { if (!dragFrom) return; if (e && e.type === 'pointerup' && moved <= 6 && !onCard) { close(); return; } dragFrom = null; hold = false; setTimeout(() => box.classList.remove('drag'), 0); if (performance.now() - lastMove > 80) vx = vy = 0; };
  box.addEventListener('pointerup', endDrag); box.addEventListener('pointercancel', endDrag);
  cards.addEventListener('click', e => { if (moved > 6) { e.preventDefault(); e.stopPropagation(); } }, true); // 回したあとの「押した」は、動画を開かない
  cards.addEventListener('mouseover', e => { hoverCard = !!e.target.closest('.ai-c:not(.back)'); });
  cards.addEventListener('mouseleave', () => { hoverCard = false; });
  box.addEventListener('wheel', e => { if (!box.classList.contains('done')) return; e.preventDefault(); zoom = Math.max(0.6, Math.min(1.5, zoom * (e.deltaY > 0 ? 0.92 : 1.08))); }, { passive: false });

  const setP = p => {
    prog = p = Math.max(0, Math.min(100, p)); const s = p.toFixed(1) + '%';
    fill.style.width = s; head.style.left = s; pctEl.textContent = Math.floor(p) + '%'; bar.setAttribute('aria-valuenow', String(Math.floor(p)));
    let t = STEPS[0][1]; for (const [at, msg] of STEPS) if (p >= at) t = msg; if (stepEl.textContent !== t) { stepEl.textContent = t; stepEl.classList.remove('in'); void stepEl.offsetWidth; stepEl.classList.add('in'); }
  };
  // 0%→100% の演出。work = 実際の処理(Promise)。min = 最短の時間(ミリ秒)。集めている間は 92% まで、終わったら 100% へ
  function run(work, min) {
    cancelAnimationFrame(raf);
    morphFrom = morph; morphAt = performance.now();
    box.classList.remove('done'); box.classList.add('thinking'); cards.innerHTML = ''; items = []; reBtn.hidden = true; $b('.ai-cnt').textContent = ''; setP(0);
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

  // ---- たくさん選ぶ: 続きから最大4・後で見る12・非登録10・急上昇10。これまでに出した動画は、できるだけ避ける。足りない分は、ほかから補う ----
  const shuffle = a => (typeof reelShuffle === 'function' ? reelShuffle(a) : a.slice().sort(() => Math.random() - .5));
  function pickMany(pool) {
    if (!pool) return [];
    const want = { resume: 4, later: 12, non: 10, trd: 10 }, used = new Set(), out = [], rest = [];
    for (const k of Object.keys(want)) {
      const all = shuffle((pool[k] || []).filter(x => x && x.id)), fresh = all.filter(x => !shown.has(x.id)), old = all.filter(x => shown.has(x.id));
      [...fresh, ...old].forEach(x => { if (used.has(x.id)) return; if (out.filter(y => y.src === k).length < want[k] && !shown.has(x.id)) { out.push(x); used.add(x.id); } else rest.push(x); });
    }
    const fill2 = arr => { for (const x of arr) { if (out.length >= MAXN) break; if (!used.has(x.id)) { out.push(x); used.add(x.id); } } };
    fill2(shuffle(rest.filter(x => !shown.has(x.id)))); fill2(shuffle(rest)); // まだ出していない動画 → それでも足りなければ、出した動画も
    const list = shuffle(out).slice(0, MAXN);
    list.forEach(x => shown.add(x.id));
    return list;
  }
  const card = (x, i) => { const [ic, nm] = (typeof REEL_SRC !== 'undefined' && REEL_SRC[x.src]) || ['', ''];
    const url = `https://www.youtube.com/watch?v=${E(x.id)}${x.list ? '&list=' + E(x.list) : ''}${x.pos ? '&t=' + Math.max(0, x.pos - 3) + 's' : ''}`;
    return `<a class="ai-c" role="listitem" href="${url}" target="_top" title="${E(x.title)}" draggable="false"><span class="ai-ci" style="--d:${calm ? 0 : i * 40}ms"><span class="ai-th"><img loading="lazy" draggable="false" src="${E(x.thumb || `https://i.ytimg.com/vi/${x.id}/mqdefault.jpg`)}" alt="">${x.len ? `<span class="ai-len">${E(x.len)}</span>` : ''}${x.pct ? `<span class="ai-pb"><i style="width:${Math.min(100, x.pct)}%"></i></span>` : ''}</span>
      <span class="ai-tx"><em class="ai-src">${ic} ${nm}${x.rank ? ` ${x.rank}位` : ''}${x.pct ? ` ${x.pct}%` : ''}</em><b>${E(x.title)}</b><small>${E(x.ch || '')}</small></span></span></a>`; };
  function show(list) {
    if (!alive) return;
    morphFrom = morph; morphAt = performance.now();
    box.classList.remove('thinking'); box.classList.add('done'); reBtn.hidden = false; vx = vy = 0; zoom = 1;
    $b('.ai-cnt').textContent = list.length ? `${list.length}本` : '';
    placeCards(list.length);
    cards.innerHTML = list.length ? list.map(card).join('') : '<p class="ai-msg">おすすめできる動画が見つかりませんでした(YouTube にログインしているか、確認してください)</p>';
    items = [...cards.querySelectorAll('.ai-c')]; armRefresh();
    const cw = cardW(); items.forEach(el => { el.style.width = cw + 'px'; }); cardH = items.length ? items[0].offsetHeight || cw * 0.9 : 0;
  }
  // ---- 画面に触れていない時間が、決めた時間(設定 px.aiRefresh 秒。0 = 切り替えない)以上たったら、動画を取り直して入れ替える。触れている間(マウスを動かす・押す・ホイール・キー)は、入れ替えない ----
  let reSec = 60, reTimer = 0, touchAt = performance.now();
  const touch = () => { touchAt = performance.now(); };
  ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart'].forEach(ev => box.addEventListener(ev, touch, { passive: true, capture: true }));
  const armRefresh = () => {
    clearTimeout(reTimer); touchAt = performance.now(); if (!alive || !reSec || !box.classList.contains('done')) return;
    reTimer = setTimeout(function tick() {
      if (!alive || !reSec || !box.classList.contains('done')) return;
      if (hold || document.hidden || performance.now() - touchAt < reSec * 1000) { reTimer = setTimeout(tick, 1000); return; }
      search(calm ? 600 : 3000);
    }, 1000);
  };
  chrome.storage.local.get('px').then(r => { const v = (r.px || {}).aiRefresh; reSec = v === undefined ? 60 : +v || 0; armRefresh(); }).catch(() => {});
  const onPx = (ch, a) => { if (a === 'local' && ch.px) { const v = (ch.px.newValue || {}).aiRefresh; reSec = v === undefined ? 60 : +v || 0; armRefresh(); } };
  chrome.storage.onChanged.addListener(onPx);
  const search = (min) => run(typeof reelGather === 'function' ? reelGather() : Promise.resolve(null), min).then(pool => show(pickMany(pool)));
  reBtn.addEventListener('click', () => search(calm ? 600 : 3000));
  const close = () => { alive = false; clearTimeout(reTimer); chrome.storage.onChanged.removeListener(onPx); cancelAnimationFrame(raf); cancelAnimationFrame(sRaf); ro.disconnect(); box.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (!box.classList.contains('done')) return;
    const K = { ArrowLeft: [0.004, 0], ArrowRight: [-0.004, 0], ArrowUp: [0, -0.004], ArrowDown: [0, 0.004] }[e.key];
    if (K) { e.preventDefault(); vx += K[0]; vy += K[1]; }
  };
  document.addEventListener('keydown', onKey, true);
  $b('.ai-x').addEventListener('click', close);
  fit();
  search(calm ? 600 : 4500);
}
