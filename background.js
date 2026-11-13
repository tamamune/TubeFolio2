const openMgr = () => chrome.tabs.create({ url: chrome.runtime.getURL('manager.html') });
// ---- 動作ログ(元のTubeFolioから移植): 設定 →「📜 動作ログ」で見られる。保存先は storage の tgLog(この端末だけ・同期しない) ----
// 保存はバックグラウンドだけが行う(同時書き込みで消えないように)。YouTubeのタブは、2秒ごとにまとめて 'tg-log' で送ってくる。
var TG_LOG_MAX = 400, _bgLogBuf = [], _bgLogT = null, _bgLogChain = Promise.resolve();
function writeLog(items) {
  _bgLogChain = _bgLogChain.then(async () => {
    const { tgLog = [] } = await chrome.storage.local.get('tgLog');
    await chrome.storage.local.set({ tgLog: tgLog.concat(items).slice(-TG_LOG_MAX) });
  }).catch(() => {});
  return _bgLogChain;
}
function bgLog(cat, msg, level = 'info') {
  _bgLogBuf.push({ t: Date.now(), c: cat, m: String(msg), l: level, s: 'bg' });
  if (!_bgLogT) _bgLogT = setTimeout(() => { _bgLogT = null; writeLog(_bgLogBuf.splice(0)); }, 3000); // 3秒ぶんまとめて書く
}
const logged = (cat, p, what = '') => p.then(r => { bgLog(cat, (what || '完了') + (r && r.count != null ? `(${r.count}件)` : '')); return r; }, e => { bgLog(cat, String((e && e.message) || e), 'error'); throw e; });
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
const pubMs = t => /前|ago/i.test(t || '') ? (Date.parse(approxDate(t)) || 0) : 0; // 「2 年前」などの表示から、投稿日のおおよそ
const approxDate = t => { const m = /(\d+)\s*(秒|分|時間|日|週間|か月|ヶ月|年)/.exec(t || ''); if (!m) return null; const u = { '秒': 1e3, '分': 6e4, '時間': 36e5, '日': 864e5, '週間': 6048e5, 'か月': 2592e6, 'ヶ月': 2592e6, '年': 31536e6 }[m[2]]; return new Date(Date.now() - (+m[1]) * u).toISOString(); };
async function videosFromApi(id, tab = 'v') {
  const TABP = { v: 'EgZ2aWRlb3PyBgQKAjoA', s: 'EgZzaG9ydHPyBgUKA5oBAA==', l: 'EgdzdHJlYW1z8gYECgJ6AA==' }; // 動画 / ショート / ライブ配信 のタブ
  const r = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { client: { clientName: 'MWEB', clientVersion: '2.20260101.00.00', hl: 'ja', gl: 'JP' } }, browseId: id, params: TABP[tab] || TABP.v }) }); // MWEB(モバイル版)は、WEBより応答が小さく速い
  if (!r.ok) throw new Error('API ' + r.status);
  const j = await r.json(), out = [], lenMap = {};
  const texts = x => { const t = []; (function w(o) { if (!o || typeof o !== 'object') return; if (typeof o.content === 'string') t.push(o.content); Object.values(o).forEach(w); })(x); return t; };
  (function walk(o) {
    if (!o || typeof o !== 'object' || out.length >= 15) return;
    { // 動画の長さ(サムネの右下に出る時間)
      const V = o.videoWithContextRenderer || o.videoRenderer;
      if (V && V.videoId) { const lt = V.lengthText && (V.lengthText.simpleText || (V.lengthText.runs || []).map(x => x.text).join('')); const m2 = !lt && JSON.stringify(V.thumbnailOverlays || []).match(/"(?:text|simpleText)":"((?:\d+:)?\d+:\d\d)"/); if (lt || m2) lenMap[V.videoId] = lt || m2[1]; }
      else if (o.contentId && o.metadata && o.metadata.lockupMetadataViewModel) { const m2 = JSON.stringify(o.contentImage || {}).match(/"text":"((?:\d+:)?\d+:\d\d)"/); if (m2) lenMap[o.contentId] = m2[1]; }
    }
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
  out.forEach(x => { if (lenMap[x.id]) x.len = lenMap[x.id]; });
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
importScripts('store.js', 'drive-config.js', 'sync.js', 'trends-bg.js');

// 一度だけ: 既定の⭐のままのフォルダに、名前に合うアイコンを自動設定(既存データがある場合のみ)
chrome.storage.local.get(['groups', 'settings']).then(async raw => {
  if (!raw.groups || (raw.settings || {}).iconAuto) return;
  await TF.autoIcons();
  await TF.mutate(s => { s.settings.iconAuto = true; });
}).catch(() => {});
const ORIGIN = 'https://www.youtube.com';
// ---- 背景から YouTube への通信が止められたとき(スマホのブラウザなど・Failed to fetch)は、YouTube のタブ経由にする ----
//   開いている YouTube のタブ(yt-api.js の 'tf-pfetch')が、ページから同じ通信をして結果を返す。
//   一度止められたら、背景が動いている間は最初からタブ経由にする
const nativeFetch = self.fetch.bind(self);
const isYtUrl = u => { try { return /(^|\.)youtube\.com$/.test(new URL(u).hostname); } catch (e) { return false; } };
let ytViaTab = false;
async function tabFetch(url, init = {}) {
  const headers = {}; if (init.headers) new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
  const r = await askTab({ type: 'tf-pfetch', url, method: init.method || 'GET', headers, body: typeof init.body === 'string' ? init.body : undefined });
  if (!r || typeof r.status !== 'number') throw new TypeError('Failed to fetch(YouTube のタブ経由でも通信できません: ' + ((r && r.error) || '応答なし') + ')');
  const noBody = [101, 204, 205, 304].includes(r.status) || r.status < 200;
  return new Response(noBody ? null : r.body, { status: r.status < 200 ? 200 : r.status, statusText: r.statusText || '', headers: { 'Content-Type': r.type || 'text/plain' } });
}
self.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input && input.url;
  if (!isYtUrl(url)) return nativeFetch(input, init);
  if (ytViaTab) return tabFetch(url, init);
  try { return await nativeFetch(input, init); }
  catch (e) {
    if (!(e instanceof TypeError) || (init && init.signal && init.signal.aborted)) throw e;
    ytViaTab = true;
    try { bgLog('通信', `YouTube への直接の通信が止められました(${e.message})。YouTube のタブ経由に切り替えます`, 'warn'); } catch (e2) { /* なし */ }
    return tabFetch(url, init);
  }
};
async function authHeaders() {
  let c = null; // クッキーを読めないブラウザでは、印を付けない(タブ経由のときは、タブ側で付ける)
  try { c = await chrome.cookies.get({ url: ORIGIN, name: 'SAPISID' }) || await chrome.cookies.get({ url: ORIGIN, name: '__Secure-3PAPISID' }); } catch (e) { return {}; }
  if (!c) return {};
  const ts = Math.floor(Date.now() / 1000);
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${c.value} ${ORIGIN}`));
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return { Authorization: `SAPISIDHASH ${ts}_${hex}`, 'X-Origin': ORIGIN, 'X-Goog-AuthUser': '0' };
}
// 拡張からのfetchは Origin が chrome-extension:// になり 403 になるため、YouTubeのOriginに書き換える
// 埋め込みプレーヤー(/embed/…tgref=1)の Referer の書き換えも、ここで登録する(id 2)。以前は manifest の静的ルール(embed_rules.json)だったが、
//   静的ルールがあると、ブラウザが拡張機能のフォルダに「_metadata」を作り、スマホの Vivaldi では、次に読み込むときに
//   「Cannot load extension with file or directory name _metadata」で読み込めなくなるので、やめた。
// スマホのブラウザ: 拡張機能からの www.youtube.com への通信が m.youtube.com へ回されて失敗する(CORS)ので、パソコンのブラウザとして名乗る(id 3)
const IS_MOBILE = /Android|Mobile|iPhone|iPad/i.test(navigator.userAgent);
chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [1, 2, 3],
  addRules: [{
    id: 2, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: 'https://tubefolio.example/' }] },
    condition: { urlFilter: '/embed/*tgref=1', requestDomains: ['www.youtube.com', 'www.youtube-nocookie.com'], resourceTypes: ['sub_frame'] }
  }, ...(IS_MOBILE ? [{
    id: 3, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [
      { header: 'User-Agent', operation: 'set', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' },
      { header: 'Sec-CH-UA-Mobile', operation: 'set', value: '?0' }, { header: 'Sec-CH-UA-Platform', operation: 'set', value: '"Windows"' }
    ] },
    condition: { urlFilter: '||www.youtube.com/', initiatorDomains: [chrome.runtime.id], resourceTypes: ['xmlhttprequest'] }
  }] : []), {
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
      if (key) out.set(key, { key, name: TF.clean(t.simpleText || (t.runs || []).map(x => x.text).join('')), avatar: av, id: /^UC[\w-]{22}$/.test(r.channelId || '') ? r.channelId : '' });
    }
    if (o.continuationItemRenderer) {
      const tok = (((o.continuationItemRenderer.continuationEndpoint || {}).continuationCommand) || {}).token;
      if (tok) next = tok;
    }
  });
  return next;
}
let importP = null;
// prune = true(「取り込みと同期」を押したとき・自動の同期): 取り込みと同時に、YouTube の登録に無いチャンネルを整理する(TF.syncChannels: フォルダに入っていれば「未登録」の印を付けて残し、入っていなければ消す)
function importSubs(prune, force) {
  return importP || (importP = (async () => {
    const html = await (await fetch(`${ORIGIN}/feed/channels`, { credentials: 'include' })).text();
    const mi = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (!mi) throw new Error('ytInitialData not found');
    const apiKey = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
    const ver = (html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || [])[1];
    const out = new Map();
    let tok = collect(JSON.parse(mi[1]), out), full = false;
    const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
    if (!tok) full = true;
    for (let i = 0; tok && i < 200; i++) {
      const res = await fetch(`${ORIGIN}/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`, {
        method: 'POST', credentials: 'include', headers,
        body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: ver, hl: 'ja' } }, continuation: tok })
      });
      if (!res.ok) throw new Error('browse ' + res.status);
      tok = collect(await res.json(), out);
      if (!tok) full = true;
      chrome.runtime.sendMessage({ type: 'importProgress', n: out.size }).catch(() => {});
    }
    if (!out.size) throw new Error('no channels (ログインしていないか、YouTube側の形式が変わりました)');
    const list = [...out.values()]; let sync = { removed: [], deleted: [], note: '', held: 0 };
    await bulkMetaIds(list); // チャンネルID(UC…)を保存しておく(新着一覧が、チャンネルページを開かずにRSSを取れる。登録を解除したチャンネルを見分けるのにも使う)
    if (prune && full) sync = await TF.syncChannels(list); else await TF.upsertChannels(list); // 一覧を最後まで取れたときだけ、印を付ける
    try { if (sync.deleted.length) bgLog('取り込み', `登録もフォルダも無いチャンネルを ${sync.deleted.length}件 消しました: ${sync.deleted.slice(0, 30).join(' / ')}`); if (sync.removed.length) bgLog('取り込み', `フォルダに入っている未登録のチャンネル ${sync.removed.length}件に「未登録」の印を付けました(残します): ${sync.removed.slice(0, 30).join(' / ')}`); } catch (e) { /* 無視 */ }
    if (prune && full) await chrome.storage.local.set({ subsSyncAt: { t: Date.now(), count: out.size, removed: sync.removed.length, held: sync.held } }); // 最後に、YouTube の登録と合わせた時刻(この端末だけの記録)
    return { count: out.size, removed: sync.removed.length, deleted: sync.deleted.length, note: sync.note, held: sync.held };
  })().finally(() => { importP = null; }));
}

// ---- 登録チャンネルの自動の同期: YouTube の今の登録に、TubeFolio2 の一覧を合わせ続ける(足す。登録に無いチャンネルは、フォルダに入っていれば「未登録」の印を付けて残し、入っていなければ消す) ----
//   きっかけ: ブラウザの起動時 / 6時間ごと(アラーム tf-subs)/ 管理画面を開いたとき / YouTube のページで「登録」「登録解除」を押したとき(content.js)。
//   gap = 前回の同期から、これより短ければ何もしない(ミリ秒)。失敗は、動作ログに残すだけ
async function subsAuto(gap, why) {
  const { subsSyncAt, channels } = await chrome.storage.local.get(['subsSyncAt', 'channels']);
  if (!channels || !Object.keys(channels).length) return { skipped: true }; // まだ一度も取り込んでいない: 勝手には始めない
  if (gap && subsSyncAt && Date.now() - (subsSyncAt.t || 0) < gap) return { skipped: true };
  try {
    const r = await importSubs(true, false);
    return r;
  } catch (e) { try { bgLog('取り込み', `自動の同期(${why})に失敗: ${String(e.message || e)}`, 'warn'); } catch (e2) { /* 無視 */ } return { error: String(e.message || e) }; }
}
chrome.alarms.get('tf-subs').then(a => { if (!a) chrome.alarms.create('tf-subs', { periodInMinutes: 360, delayInMinutes: 3 }); }).catch(() => {});
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'tf-subs') subsAuto(60 * 60e3, '定期'); });
chrome.runtime.onStartup.addListener(() => { setTimeout(() => subsAuto(6 * 60 * 60e3, '起動時'), 90e3); }); // 起動の直後は避ける(スマホで重くなる)。6時間以内に合わせていれば、何もしない

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
            items.push({ ...base, id: x.id, title: x.title, published: new Date(t).toISOString(), len: x.len || '' });
          }
        } else list.filter(x => Date.parse(x.published) >= cut).forEach(x => items.push({ ...base, id: x.id, title: x.title, published: x.published, live: !!x.live, len: x.len || '' }));
      } catch (e) { /* 取得できないチャンネルは飛ばす */ } finally { prog.done++; }
    });
    const sk = Object.keys(spub); if (sk.length > 4000) sk.slice(0, sk.length - 4000).forEach(i => delete spub[i]);
    const out = { t: Date.now(), days, kind, items: items.slice() };
    await chrome.storage.local.set({ [ck]: out, spub });
    return out;
  })().finally(() => { feedProgs[kind] = idleProg(); delete feedPs[kind]; });
  return feedPs[kind];
}

// ---------- 再生画面: コメント(時刻リスト・流れるコメント用)と翻訳 ----------
async function ytNext(body) {
  const c = await ytCtx();
  const r = await fetch(`${ORIGIN}/youtubei/v1/next?key=${c.key}&prettyPrint=false`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: c.ver, hl: 'ja', gl: 'JP' } }, ...body }) });
  if (!r.ok) throw new Error('next ' + r.status);
  return r.json();
}
const cmText = o => !o ? '' : (o.content || o.simpleText || (o.runs || []).map(x => x.text).join('') || '');
// コメントの1ページ。token が無ければ、動画の最初のページ(評価順)から。返す: { items:[{id,text,author,likes}], token }
async function cmtPage(videoId, token) {
  if (!token) {
    const j = await ytNext({ videoId });
    walk(j, o => { if (!token && o.itemSectionRenderer && /comment/i.test(o.itemSectionRenderer.sectionIdentifier || '')) walk(o.itemSectionRenderer, x => { if (!token && x.continuationCommand && x.continuationCommand.token) token = x.continuationCommand.token; }); });
    if (!token) return { items: [], token: null, disabled: true };
  }
  const json = await ytNext({ continuation: token });
  const byId = new Map(), order = []; let next = null;
  walk(json, o => {
    const p = o.commentEntityPayload;
    if (p && p.properties) byId.set(p.properties.commentId, { id: p.properties.commentId, text: cmText(p.properties.content), author: (p.author || {}).displayName || '', likes: (p.toolbar || {}).likeCountNotliked || '' });
    if (o.commentRenderer && o.commentRenderer.commentId) { const v = o.commentRenderer; byId.set(v.commentId, { id: v.commentId, text: cmText(v.contentText), author: cmText(v.authorText), likes: cmText(v.voteCount) }); }
    if (o.commentViewModel && o.commentViewModel.commentId) order.push(o.commentViewModel.commentId);
    const k = o.appendContinuationItemsAction || o.reloadContinuationItemsCommand;
    if (k && Array.isArray(k.continuationItems)) { const last = k.continuationItems[k.continuationItems.length - 1]; if (last && last.continuationItemRenderer) walk(last, x => { if (x.continuationCommand && x.continuationCommand.token) next = x.continuationCommand.token; }); }
  });
  const ids = order.length ? [...new Set(order)] : [...byId.keys()];
  return { items: ids.map(i => byId.get(i)).filter(c => c && c.text), token: next };
}
async function translateText(q, to) {
  const u = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(q)}`;
  const r = await fetch(u); if (!r.ok) throw new Error('translate ' + r.status);
  const j = await r.json();
  return { text: (j[0] || []).map(x => x[0]).join(''), src: j[2] || '' };
}

// ---------- 再生画面のパネル用: 決まったサイトへのGET中継 / 関連動画 ----------
async function xfetch(url, as, st) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !['sponsor.ajay.app', 'api.github.com', 'ja.wikipedia.org', 'en.wikipedia.org', 'api.open-meteo.com', 'geocoding-api.open-meteo.com', 'ipapi.co', 'archive.org'].includes(u.hostname)) return null;
  const r = await fetch(u.href, { credentials: 'omit', headers: u.hostname === 'api.github.com' ? { Accept: 'application/vnd.github+json' } : {} });
  if (!r.ok) return st ? { _http: r.status } : null;
  return as === 'text' ? r.text() : r.json();
}
async function relatedOf(videoId) {
  const j = await ytNext({ videoId }), out = [], seen = new Set();
  walk(j, o => {
    const c = o.compactVideoRenderer;
    if (c && c.videoId && !seen.has(c.videoId)) {
      seen.add(c.videoId);
      const live = (c.badges || []).some(x => x.metadataBadgeRenderer && /LIVE/.test(x.metadataBadgeRenderer.style || '')) || !!c.upcomingEventData;
      out.push({ id: c.videoId, title: cmText(c.title), ch: cmText(c.longBylineText) || cmText(c.shortBylineText), len: cmText(c.lengthText), live });
    }
    const l = o.lockupViewModel;
    if (l && l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && /^[\w-]{11}$/.test(l.contentId || '') && !seen.has(l.contentId)) {
      seen.add(l.contentId);
      const m = (l.metadata && l.metadata.lockupMetadataViewModel) || {}, rows = (m.metadata && m.metadata.contentMetadataViewModel && m.metadata.contentMetadataViewModel.metadataRows) || [];
      const ch = rows[0] && rows[0].metadataParts && rows[0].metadataParts[0] ? cmText(rows[0].metadataParts[0].text) : '';
      const badge = JSON.stringify(l.contentImage || {}).match(/"text":"((?:\d+:)?\d+:\d\d)"/);
      out.push({ id: l.contentId, title: cmText(m.title), ch, len: badge ? badge[1] : '', live: false });
    }
  });
  return out;
}

