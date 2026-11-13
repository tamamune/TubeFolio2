// document_start で実行。リロード時のレイアウトのガタつき対策:
//  1) 保存済みの列数などの設定を、YouTubeが最初に描画する前に反映する
//  2) 拡張機能の整形(左メニューのフォルダ・ツールバー・文字サイズ調整など)が終わるまで、画面を一時的に隠す
// 解除は content.js(整形後) か、下のタイマー(最大1.2秒)のどちらか早い方。スマホでは隠さない。
// ※ THUMBS のキーは content.js と同じにしておくこと。
(() => {
  const root = document.documentElement;
  const p = location.pathname;
  const touch = (() => { try { return matchMedia('(pointer: coarse)').matches; } catch (e) { return false; } })(); // スマホ: 隠すと、起動が遅く見えるので隠さない
  const hideMain = p !== '/watch' && !p.startsWith('/shorts') && !touch;
  // リロード時に、前のスクロール位置へ戻さない(戻すと、上のガラスバーの下に一覧の先頭が隠れた位置から始まってしまう)
  if (hideMain) { try { history.scrollRestoration = 'manual'; } catch (e) {} }
  if (hideMain) { root.setAttribute('data-tf-boot', ''); setTimeout(() => root.removeAttribute('data-tf-boot'), 1200); }
  // 下のガラスバーの幅・位置は、前回の値を最初に反映する(YouTube が描く前に。後から JS が決めると、全幅から縮む動きが見えてしまう)
  try { const v = JSON.parse(localStorage.getItem('tfHbotVars') || '[]'); if (Array.isArray(v)) v.forEach(([k, x]) => { if (/^--tf-[\w-]+$/.test(k) && /^[\d.]+(px|vw)$/.test(x)) root.style.setProperty(k, x); }); } catch (e) {}
  const THUMBS = ['cols', 'scols'];
  try {
    chrome.storage.local.get('settings').then(r => {
      const s = r.settings || {}, g = s.thumb || {};
      THUMBS.forEach(k => root.toggleAttribute('data-tf-g-' + k, !!g[k]));
      const n = g.colsN || 5;
      root.style.setProperty('--tf-cols', n); root.style.setProperty('--tf-scols', g.sN || 6);
      root.style.setProperty('--tf-title-lines', 3);
      root.style.setProperty('--tf-title-fs', (n >= 7 ? 11.5 : n >= 6 ? 12 : n >= 5 ? 13 : 14) + 'px');
      root.style.setProperty('--tf-meta-fs', (n >= 6 ? 11 : 12) + 'px');
      root.toggleAttribute('data-tf-hide-create', s.hideCreate === true);
    }).catch(() => {});
  } catch (e) {}
})();

