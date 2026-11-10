// 一覧のサムネに乗せたときのプレビュー用の中継ページ（拡張機能のページ）
//   YouTube のページから直接 youtube.com の埋め込みを作ると、埋め込み元が youtube.com 自身になってエラー 152 になる。
//   拡張機能のページから埋め込むと Referer が送られないので、embed_rules.json で youtube.com 以外の Referer を付ける
//   （検証用拡張で成功した組み合わせ：拡張ページ＋Referer 付与）。
//   親（YouTube のページ）とプレイヤーの間の postMessage をそのまま中継する。
(() => {
  const p = new URLSearchParams(location.search);
  const v = p.get('v') || '';
  if (!/^[\w-]{11}$/.test(v)) return;
  const start = parseInt(p.get('start') || '0', 10) || 0;
  const q = new URLSearchParams({
    autoplay: 1, mute: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3,
    modestbranding: 1, playsinline: 1, rel: 0, enablejsapi: 1,
    origin: location.origin, tgref: 1
  });
  if (start) q.set('start', start);
  if (p.get('loop') === '1') { q.set('loop', 1); q.set('playlist', v); } // 新プレビュー：終わったら最初から
  const f = document.createElement('iframe');
  f.allow = 'autoplay; encrypted-media';
  f.src = `https://www.youtube.com/embed/${v}?${q}`;
  f.addEventListener('load', () => { try { window.parent.postMessage(JSON.stringify({ event: 'tgPvLoaded' }), '*'); } catch (e) { /* なし */ } }); // 埋め込みの読み込みが終わったことを、親へ知らせる(原因調べ用)
  document.body.appendChild(f);

  window.addEventListener('message', e => {
    if (e.source === f.contentWindow) {
      // プレイヤー → 親
      if (window.parent !== window) window.parent.postMessage(e.data, '*');
    } else if (e.source === window.parent) {
      // 親 → プレイヤー
      try { f.contentWindow?.postMessage(e.data, '*'); } catch { /* 読み込み前 */ }
    }
  });
})();