// 振り分け補助用: チャンネルの最近の動画タイトル(動画が無ければショート)と、チャンネルの説明文
async function chText(key) {
  const r = await resolve(key); if (!r || !r.id) return { t: [], cd: '' };
  let vids = []; try { vids = await tabVideos(r.id, 'v'); } catch (e) { vids = []; }
  if (!vids.length) { try { vids = await tabVideos(r.id, 's'); } catch (e) { vids = []; } }
  let cd = '';
  try {
    const rr = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'MWEB', clientVersion: '2.20260101.00.00', hl: 'ja', gl: 'JP' } }, browseId: r.id }) });
    if (rr.ok) { const j = await rr.json(); walk(j, o => { if (!cd && o.channelMetadataRenderer && o.channelMetadataRenderer.description) cd = o.channelMetadataRenderer.description; if (!cd && o.metadata && o.metadata.channelMetadataRenderer && o.metadata.channelMetadataRenderer.description) cd = o.metadata.channelMetadataRenderer.description; }); }
  } catch (e) { /* なし */ }
  return { t: vids.map(x => x.title).filter(Boolean), cd: String(cd || '').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').slice(0, 3000) };
}
const shortsOwnerCache = new Map();
// ---- 急上昇動画(日本・日付別・最大約200本): youtube-trending.info の日別ページ(実験) ----
//   https://youtube-trending.info/video_list?date=YYYY-MM-DD&contry_code=JP を、HTMLのまま読んで取り出す(通信には、日付と国コードだけを使う)
//   過去の日付は変わらないので、storage に覚える(trdc_日付。取り直せるキャッシュなので、Drive同期の対象外)。今日の分は、30分だけメモリに覚える
const trdMem = new Map();
const trdDecode = t => String(t || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  e = e.toLowerCase(); if (e === 'amp') return '&'; if (e === 'lt') return '<'; if (e === 'gt') return '>'; if (e === 'quot') return '"'; if (e === 'apos') return "'";
  const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch (x) { return ''; }
});
function trdParse(html) {
  const out = [];
  html.split('<div class="card ').slice(1).forEach(b => {
    const h = b.match(/class="card-header">#(\d+)\s*\(([^)]*)\)/), id = (b.match(/data-video-id="([\w-]{11})"/) || [])[1];
    if (!h || !id) return;
    const num = re => { const m = b.match(re); return m ? trdDecode(m[1]).trim() : ''; };
    const ch = b.match(/channel_id=([\w-]+)">([^<]*)<\/a>/);
    out.push({
      rank: +h[1], chg: h[2], id, title: trdDecode((b.match(/data-title="([^"]*)"/) || [])[1] || ''),
      views: num(/fa-eye"><\/i>\s*([^<]*?)\s*<\/span>/), likes: num(/fa-thumbs-up"><\/i>\s*([^<]*?)\s*<\/span>/), comments: num(/fa-comment"><\/i>\s*([^<]*?)\s*<\/span>/),
      len: num(/fa-clock"><\/i>\s*([\d:]+)/), pub: num(/Published_at:(\d{4}-\d\d-\d\d)/), cat: num(/Category:([^<]*)</),
      chId: ch ? ch[1] : '', ch: ch ? trdDecode(ch[2]).trim() : ''
    });
  });
  return out;
}
// ---- 急上昇動画(日本・今): YouTube Data API v3 の videos.list?chart=mostPopular(実験)。APIキーは、ユーザー自身のもの(storage の ytApiKey。この端末だけ)----
//   50本ずつ最大4回(= 約200本。1回1ユニット)。キーは、URLではなくヘッダー(x-goog-api-key)で送る。結果は、メモリに10分だけ覚える
const trApiMem = { at: 0, region: '', v: null };
const trCompact = n => { n = +n; if (!isFinite(n)) return ''; if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '億'; if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万'; return String(n); };
const trDur = iso => { const m = String(iso || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/); if (!m) return ''; const h = +m[1] || 0, mi = +m[2] || 0, s = +m[3] || 0; return (h ? h + ':' + String(mi).padStart(2, '0') : mi) + ':' + String(s).padStart(2, '0'); };
async function trendApi(key, region) {
  region = /^[A-Z]{2}$/.test(region) ? region : 'JP';
  if (trApiMem.v && trApiMem.region === region && Date.now() - trApiMem.at < 10 * 60000) return trApiMem.v;
  const call = async (path, q) => {
    const r = await fetch('https://www.googleapis.com/youtube/v3/' + path + '?' + new URLSearchParams(q), { headers: { 'x-goog-api-key': key } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = j && j.error || {}, why = (e.errors && e.errors[0] && e.errors[0].reason) || ''; throw new Error(why === 'keyInvalid' || /API key not valid/i.test(e.message || '') ? 'APIキーが正しくありません' : why === 'quotaExceeded' ? '今日の API の上限に達しました(明日また使えます)' : (e.message || ('API ' + r.status)).slice(0, 200)); }
    return j;
  };
  const cats = {}; try { ((await call('videoCategories', { part: 'snippet', regionCode: region, hl: 'ja' })).items || []).forEach(c => { cats[c.id] = c.snippet && c.snippet.title; }); } catch (e) { if (/キー|上限/.test(e.message)) throw e; }
  const out = []; let token = '';
  for (let i = 0; i < 4; i++) {
    const j = await call('videos', { part: 'snippet,statistics,contentDetails', chart: 'mostPopular', regionCode: region, maxResults: '50', ...(token ? { pageToken: token } : {}) });
    (j.items || []).forEach(v => out.push({
      rank: out.length + 1, chg: '', id: v.id, title: (v.snippet || {}).title || '', views: trCompact((v.statistics || {}).viewCount), likes: trCompact((v.statistics || {}).likeCount), comments: trCompact((v.statistics || {}).commentCount),
      len: trDur((v.contentDetails || {}).duration), pub: String((v.snippet || {}).publishedAt || '').slice(0, 10), cat: cats[(v.snippet || {}).categoryId] || '', chId: (v.snippet || {}).channelId || '', ch: (v.snippet || {}).channelTitle || ''
    }));
    token = j.nextPageToken || ''; if (!token) break;
  }
  if (!out.length) throw new Error('急上昇の動画が返りませんでした');
  trApiMem.at = Date.now(); trApiMem.region = region; trApiMem.v = out;
  return out;
}
async function trendDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日付の形が正しくありません');
  const t = new Date(); const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const mem = trdMem.get(date); if (mem && Date.now() - mem.at < 30 * 60000) return mem.v;
  const key = 'trdc_' + date;
  if (date < today) { const c = (await chrome.storage.local.get(key))[key]; if (c && c.length) { trdMem.set(date, { at: Date.now(), v: c }); return c; } }
  const r = await fetch('https://youtube-trending.info/video_list?date=' + date + '&contry_code=JP');
  if (!r.ok) throw new Error('youtube-trending.info ' + r.status);
  const v = trdParse(await r.text());
  if (!v.length) throw new Error('この日のデータが見つかりません');
  trdMem.set(date, { at: Date.now(), v });
  if (date < today) chrome.storage.local.set({ [key]: v }).catch(() => {});
  return v;
}

chrome.runtime.onMessage.addListener((m, _s, send) => {
  if (!m) return;
  if (m.type === 'feedAll') { logged('新着', feedAll(m.days || 4, !!m.force, m.kind), '新着一覧(' + (m.kind || 'v') + ')を取得').then(send).catch(e => send({ error: String(e) })); return true; }
  if (m.type === 'feedStatus') { send(feedProgs[m.kind || 'v'] || idleProg()); return; }
  if (m.type === 'plAdd') { logged('再生リスト', plAdd(m.videoId, m.listId), '「後で見る」などに追加').then(send).catch(e => { if (!m.listId) chrome.storage.local.remove('plTargetId'); send({ error: String(e.message || e) }); }); return true; }
  if (m.type === 'cmtPage') { cmtPage(m.videoId, m.token).then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'tg-log') { writeLog((m.items || []).slice(-200).map(x => ({ t: +x.t || Date.now(), c: String(x.c || '').slice(0, 40), m: String(x.m || '').slice(0, 600), l: ['info', 'warn', 'error'].includes(x.l) ? x.l : 'info', s: x.s === 'page' ? 'page' : 'yt' }))); send(true); return true; }
  if (m.type === 'openLog') { chrome.tabs.create({ url: chrome.runtime.getURL('log.html') }); send(true); return true; }
  if (m.type === 'tgTranslate') { translateText(String(m.q || '').slice(0, 1500), m.to || 'ja').then(r => send(r.text)).catch(() => send(null)); return true; } // 移植した comments.js 用: 訳した文字列だけを返す
  if (m.type === 'translate') { translateText(String(m.q || '').slice(0, 1500), m.to || 'ja').then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'xfetch') { xfetch(m.url, m.as, m.st).then(send).catch(() => send(null)); return true; }
  if (m.type === 'related') { relatedOf(m.videoId).then(items => send({ items })).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'plCreate') { plCreate(m.title, m.privacy).then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'plDelete') { plDelete(m.id).then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'ytHome') { ytHome(m.kind, m.token).then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'ytSearch') { ytSearch(m.q, m.kind, m.token).then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'plTargetInfo') { plTarget().then(id => send({ id })).catch(() => send({})); return true; }
  if (m.type === 'plRemove') { plRemove(m).then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'plMove') { plMove(m).then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'plLists') { plLists().then(lists => send({ lists })).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'plLaterSync') { plLaterSync().then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'plVideos') { Promise.all((m.ids || []).map(id => plVideos(id, m.order))).then(rs => { (m.ids || []).forEach((id, i) => laterPut(id, rs[i].items.map(x => x.id))); const seen = new Set(), items = []; rs.flatMap(r => r.items).forEach(x => { if (!seen.has(x.id)) { seen.add(x.id); items.push(x); } }); send({ items, ordered: rs.every(r => r.ordered) }); }).catch(e => send({ error: String(e.message || e) })); return true; }
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
  if (m.type === 'trendApi') { trendApi(String(m.key || ''), m.region).then(v => send({ videos: v })).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'trendDay') { trendDay(m.date).then(v => send({ videos: v })).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'chText') { limit(() => chText(m.key)).then(send).catch(e => send({ error: String(e) })); return true; }
  if (m.type === 'chVideos') { // チャンネルの最新動画(RSS・最大15件)
    limit(async () => { const r = await resolve(m.key); return { videos: r.id ? await videos(r.id) : [] }; }).then(send).catch(e => send({ error: String(e) }));
    return true;
  }
  if (m.type === 'syncNow') { syncNow(!!m.interactive).then(send); return true; }
  if (m.type === 'driveUp' || m.type === 'driveDown') { driveForce(m.type === 'driveUp' ? 'up' : 'down').then(send); return true; }
  if (m.type === 'subsAuto') { subsAuto(+m.gap || 0, m.why || '自動').then(send).catch(e => send({ error: String(e.message || e) })); return true; }
  if (m.type === 'importSubs') { logged('取り込み', importSubs(true, !!m.force), '登録チャンネルの取り込み').then(send).catch(e => send({ error: String(e.message || e) })); return true; }
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
async function authBrowse(browseId, continuation, params) {
  const c = await ytCtx(), headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
  const body = { context: { client: { clientName: 'WEB', clientVersion: c.ver, hl: 'ja', gl: 'JP' } } };
  if (continuation) body.continuation = continuation; else { body.browseId = browseId; if (params) body.params = params; }
  const r = await fetch(`${ORIGIN}/youtubei/v1/browse?key=${c.key}&prettyPrint=false`, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('browse ' + r.status + (r.status === 401 || r.status === 403 ? '(ログインが必要です)' : ''));
  return r.json();
}
const txt = o => !o ? '' : (o.simpleText || o.content || (o.runs || []).map(x => x.text).join('') || '');
const lastThumb = t => t && t.thumbnails && t.thumbnails.length ? t.thumbnails[t.thumbnails.length - 1].url : '';
// 投稿者の欄から、チャンネルID(UC…)と @ハンドルを取る(一覧のチャンネルアイコンを、登録チャンネルの情報から引くため)
const bylineIds = o => { const be = o && o.runs && o.runs[0] && o.runs[0].navigationEndpoint && o.runs[0].navigationEndpoint.browseEndpoint, h = be && be.canonicalBaseUrl && /\/(@[^\/?#]+)/.exec(decodeURIComponent(be.canonicalBaseUrl)); return { chId: (be && be.browseId) || '', handle: h ? decodeURIComponent(h[1]).toLowerCase() : '' }; };
// 再生リスト「TubeFolio2 後で見る」へ動画を追加(ホームのサムネの「＋」ボタンから)。再生リストのIDは、見つかったら覚えておく
// 追加先: 再生リスト「TubeFolio2 後で見る」。同じ名前に近いリストが複数あるとき(古いもの・名前違い)は、名前が完全に同じものを選ぶ。
// 覚えてあるIDが、今も同じ名前のリストを指していなければ、選び直す。候補が複数あるときは、動作ログに残す。
async function plTarget() {
  const { plTargetId } = await chrome.storage.local.get('plTargetId');
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  const lists = await plLists();
  const exact = lists.filter(x => norm(x.title) === 'TubeFolio2 後で見る'), loose = lists.filter(x => /TubeFolio2\s*後で見る/.test(x.title || ''));
  const cand = exact.length ? exact : loose;
  if (!cand.length) throw new Error('再生リスト「TubeFolio2 後で見る」が見つかりません');
  if (cand.length > 1) bgLog('再生リスト', `「TubeFolio2 後で見る」に近い再生リストが ${cand.length} 個あります: ${cand.map(x => `${x.id}(${norm(x.title)}・${x.count || '?'})`).join(' / ')}`, 'warn');
  const t = cand.find(x => x.id === plTargetId) || cand[0];
  if (t.id !== plTargetId) await chrome.storage.local.set({ plTargetId: t.id });
  await chrome.storage.local.set({ plTargetName: t.title });
  return t.id;
}
// ---- 「TubeFolio2 後で見る」に入っている動画ID の控え(plLaterIds = { id: リストID, t: 取った時刻, ids: [動画ID] })。
//   一覧のサムネに「登録済み」の印を出すために使う。再生リストの中身から取り直せるので、Drive同期の対象外(キャッシュ)。
//   追加・削除・移動のたびに書き換え、リストの中身を取ったとき(視聴ページ・plLaterSync)に、丸ごと入れ替える
let laterQ = Promise.resolve();
const laterEdit = fn => (laterQ = laterQ.then(async () => { const r = await chrome.storage.local.get(['plLaterIds', 'plTargetId']), c = r.plLaterIds || { id: r.plTargetId || '', t: 0, ids: [] }; const next = fn(c, r.plTargetId || ''); if (next) await chrome.storage.local.set({ plLaterIds: next }); }).catch(() => {}));
const laterAdd = (listId, vid) => laterEdit((c, tid) => (listId === (c.id || tid) && !c.ids.includes(vid) ? { ...c, id: listId, ids: [vid, ...c.ids] } : null));
const laterDel = (listId, vid) => laterEdit((c, tid) => (listId === (c.id || tid) && c.ids.includes(vid) ? { ...c, ids: c.ids.filter(x => x !== vid) } : null));
const laterPut = (listId, ids) => laterEdit((c, tid) => (listId === tid || listId === c.id ? { id: listId, t: Date.now(), ids } : null));
async function plLaterSync() { const id = await plTarget(), r = await plVideos(id); await chrome.storage.local.set({ plLaterIds: { id, t: Date.now(), ids: r.items.map(x => x.id) } }); return { ok: true, id, count: r.items.length }; }
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
// モバイル版の形(videoWithContextRenderer)の動画を、パソコン版と同じ項目にする。
//   スマホのブラウザ(モバイル版の Vivaldi など)では、YouTube がモバイル版の形で返すことがあるため
function vwcItem(v) {
  const own = (v.shortBylineText && v.shortBylineText.runs && v.shortBylineText.runs[0]) || {};
  const be = own.navigationEndpoint && own.navigationEndpoint.browseEndpoint;
  const live = (v.badges || []).some(x => x.metadataBadgeRenderer && /LIVE/.test(x.metadataBadgeRenderer.style || '')) || (v.thumbnailOverlays || []).some(x => x.thumbnailOverlayTimeStatusRenderer && x.thumbnailOverlayTimeStatusRenderer.style === 'LIVE');
  const ct = v.channelThumbnail && (v.channelThumbnail.channelThumbnailWithLinkRenderer ? v.channelThumbnail.channelThumbnailWithLinkRenderer.thumbnail : v.channelThumbnail);
  const ch = txt(v.shortBylineText).split('、')[0];
  return { id: v.videoId, title: txt(v.headline) || txt(v.title), ch, chId: (be && be.browseId) || (JSON.stringify(v.channelThumbnail || {}).match(/"browseId":"(UC[\w-]{22})"/) || [])[1] || '', avatar: lastThumb(ct), thumb: lastThumb(v.thumbnail), len: live ? '' : txt(v.lengthText), views: txt(v.shortViewCountText), when: txt(v.publishedTimeText), live };
}
// 何も読み取れなかったときに、YouTube がどの形で返したかを動作ログに残す(原因調べ用)
const shapes = j => { const n = {}; (function w(o) { if (!o || typeof o !== 'object') return; for (const k in o) { if (/(Renderer|ViewModel)$/.test(k)) n[k] = (n[k] || 0) + 1; w(o[k]); } })(j); return Object.entries(n).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, c]) => k + '×' + c).join(' '); };
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
    const vw = o.videoWithContextRenderer; // モバイル版の形
    if (vw && vw.videoId) {
      const it = vwcItem(vw), sec = secOf(it.len);
      if (kind === 's' && !(it.len && sec <= 61)) return;
      if (kind === 'v' && sec > 0 && sec <= 61 && /shorts/.test(JSON.stringify(vw.navigationEndpoint || {}))) return;
      items.push(it); return;
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
  if (!items.length && !token) bgLog('検索', `「${q}」の結果を読み取れませんでした・YouTubeの応答の形: ${shapes(j) || '空'}`, 'warn');
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
    const vw = o.videoWithContextRenderer; // モバイル版の形
    if (vw && vw.videoId) { const it = vwcItem(vw); if ((kind === 'l') === it.live && kind !== 's') items.push(it); return; }
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
  laterAdd(m.to, m.videoId); if (m.move) laterDel(m.from, m.videoId);
  return { ok: true };
}
async function plAdd(videoId, listId0) {
  if (!/^[\w-]{11}$/.test(videoId || '')) throw new Error('動画IDが不正です');
  const listId = listId0 || await plTarget(), c = await ytCtx(), headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
  const r = await fetch(`${ORIGIN}/youtubei/v1/browse/edit_playlist?key=${c.key}&prettyPrint=false`, { method: 'POST', credentials: 'include', headers,
    body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: c.ver, hl: 'ja', gl: 'JP' } }, playlistId: listId, actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId, dedupeOption: 'DEDUPE_OPTION_SKIP' }] }) });
  if (!r.ok) throw new Error('追加 ' + r.status + (r.status === 401 || r.status === 403 ? '(ログインが必要です)' : ''));
  const j = await r.json(); if (j.status && j.status !== 'STATUS_SUCCEEDED') throw new Error(j.status);
  { const { plTargetName } = await chrome.storage.local.get('plTargetName'); bgLog('再生リスト', `追加先: ${listId0 ? listId0 : listId}(${plTargetName || '名前不明'})・動画 ${videoId}`); }
  laterAdd(listId, videoId);
  { // 登録日(plSeen。Drive同期の対象): TubeFolio2 のボタンで追加した日を覚える。そのリストをまだ一度も開いていないときは、覚えない(開いたときに、元からある動画と区別できなくなるため)
    const d = new Date(), today = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    chrome.storage.local.get('plSeen').then(r => { const ps = r.plSeen || {}; if (!ps[listId] || ps[listId][videoId]) return; return chrome.storage.local.set({ plSeen: { ...ps, [listId]: { ...ps[listId], [videoId]: today } } }); }).catch(() => {});
  }
  chrome.storage.local.set({ plAddedAt: Date.now() }).catch(() => {}); // 「視聴」ページが、開いている一覧を取り直す合図(この端末だけ・同期しない)
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
      // 再生リストの形: パソコン版 playlistRenderer / gridPlaylistRenderer、モバイル版 compactPlaylistRenderer / playlistWithContextRenderer など(…PlaylistRenderer で playlistId を持つもの)
      const pk = Object.keys(o).find(k => /^(playlist|gridPlaylist|compactPlaylist|playlistWithContext)Renderer$/.test(k) && o[k] && o[k].playlistId);
      const p = pk && o[pk];
      if (p && p.playlistId) { out.set(p.playlistId, { id: p.playlistId, title: txt(p.title) || txt(p.headline), owner: txt(p.shortBylineText) || txt(p.longBylineText) || txt(p.ownerText), count: txt(p.videoCountText) || txt(p.videoCountShortText) || p.videoCount || '', thumb: lastThumb(p.thumbnails && p.thumbnails[0]) || lastThumb(p.thumbnail) || lastThumb(p.thumbnailRenderer && p.thumbnailRenderer.playlistVideoThumbnailRenderer && p.thumbnailRenderer.playlistVideoThumbnailRenderer.thumbnail) }); return; }
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
    if (i === 0 && !out.size) bgLog('再生リスト', `一覧を読み取れませんでした・YouTubeの応答の形: ${shapes(j) || '空'}`, 'warn'); // 原因調べ用
    if (!tok) break;
  }
  return [...out.values()];
}
// 再生リストの動画: [{ id, title, ch, len, thumb }]
async function plVideos(listId, order) {
  const out = []; let tok = null, ordered = false, first = true;
  for (let i = 0; i < 12 && out.length < 1200; i++) {
    let j = tok ? await authBrowse(null, tok) : await authBrowse('VL' + listId); tok = null;
    if (first) { // YouTube の並べ替えメニュー(追加日の新しい順 / 古い順)で、そのまま並べ替えたものを取る
      first = false;
      if (order === 'new' || order === 'old') {
        let want = null; const menu = [];
        (function w(o) { if (!o || typeof o !== 'object') return; const m = o.sortFilterSubMenuRenderer; if (m) { (m.subMenuItems || []).forEach(it => { const t = txt(it.title) || String(it.title || ''), isNew = /追加日.*(新しい|最新)|Date added (newest)/i.test(t), isOld = /追加日.*古い|Date added (oldest)/i.test(t); menu.push(t + (it.selected ? '*' : '')); if ((order === 'new' && isNew) || (order === 'old' && isOld)) want = { sel: !!it.selected, tok: it.serviceEndpoint && it.serviceEndpoint.continuationCommand && it.serviceEndpoint.continuationCommand.token }; }); return; } Object.values(o).forEach(w); })(j);
        if (want) { if (want.sel) ordered = true; else if (want.tok) { j = await authBrowse(null, want.tok); ordered = true; } }
        bgLog('再生リスト', `並べ替え(${order}): ${want ? 'YouTube側の並べ替えを使いました' : '並べ替えメニューが見つかりません'}・メニュー [${menu.join(' / ') || 'なし'}]・${listId}`);
      }
    }
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (o.continuationItemRenderer && !tok) { // 続きの読み込みの印だけを使う(並べ替えメニューの印は使わない)。印は、形式によって、continuationCommand か commandExecutorCommand の中にある
        (function f(x) { if (!x || typeof x !== 'object' || tok) return; if (x.continuationCommand && x.continuationCommand.token) { tok = x.continuationCommand.token; return; } Object.values(x).forEach(f); })(o.continuationItemRenderer);
        return;
      }
      const vw = o.videoWithContextRenderer; // モバイル版の形
      if (vw && vw.videoId) { const it = vwcItem(vw); out.push({ id: it.id, setId: '', title: it.title, ch: it.ch, chId: it.chId, handle: '', len: it.len, pct: 0, thumb: it.thumb, pub: pubMs(it.when) }); return; }
      const v = o.playlistVideoRenderer;
      if (v && v.videoId) { const ov = (v.thumbnailOverlays || []).find(x => x.thumbnailOverlayResumePlaybackRenderer); out.push({ id: v.videoId, setId: v.setVideoId || '', title: txt(v.title), ch: txt(v.shortBylineText), ...bylineIds(v.shortBylineText), len: txt(v.lengthText), pct: ov ? ov.thumbnailOverlayResumePlaybackRenderer.percentDurationWatched || 0 : 0, thumb: lastThumb(v.thumbnail), pub: pubMs(txt(v.videoInfo)) }); return; }
      const lv = o.lockupViewModel;
      if (lv && /VIDEO/.test(lv.contentType || '') && lv.contentId) {
        const m = lv.metadata && lv.metadata.lockupMetadataViewModel, im = lv.contentImage && lv.contentImage.thumbnailViewModel && lv.contentImage.thumbnailViewModel.image;
        const rows = (m && m.metadata && m.metadata.contentMetadataViewModel && m.metadata.contentMetadataViewModel.metadataRows) || [];
        out.push({ id: lv.contentId, title: m ? txt(m.title) : '', ch: rows[0] && rows[0].metadataParts && rows[0].metadataParts[0] ? txt(rows[0].metadataParts[0].text) : '', len: '', thumb: im && im.sources && im.sources.length ? im.sources[im.sources.length - 1].url : '', pub: pubMs(rows.map(r => (r.metadataParts || []).map(p => txt(p.text)).join(' ')).join(' ')) });
        return;
      }
      Object.values(o).forEach(walk);
    })(j);
    if (!tok) break;
  }
  return { items: out, ordered };
}

