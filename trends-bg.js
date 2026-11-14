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
async function fetchTrendsPage(hours, limit, cat) {
  const res = await fetch('https://trends.google.co.jp/trending?geo=JP&hours=' + hours + '&hl=ja', { credentials: 'omit' });
  if (!res.ok) throw new Error('急上昇のページを取得できませんでした(' + res.status + ')');
  const html = await res.text();
  try {
    const m = html.match(/AF_initDataCallback\(\{key: 'ds:0', hash: '[0-9]+', data:/);
    if (m) {
      const rest = html.slice(m.index + m[0].length);
      const d = JSON.parse(rest.slice(0, rest.indexOf(', sideChannel')));
      // カテゴリは、Google のサーバーに頼まず、データの x[10](カテゴリ番号の並び)で、こちらで絞る
      const items = (d[1] || []).filter(x => Array.isArray(x) && x[0] && (!cat || (Array.isArray(x[10]) && x[10].includes(cat)))).slice(0, limit).map(x => ({
        title: String(x[0]), start: x[3]?.[0] || 0, end: x[4]?.[0] || 0, vol: +x[6] || 0, pct: +x[8] || 0,
        related: (x[9] || []).filter(w => w && w !== x[0]).slice(0, 12)
      }));
      if (items.length || cat) return items; // カテゴリで絞って 0 件のときは、そのまま「0件」
    }
  } catch { /* 表から読む */ }
  const cls = (b, c) => { const mm = b.match(new RegExp('class="' + c + '"[^>]*>([^<]*)<')); return mm ? xmlText(mm[1]) : ''; };
  return (html.match(/<tr[^>]*data-row-id[^]*?<\/tr>/g) || []).map(row => ({
    title: cls(row, 'mZ3RIc'), traffic: cls(row, 'lqv0Cb'), pctText: cls(row, 'TXt85b'), agoText: cls(row, 'A7jE4'),
    related: [...new Set([...row.matchAll(/data-term="([^"]+)"/g)].map(mm => xmlText(mm[1])))]
  })).filter(x => x.title).slice(0, limit);
}
async function fetchTrends(hours, cat) {
  const items = (await fetchTrendsPage(hours, 50, cat)).map(x => ({ ...x, news: [] })); // ニュースは、ワードにマウスを乗せたときに探す
  if (!items.length && !cat) throw new Error('急上昇ワードを読み取れませんでした(Google トレンドのページの作りが変わった可能性があります)');
  return { at: Date.now(), hours, items };
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'tg-trends') return;
  (async () => {
    const hours = msg.hours === 4 ? 4 : msg.hours === 48 ? 48 : 24, cat = Math.max(0, Math.min(30, +msg.cat || 0)); // 48時間と、カテゴリ(Google トレンドのカテゴリ番号。0 = すべて)は、地球儀(trwsphere.js)から
    const key = 'trendsCache' + hours + (cat ? '_c' + cat + 'f' : '');
    const cached = (await chrome.storage.local.get(key))[key];
    const age = cached ? Date.now() - cached.at : Infinity;
    if (cached && age < (msg.force ? 60e3 : TRENDS_TTL)) return reply(cached); // 取り直しでも1分以内なら使い回す
    try {
      const fresh = await fetchTrends(hours, cat);
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

// (以前あった「急上昇動画(Top1Trend)」のパネルは廃止。新しい急上昇ツール(🧪 実験)に移行。古い控えの t1_* だけ消す)
chrome.storage.local.get(null).then(all => { const ks = Object.keys(all).filter(k => /^t1_/.test(k)); if (ks.length) chrome.storage.local.remove(ks); }).catch(() => {});
