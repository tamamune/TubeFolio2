const openMgr = () => chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
// 拡張機能のボタン(桜)を押す = 拡張機能を再読み込み(vivaldi://extensions のリロードと同じ)→ 開いているYouTubeと管理画面も読み込み直す。管理画面は開かない(右クリックのメニューから開ける)
const reloadExtension = async () => { await chrome.storage.local.set({ tfReloadYt: Date.now() }); chrome.runtime.reload(); };
chrome.action.onClicked.addListener(reloadExtension);

// ---- 拡張機能のボタン(桜)を右クリック: 拡張機能の更新 / YouTubeの読み込み直し ----
// 「更新」= コピー先フォルダ(deploy-ext.cmd で反映した内容)を読み直す。開いているYouTubeは古いスクリプトのままになるので、続けて読み込み直す。
const reloadYt = async () => { const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' }); tabs.forEach(t => chrome.tabs.reload(t.id)); return tabs.length; };
// YouTubeのタブと、開いている管理画面(拡張機能のページ)をまとめて読み込み直す
const reloadAllTabs = async () => { const base = chrome.runtime.getURL(''); const tabs = await chrome.tabs.query({ url: ['https://www.youtube.com/*', base + '*'] }); tabs.forEach(t => chrome.tabs.reload(t.id)); return tabs.length; };
const MENUS = [['tf-reload-all', '🔄 拡張機能を更新して、YouTubeと管理画面も読み込み直す(左クリックと同じ)'], ['tf-reload-yt', '↻ YouTubeのタブだけ読み込み直す'], ['tf-open', '❖ 管理画面を開く']];
const makeMenus = () => chrome.contextMenus && chrome.contextMenus.removeAll(() => MENUS.forEach(([id, title]) => chrome.contextMenus.create({ id, title, contexts: ['action'] })));
chrome.runtime.onInstalled.addListener(makeMenus);
chrome.runtime.onStartup.addListener(makeMenus);
if (chrome.contextMenus) chrome.contextMenus.onClicked.addListener(async info => { // 権限が無い(拡張機能を再読み込みしていない)場合でも、他の機能が止まらないようにする
  if (info.menuItemId === 'tf-reload-all') reloadExtension();
  else if (info.menuItemId === 'tf-reload-yt') reloadYt();
  else if (info.menuItemId === 'tf-open') openMgr();
});
// 拡張機能の再読み込み直後に起動したとき、印があれば YouTube を読み込み直す(2分以内のものだけ)
chrome.storage.local.get('tfReloadYt').then(async r => { if (!r.tfReloadYt) return; await chrome.storage.local.remove('tfReloadYt'); if (Date.now() - r.tfReloadYt < 120000) reloadAllTabs(); });

// ---- チャンネル情報(アバター / 最新動画)取得 ----
let active = 0; const waiters = [];
async function limit(fn) {
  if (active >= 4) await new Promise(r => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; const w = waiters.shift(); if (w) w(); }
}
let metaQ = Promise.resolve();
const saveMeta = (key, patch) => (metaQ = metaQ.then(async () => {
  const { meta = {} } = await chrome.storage.local.get('meta');
  meta[key] = { ...meta[key], ...patch };
  await chrome.storage.local.set({ meta });
}).catch(() => {}));
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');

async function resolve(key) {
  const { meta = {} } = await chrome.storage.local.get('meta');
  const m = { ...(meta[key] || {}) };
  if (key.startsWith('UC')) m.id = key;
  if (m.id && m.avatar) return m;
  const url = key.startsWith('UC') ? `https://www.youtube.com/channel/${key}` : `https://www.youtube.com/@${encodeURIComponent(key.slice(1))}`;
  const html = await (await fetch(url, { credentials: 'omit' })).text();
  const id = (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})/) ||
    html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/"channelId":"(UC[\w-]{22})"/) || [])[1];
  const img = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1];
  const title = (html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1];
  if (id) m.id = id;
  if (img) m.avatar = img.replace(/=s\d+.*$/, '=s96-c-k-c0x00ffffff-no-rj');
  if (title) m.name = unxml(title);
  await saveMeta(key, m);
  return m;
}