// ---- 移植した再生画面の機能(xtra.js)用: 推定の低評価(Return YouTube Dislike)と、決まったサイトへのGETの中継 ----
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'ryd') {
    fetch(`https://returnyoutubedislikeapi.com/votes?videoId=${encodeURIComponent(msg.v)}`)
      .then(r => (r.ok ? r.json() : null)).then(j => reply(j ? { likes: j.likes || 0, dislikes: j.dislikes || 0, views: j.viewCount || 0 } : null)).catch(() => reply(null));
    return true;
  }
});

// ---- プレビュー用: 動画のコマ割り画像(ストーリーボード)の情報。拡張機能のページ(YouTubeの枠の中)からは、YouTubeへ直接つなげないので、ここで取る ----
const sbMemBg = new Map();
async function sbInfo(vid) {
  if (!/^[\w-]{11}$/.test(vid || '')) return null;
  if (sbMemBg.has(vid)) return sbMemBg.get(vid);
  // ログイン情報つき(ほかの取得と同じ plPost)で player を呼ぶ。ログイン情報なしだと、storyboards が返らないことがある
  const p = await plPost('player', { videoId: vid }), spec = (p.storyboards && p.storyboards.playerStoryboardSpecRenderer && p.storyboards.playerStoryboardSpecRenderer.spec) || '';
  if (!spec) bgLog('プレビュー', `コマ割り画像の情報が返りません(${vid}・状態 ${(p.playabilityStatus && p.playabilityStatus.status) || '不明'}${p.playabilityStatus && p.playabilityStatus.reason ? '・' + p.playabilityStatus.reason : ''})`, 'warn');
  let out = null;
  if (spec) {
    const [base, ...lv] = spec.split('|'), i = lv.length - 1, f = (lv[i] || '').split('#');
    if (f.length >= 8) { const [w, h, count, cols, rows, interval, name, sigh] = f; out = { w: +w, h: +h, count: +count, cols: +cols, rows: +rows, interval: +interval || 0, dur: +(p.videoDetails && p.videoDetails.lengthSeconds) || 0, base, i, name, sigh }; }
  }
  sbMemBg.set(vid, out);
  return out;
}
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'sbInfo') { sbInfo(msg.v).then(reply).catch(e => { bgLog('プレビュー', 'コマ割り画像の取得に失敗: ' + String((e && e.message) || e), 'warn'); reply(null); }); return true; }
});

