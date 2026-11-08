const openMgr = () => chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
chrome.action.onClicked.addListener(openMgr);

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
async function videos(id) {
  const c = vcache.get(id);
  if (c && Date.now() - c.t < 20 * 60 * 1000) return c.v;
  const xml = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { credentials: 'omit' })).text();
  const v = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(e => ({
    id: (e[1].match(/<yt:videoId>([^<]+)/) || [])[1],
    title: unxml((e[1].match(/<title>([^<]*)/) || [])[1] || ''),
    published: (e[1].match(/<published>([^<]+)/) || [])[1],
    short: /<link rel="alternate" href="[^"]*\/shorts\//.test(e[1])
  })).filter(x => x.id).sort((a, b) => b.published.localeCompare(a.published));
  vcache.set(id, { t: Date.now(), v });
  return v;
}

async function info(key, wantVideos) {
  const m = await resolve(key);
  const out = { id: m.id, avatar: m.avatar, name: m.name };
  if (wantVideos && m.id) out.videos = (await videos(m.id)).slice(0, 2);
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
  const h = await (await fetch(`https://www.youtube.com/watch?v=${id}`, { credentials: 'omit' })).text();
  const d = (h.match(/"publishDate":"([^"]+)/) || h.match(/itemprop="datePublished" content="([^"]+)/) || [])[1];
  return d ? Date.parse(d) : 0;
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
let feedProg = { running: false, phase: '', done: 0, total: 0, items: [] };
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const x = items[i++]; try { await fn(x); } catch (e) { /* 1件の失敗は無視 */ } } }));
}
async function isLive(id) {
  try { return /"isLiveContent":true/.test(await (await fetch(`https://www.youtube.com/watch?v=${id}`, { credentials: 'omit' })).text()); } catch (e) { return false; }
}
let feedP = null;
function feedAll(days, force) {
  if (feedP) return feedP;
  feedP = (async () => {
    const st = await chrome.storage.local.get(['channels', 'vkind', 'feedCache']);
    if (!force && st.feedCache && st.feedCache.days === days && Date.now() - st.feedCache.t < 10 * 60 * 1000) return st.feedCache;
    const channels = st.channels || {}, keys = Object.keys(channels), vkind = st.vkind || {};
    // チャンネルIDが未取得のチャンネルが多いときは、登録チャンネルの取り込み(1回の通信でまとめて取れる)でIDを集める
    { const { meta = {} } = await chrome.storage.local.get('meta'); const noId = keys.filter(k => !k.startsWith('UC') && !(meta[k] && meta[k].id));
      if (noId.length > 20) { feedProg = { running: true, phase: 'チャンネルIDを取得中', done: 0, total: 0, items: [] }; try { await importSubs(); } catch (e) { /* ログインしていない等。個別に解決する */ } } }
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const cut = d0.getTime() - (days - 1) * 86400000;
    feedProg = { running: true, phase: '新着を取得中', done: 0, total: keys.length, items: [] };
    const items = feedProg.items;
    await pool(keys, 10, async k => {
      try {
        const r = await resolve(k);
        if (r.id) (await videos(r.id)).filter(x => Date.parse(x.published) >= cut).forEach(x => items.push({ id: x.id, title: x.title, published: x.published, key: k, ch: (channels[k] && channels[k].name) || r.name || k, avatar: (channels[k] && channels[k].avatar) || r.avatar || '', kind: x.short ? 's' : (vkind[x.id] || 'v') }));
      } finally { feedProg.done++; }
    });
    const need = items.filter(x => x.kind === 'v' && !vkind[x.id]);
    feedProg.phase = 'ライブ配信を判定中'; feedProg.done = 0; feedProg.total = need.length;
    await pool(need, 10, async x => { const l = await isLive(x.id); vkind[x.id] = l ? 'l' : 'v'; x.kind = vkind[x.id]; feedProg.done++; });
    const ids = Object.keys(vkind); if (ids.length > 4000) ids.slice(0, ids.length - 4000).forEach(i => delete vkind[i]);
    const out = { t: Date.now(), days, items: items.slice() };
    await chrome.storage.local.set({ vkind, feedCache: out });
    return out;
  })().finally(() => { feedProg = { running: false, phase: '', done: 0, total: 0, items: [] }; feedP = null; });
  return feedP;
}
const shortsOwnerCache = new Map();
chrome.runtime.onMessage.addListener((m, _s, send) => {
  if (!m) return;
  if (m.type === 'feedAll') { feedAll(m.days || 4, !!m.force).then(send).catch(e => send({ error: String(e) })); return true; }
  if (m.type === 'feedStatus') { send(feedProg); return; }
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
  if (m.type === 'folderFeed') { // フォルダ内チャンネルの新着動画(N日以内・新しい順・最大30件)
    const cut = Date.now() - (m.days || 3) * 86400000;
    Promise.all((m.keys || []).map(k => limit(async () => {
      try { const r = await resolve(k); if (!r.id) return []; return (await videos(r.id)).map(v => ({ ...v, key: k, ch: r.name || k })); }
      catch (e) { return []; }
    }))).then(a => send({ items: a.flat().filter(v => Date.parse(v.published) >= cut).sort((x, y) => y.published.localeCompare(x.published)).slice(0, 30) }));
    return true;
  }
  if (m.type === 'chVideos') { // チャンネルの最新動画(RSS・最大15件)
    limit(async () => { const r = await resolve(m.key); return { videos: r.id ? await videos(r.id) : [] }; }).then(send).catch(e => send({ error: String(e) }));
    return true;
  }
  if (m.type === 'syncNow') { syncNow(!!m.interactive).then(send); return true; }
  if (m.type === 'importSubs') { importSubs().then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'scan') { limit(() => scan(m.key)).then(send).catch(e => send({ error: String(e) })); return true; }
  if (m.type === 'openManager') openMgr();
  if (m.type === 'chInfo' || m.type === 'avatar') {
    limit(() => info(m.key, m.type === 'chInfo')).then(send).catch(e => send({ error: String(e) }));
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
