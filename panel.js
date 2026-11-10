// 再生画面の「ツールパネル」: 関連動画の上に、1行のタブでまとめる(旧TubeFolioから移植)
//   ⏩ SponsorBlock(スポンサー等の区間の案内・自動で飛ばす) / 📖 事実確認(Wikipedia) / 🧭 少しズレた関連(3次リンク) /
//   🧨 エコーチェンバー(真逆の意見・関係ないジャンル) / 🏷 タグ(投稿者が設定した検索キーワード・ハッシュタグ)
//   初期は、ぜんぶたたむ。押したタブだけ開く。設定は settings.watch(sbSkip)。
(() => {
  if (window.__tfPanel) return;
  window.__tfPanel = true;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const vid = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
  const player = () => document.querySelector('#movie_player');
  const video = () => { const p = player(); return p && p.querySelector('video'); };
  const adShowing = () => !!document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const bg = msg => new Promise(res => { try { chrome.runtime.sendMessage(msg, r => res(chrome.runtime.lastError ? null : r)); } catch (e) { res(null); } });
  const xfetch = (url, st) => bg({ type: 'xfetch', url, as: 'json', st });
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const okVid = x => x && x.id && !x.live && !(x.len && /^0:[0-5]\d$/.test(x.len));

  let sbSkip = true;
  const loadS = () => TF.get().then(s => { sbSkip = (s.settings.watch || {}).sbSkip !== false; });
  chrome.storage.onChanged.addListener(ch => { if (ch.settings) loadS(); });
  loadS();

  // ---------- YouTubeのページ側に頼む(概要欄・タグ・カテゴリ) ----------
  let mSeq = 0;
  function info() {
    return new Promise(res => {
      const id = 'p' + (++mSeq);
      const on = e => { let d; try { d = JSON.parse(e.detail); } catch (err) { return; } if (d.id !== id) return; document.removeEventListener('tf-res', on); clearTimeout(t); res(d.result); };
      const t = setTimeout(() => { document.removeEventListener('tf-res', on); res(null); }, 2500);
      document.addEventListener('tf-res', on);
      document.dispatchEvent(new CustomEvent('tf-cmd', { detail: JSON.stringify({ id, op: 'info', args: {} }) }));
    });
  }
  async function meta(v) { for (let i = 0; i < 8 && vid() === v; i++) { const m = await info(); if (m && m.v === v) return m; await sleep(700); } return null; }
  const titleNow = () => ((document.querySelector('ytd-watch-metadata h1') || {}).textContent || '').trim();

  // ---------- 状態 ----------
  let st = { v: null };
  const fresh = v => ({ v, open: '', sb: { state: 'loading', segs: [] }, tabs: {}, ignore: new Set() });
  function sideHost() {
    const vis = el => el && el.getClientRects().length > 0;
    const rel = document.querySelector('ytd-watch-flexy:not([hidden]) #related');
    if (vis(rel)) return rel;
    const inner = document.querySelector('ytd-watch-flexy:not([hidden]) #secondary-inner');
    if (vis(inner)) return inner;
    const below = document.querySelector('ytd-watch-flexy:not([hidden]) #below');
    return vis(below) ? below : null;
  }

  // ================= ⏩ SponsorBlock =================
  const SB_ALL = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'filler', 'music_offtopic', 'poi_highlight'];
  const SB_NAME = { sponsor: 'スポンサー', selfpromo: '宣伝', interaction: '登録のお願い', intro: 'オープニング', outro: 'エンディング', preview: '予告・ダイジェスト', filler: '雑談・脱線', music_offtopic: '音楽以外の部分', poi_highlight: 'ハイライト' };
  const SB_COLOR = { sponsor: '#00d400', selfpromo: '#e6c800', interaction: '#cc00ff', intro: '#00b8d4', outro: '#3a3aed', preview: '#008fd6', filler: '#7300ff', music_offtopic: '#ff9900', poi_highlight: '#ff1684' };
  const SB_SKIP = new Set(['sponsor', 'selfpromo', 'interaction', 'intro']); // 自動で飛ばす種類
  const sha256hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join('');
  async function sbLoad(v) {
    const q = `categories=${encodeURIComponent(JSON.stringify(SB_ALL))}&actionTypes=${encodeURIComponent(JSON.stringify(['skip', 'poi']))}`;
    let raw = null, hashed = true;
    try { raw = await xfetch(`https://sponsor.ajay.app/api/skipSegments/${(await sha256hex(v)).slice(0, 4)}?${q}`, true); } catch (e) { raw = null; } // 動画IDそのものは送らず、ハッシュの先頭4文字で照会
    if (st.v !== v) return;
    let arr = null;
    if (Array.isArray(raw)) arr = ((raw.find(x => x.videoID === v) || {}).segments) || [];
    else if (raw && raw._http === 404) arr = [];
    const segs = (arr || []).map(x => ({ s: x.segment[0], e: x.segment[1], c: x.category, poi: x.actionType === 'poi' })).filter(x => x.poi || x.e - x.s >= 0.5).sort((a, b) => a.s - b.s);
    st.sb = { state: segs.length ? 'found' : arr ? 'none' : 'error', segs };
    paint();
  }
  const flash = text => {
    const p = player(); if (!p) return;
    let d = p.querySelector('.tf-wflash');
    if (!d) { d = document.createElement('div'); d.className = 'tf-wflash'; p.appendChild(d); }
    d.textContent = text; d.classList.remove('on'); void d.offsetWidth; d.classList.add('on');
  };
  function sbTick() {
    const v = video();
    if (!v || !sbSkip || st.sb.state !== 'found' || adShowing() || v.paused) return;
    const t = v.currentTime;
    st.sb.segs.forEach((g, i) => {
      if (g.poi || !SB_SKIP.has(g.c) || st.ignore.has(i) || !(t >= g.s && t < g.e - 0.2)) return;
      v.currentTime = Math.min(g.e, (v.duration || g.e) - 0.1);
      flash(`⏩ ${SB_NAME[g.c] || g.c}を飛ばしました(${Math.round(g.e - g.s)}秒)`);
    });
  }
  function sbPane() {
    const { state, segs } = st.sb;
    if (state === 'loading') return '<p class="m">確認中…</p>';
    if (state === 'error') return '<p class="m">SponsorBlockのサーバーに接続できず、確認できませんでした。</p>';
    if (state === 'none') return '<p class="m">この動画には登録がありません(飛ばす区間なし)。日本語の動画は、登録が少なめです。</p>';
    const tot = Math.round(segs.filter(g => !g.poi && SB_SKIP.has(g.c)).reduce((a, g) => a + (g.e - g.s), 0));
    return `<label class="sw"><input type="checkbox" id="tfp-skip"${sbSkip ? ' checked' : ''}> スポンサー・宣伝・登録のお願い・オープニングを、自動で飛ばす${tot ? `(合計 ${tot}秒)` : ''}</label>
      <div class="ls">${segs.map(g => `<button class="it" data-s="${g.s}"><i style="background:${SB_COLOR[g.c] || '#0a0'}"></i><b>${mmss(g.s)}${g.poi ? '' : '〜' + mmss(g.e)}</b><span>${esc(SB_NAME[g.c] || g.c)}</span></button>`).join('')}</div>
      <p class="m">区間のデータは、有志が登録した SponsorBlock(sponsor.ajay.app)のものです。</p>`;
  }

  // ================= 📖 事実確認(Wikipedia) =================
  function wikiTerms(title, kw) {
    const out = [];
    const add = t => { t = String(t || '').replace(/[#＃【】「」『』\[\]()（）]/g, '').trim(); if (t.length >= 2 && t.length <= 30 && !out.includes(t)) out.push(t); };
    for (const m of String(title).matchAll(/[【「『]([^】」』]{2,30})[】」』]/g)) add(m[1]);
    (kw || []).slice(0, 6).forEach(add);
    for (const m of String(title).matchAll(/[゠-ヿー]{3,}|[一-鿿]{2,}[゠-ヿ一-鿿]*/g)) add(m[0]);
    return out.slice(0, 8);
  }
  async function wikiLoad(v) {
    const m = await meta(v); if (st.v !== v) return;
    const terms = wikiTerms(titleNow() || (m && m.title) || '', m && m.kw), pages = [];
    for (const t of terms) {
      if (pages.length >= 3 || st.v !== v) break;
      const s = await xfetch(`https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(t)}&srlimit=1&format=json&origin=*`);
      const hit = s && s.query && s.query.search && s.query.search[0] && s.query.search[0].title;
      if (!hit || pages.some(p => p.title === hit)) continue;
      const sum = await xfetch(`https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.replace(/ /g, '_'))}`);
      if (!sum || !sum.extract || sum.type === 'disambiguation') continue;
      pages.push({ title: sum.title || hit, text: sum.extract, url: (sum.content_urls && sum.content_urls.desktop && sum.content_urls.desktop.page) || `https://ja.wikipedia.org/wiki/${encodeURIComponent(hit)}`, img: (sum.thumbnail && sum.thumbnail.source) || '' });
    }
    if (st.v !== v) return;
    st.tabs.wiki = { done: true, html: pages.length ? pages.map(p => `<a class="wk" href="${esc(p.url)}" target="_blank" rel="noopener">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy">` : ''}<div><b>${esc(p.title)}</b><p>${esc(p.text)}</p></div></a>`).join('') + '<p class="m">出典: Wikipedia</p>' : '<p class="m">タイトル・タグから、Wikipediaの項目を見つけられませんでした。</p>' };
    paint();
  }

  // ================= 🧭 少しズレた関連 / 🧨 エコーチェンバー =================
  const related = async v => { const r = await bg({ type: 'related', videoId: v }); return ((r && r.items) || []).filter(okVid); };
  async function nthRelated(v) {
    const L1 = await related(v), seen = new Set([v, ...L1.map(x => x.id)]), lv2 = [];
    for (const s of shuffle(L1.slice(0, 15)).slice(0, 3)) { try { const r = (await related(s.id)).filter(x => !seen.has(x.id)); r.forEach(x => seen.add(x.id)); lv2.push(...shuffle(r).slice(0, 2)); } catch (e) { /* 飛ばす */ } }
    const out = [], chs = new Set();
    for (const s of shuffle(lv2).slice(0, 3)) {
      try {
        const r = shuffle((await related(s.id)).filter(x => !seen.has(x.id)));
        let n = 0;
        for (const x of r) { if (out.length >= 9 || n >= 3) break; if (chs.has(x.ch)) continue; seen.add(x.id); chs.add(x.ch); out.push(x); n++; }
      } catch (e) { /* 飛ばす */ }
    }
    return out;
  }
  const cardsOf = list => list.length ? `<div class="gl">${list.map(x => `<a class="vc" href="/watch?v=${esc(x.id)}"><span class="th"><img src="https://i.ytimg.com/vi/${esc(x.id)}/mqdefault.jpg" alt="" loading="lazy">${x.len ? `<i>${esc(x.len)}</i>` : ''}</span><span class="tx"><b>${esc(x.title)}</b><small>${esc(x.ch)}</small>${x.kind ? `<em class="${x.kind === '真逆の意見' ? 'op' : 'far'}">${esc(x.kind)}: ${esc(x.q)}</em>` : ''}</span></a>`).join('')}</div>` : '<p class="m">見つかりませんでした。↻ で探し直せます。</p>';
  async function nthLoad(v) {
    st.tabs.nth = { busy: true }; paint();
    let list = []; try { list = await nthRelated(v); } catch (e) { /* なし */ }
    if (st.v !== v) return;
    st.tabs.nth = { done: true, html: '<div class="bar"><span>関連の関連の関連(3次リンク)</span><button data-re="nth" title="別の脱線先を探す">↻</button></div>' + cardsOf(list) }; paint();
  }
  const GENRES = ['深海生物', '伝統工芸 職人', '天文学 入門', '民族音楽', '盆栽', '鉄道 車窓', '古代文明', '数学 解説', '昆虫 観察', '建築 解説', '自然音 森', 'チェス 解説', '詩 朗読', '手話', '養蜂', '世界の朝ごはん', '気象 解説', '登山 記録', '書道', '鉱物 標本', '世界の市場', 'ジャズ 歴史', '落語', '宇宙 ドキュメンタリー'];
  const POS = /レビュー|review|おすすめ|オススメ|最高|神|買って良かった|best|recommend|愛用|絶賛|名作|最強/i;
  async function echoLoad(v) {
    st.tabs.echo = { busy: true }; paint();
    const m = (await meta(v)) || {}, title = titleNow();
    const kw = (m.kw || []).filter(k => k.length >= 2 && k.length <= 20);
    const word = kw[0] || title.replace(/【[^】]*】|\[[^\]]*\]|「|」|[#＃]\S+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' ').slice(0, 20);
    const opp = POS.test(title + ' ' + (m.kw || []).join(' ')) ? ['最悪', '買って後悔', 'デメリット'] : ['反論', '批判', '逆の意見'];
    const cat = (m.category || '').toLowerCase();
    const far = shuffle(GENRES.filter(g => !title.includes(g.split(' ')[0]) && !cat.includes(g))).slice(0, word ? 2 : 4);
    const groups = [...(word ? opp.map(o => ({ q: `${word} ${o}`, kind: '真逆の意見', n: 2 })) : []), ...far.map(g => ({ q: g, kind: '無関係なジャンル', n: 2 }))];
    const out = [], seen = new Set([v]), chs = new Set();
    for (const g of groups) {
      try {
        const r = await bg({ type: 'ytSearch', q: g.q, kind: 'v' });
        let n = 0;
        for (const x of ((r && r.items) || [])) { if (n >= g.n) break; if (!okVid(x) || x.live || seen.has(x.id) || chs.has(x.ch)) continue; seen.add(x.id); chs.add(x.ch); out.push({ id: x.id, title: x.title, ch: x.ch, len: x.len, kind: g.kind, q: g.q }); n++; }
      } catch (e) { /* 飛ばす */ }
    }
    if (st.v !== v) return;
    st.tabs.echo = { done: true, html: `<div class="bar"><span>「${esc(word)}」の真逆の意見 ＋ 関係ないジャンル</span><button data-re="echo" title="別の組み合わせで探す">↻</button></div>` + cardsOf(out) }; paint();
  }

  // ================= 🏷 タグ =================
  function hashtags(text) {
    const out = [], t = String(text).replace(/https?:\/\/\S+/g, ' ');
    for (const m of t.matchAll(/[#＃]([^\s#＃、。，,.!！?？「」『』（）()【】\[\]<>"'`/\\|]+)/gu)) { const h = m[1].replace(/[・ー~〜]+$/u, ''); if (h && !/^\d+$/.test(h) && !out.includes(h)) out.push(h); if (out.length >= 30) break; }
    return out;
  }
  // ---- タグ・タイトルから、このチャンネルを入れるフォルダの候補(フォルダのキーワード=設定。未設定ならフォルダ名から自動) ----
  const ownerA = () => document.querySelector('ytd-watch-metadata ytd-video-owner-renderer a[href^="/@"], ytd-watch-metadata ytd-video-owner-renderer a[href^="/channel/"], #owner a[href^="/@"], #owner a[href^="/channel/"]');
  const chKey = () => { const a = ownerA(); return a ? TF.keyFromHref(a.getAttribute('href')) : null; };
  const chName = () => { const a = document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a'); return a ? a.textContent.trim() : ''; };
  const chAvatar = () => { const i = document.querySelector('ytd-watch-metadata ytd-video-owner-renderer img, #owner img'); return i ? i.src : ''; };
  async function suggest(words) {
    const S = await TF.get(), key = chKey(); if (!key) return '';
    const cur = new Set(((S.channels[key] || {}).groups) || []);
    const text = (words.join(' ') + ' ' + titleNow() + ' ' + chName()).toLowerCase();
    const scored = S.groups.map(g => {
      const { inc, exc } = TF.groupKw(g);
      if (exc.some(w => text.includes(w.toLowerCase()))) return null;
      const hits = [...new Set([g.name, ...inc])].filter(w => w && w.length >= 2 && text.includes(w.toLowerCase()));
      return hits.length ? { g, hits } : null;
    }).filter(Boolean).sort((a, b) => b.hits.length - a.hits.length).slice(0, 4);
    if (!scored.length) return '<div class="sg"><span>🪄 タグから見たフォルダの候補は、ありません。(フォルダのキーワードは、管理画面のフォルダの編集で設定できます)</span></div>';
    return '<div class="sg"><span>🪄 タグから見たフォルダの候補:</span>' + scored.map(({ g, hits }) => cur.has(g.id)
      ? `<span class="chip in" title="一致: ${esc(hits.join('・'))}">✓ ${esc(g.name)}(登録済み)</span>`
      : `<button class="chip" data-gid="${esc(g.id)}" title="一致: ${esc(hits.join('・'))}">＋ ${esc(g.name)} に入れる<small>${esc(hits.slice(0, 3).join('・'))}</small></button>`).join('') + '</div>';
  }
  async function addToGroup(gid) {
    const key = chKey(); if (!key) return flash('チャンネルを特定できませんでした');
    const name = chName(), avatar = chAvatar();
    await TF.mutate(s => {
      const c = s.channels[key] || (s.channels[key] = { key, name, avatar, groups: [], addedAt: Date.now() });
      if (!c.groups.includes(gid)) c.groups.push(gid);
    });
    const g = (await TF.get()).groups.find(x => x.id === gid);
    flash(`「${name}」を、${g ? g.name : 'フォルダ'} に入れました`);
    tagsLoad(st.v);
  }
  async function tagsLoad(v) {
    const m = await meta(v); if (st.v !== v) return;
    const kw = (m && m.kw) || [], hs = hashtags((m && m.desc) || '');
    const sg = await suggest([...kw, ...hs]); if (st.v !== v) return;
    const { playedTags = {} } = await chrome.storage.local.get('playedTags'), mine = Object.values(playedTags).filter(e => e.pin && !e.ng).sort((a, b) => (b.n || 0) - (a.n || 0));
    const my = mine.length ? `<div class="bar"><span>★ あなたが表示にしたタグ(${mine.length}個・押すと検索)</span></div><div class="tg mine">${mine.map(e => `<a href="/results?search_query=${encodeURIComponent(e.t)}">${esc(e.t)}</a>`).join('')}</div>` : '';
    st.tabs.tags = { done: true, n: kw.length + hs.length, html: sg + my + (kw.length ? `<div class="bar"><span>投稿者が設定した検索キーワード(${kw.length}個・押すと検索)</span></div><div class="tg">${kw.map(k => `<a href="/results?search_query=${encodeURIComponent(k)}">${esc(k)}</a>`).join('')}</div>` : '') + (hs.length ? `<div class="bar"><span>概要欄のハッシュタグ(${hs.length}個)</span></div><div class="tg">${hs.map(h => `<a href="/hashtag/${encodeURIComponent(h)}">#${esc(h)}</a>`).join('')}</div>` : '') || '<p class="m">タグはありません。</p>' };
    paint();
  }

  // ---------- タブの表示 ----------
  const TABS = [['sb', '⏩ SponsorBlock'], ['wiki', '📖 事実確認'], ['nth', '🧭 ズレた関連'], ['echo', '🧨 エコーチェンバー'], ['tags', '🏷 タグ']];
  const loaders = { wiki: wikiLoad, nth: nthLoad, echo: echoLoad, tags: tagsLoad };
  function label(k, l) {
    if (k === 'sb') { const s = st.sb; return l + (s.state === 'found' ? ` ✓${s.segs.length}` : s.state === 'none' ? '(なし)' : s.state === 'error' ? '(?)' : ''); }
    if (k === 'tags' && st.tabs.tags && st.tabs.tags.n != null) return l + ` ${st.tabs.tags.n}`;
    return l;
  }
  function paint() {
    const host = sideHost(); let box = document.getElementById('tf-wp');
    if (!st.v || !host) { if (box && !st.v) box.remove(); return; }
    if (!box) {
      box = document.createElement('div'); box.id = 'tf-wp';
      box.innerHTML = '<div class="bar"></div><div class="body"></div>';
      ['keydown', 'keyup'].forEach(t => box.addEventListener(t, e => e.stopPropagation()));
      box.addEventListener('click', e => {
        const b = e.target.closest('.tab');
        if (b) { st.open = st.open === b.dataset.k ? '' : b.dataset.k; const k = st.open; if (k && loaders[k] && !st.tabs[k]) loaders[k](st.v); paint(); return; }
        const ad = e.target.closest('[data-gid]'); if (ad) { e.preventDefault(); addToGroup(ad.dataset.gid); return; }
        const re = e.target.closest('[data-re]'); if (re) { e.preventDefault(); loaders[re.dataset.re](st.v); return; }
        const it = e.target.closest('.it[data-s]'); if (it) { const v = video(); if (v) { v.currentTime = +it.dataset.s; v.play && v.play(); } }
      });
      box.addEventListener('change', e => { if (e.target.id === 'tfp-skip') TF.mutate(s => { s.settings.watch = { ...(s.settings.watch || {}), sbSkip: e.target.checked }; }); });
    }
    if (host.firstElementChild !== box) host.prepend(box);
    box.dataset.v = st.v;
    box.querySelector('.bar').innerHTML = TABS.map(([k, l]) => `<button class="tab${st.open === k ? ' on' : ''}${k === 'sb' ? ' sb-' + st.sb.state : ''}" data-k="${k}">${esc(label(k, l))}</button>`).join('');
    const body = box.querySelector('.body'), k = st.open;
    if (!k) { body.hidden = true; body.innerHTML = ''; return; }
    body.hidden = false;
    const t = st.tabs[k];
    const html = k === 'sb' ? sbPane() : !t ? '<p class="m">読み込み中…</p>' : t.busy ? '<p class="m">探しています…(数秒かかります)</p>' : t.html;
    if (body.dataset.sig !== k + '|' + html.length + '|' + sbSkip) { body.dataset.sig = k + '|' + html.length + '|' + sbSkip; body.innerHTML = html; }
  }
  function tick() {
    const v = vid();
    if (!v) { if (st.v) { st = { v: null }; const b = document.getElementById('tf-wp'); if (b) b.remove(); } return; }
    if (v !== st.v) { st = fresh(v); const b = document.getElementById('tf-wp'); if (b) b.remove(); sbLoad(v); tagsLoad(v); }
    paint();
  }
  setInterval(tick, 800);
  setInterval(sbTick, 150);
})();
