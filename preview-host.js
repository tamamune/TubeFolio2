// TubeFolio2 のページ(YouTubeの枠の中)のサムネに乗せたときの、動画プレビューを、YouTube側で出す。
//   枠の中の拡張機能のページから YouTube の埋め込みを読み込むと、ブラウザに止められるため、
//   元のTubeFolio と同じ形(YouTubeのページ → 拡張機能の中継ページ pv.html → 埋め込み)にする。
//   枠の中のページ(preview.js)が、動画ID・サムネの位置・設定を postMessage で送ってくる。
//   サムネの上に、マウスを通す(pointer-events: none)枠を重ねて、pv.html を開き、動き出したら返事をする。
(() => {
  if (window.__tfPvHost) return; window.__tfPvHost = true;
  let cur = null;
  const frame = () => document.querySelector('#tf-view iframe');
  const toPage = (ev, extra) => { try { frame()?.contentWindow?.postMessage({ tfPvEv: ev, ...extra }, '*'); } catch { /* なし */ } };
  const log = msg => toPage('log', { msg });

  function stop(notify) {
    if (!cur) return;
    clearInterval(cur.tune); cur.box.remove();
    if (notify && cur.done) toPage('stopped');
    cur = null;
  }

  function start(d) {
    stop(false);
    const f = frame(); if (!f || !/^[\w-]{11}$/.test(d.v || '')) return;
    const fr = f.getBoundingClientRect(), r = d.rect || {};
    if (!(r.w > 20 && r.h > 20)) return;
    const box = document.createElement('div');
    box.id = 'tf-pvo';
    Object.assign(box.style, { position: 'fixed', left: fr.left + r.l + 'px', top: fr.top + r.t + 'px', width: r.w + 'px', height: r.h + 'px', overflow: 'hidden', background: '#000',
      pointerEvents: 'none', zIndex: '2147483000', opacity: d.nu ? '1' : '0', transition: 'opacity .2s', borderRadius: d.rad || '0' });
    const el = document.createElement('iframe');
    el.allow = 'autoplay; encrypted-media';
    el.src = chrome.runtime.getURL(`pv.html?v=${encodeURIComponent(d.v)}${d.start ? '&start=' + d.start : ''}${d.nu ? '&loop=1' : ''}`);
    Object.assign(el.style, { border: '0', pointerEvents: 'none', display: 'block' });
    if (d.nu) { // 新プレビュー: 大きく作ってから縮めて、タイトル・ボタンなどの表示だけを小さくする
      const sc = Math.min(1, Math.max(0.01, +d.sc || 0.25));
      Object.assign(el.style, { position: 'absolute', left: '0', top: '0', width: r.w / sc + 'px', height: r.h / sc + 'px', transform: `scale(${sc})`, transformOrigin: 'top left' });
    } else Object.assign(el.style, { width: '100%', height: '100%' });
    box.appendChild(el); document.body.appendChild(box);
    const c = cur = { box, el, v: d.v, state: null, done: false, t0: Date.now(), d, loaded: false };
    const send = (event, extra) => { try { el.contentWindow?.postMessage(JSON.stringify({ event, id: 'tgfp', channel: 'widget', ...extra }), '*'); } catch { /* なし */ } };
    c.send = send;
    c.tune = setInterval(() => {
      if (cur !== c) return clearInterval(c.tune);
      if (!c.done) send('listening');
      if (c.state === 1 && !c.done) {
        c.done = true; c.at = Date.now();
        box.style.opacity = '1';
        if (d.fast) send('command', { func: 'setPlaybackRate', args: [2] });
        if (d.snd) setTimeout(() => { if (cur === c && !c.remuted) { send('command', { func: 'setVolume', args: [d.vol || 30] }); send('command', { func: 'unMute', args: [] }); } }, 300);
        toPage('playing');
      }
      if (c.done) { if (Date.now() - c.at > 5000) clearInterval(c.tune); return; }
      if (Date.now() - c.t0 > 10000) { clearInterval(c.tune); fail(c, `10秒で動き出さず(状態 ${c.state ?? '応答なし'}・埋め込み${c.loaded ? '読み込み済み' : '未読み込み'})`); }
    }, 250);
    log(`YouTube側でプレビューを開始(方式: ${d.nu ? '新プレビュー' : '旧プレビュー'}・UIの大きさ: ${d.nu ? Math.round((Math.min(1, Math.max(0.01, +d.sc || 0.25))) * 1000) / 10 + '%' : '(旧は変わりません)'}・枠 ${Math.round(r.w)}×${Math.round(r.h)})`);
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
      if (d.event === 'onReady') c.send('command', { func: 'playVideo', args: [] });
      const st = d.event === 'onStateChange' ? d.info : d.event === 'infoDelivery' ? d.info && d.info.playerState : undefined;
      if (st == null) return;
      c.state = st;
      // 再生中に止まった(音を出したことでブラウザに止められた等): ミュートに戻して続ける。2回目は諦める
      if (c.done && st === 2) {
        if (!c.remuted) { c.remuted = true; c.send('command', { func: 'mute', args: [] }); c.send('command', { func: 'playVideo', args: [] }); log('音声つきで止められたので、ミュートで再生を続けます'); }
        else { c.box.style.opacity = '0'; log('再生が止まりました'); }
      }
      return;
    }
    // 枠の中のページ(TubeFolio2 のページ)からの依頼
    const f = frame(); if (!f || e.source !== f.contentWindow || !e.data || !e.data.tfPv) return;
    if (e.data.tfPv === 'start') start(e.data);
    else if (e.data.tfPv === 'stop') stop(true);
  });
  window.addEventListener('yt-navigate-start', () => stop(false));
})();