// ---- 一覧のチャンネルアイコン: 登録チャンネルにないチャンネルの分は、チャンネルのページから取る(1チャンネル1回。覚えておく) ----
const chAvMem = new Map();
async function chAvatar(chId) {
  if (!/^UC[\w-]{22}$/.test(chId || '')) return '';
  if (chAvMem.has(chId)) return chAvMem.get(chId);
  const { chAvCache = {} } = await chrome.storage.local.get('chAvCache');
  if (chAvCache[chId]) { chAvMem.set(chId, chAvCache[chId]); return chAvCache[chId]; }
  const j = await authBrowse(chId);
  let url = '';
  const find = o => { if (!o || typeof o !== 'object' || url) return; const av = o.avatar; if (av && av.thumbnails && av.thumbnails.length) { url = av.thumbnails[av.thumbnails.length - 1].url; return; } const am = o.avatarViewModel; if (am && am.image && am.image.sources && am.image.sources.length) { url = am.image.sources[am.image.sources.length - 1].url; return; } Object.values(o).forEach(find); };
  find(j.header); if (!url) find(j.metadata);
  if (url) { chAvMem.set(chId, url); chAvCache[chId] = url; const ks = Object.keys(chAvCache); if (ks.length > 800) ks.slice(0, ks.length - 800).forEach(k => delete chAvCache[k]); await chrome.storage.local.set({ chAvCache }); }
  return url;
}
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'chAvatar') { chAvatar(msg.id).then(url => reply({ url })).catch(() => reply({ url: '' })); return true; }
});

