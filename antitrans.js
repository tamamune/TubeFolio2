// 自動翻訳を元に戻す（Anti-Translate 風）
//   YouTube が勝手に日本語へ翻訳した動画のタイトル・概要欄を、投稿者が付けたもとの言語で表示する
//   ・タイトル：一覧・検索結果・関連動画・視聴ページ（タブの名前も）。もとのタイトルは同じ YouTube の /oembed から取る
//   ・概要欄：表示されているものともとのものが違うときだけ、「元の概要欄」を折りたたみで足す
//   設定 px.antiTr（既定オン）
(() => {
  if (window.__tgAntiTr) return;
  window.__tgAntiTr = true;
  const esc = TG.esc;
  const ITEM_SEL = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model, ytd-reel-item-renderer';
  let on = true;
  const orig = new Map(); // 動画ID → もとのタイトル（取れなかったら ''）
  const queue = [], pending = new Set();
  let busy = 0, mSeq = 0;

  const curVid = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
  const idOf = it => {
    const h = it.querySelector('a[href*="/shorts/"], a[href*="watch?v="]')?.getAttribute('href') || '';
    return (h.match(/\/shorts\/([\w-]{11})/) || h.match(/[?&]v=([\w-]{11})/))?.[1] || null;
  };
  const titleEl = it => it.querySelector('#video-title')
    || it.querySelector('.yt-lockup-metadata-view-model__title .yt-core-attributed-string, .yt-lockup-metadata-view-model__title span');

  // ページ側（mainworld.js）に頼む
  function main(op, args) {
    return new Promise(res => {
      const id = 'at' + ++mSeq;
      const h = e => { let d; try { d = JSON.parse(e.detail); } catch { return; } if (d.id !== id) return; document.removeEventListener('tg-res', h); clearTimeout(t); res(d.result); };
      const t = setTimeout(() => { document.removeEventListener('tg-res', h); res(null); }, 2000);
      document.addEventListener('tg-res', h);
      document.dispatchEvent(new CustomEvent('tg-cmd', { detail: JSON.stringify({ id, op, args }) }));
    });
  }

  function want(v) {
    if (orig.has(v) || pending.has(v)) return;
    pending.add(v);
    queue.push(v);
    pump();
  }
  function pump() {
    while (busy < 4 && queue.length) {
      const v = queue.shift();
      busy++;
      fetch(`/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + v)}&format=json`, { credentials: 'omit' })
        .then(r => (r.ok ? r.json() : null))
        .then(async j => {
          let t = j?.title || '';
          // 埋め込み禁止の動画は oEmbed で取れない。いま見ている動画ならプレイヤーの情報で代用
          if (!t && v === curVid()) t = (await main('tracks'))?.title || '';
          orig.set(v, t);
        })
        .catch(() => orig.set(v, ''))
        .finally(() => { busy--; pending.delete(v); pump(); });
    }
  }

  function setText(el, text) {
    const cur = el.textContent.trim();
    if (!cur || cur === text) return;
    el.dataset.tgTr = cur; // 翻訳されたほう（オフにしたら戻す）
    el.textContent = text;
    if (el.hasAttribute('title')) el.title = text;
  }

  // ---------- 一覧 ----------
  function scanList() {
    let budget = 40;
    for (const it of document.querySelectorAll(ITEM_SEL)) {
      const v = idOf(it);
      if (!v) continue;
      const el = titleEl(it);
      if (!el) continue;
      const o = orig.get(v);
      if (o === undefined) { if (budget-- > 0) want(v); continue; }
      if (o) setText(el, o);
    }
  }

  // ---------- 視聴ページ ----------
  let descFor = null;
  function scanWatch() {
    const v = curVid();
    if (!v) return;
    const o = orig.get(v);
    if (o === undefined) { want(v); return; }
    if (o) {
      const h1 = document.querySelector('ytd-watch-metadata h1 yt-formatted-string, ytd-watch-metadata h1');
      if (h1) setText(h1, o);
      const pre = (document.title.match(/^\(\d+\)\s*/) || [''])[0];
      if (!document.title.startsWith(pre + o)) document.title = `${pre}${o} - YouTube`;
    }
    showDesc(v);
  }
  const norm = s => String(s || '').replace(/\s+/g, '');
  async function showDesc(v) {
    const old = document.querySelector('.tg-origdesc');
    if (old && old.dataset.v !== v) old.remove();
    if (descFor === v) return;
    const box = document.querySelector('ytd-watch-metadata #description-inner, ytd-watch-metadata #description');
    const shown = norm(box?.innerText);
    if (!shown) return; // まだ描かれていない
    descFor = v;
    const m = await main('meta');
    if (!m || m.v !== v) { if (descFor === v) descFor = null; return; } // プレイヤーの情報がまだ(前の動画のまま・読み込み中)のときは、次の回にやり直す(以前は、ここで諦めて、出たり出なかったりしていた)
    if (v !== curVid() || !on) return;
    const d = String(m.desc || '').trim();
    if (norm(d).length < 8 || shown.includes(norm(d).slice(0, 30))) return; // 同じなら何もしない
    document.querySelectorAll('.tg-origdesc').forEach(e => e.remove());
    const el = document.createElement('details');
    el.className = 'tg-origdesc';
    el.dataset.v = v;
    el.innerHTML = `<summary>🌐 元の概要欄（自動翻訳される前）</summary><div>${esc(d)}</div>`;
    (document.querySelector('ytd-watch-metadata #description') || box).after(el);
  }

  function restore() {
    document.querySelectorAll('[data-tg-tr]').forEach(el => { el.textContent = el.dataset.tgTr; if (el.hasAttribute('title')) el.title = el.dataset.tgTr; delete el.dataset.tgTr; });
    document.querySelectorAll('.tg-origdesc').forEach(e => e.remove());
    descFor = null;
  }

  const load = async () => { const { px = {} } = await chrome.storage.local.get('px'); on = px.antiTr !== false; };
  load();
  chrome.storage.onChanged.addListener(ch => {
    if (!ch.px) return;
    const was = on;
    load().then(() => { if (was && !on) restore(); });
  });

  setInterval(() => {
    if (!on || document.hidden || (window.tfQuiet && window.tfQuiet())) return;
    try { scanList(); } catch (e) { /* 一覧で失敗しても、再生画面の分は続ける */ }
    try { scanWatch(); } catch (e) { /* 次の回に */ }
  }, 1000);
})();