// ---- 動作の重さの記録(調べるため): 再生画面を開いてから20秒間、TubeFolio2 の処理(タイマー・画面の監視・イベント)にかかった時間を、
//   どのファイルの何行目から登録した処理かごとに数えて、動作ログ(分類「重さ」)に1行で残す。ページ全体(YouTube 自身も含む)の「固まった時間」も一緒に残す。
//   この拡張機能のスクリプトだけを包む(YouTube 自身の処理は、別の世界で動くので触らない)。記録していない間は、ほぼ何もしない
(() => {
  const P = { on: false, t0: 0, by: new Map(), lt: 0, ltN: 0, ltMax: 0, play: 0, nav: '' };
  window.__tfPerf = P;
  const where = err => { const s = String((err && err.stack) || '').split('\n'); for (const l of s) { const m = l.match(/chrome-extension:\/\/[^/]+\/([\w.-]+\.js):(\d+)/); if (m && m[1] !== 'early.js') return m[1] + ':' + m[2]; } return '?'; };
  const wrapFn = (fn, err) => {
    let w = null;
    return function (...a) {
      if (!P.on) return fn.apply(this, a);
      const t = performance.now();
      try { return fn.apply(this, a); } finally {
        const d = performance.now() - t; if (!w) w = where(err);
        const e = P.by.get(w) || [0, 0, 0]; e[0] += d; e[1]++; if (d > 50) e[2]++; P.by.set(w, e);
      }
    };
  };
  try {
    const sI = window.setInterval, sT = window.setTimeout, rAF = window.requestAnimationFrame;
    window.setInterval = function (fn, ...r) { return sI.call(window, typeof fn === 'function' ? wrapFn(fn, new Error()) : fn, ...r); };
    window.setTimeout = function (fn, ...r) { return sT.call(window, typeof fn === 'function' ? wrapFn(fn, new Error()) : fn, ...r); };
    window.requestAnimationFrame = function (fn) { return rAF.call(window, typeof fn === 'function' ? wrapFn(fn, new Error()) : fn); };
    const MO = window.MutationObserver;
    window.MutationObserver = class extends MO { constructor(fn) { super(typeof fn === 'function' ? wrapFn(fn, new Error()) : fn); } };
    const ET = EventTarget.prototype, add = ET.addEventListener, rem = ET.removeEventListener, map = new WeakMap();
    ET.addEventListener = function (type, fn, opt) {
      if (typeof fn !== 'function') return add.call(this, type, fn, opt);
      let w = map.get(fn); if (!w) { w = wrapFn(fn, new Error()); map.set(fn, w); }
      return add.call(this, type, w, opt);
    };
    ET.removeEventListener = function (type, fn, opt) { return rem.call(this, type, (typeof fn === 'function' && map.get(fn)) || fn, opt); };
  } catch (e) { /* 包めなくても、ほかは動かす */ }
  // ページ全体の「固まった時間」(50ミリ秒を超えた処理。YouTube 自身の分も入る)
  try { new PerformanceObserver(l => { if (!P.on) return; l.getEntries().forEach(x => { P.lt += x.duration; P.ltN++; if (x.duration > P.ltMax) P.ltMax = x.duration; }); }).observe({ type: 'longtask', buffered: false }); } catch (e) { /* 使えないブラウザ */ }
  const report = () => {
    P.on = false;
    const rows = [...P.by.entries()].sort((a, b) => b[1][0] - a[1][0]);
    const total = rows.reduce((s, [, e]) => s + e[0], 0), longs = rows.reduce((s, [, e]) => s + e[2], 0);
    const top = rows.slice(0, 8).map(([k, e]) => `${k} ${Math.round(e[0])}ms(${e[1]}回${e[2] ? '・長い' + e[2] : ''})`).join(' / ');
    const msg = `再生画面を開いてから20秒: TubeFolio2 の処理 合計${Math.round(total)}ms(50ms超え ${longs}回)・ページ全体で固まった時間 ${Math.round(P.lt)}ms(${P.ltN}回・最大${Math.round(P.ltMax)}ms)` + (P.play ? `・再生が始まるまで ${Math.round(P.play)}ms` : '') + ` ・ 多い順: ${top}`;
    try { if (typeof TG !== 'undefined') TG.log('重さ', msg, total > 1500 || P.lt > 4000 ? 'warn' : 'info'); } catch (e) { /* なし */ }
    try { console.log('[TubeFolio2 重さ]', msg); } catch (e) { /* なし */ }
  };
  let endT = 0;
  const start = () => {
    if (location.pathname !== '/watch') return;
    const v = new URLSearchParams(location.search).get('v') || ''; if (P.on && P.nav === v) return;
    P.on = true; P.nav = v; P.t0 = performance.now(); P.by = new Map(); P.lt = 0; P.ltN = 0; P.ltMax = 0; P.play = 0;
    clearTimeout(endT); endT = setTimeout(report, 20000);
  };
  start(); // ページを開いた(読み込み直した)とき
  window.addEventListener('yt-navigate-start', e => { const u = String(((e.detail || {}).url) || ''); if (/^\/watch/.test(u.replace(/^https?:\/\/[^/]+/, ''))) { P.on = false; } }, true);
  window.addEventListener('yt-navigate-finish', start, true);
  document.addEventListener('playing', e => { if (P.on && !P.play && e.target && e.target.tagName === 'VIDEO') P.play = performance.now() - P.t0; }, true);
})();

// ---- 再生画面を開いた直後(5秒)は、YouTube 自身がいちばん忙しい(記録では、ページ全体が合計4〜7秒固まる)。
//   その間は、急がない見回り(タグ・バー・印・元の概要欄など)を控える。急ぐもの(再生速度・冒頭スキップ・SponsorBlock・広告の早送り)は止めない。
//   ほかのスクリプトは、window.tfQuiet() が true の間、急がない処理を飛ばす
(() => {
  let until = 0;
  const isWatch = p => /^\/(watch|shorts)/.test(String(p || '').replace(/^https?:\/\/[^/]+/, ''));
  if (isWatch(location.pathname)) until = performance.now() + 5000;
  window.addEventListener('yt-navigate-start', e => { if (isWatch(((e.detail || {}).url) || '')) until = performance.now() + 7000; }, true);
  window.addEventListener('yt-navigate-finish', () => { if (isWatch(location.pathname)) until = performance.now() + 5000; else until = 0; }, true);
  window.tfQuiet = () => performance.now() < until;
})();