// 再生リストから動画を削除(視聴ページの×ボタン)。setVideoId があればそれで、なければ動画IDで消す
async function plRemove(m) {
  if (!m.listId || ['LL'].includes(m.listId)) throw new Error('このリストからは削除できません');
  if (!/^[\w-]{11}$/.test(m.videoId || '')) throw new Error('指定が不正です');
  await plEdit(m.listId, [m.setId ? { action: 'ACTION_REMOVE_VIDEO', setVideoId: m.setId, removedVideoId: m.videoId } : { action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: m.videoId }]);
  laterDel(m.listId, m.videoId);
  bgLog('再生リスト', `削除: ${m.listId}・動画 ${m.videoId}`);
  return { ok: true };
}

// ---- 「次のおすすめ動画」: 見ている動画の投稿者の再生リストのうち、この動画が入っているものを探し、その「次の動画」を返す ----
//   URLに再生リストの指定がなくても、投稿者が作った再生リストにこの動画が入っていれば、リストの次の動画を1本目に出すため。
//   投稿者の再生リスト(最大12件)を順に調べ、見つかった時点で終わる。結果は覚えておく(同じ動画は、再度調べない)。
const crMem = new Map(), crChPl = new Map();
async function creatorNext(vid) {
  if (!/^[\w-]{11}$/.test(vid || '')) return null;
  if (crMem.has(vid)) return crMem.get(vid);
  const p = await plPost('player', { videoId: vid }), chId = p.videoDetails && p.videoDetails.channelId;
  let res = null;
  if (/^UC[\w-]{22}$/.test(chId || '')) {
    let lists = crChPl.get(chId);
    if (!lists) {
      lists = []; // 投稿者の「再生リスト」タブ
      const j = await authBrowse(chId, null, 'EglwbGF5bGlzdHPyBgQKAkIA');
      (function w(o) {
        if (!o || typeof o !== 'object' || lists.length >= 12) return;
        const g = o.gridPlaylistRenderer || o.playlistRenderer; if (g && g.playlistId) { lists.push({ id: g.playlistId, title: txt(g.title) }); return; }
        const lv = o.lockupViewModel; if (lv && /PLAYLIST/.test(lv.contentType || '') && lv.contentId) { const m = lv.metadata && lv.metadata.lockupMetadataViewModel; lists.push({ id: lv.contentId, title: m ? txt(m.title) : '' }); return; }
        Object.values(o).forEach(w);
      })(j.contents || j);
      lists = lists.filter(x => !/^RD/.test(x.id)); crChPl.set(chId, lists);
    }
    for (const l of lists) {
      let r; try { r = await plVideos(l.id); } catch (e) { continue; }
      const items = (r && r.items) || [], i = items.findIndex(x => x.id === vid);
      if (i >= 0 && items[i + 1]) { const n = items[i + 1]; res = { listId: l.id, listTitle: l.title, next: { id: n.id, title: n.title, ch: n.ch, len: n.len } }; break; }
    }
  }
  crMem.set(vid, res);
  bgLog('次のおすすめ', res ? `投稿者の再生リスト「${res.listTitle}」に入っています。リストの次: ${res.next.title}` : `投稿者の再生リストに入っていません(${vid})`);
  return res;
}
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'creatorNext') { creatorNext(msg.v).then(reply).catch(e => { bgLog('次のおすすめ', '投稿者の再生リストを調べられません: ' + String((e && e.message) || e), 'warn'); reply(null); }); return true; }
});

