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
    published: (e[1].match(/<published>([^<]+)/) || [])[1]
  })).filter(x => x.id).sort((a, b) => b.published.localeCompare(a.published)).slice(0, 2);
  vcache.set(id, { t: Date.now(), v });
  return v;
}

async function info(key, wantVideos) {
  const m = await resolve(key);
  const out = { id: m.id, avatar: m.avatar, name: m.name };
  if (wantVideos && m.id) out.videos = await videos(m.id);
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

chrome.runtime.onMessage.addListener((m, _s, send) => {
  if (!m) return;
  if (m.type === 'scan') { limit(() => scan(m.key)).then(send).catch(e => send({ error: String(e) })); return true; }
  if (m.type === 'openManager') openMgr();
  if (m.type === 'chInfo' || m.type === 'avatar') {
    limit(() => info(m.key, m.type === 'chInfo')).then(send).catch(e => send({ error: String(e) }));
    return true;
  }
});
