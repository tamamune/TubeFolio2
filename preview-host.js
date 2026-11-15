// TubeFolio2 のページ(YouTubeの枠の中)のサムネに乗せたときの、動画プレビューを、YouTube側で出す。
//   枠の中の拡張機能のページから YouTube の埋め込みを読み込むと、ブラウザに止められるため、
//   元のTubeFolio と同じ形(YouTubeのページ → 拡張機能の中継ページ pv.html → 埋め込み)にする。
//   枠の中のページ(preview.js)が、動画ID・サムネの位置・設定を postMessage で送ってくる。
//   サムネの上に、マウスを通す(pointer-events: none)枠を重ねて、pv.html を開き、動き出したら返事をする。
//   ★ 速くする: 埋め込みプレイヤーは、毎回ゼロから読み込むと1〜3秒かかる。そこで、
//     (1) 枠の中のページが開いたら、先に、見えない場所へプレイヤーを1つ読み込んでおく(warm)
//     (2) プレビューが終わっても、プレイヤーを捨てず、画面の外へ置いておく(次の動画は、IDを入れ替えるだけ = loadVideoById)
//     (3) まだ用意できていないときは、今までどおり、新しく作る(作ったものは、終わったあと、使い回し用に残す)
(() => {
  if (window.__tfPvHost) return; window.__tfPvHost = true;
  let cur = null, W = null; // cur = 今のプレビュー / W = 使い回しのプレイヤー { box, el, send, ready, busy, tune }
  const frame = () => document.querySelector('#tf-view iframe');
  const toPage = (ev, extra) => { try { frame()?.contentWindow?.postMessage({ tfPvEv: ev, ...extra }, '*'); } catch { /* なし */ } };
  const log = msg => toPage('log', { msg });
  const sender = el => (event, extra) => { try { el.contentWindow?.postMessage(JSON.stringify({ event, id: 'tgfp', channel: 'widget', ...extra }), '*'); } catch { /* なし */ } };
  const OFF = { left: '-9999px', top: '0', opacity: '0', transition: 'none' }; // 画面の外に置く

  // ---- 先に1つ読み込んでおく(動画は再生しない) ----
  function warm() {
    if (W || !frame()) return;
    const box = document.createElement('div'); box.id = 'tf-pvo';
    Object.assign(box.style, { position: 'fixed', width: '320px', height: '180px', overflow: 'hidden', background: '#000', pointerEvents: 'none', zIndex: '2147483000', ...OFF });
    const el = document.createElement('iframe'); el.allow = 'autoplay; encrypted-media';
    el.src = chrome.runtime.getURL('pv.html?warm=1');
    Object.assign(el.style, { border: '0', pointerEvents: 'none', display: 'block', width: '100%', height: '100%' });
    box.appendChild(el); document.body.appendChild(box);
    const w = W = { box, el, send: sender(el), ready: false, busy: false, t0: Date.now() };
    w.tune = setInterval(() => { if (W !== w || w.ready || Date.now() - w.t0 > 20000) return clearInterval(w.tune); w.send('listening'); }, 250);
  }
  // 使い終わったプレイヤーは、捨てずに、画面の外へ置いて、次に使う
  function park(c) {
    if (W && W.el !== c.el) { clearInterval(W.tune); W.box.remove(); } // 別に用意していた分があれば、捨てる(1つだけ持つ)
    try { c.send('command', { func: 'stopVideo', args: [] }); } catch { /* なし */ }
    Object.assign(c.box.style, OFF); c.box.querySelectorAll('.tf-pvk').forEach(x => x.remove());
    W = { box: c.box, el: c.el, send: c.send, ready: true, busy: false, t0: Date.now() };
  }

  function stop(notify) {
    if (!cur) return;
    const c = cur; clearInterval(c.tune); cur = null;
    if (notify && c.done) toPage('stopped');
    if (c.warm || c.done) park(c); else c.box.remove(); // 動き出していない新しいものは、捨てる
  }

  function start(d) {
    stop(false);
    const f = frame(); if (!f || !/^[\w-]{11}$/.test(d.v || '')) return;
    const fr = f.getBoundingClientRect(), r = d.rect || {};
    if (!(r.w > 20 && r.h > 20)) return;
    const reuse = !!(W && W.ready && !W.busy); // 用意してあるプレイヤーがあれば、それを使う
    let box, el;
    if (reuse) { box = W.box; el = W.el; box.querySelectorAll('.tf-pvk').forEach(x => x.remove()); el.removeAttribute('style'); }
    else { box = document.createElement('div'); box.id = 'tf-pvo'; el = document.createElement('iframe'); el.allow = 'autoplay; encrypted-media'; }
    Object.assign(box.style, { position: 'fixed', left: fr.left + r.l + 'px', top: fr.top + r.t + 'px', width: r.w + 'px', height: r.h + 'px', overflow: 'hidden', background: '#000',
      pointerEvents: 'none', zIndex: '2147483000', opacity: '0', transition: 'opacity .2s', borderRadius: d.rad || '0' });
    if (!reuse) el.src = chrome.runtime.getURL(`pv.html?v=${encodeURIComponent(d.v)}${d.start ? '&start=' + d.start : ''}${d.nu ? '&loop=1' : ''}`);
    Object.assign(el.style, { border: '0', pointerEvents: 'none', display: 'block' });
    if (d.nu) { // 新プレビュー: 大きく作ってから縮めて、タイトル・ボタンなどの表示だけを小さくする
      const sc = Math.min(1, Math.max(0.01, +d.sc || 0.25));
      Object.assign(el.style, { position: 'absolute', left: '0', top: '0', width: r.w / sc + 'px', height: r.h / sc + 'px', transform: `scale(${sc})`, transformOrigin: 'top left' });
    } else Object.assign(el.style, { width: '100%', height: '100%' });
    if (!reuse) box.appendChild(el);
    // サムネの左下の「🕒 後で見る」: プレビューが上に重なると見えなくなるので、同じ見た目の印を、プレビューの上に出す(マウスは通すので、押すと、下の本物のボタンが押される)
    if (d.btn && d.btn.w > 4) {
      const b = d.btn, k = document.createElement('div'); k.className = 'tf-pvk';
      k.textContent = b.text || '🕒';
      Object.assign(k.style, { position: 'absolute', left: b.l - r.l + 'px', top: b.t - r.t + 'px', width: b.w + 'px', height: b.h + 'px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: b.bg, color: b.fg, border: b.bd, borderRadius: b.rad, font: `${b.fw} ${b.fs}/1 Roboto, Arial, "Noto Sans JP", sans-serif`, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: '5' });
      box.appendChild(k);
    }
    if (!reuse) document.body.appendChild(box);
    const send = reuse ? W.send : sender(el);
    const c = cur = { box, el, v: d.v, state: null, done: false, t0: Date.now(), d, loaded: reuse, warm: reuse, send };
    if (reuse) { // プレイヤーはもう動いている: ミュート・速さを戻して、動画だけ入れ替える
      W.busy = true;
      send('command', { func: 'mute', args: [] }); send('command', { func: 'setPlaybackRate', args: [1] });
      send('command', { func: 'loadVideoById', args: [d.v, d.start || 0] });
    }
    c.tune = setInterval(() => {
      if (cur !== c) return clearInterval(c.tune);
      if (!c.done) send('listening');
      const el1 = c.t1 ? Date.now() - c.t1 : 0, ready = !!c.t1 && (el1 >= 800 || (c.time != null ? c.time >= (c.d.start || 0) + 0.15 : el1 >= 300)); // 動画の最初のコマが出てから見せる(その前に出すと、黒い画面になる。0.8秒たてば、出す)
      if (c.state === 1 && !c.done && ready) {
        c.done = true; c.at = Date.now();
        box.style.opacity = '1';
        if (d.fast) send('command', { func: 'setPlaybackRate', args: [2] });
        if (d.snd) setTimeout(() => { if (cur === c && !c.remuted) { send('command', { func: 'setVolume', args: [d.vol || 30] }); send('command', { func: 'unMute', args: [] }); } }, 300);
        toPage('playing');
      }
      if (c.done) { if (Date.now() - c.at > 5000) clearInterval(c.tune); return; }
      if (Date.now() - c.t0 > 10000) { clearInterval(c.tune); fail(c, `10秒で動き出さず(状態 ${c.state ?? '応答なし'}・埋め込み${c.loaded ? '読み込み済み' : '未読み込み'})`); }
    }, 250);
    log(`YouTube側でプレビューを開始(${reuse ? '用意してあったプレイヤーを使用' : '新しく読み込み'}・方式: ${d.nu ? '新プレビュー' : '旧プレビュー'}・UIの大きさ: ${d.nu ? Math.round((Math.min(1, Math.max(0.01, +d.sc || 0.25))) * 1000) / 10 + '%' : '(旧は変わりません)'}・枠 ${Math.round(r.w)}×${Math.round(r.h)})`);
  }
  function fail(c, why) { if (cur !== c) return; stop(false); toPage('fail', { why }); }

  // 中継ページ(pv.html)・プレイヤーからの返事
  window.addEventListener('message', e => {
    const c = cur;
    if (c && e.source === c.el.contentWindow) {
      let d = e.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
      if (!d || !d.event) return;
      if (d.event === 'tgPvLoaded') { c.loaded = true; return; }
      if (d.event === 'onError') return fail(c, `エラー ${d.info}`);
      if (d.event === 'onReady' && !c.warm) c.send('command', { func: 'playVideo', args: [] });
      if (d.event === 'infoDelivery' && d.info && typeof d.info.currentTime === 'number') c.time = d.info.currentTime;
      const st = d.event === 'onStateChange' ? d.info : d.event === 'infoDelivery' ? d.info && d.info.playerState : undefined;
      if (st == null) return;
      c.state = st; if (st === 1 && !c.t1) c.t1 = Date.now();
      if (c.warm && st === 0 && c.d.nu) { c.send('command', { func: 'seekTo', args: [c.d.start || 0, true] }); c.send('command', { func: 'playVideo', args: [] }); } // 新プレビュー: 終わったら最初から(使い回しのプレイヤーは、URLのループが使えない)
      // 再生中に止まった(音を出したことでブラウザに止められた等): ミュートに戻して続ける。2回目は諦める
      if (c.done && st === 2) {
        if (!c.remuted) { c.remuted = true; c.send('command', { func: 'mute', args: [] }); c.send('command', { func: 'playVideo', args: [] }); log('音声つきで止められたので、ミュートで再生を続けます'); }
        else { c.box.style.opacity = '0'; log('再生が止まりました'); }
      }
      return;
    }
    // 先に読み込んでおいたプレイヤーの返事: 用意ができた印
    if (W && !W.busy && !W.ready && e.source === W.el.contentWindow) {
      let d = e.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
      if (d && (d.event === 'onReady' || d.event === 'initialDelivery' || d.event === 'infoDelivery' || d.event === 'onStateChange')) { W.ready = true; clearInterval(W.tune); }
      return;
    }
    // 枠の中のページ(TubeFolio2 のページ)からの依頼
    const f = frame(); if (!f || e.source !== f.contentWindow || !e.data || !e.data.tfPv) return;
    if (e.data.tfPv === 'start') start(e.data);
    else if (e.data.tfPv === 'stop') stop(true);
    else if (e.data.tfPv === 'warm') warm();
  });
  window.addEventListener('yt-navigate-start', () => { stop(false); if (W) { clearInterval(W.tune); W.box.remove(); W = null; } }); // 別のページへ移ったら、使い回し用のプレイヤーも捨てる
})();