const vcache = new Map();
// YouTube内部API(動画タブ)から先頭の動画を取得。RSSが使えなくなっているため、これを最優先にする
// 「8 日前」「2 週間前」などの表示から、おおよその投稿日時(ISO)を作る(RSSの代わりなので、日単位の目安)
const approxDate = t => { const m = /(\d+)\s*(秒|分|時間|日|週間|か月|ヶ月|年)/.exec(t || ''); if (!m) return null; const u = { '秒': 1e3, '分': 6e4, '時間': 36e5, '日': 864e5, '週間': 6048e5, 'か月': 2592e6, 'ヶ月': 2592e6, '年': 31536e6 }[m[2]]; return new Date(Date.now() - (+m[1]) * u).toISOString(); };
async function videosFromApi(id, tab = 'v') {
  const TABP = { v: 'EgZ2aWRlb3PyBgQKAjoA', s: 'EgZzaG9ydHPyBgUKA5oBAA==', l: 'EgdzdHJlYW1z8gYECgJ6AA==' }; // 動画 / ショート / ライブ配信 のタブ
  const r = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { client: { clientName: 'MWEB', clientVersion: '2.20260101.00.00', hl: 'ja', gl: 'JP' } }, browseId: id, params: TABP[tab] || TABP.v }) }); // MWEB(モバイル版)は、WEBより応答が小さく速い
  if (!r.ok) throw new Error('API ' + r.status);
  const j = await r.json(), out = [];
  const texts = x => { const t = []; (function w(o) { if (!o || typeof o !== 'object') return; if (typeof o.content === 'string') t.push(o.content); Object.values(o).forEach(w); })(x); return t; };
  (function walk(o) {
    if (!o || typeof o !== 'object' || out.length >= 15) return;
    if (o.contentId && o.metadata && o.metadata.lockupMetadataViewModel) {
      const m = o.metadata.lockupMetadataViewModel;
      out.push({ id: o.contentId, title: (m.title && m.title.content) || '', published: null, pubText: texts(m.metadata).find(s => /前|ago/i.test(s)) || '' }); out[out.length - 1].published = approxDate(out[out.length - 1].pubText) || new Date(0).toISOString(); return;
    }
    if (o.shortsLockupViewModel) { // ショートは投稿日が無い(再生回数だけ)。日付は shortDate() で別に調べる
      const q = o.shortsLockupViewModel, vid = q.onTap && q.onTap.innertubeCommand && q.onTap.innertubeCommand.reelWatchEndpoint && q.onTap.innertubeCommand.reelWatchEndpoint.videoId;
      if (vid) out.push({ id: vid, short: true, title: (q.overlayMetadata && q.overlayMetadata.primaryText && q.overlayMetadata.primaryText.content) || (q.accessibilityText || '').replace(/,.*$/, ''), published: null, pubText: (q.overlayMetadata && q.overlayMetadata.secondaryText && q.overlayMetadata.secondaryText.content) || '' });
      return;
    }
    if (o.videoWithContextRenderer && o.videoWithContextRenderer.videoId) {
      const v = o.videoWithContextRenderer, pt = v.publishedTimeText && (v.publishedTimeText.simpleText || (v.publishedTimeText.runs || []).map(x => x.text).join(''));
      // 配信中の動画は、投稿日の表示が無く、サムネの印(style: LIVE)と「N 人が視聴中」の表示がある。いま配信中として、日付はいまにする
      const live = /"style":"LIVE"|LIVE_NOW|"isLive":true/.test(JSON.stringify(v));
      const vt = v.viewCountText && (v.viewCountText.simpleText || (v.viewCountText.runs || []).map(x => x.text).join('')) || '';
      out.push({ id: v.videoId, title: (v.headline && v.headline.runs && v.headline.runs.map(x => x.text).join('')) || '', published: live ? new Date().toISOString() : (approxDate(pt) || (tab === 'l' && pt ? new Date().toISOString() : new Date(0).toISOString())), pubText: live ? vt : (pt || ''), live }); return;
    }
    if (o.videoRenderer && o.videoRenderer.videoId) {
      const v = o.videoRenderer;
      out.push({ id: v.videoId, title: (v.title && v.title.runs && v.title.runs.map(x => x.text).join('')) || '', published: null, pubText: (v.publishedTimeText && v.publishedTimeText.simpleText) || '' }); out[out.length - 1].published = approxDate(out[out.length - 1].pubText) || new Date(0).toISOString(); return;
    }
    Object.values(o).forEach(walk);
  })(j);
  return out;
}
// RSSが使えないとき(多数のチャンネルを集計した直後などに制限されることがある)の代わり: 動画タブの先頭2件 + oEmbed(題名) + 視聴ページ(投稿日)
async function videosFromPage(id) {
  const h = await (await fetch(`https://www.youtube.com/channel/${id}/videos`, { credentials: 'omit' })).text();
  const s = h.indexOf('"selected":true'), body = s >= 0 ? h.slice(s, s + 120000) : h;
  const ids = []; const re = /(?:"contentId":"|ytimg\.com\/vi(?:_webp)?\/)([\w-]{11})/g; let m;
  while ((m = re.exec(body)) && ids.length < 4) if (!ids.includes(m[1])) ids.push(m[1]);
  return Promise.all(ids.map(async vid => {
    let title = '', published = null;
    try { title = (await (await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${vid}&format=json`, { credentials: 'omit' })).json()).title || ''; } catch (e) {}
    try { const t = await pubDate(vid, new Map()); if (t) published = new Date(t).toISOString(); } catch (e) {}
    return { id: vid, title, published: published || new Date(0).toISOString() };
  }));
}
async function videos(id) {
  const c = vcache.get(id);
  if (c && Date.now() - c.t < 20 * 60 * 1000) return c.v;
  try { const v = await videosFromApi(id); if (v.length) { vcache.set(id, { t: Date.now(), v }); return v; } } catch (e) {}
  let xml = '';
  try { const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { credentials: 'omit' }); if (r.ok) xml = await r.text(); } catch (e) {}
  if (!xml.includes('<entry>')) { const v = await videosFromPage(id); if (v.length) vcache.set(id, { t: Date.now(), v }); return v; }
  const v = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(e => ({
    id: (e[1].match(/<yt:videoId>([^<]+)/) || [])[1],
    title: unxml((e[1].match(/<title>([^<]*)/) || [])[1] || ''),
    published: (e[1].match(/<published>([^<]+)/) || [])[1],
    short: /<link rel="alternate" href="[^"]*\/shorts\//.test(e[1])
  })).filter(x => x.id).sort((a, b) => b.published.localeCompare(a.published));
  vcache.set(id, { t: Date.now(), v });
  return v;
}

async function info(key, wantVideos, n) {
  const m = await resolve(key);
  const out = { id: m.id, avatar: m.avatar, name: m.name };
  if (wantVideos && m.id) out.videos = (await videos(m.id)).slice(0, Math.max(1, Math.min(4, +n || 2)));
  return out;
}

// ---- 投稿の新しさ集計(動画 / ショート / ライブ) ----
// 各タブの先頭動画を取得し、投稿日はRSS(最新15件)→無ければ視聴ページから得る
async function latestId(base, tab) {
  const h = await (await fetch(`${base}/${tab}`, { credentials: 'omit' })).text();
  const re = new RegExp('"url":"\\/(?:@[^"\\/]+|channel\\/UC[\\w-]+)\\/' + tab + '"', 'g');
  let u;
  while ((u = re.exec(h))) {
    const s = h.indexOf('"selected":true', u.index);
    if (s < 0 || s - u.index > 1500 || h.slice(u.index, s).includes('"tabRenderer"')) continue;
    const v = h.slice(s, s + 80000).match(/(?:"contentId":"|ytimg\.com\/vi(?:_webp)?\/)([\w-]{11})/);
    return v ? v[1] : null;
  }
  return null; // タブなし or 投稿なし
}
async function pubDate(id, rss) {
  if (rss.has(id)) return rss.get(id);
  return shortDate(id); // 視聴ページのHTMLは、取りすぎるとYouTubeの確認画面(google.com/sorry)に飛ばされ、エラーが大量に出る。軽い player API で投稿日を取る
}
async function scan(key) {
  const m = await resolve(key);
  const base = key.startsWith('UC') ? `https://www.youtube.com/channel/${key}` : `https://www.youtube.com/@${encodeURIComponent(key.slice(1))}`;
  const rss = new Map();
  if (m.id) {
    try {
      const xml = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${m.id}`, { credentials: 'omit' })).text();
      [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].forEach(e => {
        const id = (e[1].match(/<yt:videoId>([^<]+)/) || [])[1], p = (e[1].match(/<published>([^<]+)/) || [])[1];
        if (id && p) rss.set(id, Date.parse(p));
      });
    } catch (e) {}
  }
  const out = { t: Date.now() };
  for (const [f, tab] of [['v', 'videos'], ['s', 'shorts'], ['l', 'streams']]) {
    const id = await latestId(base, tab);
    out[f] = id ? await pubDate(id, rss) : 0; // 0 = 投稿なし
  }
  return out;
}

// ---- 登録チャンネル取り込み(バックグラウンド実行・タブを開かない) ----
importScripts('store.js', 'drive-config.js', 'sync.js');

// 一度だけ: 既定の⭐のままのフォルダに、名前に合うアイコンを自動設定(既存データがある場合のみ)
chrome.storage.local.get(['groups', 'settings']).then(async raw => {
  if (!raw.groups || (raw.settings || {}).iconAuto) return;
  await TF.autoIcons();
  await TF.mutate(s => { s.settings.iconAuto = true; });
}).catch(() => {});
const ORIGIN = 'https://www.youtube.com';
async function authHeaders() {
  const c = await chrome.cookies.get({ url: ORIGIN, name: 'SAPISID' }) || await chrome.cookies.get({ url: ORIGIN, name: '__Secure-3PAPISID' });
  if (!c) return {};
  const ts = Math.floor(Date.now() / 1000);
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${c.value} ${ORIGIN}`));
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return { Authorization: `SAPISIDHASH ${ts}_${hex}`, 'X-Origin': ORIGIN, 'X-Goog-AuthUser': '0' };
}
// 拡張からのfetchは Origin が chrome-extension:// になり 403 になるため、YouTubeのOriginに書き換える
chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [1],
  addRules: [{
    id: 1, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [
      { header: 'Origin', operation: 'set', value: ORIGIN },
      { header: 'Referer', operation: 'set', value: ORIGIN + '/feed/channels' }
    ] },
    condition: { urlFilter: '||www.youtube.com/youtubei/', initiatorDomains: [chrome.runtime.id], resourceTypes: ['xmlhttprequest'] }
  }]
}).catch(() => {});
function walk(o, fn) {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) { o.forEach(x => walk(x, fn)); return; }
  fn(o);
  for (const k in o) walk(o[k], fn);
}
function collect(data, out) {
  let next = null;
  walk(data, o => {
    if (o.channelRenderer) {
      const r = o.channelRenderer;
      const href = (((r.navigationEndpoint || {}).browseEndpoint) || {}).canonicalBaseUrl;
      const key = TF.keyFromHref(href) || r.channelId;
      let av = ((r.thumbnail || {}).thumbnails || []).slice(-1)[0];
      av = av ? av.url.replace(/^\/\//, 'https://') : '';
      const t = r.title || {};
      if (key) out.set(key, { key, name: TF.clean(t.simpleText || (t.runs || []).map(x => x.text).join('')), avatar: av, id: /^UC[w-]{22}$/.test(r.channelId || '') ? r.channelId : '' });
    }
    if (o.continuationItemRenderer) {
      const tok = (((o.continuationItemRenderer.continuationEndpoint || {}).continuationCommand) || {}).token;
      if (tok) next = tok;
    }
  });
  return next;
}
let importP = null;
function importSubs() {
  return importP || (importP = (async () => {
    const html = await (await fetch(`${ORIGIN}/feed/channels`, { credentials: 'include' })).text();
    const mi = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (!mi) throw new Error('ytInitialData not found');
    const apiKey = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
    const ver = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1];
    const out = new Map();
    let tok = collect(JSON.parse(mi[1]), out);
    const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
    for (let i = 0; tok && i < 200; i++) {
      const res = await fetch(`${ORIGIN}/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`, {
        method: 'POST', credentials: 'include', headers,
        body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: ver, hl: 'ja' } }, continuation: tok })
      });
      if (!res.ok) throw new Error('browse ' + res.status);
      tok = collect(await res.json(), out);
      chrome.runtime.sendMessage({ type: 'importProgress', n: out.size }).catch(() => {});
    }
    if (!out.size) throw new Error('no channels (ログインしていないか、YouTube側の形式が変わりました)');
    await TF.upsertChannels([...out.values()]);
    await bulkMetaIds([...out.values()]); // チャンネルID(UC…)を保存しておく(新着一覧が、チャンネルページを開かずにRSSを取れる)
    return { count: out.size };
  })().finally(() => { importP = null; }));
}


