// 急上昇ワード・急上昇動画のデータ取り(背景)。background.js から importScripts で読み込む。元のTubeFolio の background.js から移した部分。
//   取ったデータは storage にキャッシュする(trendsCache4 / trendsCache24 / t1_<日付>)。
//   どれも取り直せるキャッシュなので、Drive 同期(sync.js の SYNC_KEYS)には入れない。

// ---- Google トレンドの急上昇ワード(日本)。30分は覚えておく ----
const TRENDS_TTL = 30 * 60e3;
function xmlText(s) {
  return (s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&').trim();
}
const xmlTag = (s, t) => { const m = s.match(new RegExp('<' + t + '(?: [^>]*)?>([^]*?)</' + t + '>')); return m ? xmlText(m[1]) : ''; }; // [^] = 改行も含む任意の文字
// 急上昇のページ: ページに埋め込まれているデータ(AF_initDataCallback の ds:0)から、関連度順に上位 N 件。
//   hours は 4 か 24。ds:0 が読めないときは、ページの表(25件ほど)から読む
async function fetchTrendsPage(hours, limit) {
  const res = await fetch('https://trends.google.co.jp/trending?geo=JP&hours=' + hours + '&hl=ja', { credentials: 'omit' });
  if (!res.ok) throw new Error('急上昇のページを取得できませんでした(' + res.status + ')');
  const html = await res.text();
  try {
    const m = html.match(/AF_initDataCallback\(\{key: 'ds:0', hash: '[0-9]+', data:/);
    if (m) {
      const rest = html.slice(m.index + m[0].length);
      const d = JSON.parse(rest.slice(0, rest.indexOf(', sideChannel')));
      const items = (d[1] || []).filter(x => Array.isArray(x) && x[0]).slice(0, limit).map(x => ({
        title: String(x[0]), start: x[3]?.[0] || 0, end: x[4]?.[0] || 0, vol: +x[6] || 0, pct: +x[8] || 0,
        related: (x[9] || []).filter(w => w && w !== x[0]).slice(0, 12)
      }));
      if (items.length) return items;
    }
  } catch { /* 表から読む */ }
  const cls = (b, c) => { const mm = b.match(new RegExp('class="' + c + '"[^>]*>([^<]*)<')); return mm ? xmlText(mm[1]) : ''; };
  return (html.match(/<tr[^>]*data-row-id[^]*?<\/tr>/g) || []).map(row => ({
    title: cls(row, 'mZ3RIc'), traffic: cls(row, 'lqv0Cb'), pctText: cls(row, 'TXt85b'), agoText: cls(row, 'A7jE4'),
    related: [...new Set([...row.matchAll(/data-term="([^"]+)"/g)].map(mm => xmlText(mm[1])))]
  })).filter(x => x.title).slice(0, limit);
}
async function fetchTrends(hours) {
  const items = (await fetchTrendsPage(hours, 50)).map(x => ({ ...x, news: [] })); // ニュースは、ワードにマウスを乗せたときに探す
  if (!items.length) throw new Error('急上昇ワードを読み取れませんでした(Google トレンドのページの作りが変わった可能性があります)');
  return { at: Date.now(), hours, items };
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'tg-trends') return;
  (async () => {
    const hours = msg.hours === 4 ? 4 : 24;
    const key = 'trendsCache' + hours;
    const cached = (await chrome.storage.local.get(key))[key];
    const age = cached ? Date.now() - cached.at : Infinity;
    if (cached && age < (msg.force ? 60e3 : TRENDS_TTL)) return reply(cached); // 取り直しでも1分以内なら使い回す
    try {
      const fresh = await fetchTrends(hours);
      await chrome.storage.local.set({ [key]: fresh });
      reply(fresh);
    } catch (e) { reply(cached || { error: e.message }); }
  })();
  return true;
});

// ---- ワードのニュース: Bing ニュースの検索 RSS から3件(記事の画像つき)。取れなければ Google ニュースの RSS(画像なし) ----
const newsMem = new Map();
async function newsFromBing(q) {
  const res = await fetch('https://www.bing.com/news/search?q=' + encodeURIComponent(q) + '&format=rss&setlang=ja&cc=JP', { credentials: 'omit' });
  if (!res.ok) throw new Error('bing ' + res.status);
  const xml = await res.text();
  const all = xml.split('<item>').slice(1, 11).map(raw => {
    const body = raw.split('</item>')[0];
    let url = xmlTag(body, 'link');
    try { const u = new URL(url).searchParams.get('url'); if (u) url = u; } catch { /* そのまま */ } // Bing の中継ではなく、記事のアドレスへ
    const img = xmlTag(body, 'News:Image').replace(/^http:/, 'https:');
    return { title: xmlTag(body, 'title'), url, source: xmlTag(body, 'News:Source'), picture: img ? img + '&w=120&h=120&c=14' : '' };
  }).filter(n => n.title && /^https?:\/\//.test(n.url));
  // 画像のある記事を先に(元の順は保つ)。3件に絞る
  return [...all.filter(n => n.picture), ...all.filter(n => !n.picture)].slice(0, 3);
}
async function newsFromGoogle(q) {
  const res = await fetch('https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=ja&gl=JP&ceid=JP:ja', { credentials: 'omit' });
  if (!res.ok) throw new Error('google ' + res.status);
  const xml = await res.text();
  return xml.split('<item>').slice(1, 4).map(raw => {
    const body = raw.split('</item>')[0];
    let title = xmlTag(body, 'title'); const source = xmlTag(body, 'source');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    return { title, url: xmlTag(body, 'link'), source, picture: '' };
  }).filter(n => n.title && /^https?:\/\//.test(n.url));
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'tg-trend-news' || !msg.q) return;
  (async () => {
    const hit = newsMem.get(msg.q);
    if (hit && Date.now() - hit.at < 30 * 60e3) return reply({ news: hit.news });
    let news = [];
    try { news = await newsFromBing(msg.q); } catch { /* 次へ */ }
    if (!news.length) { try { news = await newsFromGoogle(msg.q); } catch { /* なし */ } }
    newsMem.set(msg.q, { at: Date.now(), news });
    if (newsMem.size > 200) newsMem.delete(newsMem.keys().next().value);
    reply({ news });
  })();
  return true;
});

// ---- 急上昇動画(日本): Top1Trend(t1trend.com)の「日別 Top 50」の一覧ページから読む ----
//   最新は /youtube/jp、日付ごとは /youtube/jp/YYYY-MM-DD。直近10日ほどは日付ごとの保存が無く、最新と同じ一覧が返る(same で知らせる)
const T1_TTL = 30 * 60e3;
function t1Decode(s) {
  return xmlText(s).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d));
}
function t1Tokens(x) {
  return x.replace(/<svg[^]*?<\/svg>/g, '').replace(/<(script|style)[^]*?<\/\1>/g, '').split(/<[^>]+>/).map(s => t1Decode(s).trim()).filter(Boolean);
}
function t1Parse(html) {
  const out = new Map();
  const idOf = s => (s.match(/href="\/youtube\/video_([\w-]{11})"/) || [])[1];
  for (const part of html.split('<div data-slot="card"')) { // 1〜3位のカード
    if (!/(1st|2nd|3rd)<!-- --> Place/.test(part.slice(0, 3000))) continue;
    const id = idOf(part); if (!id) continue;
    const t = t1Tokens(part.slice(0, 9000)), i = t.indexOf('Place'), p = t.indexOf('pts');
    out.set(id, { id, rank: +t[i + 2], dur: t[i + 1], title: t[i + 3], channel: t[i + 4], views: '', score: p > 0 ? t[p - 1] : '' });
  }
  for (const row of html.match(/<tr data-slot="table-row"[^]*?<\/tr>/g) || []) { // 4位以降の表
    const id = idOf(row); if (!id || out.has(id)) continue;
    const t = t1Tokens(row), d = t.findIndex(s => /^\d+:\d\d(?::\d\d)?$/.test(s));
    if (d < 0) continue;
    out.set(id, { id, rank: +t.find(s => /^\d+$/.test(s)), dur: t[d], title: t[d + 1], channel: t[d + 2], views: t[d + 3] || '', score: /^\d+$/.test(t[t.length - 1]) ? t[t.length - 1] : '' });
  }
  return [...out.values()].filter(x => x.title).sort((a, b) => a.rank - b.rank);
}
async function t1Fetch(date) {
  const res = await fetch('https://t1trend.com/youtube/jp' + (date && date !== 'latest' ? '/' + date : ''), { credentials: 'omit' });
  if (!res.ok) throw new Error('Top1Trend から取得できませんでした(' + res.status + ')');
  const items = t1Parse(await res.text());
  if (!items.length) throw new Error('一覧を読み取れませんでした(Top1Trend のページの作りが変わった可能性があります)');
  return items;
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'tg-t1') return;
  (async () => {
    const date = /^\d{4}-\d\d-\d\d$/.test(msg.date) ? msg.date : 'latest';
    const key = 't1_' + date;
    const c = (await chrome.storage.local.get(key))[key];
    const ttl = date === 'latest' ? T1_TTL : 24 * 3600e3;
    if (c && Date.now() - c.at < (msg.force ? 60e3 : ttl)) return reply(c);
    try {
      const items = await t1Fetch(date);
      let same = false;
      if (date !== 'latest') { // 日付ごとの保存が無い日は、最新と同じ一覧が返る
        const l = await chrome.storage.local.get('t1_latest');
        const latest = l.t1_latest && Date.now() - l.t1_latest.at < T1_TTL ? l.t1_latest.items : await t1Fetch('latest').catch(() => null);
        if (latest) same = latest.map(x => x.id).join() === items.map(x => x.id).join();
      }
      const fresh = { at: Date.now(), date, same, items };
      await chrome.storage.local.set({ [key]: fresh });
      reply(fresh);
    } catch (e) { reply(c || { error: e.message }); }
  })();
  return true;
});
