// 🎲 ランダムタグ(再生した動画のタグ)の編集。設定の「整理・通知 → 🎲 ランダムタグ」と、大きい画面(⤢)の両方で、同じものを使う。
//   playedTags: { 小文字のタグ: { t: タグ, n: 見た動画の本数, at: 最後に見た時刻, own: 自分で追加, keep: 📌 消さない, ng: 追加しない, x: 削除済み } }
//     ← storage。Drive同期の対象(sync.js の SYNC_KEYS)。溜まり方は playedtags.js、ランダムの選び方は search.js
//   x(削除済み)のタグは、また見た動画に付いていたら 0 から数え直す。ng(追加しない)は x も付けて、増やさない・ランダムに使わない
//   window.tfTagEditor.mount(要素, { openBig }) で描く。window.tfOpenTagMgr() で大きい画面を開く/閉じる
(() => {
  if (window.tfTagEditor) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const words = s => String(s || '').split(/[,、，\n]/).map(x => x.trim()).filter(x => x.length >= 1 && x.length <= 40);
  const load = async () => (await chrome.storage.local.get('playedTags')).playedTags || {};
  const edit = async fn => { const cur = await load(); fn(cur); await chrome.storage.local.set({ playedTags: cur, tagEditAt: Date.now() }); };

  const DAY = 24 * 3600e3;
  const isNewTag = e => !e.own && (e.first || 0) > Date.now() - DAY; // 🆕 = 24時間以内に、動画を見て初めて入ったタグ
  function html(tags, opts, sort) {
    const byCount = (a, b) => (b[1].own ? 1 : 0) - (a[1].own ? 1 : 0) || (b[1].keep ? 1 : 0) - (a[1].keep ? 1 : 0) || (b[1].n || 0) - (a[1].n || 0) || (b[1].at || 0) - (a[1].at || 0);
    const byNew = (a, b) => (b[1].first || b[1].at || 0) - (a[1].first || a[1].at || 0) || (b[1].at || 0) - (a[1].at || 0); // 新しい順: 初めて入った時刻(なければ最後に見た時刻)
    const rows = Object.entries(tags).filter(([, e]) => !e.x).sort(sort === 'new' ? byNew : byCount);
    const newN = rows.filter(([, e]) => isNewTag(e)).length;
    const ngs = Object.entries(tags).filter(([, e]) => e.ng).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    const keeps = rows.filter(([, e]) => e.keep && !e.own); // 📌 消さないタグ(自分で追加したタグは、もともと消えない)
    const chip = ([k, e]) => `<span class="tf-te-c${e.own ? ' own' : ''}${e.keep ? ' keep' : ''}" data-q="${esc(String(e.t).toLowerCase())}">${isNewTag(e) ? '<i class="tf-te-new" title="24時間以内に、動画を見て増えたタグ">🆕</i>' : ''}<b title="マウスを乗せる / 押すと、Wikipedia で意味を見る">${esc(e.t)}</b>${e.own ? '' : `<small>${e.n || 0}</small>`}${e.own ? '' : `<button data-te="keep" data-k="${esc(k)}" title="${e.keep ? '消さないタグをやめる' : '消さないタグにする(タグが溜まりすぎたときの自動削除や「すべて削除」で消えない)'}">${e.keep ? '📌' : '📍'}</button>`}<button data-te="ng" data-k="${esc(k)}" title="削除して、次回から追加しない">🚫</button><button data-te="del" data-k="${esc(k)}" title="削除(また見た動画に付いていたら増えます)">✕</button></span>`;
    const keepChip = ([k, e]) => `<span class="tf-te-c keep"><b>${esc(e.t)}</b><small>${e.n || 0}</small><button data-te="keep" data-k="${esc(k)}" title="消さないタグをやめる">↩</button></span>`;
    const ngChip = ([k, e]) => `<span class="tf-te-c ng"><b>${esc(e.t)}</b><button data-te="back" data-k="${esc(k)}" title="除外をやめる">↩</button></span>`;
    const none = '<p class="tf-te-note">まだありません</p>';
    return `${opts.openBig ? '<div class="tf-te-top"><button class="tf-te-btn" data-te="big" title="大きい画面で編集する">⤢ 大きい画面で編集</button></div>' : ''}
      <p class="tf-te-note">検索ページの「🎲 ランダムタグ」を押すと、ここからランダムに選んで、キーワードに入れて探します(回数の多いタグほど選ばれやすい)。ボタンの横の「1〜5」で、選ぶタグの数を変えられます(2つ以上は「a | b | c」で、どれかを含む動画をまとめて探します)。動画を30秒以上見ると、その動画のタグが自動で増えます。</p>
      <div class="tf-te-sub">タグを追加</div>
      <div class="tf-te-row"><input class="tf-te-in" data-f="add" placeholder="タグ(カンマ区切りで複数)"><button class="tf-te-btn pri" data-te="add">追加</button></div>
      <div class="tf-te-subrow"><div class="tf-te-sub">今のタグ(${rows.length} 個${newN ? ` ・ 🆕 ${newN}` : ''})</div><span class="tf-te-seg" title="並べ方">${[['count', '回数順'], ['new', '新しい順']].map(([v, l]) => `<button data-te="sort" data-v="${v}" class="${(sort === 'new' ? 'new' : 'count') === v ? 'on' : ''}">${l}</button>`).join('')}</span></div>
      <p class="tf-te-note">タグにマウスを乗せる(押す)と、Wikipedia の説明を出します(外国語は日本語に翻訳)。</p>
      ${rows.length > 12 ? '<div class="tf-te-row"><input class="tf-te-in" data-f="q" type="search" placeholder="タグで絞り込み"></div>' : ''}
      <div class="tf-te-l" data-l="tags">${rows.map(chip).join('') || none}</div>
      ${rows.length ? '<div class="tf-te-row"><button class="tf-te-btn" data-te="clear">自動で溜まったタグをすべて削除</button></div>' : ''}
      <div class="tf-te-sub">📌 消さないタグ(${keeps.length} 個)</div>
      <p class="tf-te-note">タグが溜まりすぎたときの自動削除(古いものから)や「すべて削除」で、消えないタグです。上のタグの「📍」を押すと、ここに入ります(自分で追加したタグは、もともと消えません)。</p>
      <div class="tf-te-l">${keeps.map(keepChip).join('') || none}</div>
      <div class="tf-te-sub">追加しないタグ(${ngs.length} 個)</div>
      <p class="tf-te-note">ここに入れたタグは、動画を見ても自動で増えません(ランダムにも使いません)。上のタグの「🚫」で移せます。</p>
      <div class="tf-te-row"><input class="tf-te-in" data-f="ngadd" placeholder="追加しないタグ(カンマ区切りで複数)"><button class="tf-te-btn" data-te="ngadd">登録</button></div>
      <div class="tf-te-l">${ngs.map(ngChip).join('') || none}</div>`;
  }

  // ---- タグの意味(Wikipedia)を浮かべて出す ----
  //   日本語のタグ → 日本語版 Wikipedia。外国語のタグ → まず日本語版を探し、無ければ英語版の説明を日本語に翻訳。タグ自体の訳も出す
  //   通信は背景(background.js)の xfetch(Wikipedia)・translate(Google 翻訳)を使う。結果はこの画面を開いている間だけ覚えておく
  const xfetch = url => chrome.runtime.sendMessage({ type: 'xfetch', url }).catch(() => null);
  const tr = q => chrome.runtime.sendMessage({ type: 'translate', q, to: 'ja' }).then(r => (r && !r.error ? r : null)).catch(() => null);
  const isJa = s => /[぀-ヿ㐀-鿿]/.test(s);
  const wikiMem = new Map();
  // 検索の上位5件から、関係のあるものだけを使う(見出しが合う / 本文の抜粋にタグがそのまま出てくる)。曖昧さ回避のページは飛ばす。
  //   合うものが無ければ「見つかりませんでした」(関係の薄いページを出さない)
  const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s_・･\-‐]+/g, ' ').replace(/\s*[(（][^)）]*[)）]\s*$/, '').trim();
  async function wikiOf(lang, q) {
    const s = await xfetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=5&srprop=snippet&format=json`);
    const hits = (s && s.query && s.query.search) || [], nq = norm(q), words = nq.split(' ').filter(w => w.length >= 2);
    for (const [i, hit] of hits.entries()) {
      if (/曖昧さ回避|disambiguation/i.test(hit.title)) continue;
      const nt = norm(hit.title), sn = norm(String(hit.snippet || '').replace(/<[^>]+>/g, '').replace(/[_@]/g, ' '));
      const allWords = i === 0 && words.length === 2 && words.every(w => w.length >= 3 && sn.includes(w)); // ローマ字の名前(Goto Hana → 後藤花): 2語のタグで、いちばん上の結果に両方とも出てくる
      if (!(nt === nq || nt.includes(nq) || (nq.includes(nt) && nt.length >= 2) || sn.includes(nq) || allWords)) continue;
      const sum = await xfetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`);
      if (!sum || !sum.extract || sum.type === 'disambiguation') continue;
      return { title: sum.title || hit.title, text: sum.extract, url: (sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page) || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`, img: (sum.thumbnail && sum.thumbnail.source) || '', lang };
    }
    return null;
  }
  function lookup(tag) {
    if (wikiMem.has(tag)) return wikiMem.get(tag);
    const p = (async () => {
      const foreign = !isJa(tag);
      const word = foreign ? await tr(tag) : null; // タグ自体の訳(同じなら出さない)
      const wordJa = word && word.text && word.text.toLowerCase() !== tag.toLowerCase() ? word.text : '';
      let w = await wikiOf('ja', tag);
      if (!w && wordJa && isJa(wordJa)) w = await wikiOf('ja', wordJa); // 訳した言葉で日本語版を探す
      let translated = false;
      if (!w && foreign) { w = await wikiOf('en', tag); if (w) { const t = await tr(w.text.slice(0, 1200)); if (t && t.text) { w.text = t.text; translated = true; } } }
      return { tag, foreign, wordJa, w, translated };
    })();
    wikiMem.set(tag, p); p.catch(() => wikiMem.delete(tag));
    return p;
  }
  let pop = null, hovEl = null, hideT = 0;
  const hideInfo = () => { clearTimeout(hideT); if (pop) pop.remove(); pop = null; hovEl = null; };
  const hideInfoSoon = () => { clearTimeout(hideT); hideT = setTimeout(hideInfo, 350); };
  function place(n) {
    if (!pop || !n.isConnected) return;
    const r = n.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    let top = r.bottom + 6; if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.top = top + 'px'; pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  }
  async function showInfo(n) {
    const tag = n.textContent.trim(); if (!tag) return;
    if (hovEl === n && pop) return;
    hideInfo(); hovEl = n;
    pop = document.createElement('div'); pop.id = 'tf-tagwiki';
    pop.innerHTML = `<div class="tw-h"><b>${esc(tag)}</b></div><p class="tw-m">Wikipedia を調べています…</p>`;
    pop.addEventListener('mouseenter', () => clearTimeout(hideT)); pop.addEventListener('mouseleave', hideInfoSoon);
    ['keydown', 'keyup', 'keypress'].forEach(t => pop.addEventListener(t, e => e.stopPropagation()));
    document.body.appendChild(pop); place(n);
    let r; try { r = await lookup(tag); } catch (e) { r = null; }
    if (hovEl !== n || !pop) return; // もう別のタグへ移った
    const w = r && r.w;
    pop.innerHTML = `<div class="tw-h"><b>${esc(tag)}</b>${r && r.wordJa ? `<span class="tw-tr" title="Google 翻訳">→ ${esc(r.wordJa)}</span>` : ''}</div>`
      + (w ? `<div class="tw-b">${w.img ? `<img src="${esc(w.img)}" alt="" referrerpolicy="no-referrer">` : ''}<div><div class="tw-t">${esc(w.title)}</div><p class="tw-x">${esc(w.text.length > 260 ? w.text.slice(0, 260) + '…' : w.text)}</p></div></div>
          <div class="tw-f"><span>${w.lang === 'ja' ? 'Wikipedia(日本語版)' : w.translated ? 'Wikipedia(英語版を日本語に翻訳)' : 'Wikipedia(英語版)'}</span><a href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">Wikipedia で開く ↗</a></div>`
        : `<p class="tw-m">Wikipedia に見つかりませんでした。</p>`);
    place(n);
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && pop) hideInfo(); }, true);
  document.addEventListener('scroll', () => { if (pop) hideInfo(); }, true);

  // el の中に描く。入力中の文字・カーソルは、描き直しても残す。タグが変わったら(もう一方の画面で変えても)描き直す
  function mount(el, opts = {}) {
    if (el._te) return el._te;
    el.classList.add('tf-te');
    let q = '';
    const filter = () => el.querySelectorAll('[data-l="tags"] .tf-te-c').forEach(c => { c.hidden = !!q && !c.dataset.q.includes(q); });
    const draw = async () => {
      const r = await chrome.storage.local.get(['playedTags', 'px']), tags = r.playedTags || {}, sort = (r.px || {}).tagSort === 'new' ? 'new' : 'count';
      const keep = {}; el.querySelectorAll('[data-f]').forEach(i => { keep[i.dataset.f] = i.value; });
      const act = document.activeElement && el.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.f : null;
      el.innerHTML = html(tags, opts, sort);
      el.querySelectorAll('[data-f]').forEach(i => { if (keep[i.dataset.f]) i.value = keep[i.dataset.f]; });
      if (act) { const i = el.querySelector(`[data-f="${act}"]`); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
      if (!el.querySelector('[data-f="q"]')) q = '';
      filter();
    };
    const val = f => (el.querySelector(`[data-f="${f}"]`) || {}).value;
    const clearIn = f => { const i = el.querySelector(`[data-f="${f}"]`); if (i) i.value = ''; };
    el.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-te]'); if (!b) return;
      const a = b.dataset.te, k = b.dataset.k;
      if (a === 'big') { window.tfOpenTagMgr(); return; }
      if (a === 'sort') { chrome.storage.local.get('px').then(r => chrome.storage.local.set({ px: { ...(r.px || {}), tagSort: b.dataset.v }, prefsAt: Date.now() })); return; } // 並べ方(Drive同期の px)
      if (a === 'add') { const w = words(val('add')); if (!w.length) return; clearIn('add'); edit(cur => w.forEach(t => { const kk = t.toLowerCase(); cur[kk] = { t, n: Math.max(3, (cur[kk] || {}).n || 0), at: Date.now(), own: true }; })); }
      else if (a === 'ngadd') { const w = words(val('ngadd')); if (!w.length) return; clearIn('ngadd'); edit(cur => w.forEach(t => { cur[t.toLowerCase()] = { t, n: 0, at: Date.now(), x: true, ng: true }; })); }
      else if (a === 'del') edit(cur => { if (cur[k]) cur[k] = { ...cur[k], x: true, keep: false, at: Date.now() }; });
      else if (a === 'keep') edit(cur => { if (cur[k]) cur[k] = { ...cur[k], keep: !cur[k].keep }; });
      else if (a === 'ng') edit(cur => { if (cur[k]) cur[k] = { t: cur[k].t, n: cur[k].n || 0, at: Date.now(), x: true, ng: true }; });
      else if (a === 'back') edit(cur => { if (cur[k]) cur[k] = { t: cur[k].t, n: 0, at: Date.now(), x: true }; });
      else if (a === 'clear') { if (confirm('自動で溜まったタグをすべて削除しますか？(自分で追加したタグと、📌 消さないタグは残ります)')) edit(cur => { for (const [kk, v] of Object.entries(cur)) if (!v.own && !v.ng && !v.keep) cur[kk] = { ...v, x: true, at: Date.now() }; }); }
    });
    el.addEventListener('keydown', e => {
      e.stopPropagation(); // YouTube のキー操作(ショートカット)に渡さない
      if (e.key !== 'Enter' || e.isComposing) return;
      const f = e.target.dataset && e.target.dataset.f;
      if (f === 'add' || f === 'ngadd') { e.preventDefault(); const b = el.querySelector(`[data-te="${f}"]`); if (b) b.click(); }
    });
    el.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.f === 'q') { q = e.target.value.trim().toLowerCase(); filter(); } });
    // タグの名前に乗せる(0.5秒)/押すと、Wikipedia の説明を浮かべて出す
    let hovT = 0;
    el.addEventListener('mouseover', e => { const n = e.target.closest && e.target.closest('.tf-te-c > b'); if (!n || n === hovEl) return; clearTimeout(hovT); hovT = setTimeout(() => showInfo(n), 500); });
    el.addEventListener('mouseout', e => { const n = e.target.closest && e.target.closest('.tf-te-c > b'); if (!n || n.contains(e.relatedTarget)) return; clearTimeout(hovT); hideInfoSoon(); });
    el.addEventListener('click', e => { const n = e.target.closest && e.target.closest('.tf-te-c > b'); if (n) { clearTimeout(hovT); showInfo(n); } });
    const onCh = (ch, area) => { if (area === 'local' && (ch.playedTags || ch.px)) { if (!el.isConnected) chrome.storage.onChanged.removeListener(onCh); else if (ch.playedTags || ((ch.px.oldValue || {}).tagSort !== (ch.px.newValue || {}).tagSort)) draw(); } };
    chrome.storage.onChanged.addListener(onCh);
    el._te = { draw };
    draw();
    return el._te;
  }
  window.tfTagEditor = { mount };

  // 大きい画面(画面の真ん中に大きく出す)。もう一度呼ぶと閉じる
  window.tfOpenTagMgr = function () {
    let box = document.getElementById('tf-tgm'); if (box) { box.remove(); hideInfo(); return; }
    box = document.createElement('div'); box.id = 'tf-tgm';
    box.innerHTML = '<div class="h">🎲 ランダムタグ<button data-a="x" title="閉じる">✕</button></div><div class="b"></div>';
    ['keydown', 'keyup', 'keypress'].forEach(t => box.addEventListener(t, e => { if (t === 'keydown' && e.key === 'Escape') box.remove(); e.stopPropagation(); }));
    box.querySelector('[data-a="x"]').addEventListener('click', () => box.remove());
    document.body.appendChild(box);
    mount(box.querySelector('.b'));
  };
})();
