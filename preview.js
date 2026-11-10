// サムネに乗せたら、プレビュー(埋め込みの動画を音声あり・倍速で / 動かなければコマ送り)。元のTubeFolioの content.js から移した部分。
// TubeFolio2 の自前のページ(page.html の「新着動画・ライブ・ショート」「視聴」の一覧)のサムネで動く。
// 設定は px: feedPreview(使う) / pvMode(旧・新) / hoverSound / hoverVol / hoverFast(⚙ 設定 → 再生・動画 →「サムネのプレビュー」)
(() => {
  if (window.__tfPreview) return; window.__tfPreview = true;
  const PXH0 = { hoverSound: true, hoverVol: 30, hoverFast: true, feedPreview: true, pvMode: 'old', pvScale: 0.25 };
  let PXH = { ...PXH0 };
  chrome.storage.local.get('px').then(r => { PXH = { ...PXH0, ...(r.px || {}) }; });
  chrome.storage.onChanged.addListener(ch => { if (ch.px) PXH = { ...PXH0, ...(ch.px.newValue || {}) }; });
  const hoverVol = () => Math.min(1, Math.max(0.01, (+PXH.hoverVol || 30) / 100));
  const sbMem = new Map(); // 動画ID → コマ割り画像の情報
  const stAdd = () => {}; // ショートを見た時間の合計(元のTubeFolioの機能。ここでは使わない)
  // ---------- TubeFolio の一覧（新着・動画・後で見る・ブックマークなど）のサムネに乗せたらプレビュー ----------
  //   コマ割り画像のパラパラ表示（音声なし）をすぐ出し、裏で埋め込みプレイヤーを読み込む。
  //   埋め込みが動き出したらそちらに切り替える（拡張機能の中継ページ pv.html の中で埋め込み、
  //   embed_rules.json で youtube.com 以外の Referer を付けてエラー 152／153 を避ける）
  let fpTimer = 0, fpThumb = null, fpBoardEl = null, fpBoardT = 0, fpTune = 0, fpCur = null;
  let fpEmbedBad = 0; // 続けて失敗したら、しばらくは埋め込みを試さない
  const FP_SEL = '.card .th'; // TubeFolio2 のページのサムネ
  const fpLog = msg => { try { TG.log('プレビュー', msg); } catch { /* なし */ } };
  function fpStop() {
    clearTimeout(fpTimer); clearInterval(fpTune); clearInterval(fpBoardT); fpTimer = 0; fpTune = 0; fpBoardT = 0;
    fpBoardEl?.remove(); fpBoardEl = null;
    if (fpCur?.done && fpCur.short) stAdd((Date.now() - fpCur.at) / 1000); // ショートのプレビュー時間も合計に
    if (fpCur && !fpCur.done && !fpCur.fell) fpLog(`埋め込みが動き出す前に離れました(${((Date.now() - fpCur.t0) / 1000).toFixed(1)}秒)`);
    fpHostStop(); fpCur = null;
    fpThumb?.classList.remove('tg-fp-on', 'tg-fp-play'); fpThumb = null;
  }
  const fpTarget = th => {
    const a = th.matches('a[href]') ? th : th.closest('a[href]');
    const u = new URL(a?.getAttribute('href') || '', location.href);
    const v = u.searchParams.get('v') || (u.pathname.match(/^\/shorts\/([\w-]{11})/) || [])[1] || th.closest('[data-v]')?.dataset.v;
    return { v, start: parseInt(u.searchParams.get('t') || '0', 10) || 0 };
  };
  function fpStart(th) {
    const { v, start } = fpTarget(th);
    if (!v) return;
    // 検証用拡張で成功したのと同じ流れ：サムネを出したまま埋め込みを読み込み、再生が始まってから表示する。
    // コマ送り（コマ割り画像）は、埋め込みで再生できなかったときだけ
    fpEmbed(th, v, start); // 動画のプレビューだけ(コマ送りは出さない)。動き出すまで数秒かかる
  }
  // 埋め込みの動画は、このページ(YouTubeの枠の中)ではなく、YouTube側(preview-host.js)で出す。
  //   枠の中の拡張機能のページから YouTube の埋め込みを読み込むと、ブラウザに止められる(読み込みが終わらない)ため。
  //   ここでは「どの動画を、サムネのどの位置に」とだけ親(YouTubeのページ)へ知らせ、動き出したら返事が来る。
  const HOSTED = window.parent !== window;
  function fpEmbed(th, v, start) {
    if (!HOSTED) return; // 枠に入っていない(単独のタブ)ときは、コマ送りだけ
    const r = th.getBoundingClientRect(), nu = PXH.pvMode === 'new';
    fpCur = { th, v, state: null, done: false, t0: Date.now(), short: !!th.closest('[data-type="short"]') || /\/shorts\//.test(th.closest('a[href]')?.getAttribute('href') || '') };
    try {
      parent.postMessage({ tfPv: 'start', v, start, nu, sc: Math.min(1, Math.max(0.01, +PXH.pvScale || 0.25)), fast: !!PXH.hoverFast, snd: !!PXH.hoverSound, vol: Math.round(hoverVol() * 100),
        rect: { l: r.left, t: r.top, w: r.width, h: r.height }, rad: getComputedStyle(th).borderRadius }, '*');
    } catch { /* なし */ }
    if (nu) th.classList.add('tg-fp-on', 'tg-fp-play'); // 新プレビュー:すぐに重ねて表示(UIが小さいので待たない)
  }
  function fpHostStop() { if (HOSTED) { try { parent.postMessage({ tfPv: 'stop' }, '*'); } catch { /* なし */ } } }
  // YouTube側からの返事: 動き出した / 失敗した / 記録
  window.addEventListener('message', e => {
    if (e.source !== parent || !e.data || !e.data.tfPvEv) return;
    const d = e.data, cur = fpCur; if (!cur) return;
    if (d.tfPvEv === 'log') return fpLog(d.msg);
    if (d.tfPvEv === 'playing') {
      cur.done = true; cur.at = Date.now(); fpEmbedBad = 0;
      fpLog(`埋め込みで再生(${((Date.now() - cur.t0) / 1000).toFixed(1)}秒)`);
      cur.th.classList.add('tg-fp-on', 'tg-fp-play');
      clearInterval(fpBoardT); fpBoardEl?.remove(); fpBoardEl = null; // コマ送りは、動画に切り替わったら消す
    } else if (d.tfPvEv === 'fail' && !cur.fell) {
      cur.fell = true; fpEmbedBad++;
      cur.th.classList.remove('tg-fp-play');
      fpLog(`埋め込みで再生できません: ${d.why || ''}`);

    } else if (d.tfPvEv === 'stopped' && cur.done) cur.th.classList.remove('tg-fp-play');
  });
  // 動画のコマ割り画像をパラパラ表示する（音声なし）
  async function fpBoard(th) {
    const { v, start } = fpTarget(th);
    let sb = null;
    try { // 背景側(background.js)で取る。拡張機能のページから YouTube へ直接つなぐと「Failed to fetch」になるため
      const r = sbMem.has(v) ? sbMem.get(v) : await chrome.runtime.sendMessage({ type: 'sbInfo', v });
      sbMem.set(v, r || null);
      if (r && r.base) sb = { ...r, url: n => r.base.replace('$L', r.i).replace('$N', r.name.replace('$M', n)) + (r.base.includes('?') ? '&' : '?') + 'sigh=' + r.sigh };
    } catch (e) { fpLog('コマ割り画像を取得できません: ' + String((e && e.message) || e)); }
    if (!sb) fpLog('コマ割り画像がありません(取得できませんでした)');
    if (!sb || fpThumb !== th || th.classList.contains('tg-fp-play')) return;
    const per = sb.cols * sb.rows, total = sb.count || per;
    const step = sb.interval ? sb.interval / 1000 : (sb.dur || total) / total; // 1コマの秒数
    let k = Math.min(total - 1, Math.floor(start / step));
    const f = document.createElement('div');
    f.className = 'tg-fp tg-fp-sb';
    f.innerHTML = '<i></i>';
    th.appendChild(f);
    fpBoardEl = f;
    const bar = f.firstChild;
    const show = () => {
      const sheet = Math.floor(k / per), j = k % per, col = j % sb.cols, row = Math.floor(j / sb.cols);
      f.style.backgroundImage = `url("${sb.url(sheet)}")`;
      f.style.backgroundSize = `${sb.cols * 100}% ${sb.rows * 100}%`;
      f.style.backgroundPosition = `${sb.cols > 1 ? (col / (sb.cols - 1)) * 100 : 0}% ${sb.rows > 1 ? (row / (sb.rows - 1)) * 100 : 0}%`;
      bar.style.width = ((k + 1) / total) * 100 + '%';
    };
    const pre = new Set();
    const preload = () => { const sh = Math.floor(k / per) + 1; if (!pre.has(sh) && sh * per < total) { pre.add(sh); new Image().src = sb.url(sh); } };
    show(); preload();
    th.classList.add('tg-fp-on');
    const ms = PXH.hoverFast ? 250 : 500;
    clearInterval(fpBoardT);
    fpBoardT = setInterval(() => { if (fpBoardEl !== f) return clearInterval(fpBoardT); k = (k + 1) % total; show(); preload(); }, ms);
  }
  document.addEventListener('mouseover', e => {
    const th = e.target.closest?.(FP_SEL);
    if (th === fpThumb) return;
    fpStop();
    if (!th || PXH.feedPreview === false || e.target.closest('button')) return;
    fpThumb = th;
    fpTimer = setTimeout(() => { if (fpThumb === th) fpStart(th); }, 600);
  }, true);
  document.addEventListener('mouseout', e => { if (fpThumb && !fpThumb.contains(e.relatedTarget)) fpStop(); }, true);
  document.addEventListener('click', e => { if (fpThumb && fpThumb.contains(e.target)) fpStop(); }, true);
  window.addEventListener('scroll', () => { if (fpThumb) fpStop(); }, { passive: true });
})();
