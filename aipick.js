// 視聴の「✨ AIおすすめ(試作)」: 生成AIが考えているような「もやもや」の光と、「検索中…」・0%→100% のシークバーを出してから、
//   おすすめ10本をカードで並べる。page.js の viewPage() のボタンから openAiPick() で開く。
//   候補を集める・10本を選ぶのは、🎞 おすすめ10本(reel.js)と同じ(reelGather / reelPick。続きから・後で見る・非登録チャンネル・急上昇)。
//   バーの進み方: 実際に候補を集めている間は 92% までゆっくり進み、集め終わったら 100% まで進めて、カードを出す(最短で約4秒。演出のため)。
//   🔄 もう一度探す: 集めた候補から選び直す(短い演出つき)。✕・背景・Esc で閉じる
function openAiPick() {
  document.getElementById('aip')?.remove();
  const E = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const calm = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  const box = document.createElement('div'); box.id = 'aip';
  box.innerHTML = `<div class="ai-bg"></div><div class="ai-pan" role="dialog" aria-label="AIおすすめ">
    <div class="ai-h"><b>✨ AIおすすめ<small>試作</small></b><span class="ai-sp"></span><button type="button" class="ai-re" hidden>🔄 もう一度探す</button><button type="button" class="ai-x" title="閉じる(Esc)">✕</button></div>
    <div class="ai-think">
      <div class="ai-mist" aria-hidden="true"><i class="m1"></i><i class="m2"></i><i class="m3"></i><i class="m4"></i><span class="ai-core"></span></div>
      <div class="ai-lbl"><b>検索中<span class="ai-dots"><i>.</i><i>.</i><i>.</i></span></b><small class="ai-step">準備しています</small></div>
      <div class="ai-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i class="ai-fill"></i><span class="ai-head"></span></div>
      <div class="ai-pct">0%</div>
    </div>
    <div class="ai-out" hidden></div></div>`;
  document.body.appendChild(box);
  const think = box.querySelector('.ai-think'), out = box.querySelector('.ai-out'), fill = box.querySelector('.ai-fill'), head = box.querySelector('.ai-head');
  const pctEl = box.querySelector('.ai-pct'), stepEl = box.querySelector('.ai-step'), bar = box.querySelector('.ai-bar'), reBtn = box.querySelector('.ai-re');
  const STEPS = [[0, '視聴履歴を読み込んでいます'], [18, '途中まで見た動画を探しています'], [38, '「後で見る」を確認しています'], [56, 'まだ登録していないチャンネルを探しています'], [72, '急上昇と照らし合わせています'], [88, 'あなたへの10本を選んでいます']];
  let raf = 0, alive = true, pool = null;
  const setP = p => {
    p = Math.max(0, Math.min(100, p)); const s = p.toFixed(1) + '%';
    fill.style.width = s; head.style.left = s; pctEl.textContent = Math.floor(p) + '%'; bar.setAttribute('aria-valuenow', String(Math.floor(p)));
    let t = STEPS[0][1]; for (const [at, msg] of STEPS) if (p >= at) t = msg; if (stepEl.textContent !== t) { stepEl.textContent = t; stepEl.classList.remove('in'); void stepEl.offsetWidth; stepEl.classList.add('in'); }
  };
  // 0%→100% の演出。work = 実際の処理(Promise)。min = 最短の時間(ミリ秒)
  function run(work, min) {
    cancelAnimationFrame(raf); think.hidden = false; out.hidden = true; reBtn.hidden = true; box.classList.remove('done'); setP(0);
    const t0 = performance.now(); let done = false, endAt = 0, from = 0, p = 0;
    return new Promise(res => {
      work.then(v => { done = true; res.v = v; }).catch(() => { done = true; });
      const step = t => {
        if (!alive) return;
        const el = t - t0;
        if (!done || el < min) { // 集めている間: 92% に近づくように、だんだんゆっくり
          const target = 92 * (1 - Math.exp(-el / (min * 0.45)));
          p = Math.max(p, Math.min(target, done ? 99 : 92));
        } else { // 集め終わった: 100% まで、0.6秒で
          if (!endAt) { endAt = t; from = p; }
          const k = Math.min(1, (t - endAt) / 600); p = from + (100 - from) * (1 - Math.pow(1 - k, 3));
          if (k >= 1) { setP(100); setTimeout(() => alive && res(res.v), calm ? 0 : 280); return; }
        }
        setP(p); raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
  }
  const card = (x, i) => { const [ic, nm] = (typeof REEL_SRC !== 'undefined' && REEL_SRC[x.src]) || ['', ''];
    const url = `https://www.youtube.com/watch?v=${E(x.id)}${x.list ? '&list=' + E(x.list) : ''}${x.pos ? '&t=' + Math.max(0, x.pos - 3) + 's' : ''}`;
    return `<a class="ai-c" href="${url}" target="_top" title="${E(x.title)}" style="animation-delay:${calm ? 0 : i * 70}ms"><span class="ai-th"><img loading="lazy" src="${E(x.thumb || `https://i.ytimg.com/vi/${x.id}/mqdefault.jpg`)}" alt=""><em class="ai-src ai-${E(x.src)}">${ic} ${nm}${x.rank ? ` ${x.rank}位` : ''}${x.pct ? ` ${x.pct}%` : ''}</em>${x.len ? `<span class="ai-len">${E(x.len)}</span>` : ''}${x.pct ? `<span class="ai-pb"><i style="width:${Math.min(100, x.pct)}%"></i></span>` : ''}</span>
      <b>${E(x.title)}</b><small>${E(x.ch || '')}${x.views ? ' ・ ' + E(x.views) : ''}</small></a>`; };
  function show(list) {
    if (!alive) return;
    think.hidden = true; out.hidden = false; reBtn.hidden = false; box.classList.add('done');
    out.innerHTML = list.length ? `<p class="ai-msg">あなたへのおすすめ ${list.length}本</p><div class="ai-grid">${list.map(card).join('')}</div>`
      : '<p class="ai-msg">おすすめできる動画が見つかりませんでした(YouTube にログインしているか、確認してください)</p>';
  }
  const pick = () => (typeof reelPick === 'function' && pool ? reelPick(pool) : []);
  reBtn.addEventListener('click', () => run(new Promise(r => setTimeout(r, 300)), calm ? 300 : 1800).then(() => show(pick())));
  const close = () => { alive = false; cancelAnimationFrame(raf); box.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
  box.querySelector('.ai-bg').addEventListener('click', close);
  box.querySelector('.ai-x').addEventListener('click', close);
  const work = typeof reelGather === 'function' ? reelGather() : Promise.resolve(null);
  run(work.then(p => { pool = p; return p; }), calm ? 600 : 4200).then(() => show(pick()));
}
