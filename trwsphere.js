// 🧪 テスト: 急上昇ワードを、「おすすめ動画」(aipick.js)と同じ、点と線の球の表面に並べて回す。trwpage.js から openTrendSphere() で開く。
//   ・ワードは、検索数が多いほど大きく。手前ほど大きく・はっきり、奥は小さく・薄く(奥は押せない)
//   ・ドラッグ・矢印キーで回せる(離すと勢いで回り続ける)・ホイールで大きさ・ワードに乗せると止まって、下に細かい数字と関連ワードを出す
//   ・ワードを押すと YouTube で検索 ・ 周りをクリック / Esc / ✕ で閉じる ・ 4時間 / 24時間の切り替えと、↻ 取り直し
//   見た目は #aip と同じ --aq-* の色(page.css。ダーク・ライトの両方)。ワードのデータは、背景の tg-trends(ふつうの急上昇ワードのパネルと同じ)
function openTrendSphere() {
  document.getElementById('aip')?.remove();
  const E = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const calm = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  let hours = 4; try { hours = +(localStorage.getItem('tfTrwHours') || 4) === 24 ? 24 : 4; } catch (e) { /* なし */ }
  const box = document.createElement('div'); box.id = 'aip'; box.className = 'done trwsph';
  box.innerHTML = `<div class="ai-bg"></div><canvas class="ai-cv" aria-hidden="true"></canvas>
    <div class="ai-top"><b class="ai-ttl">🔥 急上昇ワード<small>テスト</small></b><span class="ai-cnt"></span><span class="ai-sp"></span>
      <span class="trw-seg"><button type="button" data-h="4">過去4時間</button><button type="button" data-h="24">過去24時間</button></span><button type="button" class="ai-re" title="取り直す">🔄</button><button type="button" class="ai-x" title="閉じる(Esc)">✕</button></div>
    <div class="ai-cards" role="list" aria-label="急上昇ワード"></div><p class="ai-msg" hidden></p>
    <div class="trw-det" hidden></div>
    <div class="ai-hint">周りをクリックで閉じる ・ ドラッグ・矢印キーで回せます ・ ホイールで大きさ ・ ワードを押すと検索</div>`;
  document.body.appendChild(box);
  const $b = s => box.querySelector(s), cv = $b('.ai-cv'), cards = $b('.ai-cards'), msg = $b('.ai-msg'), det = $b('.trw-det');
  let alive = true, sRaf = 0, items = [], els = [], CP = [], vx = 0, vy = 0, hold = false, hoverCard = false, zoom = 1, last = 0;

  // ---- 回転(3×3 の行列。aipick.js と同じ) ----
  let M = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const mul = (a, b) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
  const rotY = t => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)], rotX = t => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
  const turn = (dx, dy) => { if (dx) M = mul(rotY(dx), M); if (dy) M = mul(rotX(dy), M); };
  turn(0, 0.32);
  const app = v => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];

  // ---- 点と線の球 ----
  const N = 260, P = [], PAIRS = [];
  for (let i = 0; i < N; i++) { const y = 1 - (i + .5) / N * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963; P.push({ s: [Math.cos(th) * r, y, Math.sin(th) * r], tw: Math.random() * 6.28 }); }
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const a = P[i].s, b = P[j].s; if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 < 0.04) PAIRS.push([i, j]); }
  const ctx = cv.getContext('2d'); let W = 0, H = 0, col = '170,230,255';
  const fit = () => { const dpr = Math.min(2, devicePixelRatio || 1); W = Math.max(1, box.clientWidth); H = Math.max(1, box.clientHeight); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); col = (getComputedStyle(box).getPropertyValue('--aq-p') || '170,230,255').trim(); };
  const ro = new ResizeObserver(fit); ro.observe(box);
  const geo = () => ({ R: Math.min(W * 0.36, H * 0.42) * zoom, cx: W / 2, cy: H * 0.52 });

  // ---- ワードの位置: 球の表面にほぼ均等に(順位の高いものが、最初は手前に来る) ----
  const place = n => { CP = []; for (let i = 0; i < n; i++) { const y = 1 - (i + .5) / n * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963; CP.push([Math.cos(th) * r, y, Math.sin(th) * r]); } };
  function frame(t) {
    if (!alive) return; sRaf = requestAnimationFrame(frame);
    const dt = last ? Math.min(60, t - last) : 16; last = t;
    if (!hold) { if (!hoverCard) turn(vx * dt + (calm ? 0.00004 : 0.00012) * dt, vy * dt); vx *= Math.pow(0.94, dt / 16); vy *= Math.pow(0.94, dt / 16); }
    const { R, cx, cy } = geo(); ctx.clearRect(0, 0, W, H);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.35); g.addColorStop(0, `rgba(${col},0.10)`); g.addColorStop(1, `rgba(${col},0)`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const proj = v => { const p = app(v), f = 3.2 / (3.2 + p[2]); return [cx + p[0] * R * f, cy + p[1] * R * f, p[2], f]; };
    const pr = P.map(p => proj(p.s)); ctx.lineWidth = 0.7;
    for (const [i, j] of PAIRS) { const a = pr[i], b = pr[j], depth = (2 - (a[2] + b[2]) / 2) / 3; ctx.strokeStyle = `rgba(${col},${(0.3 * depth).toFixed(3)})`; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    for (let i = 0; i < N; i++) { const a = pr[i], depth = (2 - a[2]) / 3, tw = 0.6 + 0.4 * Math.sin(t / 400 + P[i].tw); ctx.fillStyle = `rgba(${col},${(0.3 + 0.6 * depth * tw).toFixed(3)})`; ctx.beginPath(); ctx.arc(a[0], a[1], 0.6 + 1.4 * depth, 0, 6.283); ctx.fill(); }
    els.forEach((el, i) => {
      const a = proj([CP[i][0] * 1.08, CP[i][1] * 1.08, CP[i][2] * 1.08]), depth = Math.max(0, Math.min(1, (1 - a[2] / 1.08) / 2)), s = (0.45 + 0.65 * depth) * a[3];
      el.style.transform = `translate(${(a[0] - el._w / 2).toFixed(1)}px, ${(a[1] - el._h / 2).toFixed(1)}px) scale(${s.toFixed(3)})`;
      el.style.zIndex = String(Math.round(depth * 1000)); el.style.opacity = (0.15 + 0.85 * Math.pow(depth, 1.3)).toFixed(3); el.classList.toggle('back', depth < 0.4);
    });
  }
  sRaf = requestAnimationFrame(frame);

  // ---- ドラッグ・矢印キー・ホイール(aipick.js と同じ操作) ----
  let dragFrom = null, moved = 0, lastMove = 0, onCard = false;
  box.addEventListener('pointerdown', e => { if (e.button !== 0 || e.target.closest('.ai-top')) return; onCard = !!e.target.closest('.ai-c'); dragFrom = [e.clientX, e.clientY]; moved = 0; hold = true; vx = vy = 0; lastMove = performance.now(); });
  box.addEventListener('pointermove', e => {
    if (!dragFrom) return;
    const dx = e.clientX - dragFrom[0], dy = e.clientY - dragFrom[1], now = performance.now(), dt = Math.max(8, now - lastMove);
    moved += Math.abs(dx) + Math.abs(dy); dragFrom = [e.clientX, e.clientY]; lastMove = now;
    const k = 1 / Math.max(160, geo().R); turn(-dx * k, dy * k); vx = -dx * k / dt; vy = dy * k / dt;
    if (moved > 6 && !box.classList.contains('drag')) { box.classList.add('drag'); try { box.setPointerCapture(e.pointerId); } catch (x) { /* なし */ } }
  });
  const endDrag = e => { if (!dragFrom) return; if (e && e.type === 'pointerup' && moved <= 6 && !onCard) { close(); return; } dragFrom = null; hold = false; setTimeout(() => box.classList.remove('drag'), 0); if (performance.now() - lastMove > 80) vx = vy = 0; };
  box.addEventListener('pointerup', endDrag); box.addEventListener('pointercancel', endDrag);
  cards.addEventListener('click', e => { if (moved > 6) { e.preventDefault(); e.stopPropagation(); } }, true);
  box.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.max(0.6, Math.min(1.5, zoom * (e.deltaY > 0 ? 0.92 : 1.08))); }, { passive: false });

  // ---- 乗せたワードの詳細 ----
  cards.addEventListener('mouseover', e => {
    const a = e.target.closest('.ai-c:not(.back)'); hoverCard = !!a;
    if (!a) { det.hidden = true; return; }
    const it = items[+a.dataset.i] || {}, rel = (it.related || []).slice(0, 5).join(' / ');
    det.innerHTML = `<b>${E(it.title)}</b><span>${[it.traffic && '検索 ' + E(it.traffic), it.pctText && '▲' + E(it.pctText), E(it.agoText || '')].filter(Boolean).join(' ・ ')}</span>${rel ? `<small>関連: ${E(rel)}</small>` : ''}`; det.hidden = false;
  });
  cards.addEventListener('mouseleave', () => { hoverCard = false; det.hidden = true; });

  // ---- データ ----
  const num = it => { let n = +it.vol || 0; if (!n) { const m = /([\d,.]+)\s*(万)?/.exec(String(it.traffic || '')); if (m) n = parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 10000 : 1); } return n || 0; };
  function show(list) {
    items = list; els = []; cards.innerHTML = ''; det.hidden = true; msg.hidden = !!list.length; if (!list.length) msg.textContent = '急上昇ワードがありません';
    $b('.ai-cnt').textContent = list.length ? `${list.length}語` : '';
    place(list.length); zoom = 1;
    const lg = v => Math.log10(Math.max(1, v)), vs = list.map(x => lg(num(x))), lmax = Math.max(...vs, 1), lmin = Math.min(...vs, lmax);
    cards.innerHTML = list.map((it, i) => { const k = lmax === lmin ? .5 : (vs[i] - lmin) / (lmax - lmin);
      return `<a class="ai-c wd" role="listitem" data-i="${i}" href="https://www.youtube.com/results?search_query=${encodeURIComponent(it.title)}" target="_top" draggable="false" title="${E(it.title)}"><span class="ai-ci" style="--d:${calm ? 0 : i * 30}ms;font-size:${(14 + k * 12).toFixed(1)}px"><i>${i + 1}</i>${E(it.title)}</span></a>`; }).join('');
    els = [...cards.querySelectorAll('.ai-c')]; els.forEach(el => { el._w = el.offsetWidth; el._h = el.offsetHeight; });
  }
  let gen = 0;
  function load(force) {
    const my = ++gen; cards.innerHTML = ''; els = []; msg.hidden = false; msg.textContent = '読み込み中…'; det.hidden = true;
    box.querySelectorAll('.trw-seg [data-h]').forEach(b => b.classList.toggle('on', +b.dataset.h === hours));
    chrome.runtime.sendMessage({ type: 'tg-trends', force: !!force, hours }, r => {
      if (!alive || my !== gen) return; void chrome.runtime.lastError;
      if (!r || r.error || !r.items) { msg.textContent = '取得できませんでした' + (r && r.error ? '(' + r.error + ')' : ''); return; }
      show(r.items.slice(0, 40));
    });
  }
  $b('.trw-seg').addEventListener('click', e => { const b = e.target.closest('[data-h]'); if (!b || +b.dataset.h === hours) return; hours = +b.dataset.h; try { localStorage.setItem('tfTrwHours', String(hours)); } catch (x) { /* なし */ } load(); });
  $b('.ai-re').addEventListener('click', () => load(true));
  const close = () => { alive = false; cancelAnimationFrame(sRaf); ro.disconnect(); box.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    const K = { ArrowLeft: [0.004, 0], ArrowRight: [-0.004, 0], ArrowUp: [0, -0.004], ArrowDown: [0, 0.004] }[e.key];
    if (K) { e.preventDefault(); vx += K[0]; vy += K[1]; }
  };
  document.addEventListener('keydown', onKey, true);
  $b('.ai-x').addEventListener('click', close);
  fit(); load();
}