// ---- 新着一覧(登録チャンネル全体)。新着動画 / ライブ・配信 / ショート のページ用 ----
// 各チャンネルのRSS(最新15件)から、N日分の動画を集める。ショートは、RSSのリンク(/shorts/)で分かる。
// それ以外は、動画ページで「ライブ配信か」を判定する(動画IDごとに保存: vkind)。結果は短時間キャッシュ(feedCache)。
// 取得の途中でも、集まった分をページに返せる(feedStatus の items)。
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const x = items[i++]; try { await fn(x); } catch (e) { /* 1件の失敗は無視 */ } } }));
}
// チャンネルの動画(v) / ショート(s) / ライブ配信(l) の先頭(約15件)。動画は RSS 等のフォールバックつき
const tcache = new Map();
async function tabVideos(id, tab) {
  if (tab === 'v') return videos(id);
  const k = id + ':' + tab, c = tcache.get(k); if (c && Date.now() - c.t < (tab === 'l' ? 3 : 20) * 60 * 1000) return c.v; // 配信中は変わりやすいので、ライブ配信は3分だけ覚える
  const v = await videosFromApi(id, tab); tcache.set(k, { t: Date.now(), v }); return v;
}
// ショートの投稿日(player API の publishDate。約9KBと軽い)
async function shortDate(vid) {
  try {
    const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20260101.00.00', hl: 'ja', gl: 'JP' } }, videoId: vid }) });
    const m = /"publishDate":"([^"]+)"/.exec(await r.text()); return m ? Date.parse(m[1]) : 0;
  } catch (e) { return 0; }
}
let feedP = null;
// 新着一覧(動画 v / ショート s / ライブ・配信 l)。種類ごとに、チャンネルの対応するタブを調べる。
// 結果のキャッシュ(feedCache_v/s/l)と、ショートの投稿日(spub)は、取り直せる一時データなので、Drive同期(SYNC_KEYS)の対象にしない。
const feedPs = {}, feedProgs = {};
const idleProg = () => ({ running: false, phase: '', done: 0, total: 0, items: [] });
function feedAll(days, force, kind = 'v') {
  if (!'vsl'.includes(kind)) kind = 'v';
  if (feedPs[kind]) return feedPs[kind];
  feedPs[kind] = (async () => {
    const ck = 'feedCache_' + kind;
    const st = await chrome.storage.local.get(['channels', ck, 'spub', 'meta']);
    if (!force && st[ck] && st[ck].days === days && Date.now() - st[ck].t < (kind === 'l' ? 2 : 10) * 60 * 1000) return st[ck];
    const channels = st.channels || {}, keys = Object.keys(channels), spub = st.spub || {};
    // チャンネルIDが未取得のチャンネルが多いときは、登録チャンネルの取り込み(1回の通信でまとめて取れる)でIDを集める
    { const { meta = {} } = await chrome.storage.local.get('meta'); const noId = keys.filter(k => !k.startsWith('UC') && !(meta[k] && meta[k].id));
      if (noId.length > 20) { feedProgs[kind] = { running: true, phase: 'チャンネルIDを取得中', done: 0, total: 0, items: [] }; try { await importSubs(); } catch (e) { /* ログインしていない等。個別に解決する */ } } }
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const cut = d0.getTime() - (days - 1) * 86400000;
    const prog = feedProgs[kind] = { running: true, phase: '新着を取得中', done: 0, total: keys.length, items: [] };
    const items = prog.items;
    // 新着が見つかりやすい順(最近投稿したチャンネル → 不明 → 長く投稿のないチャンネル)に取得して、新しい動画が先に画面へ出るようにする
    { const mm = st.meta || {}, score = k => { const v = mm[k] && mm[k][kind]; return v > cut ? v : v === undefined ? cut : v === 0 ? -1 : v / 1e6; }; keys.sort((a, b) => score(b) - score(a)); }
    await pool(keys, 32, async k => {
      try {
        // ショート・ライブ配信は、集計済みで「投稿なし」(0)と分かっているチャンネルは、7日間は調べない(ライブは約半数、ショートも一部が該当し、通信が大きく減る)
        const mt = (st.meta || {})[k]; if (kind !== 'v' && mt && mt[kind] === 0 && mt.t && Date.now() - mt.t < 7 * 86400000) return;
        // チャンネルIDは、読み込み済みの集計データ(meta)から取る。resolve()は毎回、保存データ全体を読み直し、足りないときはチャンネルのページ全体(約1MB)を取りに行くので、ここでは使わない
        const m0 = (st.meta || {})[k]; const r = k.startsWith('UC') ? { id: k } : (m0 && m0.id) ? m0 : await resolve(k); if (!r.id) return;
        const list = await tabVideos(r.id, kind);
        const base = { key: k, ch: (channels[k] && channels[k].name) || r.name || k, avatar: (channels[k] && channels[k].avatar) || r.avatar || '', kind };
        if (kind === 's') { // ショートは日付が無いので、新しい順に1本ずつ投稿日を調べ、期間より古くなったら止める
          for (const x of list.slice(0, 6)) {
            let t = spub[x.id]; if (!t) { t = await shortDate(x.id); if (t) spub[x.id] = t; }
            if (!t) continue; if (t < cut) break;
            items.push({ ...base, id: x.id, title: x.title, published: new Date(t).toISOString() });
          }
        } else list.filter(x => Date.parse(x.published) >= cut).forEach(x => items.push({ ...base, id: x.id, title: x.title, published: x.published, live: !!x.live }));
      } catch (e) { /* 取得できないチャンネルは飛ばす */ } finally { prog.done++; }
    });
    const sk = Object.keys(spub); if (sk.length > 4000) sk.slice(0, sk.length - 4000).forEach(i => delete spub[i]);
    const out = { t: Date.now(), days, kind, items: items.slice() };
    await chrome.storage.local.set({ [ck]: out, spub });
    return out;
  })().finally(() => { feedProgs[kind] = idleProg(); delete feedPs[kind]; });
  return feedPs[kind];
}
const shortsOwnerCache = new Map();
chrome.runtime.onMessage.addListener((m, _s, send) => {
  if (!m) return;
  if (m.type === 'feedAll') { feedAll(m.days || 4, !!m.force, m.kind).then(send).catch(e => send({ error: String(e) })); return true; }
  if (m.type === 'feedStatus') { send(feedProgs[m.kind || 'v'] || idleProg()); return; }
  if (m.type === 'plAdd') { plAdd(m.videoId, m.listId).then(send).catch(e => { if (!m.listId) chrome.storage.local.remove('plTargetId'); send({ error: String(e.message || e) }); }); return true; }
  if (m.type === 'plCreate') { plCreate(m.title, m.privacy).then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'plDelete') { plDelete(m.id).then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'ytHome') { ytHome(m.kind, m.token).then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'ytSearch') { ytSearch(m.q, m.kind, m.token).then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'plMove') { plMove(m).then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'plLists') { plLists().then(lists => send({ lists })).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'plVideos') { Promise.all((m.ids || []).map(plVideos)).then(rs => { const seen = new Set(), items = []; rs.flat().forEach(x => { if (!seen.has(x.id)) { seen.add(x.id); items.push(x); } }); send({ items }); }).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'feedClear') { // 新着一覧の保存結果(feedCache_*)・ショートの投稿日(spub)・メモリのキャッシュを消す。Drive同期の対象外の一時データだけ
    tcache.clear(); chrome.storage.local.remove(['feedCache_v', 'feedCache_s', 'feedCache_l', 'spub']).then(() => send({ ok: true })).catch(e => send({ error: String(e) })); return true; }
  if (m.type === 'newCounts') { // 各チャンネルの「N日以内の新着動画」件数(RSS・20分キャッシュ)
    const cut = Date.now() - (m.days || 3) * 86400000;
    Promise.all((m.keys || []).map(k => limit(async () => {
      try { const r = await resolve(k); if (!r.id) return [k, 0]; return [k, (await videos(r.id)).filter(x => Date.parse(x.published) >= cut).length]; }
      catch (e) { return [k, 0]; }
    }))).then(a => send({ counts: Object.fromEntries(a) }));
    return true;
  }
  if (m.type === 'shortsOwners') { // ショートの動画ID → 投稿者のチャンネルキー(oEmbed。結果はメモリにキャッシュ)
    Promise.all((m.ids || []).map(id => limit(async () => {
      if (shortsOwnerCache.has(id)) return [id, shortsOwnerCache.get(id)];
      try {
        const j = await (await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/shorts/' + id))).json();
        const k = TF.keyFromHref(j.author_url || ''); shortsOwnerCache.set(id, k); return [id, k];
      } catch (e) { return [id, null]; }
    }))).then(a => send({ owners: Object.fromEntries(a) }));
    return true;
  }
  if (m.type === 'chVideos') { // チャンネルの最新動画(RSS・最大15件)
    limit(async () => { const r = await resolve(m.key); return { videos: r.id ? await videos(r.id) : [] }; }).then(send).catch(e => send({ error: String(e) }));
    return true;
  }
  if (m.type === 'syncNow') { syncNow(!!m.interactive).then(send); return true; }
  if (m.type === 'driveUp' || m.type === 'driveDown') { driveForce(m.type === 'driveUp' ? 'up' : 'down').then(send); return true; }
  if (m.type === 'importSubs') { importSubs().then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'scan') { limit(() => scan(m.key)).then(send).catch(e => send({ error: String(e) })); return true; }
  if (m.type === 'openManager') openMgr();
  if (m.type === 'chInfo' || m.type === 'avatar') {
    (m.type === 'chInfo' ? info(m.key, true, m.n) : limit(() => info(m.key, false))).then(send).catch(e => send({ error: String(e) }));
    return true;
  }
});

// チャンネルIDを、まとめて meta に保存する(1件ずつ保存すると、800件超で遅いため)
async function bulkMetaIds(list) {
  await (metaQ = metaQ.then(async () => {
    const { meta = {} } = await chrome.storage.local.get('meta');
    list.forEach(c => { if (c.id) meta[c.key] = { ...meta[c.key], id: c.id }; });
    await chrome.storage.local.set({ meta });
  }));
}

// ---- 視聴ページ: ログイン中のアカウントの再生リスト(ライブラリ) ----
// 再生リスト一覧(FEplaylist_aggregation)と、各再生リストの動画(VL+ID)を、ログイン情報つきで取得する。
let ytApi = null;
async function ytCtx() {
  if (ytApi) return ytApi;
  const html = await (await fetch(ORIGIN + '/', { credentials: 'include' })).text();
  const key = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1], ver = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1];
  if (!key) throw new Error('YouTubeの情報を取得できません');
  return (ytApi = { key, ver: ver || '2.20260101.00.00' });
}
async function authBrowse(browseId, continuation) {
  const c = await ytCtx(), headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
  const body = { context: { client: { clientName: 'WEB', clientVersion: c.ver, hl: 'ja', gl: 'JP' } } };
  if (continuation) body.continuation = continuation; else body.browseId = browseId;
  const r = await fetch(`${ORIGIN}/youtubei/v1/browse?key=${c.key}&prettyPrint=false`, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('browse ' + r.status + (r.status === 401 || r.status === 403 ? '(ログインが必要です)' : ''));
  return r.json();
}
const txt = o => !o ? '' : (o.simpleText || o.content || (o.runs || []).map(x => x.text).join('') || '');
const lastThumb = t => t && t.thumbnails && t.thumbnails.length ? t.thumbnails[t.thumbnails.length - 1].url : '';
// 再生リスト「TubeFolio2 後で見る」へ動画を追加(ホームのサムネの「＋」ボタンから)。再生リストのIDは、見つかったら覚えておく
async function plTarget() {
  const { plTargetId } = await chrome.storage.local.get('plTargetId'); if (plTargetId) return plTargetId;
  const t = (await plLists()).find(x => /TubeFolio2\s*後で見る/.test(x.title || ''));
  if (!t) throw new Error('再生リスト「TubeFolio2 後で見る」が見つかりません');
  await chrome.storage.local.set({ plTargetId: t.id }); return t.id;
}
async function plPost(path, body) {
  const c = await ytCtx(), headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
  const r = await fetch(`${ORIGIN}/youtubei/v1/${path}?key=${c.key}&prettyPrint=false`, { method: 'POST', credentials: 'include', headers,
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: c.ver, hl: 'ja', gl: 'JP' } }, ...body }) });
  if (!r.ok) throw new Error(path + ' ' + r.status + (r.status === 401 || r.status === 403 ? '(ログインが必要です)' : ''));
  return r.json();
}
async function plCreate(title, privacy) {
  title = String(title || '').trim().slice(0, 150); if (!title) throw new Error('名前を入れてください');
  const j = await plPost('playlist/create', { title, privacyStatus: ['PUBLIC', 'UNLISTED', 'PRIVATE'].includes(privacy) ? privacy : 'PRIVATE', videoIds: [] });
  if (!j.playlistId) throw new Error('作成できませんでした' + (j.status ? '(' + j.status + ')' : ''));
  return { ok: true, id: j.playlistId };
}
async function plDelete(id) {
  if (!id || ['WL', 'LL'].includes(id)) throw new Error('このリストは削除できません');
  const j = await plPost('playlist/delete', { playlistId: id });
  if (j.status && j.status !== 'STATUS_SUCCEEDED') throw new Error(j.status);
  const { plTargetId } = await chrome.storage.local.get('plTargetId'); if (plTargetId === id) await chrome.storage.local.remove('plTargetId');
  return { ok: true };
}
// YouTubeの動画検索(検索ページ用)。kind: v 動画 / l ライブ・配信 / s ショート。結果: { items:[{id,title,ch,chId,avatar,thumb,len,views,when,live}], token }
async function ytSearch(q, kind, token) {
  q = String(q || '').trim(); if (!q && !token) throw new Error('キーワードがありません');
  const P = { v: 'EgIQAQ==', l: 'EgJAAQ==' };
  const j = await plPost('search', token ? { continuation: token } : { query: kind === 's' ? q + ' #shorts' : q, ...(P[kind] ? { params: P[kind] } : {}) });
  const items = []; let next = null; const secOf = t => { const p = String(t || '').split(':').map(Number); return p.length && !p.some(isNaN) ? p.reduce((a, x) => a * 60 + x, 0) : 0; };
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (o.continuationCommand && o.continuationCommand.token && !next) next = o.continuationCommand.token;
    const v = o.videoRenderer;
    if (v && v.videoId) {
      const own = (v.ownerText && v.ownerText.runs && v.ownerText.runs[0]) || (v.longBylineText && v.longBylineText.runs && v.longBylineText.runs[0]) || {};
      const live = (v.badges || []).some(x => x.metadataBadgeRenderer && /LIVE/.test(x.metadataBadgeRenderer.style || '')) || (v.thumbnailOverlays || []).some(x => x.thumbnailOverlayTimeStatusRenderer && x.thumbnailOverlayTimeStatusRenderer.style === 'LIVE');
      const len = txt(v.lengthText);
      if (kind === 's' && !(len && secOf(len) <= 61)) return;
      if (kind === 'v' && secOf(len) > 0 && secOf(len) <= 61 && /shorts/.test(JSON.stringify(v.navigationEndpoint || {}))) return;
      items.push({ id: v.videoId, title: txt(v.title), ch: own.text || '', chId: (own.navigationEndpoint && own.navigationEndpoint.browseEndpoint && own.navigationEndpoint.browseEndpoint.browseId) || '', avatar: lastThumb(v.channelThumbnailSupportedRenderers && v.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer && v.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer.thumbnail), thumb: lastThumb(v.thumbnail), len: live ? '' : len, views: txt(v.shortViewCountText) || txt(v.viewCountText), when: txt(v.publishedTimeText), live });
      return;
    }
    const sl = o.shortsLockupViewModel;
    if (sl && kind === 's') {
      const id = (sl.onTap && sl.onTap.innertubeCommand && sl.onTap.innertubeCommand.reelWatchEndpoint && sl.onTap.innertubeCommand.reelWatchEndpoint.videoId) || String(sl.entityId || '').replace(/^shorts-shelf-item-/, '');
      if (/^[\w-]{11}$/.test(id)) items.push({ id, title: (sl.overlayMetadata && sl.overlayMetadata.primaryText && sl.overlayMetadata.primaryText.content) || '', ch: '', chId: '', avatar: '', thumb: '', len: '', views: (sl.overlayMetadata && sl.overlayMetadata.secondaryText && sl.overlayMetadata.secondaryText.content) || '', when: '', live: false });
      return;
    }
    const rv = o.reelItemRenderer;
    if (rv && rv.videoId && kind === 's') { items.push({ id: rv.videoId, title: txt(rv.headline), ch: '', chId: '', avatar: '', thumb: '', len: '', views: txt(rv.viewCountText), when: '', live: false }); return; }
    Object.values(o).forEach(walk);
  })(j);
  return { items, token: next };
}
// YouTubeのおすすめ(ホームのフィード)。token が無ければ先頭から、あれば続きを取る。kind: v 動画 / l ライブ・配信 / s ショート
async function ytHome(kind, token) {
  const j = await authBrowse('FEwhat_to_watch', token || null);
  const items = []; let next = null; const secOf = t => { const p = String(t || '').split(':').map(Number); return p.length && !p.some(isNaN) ? p.reduce((a, x) => a * 60 + x, 0) : 0; };
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    if (o.continuationCommand && o.continuationCommand.token && !next) next = o.continuationCommand.token;
    const v = o.videoRenderer;
    if (v && v.videoId) {
      const own = (v.ownerText && v.ownerText.runs && v.ownerText.runs[0]) || (v.longBylineText && v.longBylineText.runs && v.longBylineText.runs[0]) || {};
      const live = (v.badges || []).some(x => x.metadataBadgeRenderer && /LIVE/.test(x.metadataBadgeRenderer.style || '')) || (v.thumbnailOverlays || []).some(x => x.thumbnailOverlayTimeStatusRenderer && x.thumbnailOverlayTimeStatusRenderer.style === 'LIVE');
      if ((kind === 'l') === live && kind !== 's') items.push({ id: v.videoId, title: txt(v.title), ch: own.text || '', chId: (own.navigationEndpoint && own.navigationEndpoint.browseEndpoint && own.navigationEndpoint.browseEndpoint.browseId) || '', avatar: lastThumb(v.channelThumbnailSupportedRenderers && v.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer && v.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer.thumbnail), thumb: lastThumb(v.thumbnail), len: live ? '' : txt(v.lengthText), views: txt(v.shortViewCountText) || txt(v.viewCountText), when: txt(v.publishedTimeText), live });
      return;
    }
    const lv = o.lockupViewModel;
    if (lv && /VIDEO/.test(lv.contentType || '') && lv.contentId) {
      const m = lv.metadata && lv.metadata.lockupMetadataViewModel, rows = (m && m.metadata && m.metadata.contentMetadataViewModel && m.metadata.contentMetadataViewModel.metadataRows) || [];
      const parts = r => r && r.metadataParts ? r.metadataParts.map(p => txt(p.text)) : [];
      const js = JSON.stringify(lv), live = /BADGE_STYLE_LIVE|LIVE_NOW|視聴中/.test(js);
      const len = (js.match(/"text":"(\d{1,2}:\d{2}(?::\d{2})?)"/) || [])[1] || '';
      const im = lv.contentImage && lv.contentImage.thumbnailViewModel && lv.contentImage.thumbnailViewModel.image;
      const av = m && m.image && m.image.decoratedAvatarViewModel && m.image.decoratedAvatarViewModel.avatar && m.image.decoratedAvatarViewModel.avatar.avatarViewModel && m.image.decoratedAvatarViewModel.avatar.avatarViewModel.image;
      if ((kind === 'l') === live && kind !== 's') items.push({ id: lv.contentId, title: m ? txt(m.title) : '', ch: parts(rows[0])[0] || '', chId: (js.match(/"browseId":"(UC[\w-]{22})"/) || [])[1] || '', avatar: av && av.sources && av.sources.length ? av.sources[av.sources.length - 1].url : '', thumb: im && im.sources && im.sources.length ? im.sources[im.sources.length - 1].url : '', len: live ? '' : len, views: parts(rows[1])[0] || '', when: parts(rows[1])[1] || '', live });
      return;
    }
    const sl = o.shortsLockupViewModel;
    if (sl) {
      if (kind === 's') {
        const id = (sl.onTap && sl.onTap.innertubeCommand && sl.onTap.innertubeCommand.reelWatchEndpoint && sl.onTap.innertubeCommand.reelWatchEndpoint.videoId) || String(sl.entityId || '').replace(/^shorts-shelf-item-/, '');
        if (/^[\w-]{11}$/.test(id)) items.push({ id, title: (sl.overlayMetadata && sl.overlayMetadata.primaryText && sl.overlayMetadata.primaryText.content) || '', ch: '', chId: '', avatar: '', thumb: '', len: '', views: (sl.overlayMetadata && sl.overlayMetadata.secondaryText && sl.overlayMetadata.secondaryText.content) || '', when: '', live: false });
      }
      return;
    }
    Object.values(o).forEach(walk);
  })(j);
  return { items, token: next };
}
async function plEdit(listId, actions) {
  const c = await ytCtx(), headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
  const r = await fetch(`${ORIGIN}/youtubei/v1/browse/edit_playlist?key=${c.key}&prettyPrint=false`, { method: 'POST', credentials: 'include', headers,
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: c.ver, hl: 'ja', gl: 'JP' } }, playlistId: listId, actions }) });
  if (!r.ok) throw new Error('編集 ' + r.status + (r.status === 401 || r.status === 403 ? '(ログインが必要です)' : ''));
  const j = await r.json(); if (j.status && j.status !== 'STATUS_SUCCEEDED') throw new Error(j.status);
}
// 再生リスト間の動画のコピー・移動。移動は「コピー先に追加 → コピー元から削除」の順(追加に失敗したら、元は消さない)
async function plMove(m) {
  if (!/^[\w-]{11}$/.test(m.videoId || '') || !m.to) throw new Error('指定が不正です');
  if (m.move && !m.setId) throw new Error('この動画は、元の再生リストから削除できません(ページを更新してください)');
  await plEdit(m.to, [{ action: 'ACTION_ADD_VIDEO', addedVideoId: m.videoId, dedupeOption: 'DEDUPE_OPTION_SKIP' }]);
  if (m.move) await plEdit(m.from, [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: m.setId, removedVideoId: m.videoId }]);
  return { ok: true };
}
async function plAdd(videoId, listId0) {
  if (!/^[\w-]{11}$/.test(videoId || '')) throw new Error('動画IDが不正です');
  const listId = listId0 || await plTarget(), c = await ytCtx(), headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
  const r = await fetch(`${ORIGIN}/youtubei/v1/browse/edit_playlist?key=${c.key}&prettyPrint=false`, { method: 'POST', credentials: 'include', headers,
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: c.ver, hl: 'ja', gl: 'JP' } }, playlistId: listId, actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId, dedupeOption: 'DEDUPE_OPTION_SKIP' }] }) });
  if (!r.ok) throw new Error('追加 ' + r.status + (r.status === 401 || r.status === 403 ? '(ログインが必要です)' : ''));
  const j = await r.json(); if (j.status && j.status !== 'STATUS_SUCCEEDED') throw new Error(j.status);
  return { ok: true };
}
// 再生リスト一覧: [{ id, title, count, thumb }]。ライブラリ(後で見る・高く評価した動画)は、ページ側でひとつにまとめる
async function plLists() {
  const out = new Map(); let tok = null;
  for (let i = 0; i < 20; i++) {
    const j = await authBrowse('FEplaylist_aggregation', tok); tok = null;
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (o.continuationCommand && o.continuationCommand.token && !tok) tok = o.continuationCommand.token;
      const p = o.playlistRenderer || o.gridPlaylistRenderer;
      if (p && p.playlistId) { out.set(p.playlistId, { id: p.playlistId, title: txt(p.title), owner: txt(p.shortBylineText) || txt(p.longBylineText), count: txt(p.videoCountText) || txt(p.videoCountShortText) || p.videoCount || '', thumb: lastThumb(p.thumbnails && p.thumbnails[0]) || lastThumb(p.thumbnail) || lastThumb(p.thumbnailRenderer && p.thumbnailRenderer.playlistVideoThumbnailRenderer && p.thumbnailRenderer.playlistVideoThumbnailRenderer.thumbnail) }); return; }
      const lv = o.lockupViewModel;
      if (lv && /PLAYLIST/.test(lv.contentType || '') && lv.contentId) {
        const m = lv.metadata && lv.metadata.lockupMetadataViewModel, ci = lv.contentImage && lv.contentImage.collectionThumbnailViewModel, im = ci && ci.primaryThumbnail && ci.primaryThumbnail.thumbnailViewModel && ci.primaryThumbnail.thumbnailViewModel.image;
        const badge = JSON.stringify(lv.contentImage || {}).match(/"text":"([^"]*(?:本|videos?)[^"]*)"/);
        const rows0 = (m && m.metadata && m.metadata.contentMetadataViewModel && m.metadata.contentMetadataViewModel.metadataRows) || [], own0 = rows0[0] && rows0[0].metadataParts && rows0[0].metadataParts[0] ? txt(rows0[0].metadataParts[0].text) : '';
        out.set(lv.contentId, { id: lv.contentId, title: m ? txt(m.title) : '', owner: own0, count: badge ? badge[1] : '', thumb: im && im.sources && im.sources.length ? im.sources[im.sources.length - 1].url : '' });
        return;
      }
      Object.values(o).forEach(walk);
    })(j);
    if (!tok) break;
  }
  return [...out.values()];
}
// 再生リストの動画: [{ id, title, ch, len, thumb }]
async function plVideos(listId) {
  const out = []; let tok = null;
  for (let i = 0; i < 5 && out.length < 300; i++) {
    const j = tok ? await authBrowse(null, tok) : await authBrowse('VL' + listId); tok = null;
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (o.continuationCommand && o.continuationCommand.token && !tok) tok = o.continuationCommand.token;
      const v = o.playlistVideoRenderer;
      if (v && v.videoId) { const ov = (v.thumbnailOverlays || []).find(x => x.thumbnailOverlayResumePlaybackRenderer); out.push({ id: v.videoId, setId: v.setVideoId || '', title: txt(v.title), ch: txt(v.shortBylineText), len: txt(v.lengthText), pct: ov ? ov.thumbnailOverlayResumePlaybackRenderer.percentDurationWatched || 0 : 0, thumb: lastThumb(v.thumbnail) }); return; }
      const lv = o.lockupViewModel;
      if (lv && /VIDEO/.test(lv.contentType || '') && lv.contentId) {
        const m = lv.metadata && lv.metadata.lockupMetadataViewModel, im = lv.contentImage && lv.contentImage.thumbnailViewModel && lv.contentImage.thumbnailViewModel.image;
        const rows = (m && m.metadata && m.metadata.contentMetadataViewModel && m.metadata.contentMetadataViewModel.metadataRows) || [];
        out.push({ id: lv.contentId, title: m ? txt(m.title) : '', ch: rows[0] && rows[0].metadataParts && rows[0].metadataParts[0] ? txt(rows[0].metadataParts[0].text) : '', len: '', thumb: im && im.sources && im.sources.length ? im.sources[im.sources.length - 1].url : '' });
        return;
      }
      Object.values(o).forEach(walk);
    })(j);
    if (!tok) break;
  }
  return out;
}