// ---------- 新着の定期確認と通知(元のTubeFolioと同じ仕組み) ----------
//   決めた間隔ごとに、開いているYouTubeのタブへ新着の確認を頼む(YouTubeのログイン情報を使うため)。
//   新着はフォルダごとのルール(notifyRules)で振り分けて、YouTube画面の右下(サムネ+タイトル)か、PCの通知で知らせる。
const NT_DEF = { folders: {}, kw: 'LIVE, 生配信, 配信中, 速報', kwLevel: 'high', kwAll: false, live: { on: true, scope: 'all', upcoming: false, level: 'high' }, show: 'both', interval: 15 };
async function ntRules() {
  const { notifyRules } = await chrome.storage.local.get('notifyRules'), r = notifyRules || {};
  return { ...NT_DEF, ...r, live: { ...NT_DEF.live, ...(r.live || {}) }, folders: r.folders || {} };
}
async function setupCheckAlarm() {
  const iv = Math.max(5, (await ntRules()).interval || 15);
  const a = await chrome.alarms.get('tg-check');
  if (!a || a.periodInMinutes !== iv) chrome.alarms.create('tg-check', { periodInMinutes: iv, delayInMinutes: 1 });
  const q = await chrome.alarms.get('tg-queue');
  if (!q) chrome.alarms.create('tg-queue', { periodInMinutes: 5, delayInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(setupCheckAlarm);
chrome.runtime.onStartup.addListener(setupCheckAlarm);
setupCheckAlarm();
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.notifyRules) setupCheckAlarm(); });

