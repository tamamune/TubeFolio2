// 🌐 急上昇ワードの地球儀(YouTube のページに出す)。急上昇ワードのパネル(trends.js)の右上の 🌐 ボタンから openTrendSphere() で開く(開くと、パネルは閉じる)。
//   「おすすめ動画」(aipick.js)と同じ、点と線の球の表面に、急上昇ワードを並べて回す。
//   ・色 = 検索ボリューム(高いほど赤、低いほど青)。大きさも、ボリュームが多いほど大きい
//   ・過去4時間 / 24時間 / 48時間 と、カテゴリ(Google トレンドのカテゴリ)を選べる ・ ↻ 取り直し
//   ・ワードに乗せると回転が止まり、下に数字・ニュース3件(パネルと同じ)・関連ワードを出す。ニュースの記事は別タブで開く
//   ・ワードを押す → 閉じて、trends.js の useTerm へ(ホーム = YouTube の検索欄に入れる / ほか = TubeFolio2 の検索で、対象 = すべて・種類 = 動画)
//   ・ドラッグ・矢印キーで回す ・ ホイールで大きさ ・ 周りのクリック / Esc / ✕ で閉じる。見た目は trwsphere.css(ダーク・ライト両対応)
function openTrendSphere() {
  document.getElementById('tf-sph')?.remove();
  const E = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const calm = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  const CATS = [[0, 'すべてのカテゴリ'], [4, 'エンタメ'], [17, 'スポーツ'], [14, '政治'], [3, 'ビジネス・金融'], [18, 'テクノロジー'], [6, 'ゲーム'], [15, '科学'], [7, '健康'], [2, 'ファッション・美容'], [5, '食べ物'], [19, '旅行・交通'], [1, '自動車'], [8, '趣味・レジャー'], [9, '仕事・教育'], [10, '法律・行政'], [13, 'ペット'], [16, 'ショッピング'], [20, '気候'], [11, 'その他']];
  let hours = 4, cat = 0; try { const h = +(localStorage.getItem('tfTrwHours') || 4); hours = [4, 24, 48].includes(h) ? h : 4; cat = +(localStorage.getItem('tfTrwCat') || 0) || 0; } catch (e) { /* なし */ }
  const box = document.createElement('div'); box.id = 'tf-sph';
  box.innerHTML = `<div class="tsp-bg"></div><canvas class="tsp-cv" aria-hidden="true"></canvas>
    <div class="tsp-top"><b class="tsp-ttl">🌐 急上昇ワード</b><span class="tsp-cnt"></span><span class="tsp-sp"></span>
      <span class="tsp-seg">${[4, 24, 48].map(h => `<button type="button" data-h="${h}">過去${h}時間</button>`).join('')}</span>
      <select class="tsp-cat" title="カテゴリ">${CATS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
      <button type="button" class="tsp-fs" title="表示の範囲(サイドバーを除くメイン画面 / 画面全体)"></button><button type="button" class="tsp-re" title="取り直す">↻</button><button type="button" class="tsp-x" title="閉じる(Esc)">✕</button></div>
    <div class="tsp-cards" role="list" aria-label="急上昇ワード"></div><p class="tsp-msg" hidden></p>
    <div class="tsp-det" hidden></div>
    <div class="tsp-hint">周りをクリックで閉じる ・ ドラッグ・矢印キーで回せます ・ ホイールで大きさ ・ 色: 赤 = 検索が多い / 青 = 少ない</div>`;
  document.documentElement.appendChild(box);
  const $b = s => box.querySelector(s), cv = $b('.tsp-cv'), cards = $b('.tsp-cards'), msg = $b('.tsp-msg'), det = $b('.tsp-det');
  // 表示の範囲: メイン画面(サイドバーを除く。上から下まで) / 画面全体(これまで)。選んだ方は覚えておく
  let full = false; try { full = localStorage.getItem('tfTrwFull') === '1'; } catch (e) { /* なし */ }
  const setRange = () => {
    const pm = document.querySelector('ytd-page-manager'), l = !full && pm ? Math.max(0, Math.round(pm.getBoundingClientRect().left)) : 0;
    box.style.left = l + 'px'; const b = $b('.tsp-fs'); b.textContent = full ? '▣' : '⛶'; b.title = full ? 'サイドバーを除くメイン画面に戻す' : '画面全体に広げる';
  };
  $b('.tsp-fs').addEventListener('click', () => { full = !full; try { localStorage.setItem('tfTrwFull', full ? '1' : '0'); } catch (e) { /* なし */ } setRange(); });
  window.addEventListener('resize', setRange); const rangeT = setInterval(setRange, 1000); // サイドバーを開閉したときも、左端をそろえる
  let alive = true, sRaf = 0, items = [], els = [], CP = [], vx = 0, vy = 0, hold = false, hoverCard = false, zoom = 1, last = 0, hideT = 0;

  // ---- 回転(3×3 の行列。aipick.js と同じ) ----
  let M = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const mul = (a, b) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
  const rotY = t => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)], rotX = t => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
  const turn = (dx, dy) => { if (dx) M = mul(rotY(dx), M); if (dy) M = mul(rotX(dy), M); };
  turn(0, 0.32);
  const app = v => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];

  // ---- 点と線の球 ----
  // 後ろの球は、視聴の「おすすめ動画」(aipick.js)と同じ(点300・近い点どうしを線で・まわりに散った点・ワード同士を結ぶ光る線)
  const N = 300, P = [], PAIRS = [], FLY = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i + .5) / N * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963 + (Math.random() - .5) * .35;
    const v = [Math.cos(th) * r, y + (Math.random() - .5) * .04, Math.sin(th) * r], L = Math.hypot(...v);
    P.push({ s: [v[0] / L, v[1] / L, v[2] / L], tw: Math.random() * 6.28 });
  }
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) { const a = P[i].s, b = P[j].s; if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 < 0.034) PAIRS.push([i, j]); }
  for (let i = 0; i < 50; i++) { const v = [Math.random() - .5, Math.random() - .5, Math.random() - .5], L = Math.hypot(...v) || 1, r = 1.1 + Math.random() * .5; FLY.push({ v: v.map(c => c / L * r) }); }
  const ctx = cv.getContext('2d'); let W = 0, H = 0, col = '170,230,255';
  const fit = () => { const dpr = Math.min(2, devicePixelRatio || 1); W = Math.max(1, box.clientWidth); H = Math.max(1, box.clientHeight); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); col = (getComputedStyle(box).getPropertyValue('--tsp-p') || '170,230,255').trim(); };
  const ro = new ResizeObserver(fit); ro.observe(box);
  const geo = () => ({ R: Math.min(W * 0.38, H * 0.4) * zoom, cx: W / 2, cy: H * 0.52 });
  let CPAIR = [];
  const place = n => {
    CP = []; for (let i = 0; i < n; i++) { const y = 1 - (i + .5) / n * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963; CP.push([Math.cos(th) * r, y, Math.sin(th) * r]); }
    CPAIR = []; CP.forEach((a, i) => { CP.map((b, j) => [j, (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2]).filter(x => x[0] !== i).sort((p, q) => p[1] - q[1]).slice(0, 2).forEach(([j]) => { if (i < j) CPAIR.push([i, j]); }); });
  };
  function frame(t) {
    if (!alive) return; sRaf = requestAnimationFrame(frame);
    const dt = last ? Math.min(60, t - last) : 16; last = t;
    if (!hold) { if (!hoverCard) turn(vx * dt + (calm ? 0.00004 : 0.00012) * dt, vy * dt); vx *= Math.pow(0.94, dt / 16); vy *= Math.pow(0.94, dt / 16); }
    const { R, cx, cy } = geo(); ctx.clearRect(0, 0, W, H);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.35); g.addColorStop(0, `rgba(${col},0.10)`); g.addColorStop(1, `rgba(${col},0)`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const proj = v => { const p = app(v), f = 3.2 / (3.2 + p[2]); return [cx + p[0] * R * f, cy + p[1] * R * f, p[2], f]; };
    const pr = P.map(p => proj(p.s)), dim = 0.55; ctx.lineWidth = 0.7; // 結果の表示では、ワードが主役なので、点と線を少し控えめに(おすすめ動画と同じ)
    for (const [i, j] of PAIRS) { const a = pr[i], b = pr[j], depth = (2 - (a[2] + b[2]) / 2) / 3; ctx.strokeStyle = `rgba(${col},${(0.5 * dim * depth).toFixed(3)})`; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    for (let i = 0; i < N; i++) { const a = pr[i], depth = (2 - a[2]) / 3, tw = 0.6 + 0.4 * Math.sin(t / 400 + P[i].tw); ctx.fillStyle = `rgba(${col},${((0.35 + 0.65 * depth * tw) * dim).toFixed(3)})`; ctx.beginPath(); ctx.arc(a[0], a[1], 0.6 + 1.4 * depth, 0, 6.283); ctx.fill(); }
    for (const q of FLY) { const a = proj(q.v); ctx.fillStyle = `rgba(${col},${(0.65 * dim).toFixed(2)})`; ctx.fillRect(a[0], a[1], 1.4, 1.4); }
    if (els.length) { // ワード同士を、光る線でつなぐ
      const cp = CP.map(v => proj([v[0] * 1.12, v[1] * 1.12, v[2] * 1.12])); ctx.lineWidth = 1;
      for (const [i, j] of CPAIR) { const a = cp[i], b = cp[j], depth = (2 - (a[2] + b[2]) / 2) / 3; ctx.strokeStyle = `rgba(${col},${(0.45 * depth * depth).toFixed(3)})`; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    }
    els.forEach((el, i) => {
      const a = proj([CP[i][0] * 1.12, CP[i][1] * 1.12, CP[i][2] * 1.12]), depth = Math.max(0, Math.min(1, (1 - a[2] / 1.08) / 2)), s = (0.45 + 0.65 * depth) * a[3];
      el.style.transform = `translate(${(a[0] - el._w / 2).toFixed(1)}px, ${(a[1] - el._h / 2).toFixed(1)}px) scale(${s.toFixed(3)})`;
      el.style.zIndex = String(Math.round(depth * 1000)); el.style.opacity = (0.18 + 0.82 * Math.pow(depth, 1.3)).toFixed(3); el.classList.toggle('back', depth < 0.4);
    });
  }
  sRaf = requestAnimationFrame(frame);

  // ---- ドラッグ・矢印キー・ホイール ----
  let dragFrom = null, moved = 0, lastMove = 0, onCard = false;
  box.addEventListener('pointerdown', e => { if (e.button !== 0 || e.target.closest('.tsp-top, .tsp-det')) return; onCard = !!e.target.closest('.tsp-w'); dragFrom = [e.clientX, e.clientY]; moved = 0; hold = true; vx = vy = 0; lastMove = performance.now(); });
  box.addEventListener('pointermove', e => {
    if (!dragFrom) return;
    const dx = e.clientX - dragFrom[0], dy = e.clientY - dragFrom[1], now = performance.now(), dt = Math.max(8, now - lastMove);
    moved += Math.abs(dx) + Math.abs(dy); dragFrom = [e.clientX, e.clientY]; lastMove = now;
    const k = 1 / Math.max(160, geo().R); turn(-dx * k, dy * k); vx = -dx * k / dt; vy = dy * k / dt;
    if (moved > 6 && !box.classList.contains('drag')) { box.classList.add('drag'); try { box.setPointerCapture(e.pointerId); } catch (x) { /* なし */ } }
  });
  const endDrag = e => { if (!dragFrom) return; const tap = e && e.type === 'pointerup' && moved <= 6; if (tap && !onCard) { close(); return; } dragFrom = null; hold = false; setTimeout(() => box.classList.remove('drag'), 0); if (performance.now() - lastMove > 80) vx = vy = 0; };
  box.addEventListener('pointerup', endDrag); box.addEventListener('pointercancel', endDrag);
  box.addEventListener('wheel', e => { if (e.target.closest('.tsp-det, .tsp-cat')) return; e.preventDefault(); zoom = Math.max(0.6, Math.min(1.5, zoom * (e.deltaY > 0 ? 0.92 : 1.08))); }, { passive: false });

  // ---- ワードを押す ----
  cards.addEventListener('click', e => {
    const w = e.target.closest('.tsp-w'); if (!w || moved > 6) return;
    const it = items[+w.dataset.i]; if (!it) return; close();
    document.dispatchEvent(new CustomEvent('tg-use-term', { detail: it.title }));
  });

  // ---- 乗せたワードの詳細(数字・ニュース3件・関連ワード。ニュースは、パネルと同じ背景の tg-trend-news で探す) ----
  const paintDet = it => {
    const hasN = it.news && it.news.length, rel = (it.related || []).slice(0, 8);
    det.innerHTML = `<b>${E(it.title)}</b><span class="tsp-num">${[it.traffic && '検索 ' + E(it.traffic), it.pctText && '▲' + E(it.pctText), E(it.agoText || '')].filter(Boolean).join(' ・ ')}</span>`
      + (hasN ? it.news.slice(0, 3).map(n => `<a class="tsp-n" href="${E(n.url)}" target="_blank" rel="noopener noreferrer">${n.picture ? `<img src="${E(n.picture)}" alt="" referrerpolicy="no-referrer">` : ''}<span>${E(n.title)}<small>${E(n.source || '')}</small></span></a>`).join('')
        : `<span class="tsp-nn">${it.newsLoading ? 'ニュースを探しています…' : 'ニュースは見つかりませんでした'}</span>`)
      + (rel.length ? `<div class="tsp-rel">${rel.map(w => `<i data-w="${E(w)}">${E(w)}</i>`).join('')}</div>` : '');
    det.hidden = false;
  };
  let hoverIt = null;
  cards.addEventListener('mouseover', e => {
    const a = e.target.closest('.tsp-w:not(.back)'); if (!a) return;
    clearTimeout(hideT); hoverCard = true; const it = items[+a.dataset.i]; if (!it) return; hoverIt = it; paintDet(it);
    if (!(it.news && it.news.length) && !it.newsTried) {
      it.newsTried = true; it.newsLoading = true; paintDet(it);
      chrome.runtime.sendMessage({ type: 'tg-trend-news', q: it.title }, r => { it.newsLoading = false; if (!chrome.runtime.lastError && r && r.news && r.news.length) it.news = r.news; if (alive && hoverIt === it && !det.hidden) paintDet(it); });
    }
  });
  const leave = () => { clearTimeout(hideT); hideT = setTimeout(() => { hoverCard = false; det.hidden = true; hoverIt = null; }, 400); };
  cards.addEventListener('mouseleave', leave);
  det.addEventListener('mouseenter', () => { clearTimeout(hideT); hoverCard = true; });
  det.addEventListener('mouseleave', leave);
  det.addEventListener('click', e => { const w = e.target.closest('[data-w]'); if (w) { close(); document.dispatchEvent(new CustomEvent('tg-use-term', { detail: w.dataset.w })); } });

  // ---- データ・色(ボリュームが高いほど赤、低いほど青) ----
  const num = it => { let n = +it.vol || 0; if (!n) { const m = /([\d,.]+)\s*(万)?/.exec(String(it.traffic || '')); if (m) n = parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 10000 : 1); } return n || 0; };
  function show(list) {
    items = list; els = []; cards.innerHTML = ''; det.hidden = true; msg.hidden = !!list.length; if (!list.length) msg.textContent = 'このカテゴリの急上昇ワードがありません';
    $b('.tsp-cnt').textContent = list.length ? `${list.length}語` : '';
    place(list.length); zoom = 1;
    const lg = v => Math.log10(Math.max(1, v)), vs = list.map(x => lg(num(x))), lmax = Math.max(...vs, 1), lmin = Math.min(...vs, lmax);
    cards.innerHTML = list.map((it, i) => { const k = lmax === lmin ? .5 : (vs[i] - lmin) / (lmax - lmin), hue = Math.round(220 - k * 220);
      return `<div class="tsp-w" role="listitem" data-i="${i}" style="--d:${calm ? 0 : i * 30}ms;--hue:${hue};font-size:calc(${(13 + k * 13).toFixed(1)}px * var(--tsp-fs, 1))"><i>${i + 1}</i>${E(it.title)}</div>`; }).join('');
    els = [...cards.querySelectorAll('.tsp-w')]; els.forEach(el => { el._w = el.offsetWidth; el._h = el.offsetHeight; }); setTimeout(() => els.forEach(el => { el._w = el.offsetWidth; el._h = el.offsetHeight; }), 50);
  }
  // 文字の大きさ(設定 px.sphFont。50〜100%・初期75%)。地球儀のワードだけに効く
  const setFs = px => { const v = Math.max(50, Math.min(100, +(px || {}).sphFont || 75)); box.style.setProperty('--tsp-fs', String(v / 100)); setTimeout(() => els.forEach(el => { el._w = el.offsetWidth; el._h = el.offsetHeight; }), 0); };
  chrome.storage.local.get('px').then(r => setFs(r.px)).catch(() => setFs(null)); setFs(null);
  const onPx = (ch, a) => { if (a === 'local' && ch.px) setFs(ch.px.newValue); }; chrome.storage.onChanged.addListener(onPx);
  let gen = 0;
  function load(force) {
    const my = ++gen; cards.innerHTML = ''; els = []; msg.hidden = false; msg.textContent = '読み込み中…'; det.hidden = true; $b('.tsp-cnt').textContent = '';
    box.querySelectorAll('.tsp-seg [data-h]').forEach(b => b.classList.toggle('on', +b.dataset.h === hours)); $b('.tsp-cat').value = String(cat);
    chrome.runtime.sendMessage({ type: 'tg-trends', force: !!force, hours, cat }, r => {
      if (!alive || my !== gen) return; void chrome.runtime.lastError;
      if (!r || r.error || !r.items) { msg.textContent = '取得できませんでした' + (r && r.error ? '(' + r.error + ')' : ''); return; }
      show(r.items.slice(0, 40));
    });
  }
  $b('.tsp-seg').addEventListener('click', e => { const b = e.target.closest('[data-h]'); if (!b || +b.dataset.h === hours) return; hours = +b.dataset.h; try { localStorage.setItem('tfTrwHours', String(hours)); } catch (x) { /* なし */ } load(); });
  $b('.tsp-cat').addEventListener('change', e => { cat = +e.target.value || 0; try { localStorage.setItem('tfTrwCat', String(cat)); } catch (x) { /* なし */ } load(); });
  $b('.tsp-re').addEventListener('click', () => load(true));
  const onNav = () => { if (/^\/(watch|shorts)(\/|$)/.test(location.pathname)) close(); };
  const close = () => { alive = false; chrome.storage.onChanged.removeListener(onPx); clearTimeout(hideT); clearInterval(rangeT); window.removeEventListener('resize', setRange); cancelAnimationFrame(sRaf); ro.disconnect(); box.remove(); document.removeEventListener('keydown', onKey, true); document.removeEventListener('yt-navigate-finish', onNav); };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const K = { ArrowLeft: [0.004, 0], ArrowRight: [-0.004, 0], ArrowUp: [0, -0.004], ArrowDown: [0, 0.004] }[e.key];
    if (K) { e.preventDefault(); vx += K[0]; vy += K[1]; }
  };
  document.addEventListener('keydown', onKey, true); document.addEventListener('yt-navigate-finish', onNav);
  $b('.tsp-x').addEventListener('click', close);
  setRange(); fit(); load();
}
document.addEventListener('tg-open-sphere', () => openTrendSphere());