async function askTab(msg) {
  const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
  if (!tabs.length) return { ok: false, error: 'YouTubeのタブが開いていません(YouTubeを開いてからもう一度押してください)' };
  tabs.sort((a, b) => (b.active - a.active) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  for (const t of tabs) { try { return await chrome.tabs.sendMessage(t.id, msg); } catch { /* 拡張機能の更新前に開いたタブ等 */ } }
  return { ok: false, error: 'YouTubeのタブを再読み込みしてください' };
}
chrome.alarms.onAlarm.addListener(a => {
  if (a.name === 'tg-check') { flushQueue(); askTab({ type: 'tg-check', force: false }).then(r => { if (r && r.ok === false) bgLog('新着', '定期確認:' + r.error, 'warn'); }); }
  if (a.name === 'tg-queue') flushQueue();
});
async function flushQueue() { // 時間帯待ちの通知を、時間になったら出す
  const { notifyQueue = [] } = await chrome.storage.local.get('notifyQueue');
  if (!notifyQueue.length) return;
  const now = Date.now(), due = notifyQueue.filter(x => x.due <= now);
  if (!due.length) return;
  await chrome.storage.local.set({ notifyQueue: notifyQueue.filter(x => x.due > now) });
  deliver(due.filter(x => now - x.due < 2 * 864e5), '時間帯'); // 2日以上待ったものは出さない
}
const notifUrl = new Map();
const NT_KIND = { live: '🔴 配信中', upcoming: '⏰ 配信予定', kw: '⚡', new: '' };
const ntLabel = it => `${NT_KIND[it.kind] ? NT_KIND[it.kind] + ' ' : ''}【${it.folder}】${it.ch}`;
// PCの通知のアイコンを、動画のサムネにする。通知は外部の画像URLを使えないので、取ってきて data URL にする。
//   サムネ(16:9)の真ん中を正方形に切り抜く(アイコンの枠は正方形なので、小さく潰れないように)。取れなければ null(拡張機能のアイコンを使う)
async function thumbIcon(v) {
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`https://i.ytimg.com/vi/${encodeURIComponent(v)}/mqdefault.jpg`, { credentials: 'omit', signal: ctl.signal }).finally(() => clearTimeout(t));
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob()), s = Math.min(bmp.width, bmp.height);
    const cv = new OffscreenCanvas(192, 192), g = cv.getContext('2d');
    g.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 192, 192);
    const buf = new Uint8Array(await (await cv.convertToBlob({ type: 'image/jpeg', quality: 0.85 })).arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return 'data:image/jpeg;base64,' + btoa(bin);
  } catch (e) { return null; }
}
async function deliver(items, why = '') {
  if (!items.length) return;
  const rules = await ntRules();
  bgLog('通知', `${why ? why + ':' : ''}${items.length}本 ` + items.slice(0, 5).map(x => `${ntLabel(x)}(${x.level === 'high' ? '高' : x.level === 'low' ? '低' : '中'})`).join('、'));
  let toPage = rules.show !== 'pc', toPc = rules.show !== 'page';
  if (toPage) { const r = await askTab({ type: 'tg-toast', items }); if (!r || !r.ok) { toPage = false; toPc = true; } } // YouTubeのタブが無ければPCの通知で
  if (!toPc) return;
  const icon = chrome.runtime.getURL('icon128.png');
  const high = items.filter(x => x.level === 'high'), rest = items.filter(x => x.level !== 'high');
  const single = async it => {
    const id = 'tg-' + it.v + '-' + Date.now() + Math.random().toString(36).slice(2, 5);
    notifUrl.set(id, 'https://www.youtube.com/watch?v=' + it.v);
    const when = it.kind === 'upcoming' && it.at ? `(${new Date(it.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}〜)` : '';
    const th = it.v ? await thumbIcon(it.v) : null; // 動画のサムネ(取れなければ拡張機能のアイコン)
    chrome.notifications.create(id, { type: 'basic', iconUrl: th || icon, title: ntLabel(it), message: it.title + when, priority: it.level === 'high' ? 2 : it.level === 'low' ? 0 : 1, requireInteraction: it.level === 'high', silent: it.level === 'low' });
  };
  high.forEach(single);
  if (rest.length <= 3) rest.forEach(single);
  else {
    const id = 'tg-many-' + Date.now(); notifUrl.set(id, 'https://www.youtube.com/feed/subscriptions');
    chrome.notifications.create(id, { type: 'list', iconUrl: icon, title: `新着 ${rest.length} 本(${[...new Set(rest.map(x => x.folder))].join('・')})`, message: '', items: rest.slice(0, 5).map(x => ({ title: x.ch, message: x.title })), priority: 1, silent: rest.every(x => x.level === 'low') });
  }
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'tg-check-now') { askTab({ type: 'tg-check', force: true }).then(reply); return true; }
  if (msg && msg.type === 'tg-notify-test') { deliver([{ v: 'dQw4w9WgXcQ', title: 'テスト通知です(クリックで動画を開きます)', ch: 'TubeFolio2', folder: 'テスト', level: msg.level || 'normal', kind: msg.kind || 'new' }], 'テスト').then(() => reply({ ok: true })); return true; }
  if (msg && msg.type === 'tg-notify') deliver(msg.items || []);
});
chrome.notifications.onClicked.addListener(id => { const url = notifUrl.get(id); if (url) chrome.tabs.create({ url }); chrome.notifications.clear(id); });
