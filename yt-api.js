// YouTubeからのデータ取得（登録チャンネル一覧・最終投稿）
const YTAPI = (() => {
  // ---------- HTML内のJSON抽出 ----------
  function extractObject(text, start) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
    }
    return null;
  }

  function findJson(html, marker) {
    let i = html.indexOf(marker);
    if (i < 0) return null;
    i = html.indexOf('{', i);
    try { return JSON.parse(extractObject(html, i)); } catch { return null; }
  }

  function findCfg(html) {
    const cfg = {};
    let i = 0;
    while ((i = html.indexOf('ytcfg.set({', i)) >= 0) {
      const s = extractObject(html, i + 10);
      i += 10;
      try { Object.assign(cfg, JSON.parse(s)); } catch { /* skip */ }
    }
    return cfg;
  }

  // ---------- InnerTube API（ログイン中のセッションで呼ぶ） ----------
  async function sha1(s) {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function cookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&') + '=([^;]*)'));
    return m ? m[1] : null;
  }

  async function authHeader() {
    const ts = Math.floor(Date.now() / 1000);
    const origin = 'https://www.youtube.com';
    const parts = [];
    const pairs = [
      ['SAPISIDHASH', cookie('SAPISID') || cookie('__Secure-3PAPISID')],
      ['SAPISID1PHASH', cookie('__Secure-1PAPISID')],
      ['SAPISID3PHASH', cookie('__Secure-3PAPISID')]
    ];
    for (const [label, val] of pairs) {
      if (val) parts.push(`${label} ${ts}_${await sha1(`${ts} ${val} ${origin}`)}`);
    }
    return parts.join(' ');
  }

  // ---------- 背景(background.js)の代わりに YouTube へ通信する ----------
  //   スマホのブラウザなどでは、拡張機能の背景から youtube.com への通信が止められる(Failed to fetch)。
  //   そのときは背景が 'tf-pfetch' で頼んでくるので、このページ(youtube.com)から同じ通信をして、結果を返す。
  //   ログインの印(Authorization)が付いていなければ、このページのクッキーから作って付ける
  if (/(^|\.)youtube\.com$/.test(location.hostname)) {
    chrome.runtime.onMessage.addListener((m, sender, send) => {
      if (!m || m.type !== 'tf-pfetch') return;
      (async () => {
        try {
          const u = new URL(m.url); if (!/(^|\.)youtube\.com$/.test(u.hostname)) throw new Error('youtube.com 以外には使えません');
          const url = location.origin + u.pathname + u.search; // このページと同じ場所(www / m)へ
          const headers = { ...(m.headers || {}) };
          for (const k of Object.keys(headers)) if (/^(origin|x-origin|cookie)$/i.test(k)) delete headers[k];
          if (!Object.keys(headers).some(k => /^authorization$/i.test(k))) { const a = await authHeader(); if (a) { headers.Authorization = a; headers['X-Goog-AuthUser'] = headers['X-Goog-AuthUser'] || '0'; } }
          const r = await fetch(url, { method: m.method || 'GET', headers, body: m.body, credentials: 'include' });
          send({ status: r.status, statusText: r.statusText, type: r.headers.get('content-type') || '', body: await r.text() });
        } catch (e) { send({ ok: false, error: String((e && e.message) || e) }); }
      })();
      return true;
    });
  }

  //   anon：ログインしていない状態で取得する（視聴履歴に影響されない検索結果・関連動画にするため）
  async function innertube(endpoint, body, cfg, signal, anon = false) {
    const headers = {
      'Content-Type': 'application/json',
      'X-Origin': 'https://www.youtube.com',
      'X-Youtube-Client-Name': String(cfg.INNERTUBE_CONTEXT_CLIENT_NAME ?? 1),
      'X-Youtube-Client-Version': cfg.INNERTUBE_CLIENT_VERSION || ''
    };
    if (anon) {
      body = { ...body, context: { ...(body.context || cfg.INNERTUBE_CONTEXT || {}), user: {} } };
      if (body.context.client) body.context.client = { ...body.context.client, visitorData: undefined };
    } else {
      headers['X-Goog-AuthUser'] = String(cfg.SESSION_INDEX ?? 0);
      const auth = await authHeader();
      if (auth) headers.Authorization = auth;
      if (cfg.DELEGATED_SESSION_ID) headers['X-Goog-PageId'] = cfg.DELEGATED_SESSION_ID;
    }
    const url = `/youtubei/v1/${endpoint}?prettyPrint=false` + (cfg.INNERTUBE_API_KEY ? `&key=${cfg.INNERTUBE_API_KEY}` : '');
    const r = await fetch(url, {
      method: 'POST',
      credentials: anon ? 'omit' : 'include',
      headers,
      signal,
      body: JSON.stringify({ context: cfg.INNERTUBE_CONTEXT, ...body })
    });
    if (!r.ok) {
      TG.log('YouTube', `${endpoint}${body?.browseId ? ' ' + body.browseId : ''} がエラー (${r.status})`, 'warn');
      throw new Error(`YouTube API エラー (${r.status})`);
    }
    return r.json();
  }

  // ---------- JSON走査 ----------
  const SKIP = new Set(['adSlotRenderer', 'promotedSparklesWebRenderer', 'promotedVideoRenderer', 'statementBannerRenderer']);
  function walk(node, fn) {
    if (Array.isArray(node)) node.forEach(n => walk(n, fn));
    else if (node && typeof node === 'object') {
      for (const k in node) {
        if (SKIP.has(k)) continue; // 広告は読まない
        fn(k, node[k]);
        walk(node[k], fn);
      }
    }
  }
  const text = t => (typeof t === 'string' ? t : t?.simpleText ?? t?.runs?.map(r => r.text).join('') ?? t?.content ?? '');
  function walkPath(node, fn, stack = []) {
    if (node && typeof node === 'object') {
      stack.push(node);
      for (const k in node) {
        fn(k, node[k], stack);
        walkPath(node[k], fn, stack);
      }
      stack.pop();
    }
  }
  function thumbOf(r) {
    const a = r?.thumbnail?.thumbnails;
    let u = a?.[a.length - 1]?.url || '';
    if (u.startsWith('//')) u = 'https:' + u;
    return u;
  }

  function add(out, id, name, base, thumb, maybeHandle) {
    let key = TG.channelKey(base);
    if (!key && /^@/.test(maybeHandle || '')) key = TG.channelKey('/' + maybeHandle);
    if (!key) key = 'channel/' + id;
    out.set(id, { id, key, name, thumb });
  }

  function parsePage(json, out) {
    let token = null;
    walk(json, (k, v) => {
      if ((k === 'channelRenderer' || k === 'gridChannelRenderer') && v?.channelId) {
        add(out, v.channelId, text(v.title), v.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl, thumbOf(v), text(v.subscriberCountText));
      } else if (k === 'continuationCommand' && v?.token) {
        token = v.token;
      }
    });
    return token;
  }

  function parseGuide(json, out) {
    walk(json, (k, v) => {
      if (k === 'guideEntryRenderer') {
        const b = v?.navigationEndpoint?.browseEndpoint;
        if (b?.browseId?.startsWith('UC')) add(out, b.browseId, text(v.formattedTitle), b.canonicalBaseUrl, thumbOf(v), '');
      }
    });
  }

  // 登録チャンネル一覧を全件取得
  async function fetchSubscriptions(onProgress = () => {}) {
    const html = await (await fetch('/feed/channels', { credentials: 'include' })).text();
    const cfg = findCfg(html);
    if (cfg.LOGGED_IN === false) throw new Error('YouTubeにログインしていません');
    const data = findJson(html, 'ytInitialData = ') || findJson(html, 'ytInitialData"] = ');
    const out = new Map();
    let token = data ? parsePage(data, out) : null;
    onProgress(out.size);
    const seen = new Set();
    let n = 0;
    while (token && !seen.has(token) && n++ < 300) {
      seen.add(token);
      token = parsePage(await innertube('browse', { continuation: token }, cfg), out);
      onProgress(out.size);
    }
    // 予備：サイドバー（ガイド）から取得
    if (out.size === 0) {
      try { parseGuide(await innertube('guide', {}, cfg), out); } catch { /* ignore */ }
    }
    return [...out.values()];
  }

  // ---------- 最終投稿日（RSS） ----------
  async function resolveId(key, signal) {
    const r = await fetch(TG.channelUrl(key), { credentials: 'omit', signal });
    if (!r.ok) return null;
    const html = await r.text();
    const m =
      html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) ||
      html.match(/"externalId":"(UC[\w-]{22})"/) ||
      html.match(/itemprop="identifier" content="(UC[\w-]{22})"/);
    return m?.[1] || null;
  }

  async function fetchFeed(id, signal) {
    const r = await fetch(`/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`, { credentials: 'omit', signal });
    if (!r.ok) return { last: null, interval: null, count: 0 };
    const doc = new DOMParser().parseFromString(await r.text(), 'application/xml');
    const ds = [...doc.getElementsByTagName('entry')]
      .map(e => Date.parse(e.getElementsByTagName('published')[0]?.textContent || ''))
      .filter(Boolean)
      .sort((a, b) => b - a);
    return {
      last: ds[0] || null,
      interval: ds.length > 1 ? (ds[0] - ds[ds.length - 1]) / (ds.length - 1) / 864e5 : null,
      count: ds.length
    };
  }

  // ショートの最終投稿日：「ショート」タブには日付が無いので、RSS（ショートのURLの項目）→ 動画ページの順で調べる
  async function shortDate(id, shorts, signal) {
    const ids = new Set(shorts.map(x => x.v));
    try {
      const r = await fetch('/feeds/videos.xml?channel_id=' + encodeURIComponent(id), { credentials: 'omit', signal });
      if (r.ok) {
        const doc = new DOMParser().parseFromString(await r.text(), 'application/xml');
        let best = 0;
        for (const e of doc.getElementsByTagName('entry')) {
          const href = e.getElementsByTagName('link')[0]?.getAttribute('href') || '';
          const vid = e.getElementsByTagNameNS('*', 'videoId')[0]?.textContent || '';
          if (/\/shorts\//.test(href) || ids.has(vid)) best = Math.max(best, Date.parse(e.getElementsByTagName('published')[0]?.textContent || '') || 0);
        }
        if (best) return best;
      }
    } catch (e) { if (signal?.aborted) throw e; }
    try {
      const r = await fetch('/watch?v=' + encodeURIComponent(shorts[0].v), { credentials: 'omit', signal });
      if (r.ok) {
        const m = (await r.text()).match(/"(?:publishDate|uploadDate)":"([^"]+)"/);
        return (m && Date.parse(m[1])) || 0;
      }
    } catch (e) { if (signal?.aborted) throw e; }
    return 0;
  }

  // 最終投稿：チャンネルの「動画」「ライブ」「ショート」それぞれの最終投稿日（内部API）
  //   戻り値: { id, last(動画), lastLive, lastShort, any(3つのうち最新), interval, count, shortsOnly?, error? }
  async function fetchMeta(ch, signal) {
    let id = ch.id || (ch.key.startsWith('channel/') ? ch.key.slice(8) : null);
    if (!id) id = await resolveId(ch.key, signal);
    if (!id) return { id: null, last: null, interval: null, count: 0, error: true };
    let failed = false;
    try {
      const videos = await channelTab(id, 'video', signal);
      const vlist = videos.filter(x => x.p);
      let live = [];
      try { live = (await channelTab(id, 'live', signal)).filter(x => x.p && !x.upcoming); } catch (e) { if (signal?.aborted) throw e; }
      let shorts = [];
      try { shorts = await channelTab(id, 'short', signal); } catch (e) { if (signal?.aborted) throw e; }
      let lastShort = null;
      if (shorts.length) { try { lastShort = (await shortDate(id, shorts, signal)) || null; } catch (e) { if (signal?.aborted) throw e; } }
      const lastLive = live.length ? Math.max(...live.map(x => x.p)) : null;
      // 動画が無ければライブを投稿間隔の計算に使う（従来どおり）
      const list = vlist.length ? vlist : live;
      const last = vlist.length ? Math.max(...vlist.map(x => x.p)) : null;
      const any = Math.max(last || 0, lastLive || 0, lastShort || 0) || null;
      if (list.length) {
        const ds = list.map(x => x.p).sort((a, b) => b - a);
        const iv = ds.length > 1 ? (ds[0] - ds[ds.length - 1]) / (ds.length - 1) / 864e5 : null;
        return { id, last: last || ds[0], lastLive, lastShort, any, interval: iv > 0 ? iv : null, count: ds.length };
      }
      if (!any && videos.length) return { id, last: null, interval: null, count: videos.length, nodate: true };
      if (shorts.length) return { id, last: null, lastLive, lastShort, any, interval: null, count: shorts.length, shortsOnly: true };
      return { id, last: null, interval: null, count: 0 };
    } catch (e) {
      if (signal?.aborted) throw e;
      failed = true;
    }
    try {
      const r = await fetchFeed(id, signal);
      if (r.last) return { id, ...r, any: r.last };
    } catch { /* RSSも不可 */ }
    return { id, last: null, interval: null, count: 0, error: failed };
  }

  // チャンネルの人気動画（「動画」タブの「人気順」）
  async function channelPopular(id, signal) {
    const cfg = await getCfg();
    const context = structuredClone(cfg.INNERTUBE_CONTEXT || {});
    context.client = { ...(context.client || {}), hl: 'en' };
    const json = await innertube('browse', { context, browseId: id, params: TAB_PARAMS.video }, cfg, signal);
    let token = null;
    walkPath(json, (k, v, stack) => {
      if (token || k !== 'continuationCommand' || !v?.token) return;
      for (let i = stack.length - 1; i >= Math.max(0, stack.length - 8); i--) {
        const o = stack[i];
        if (Array.isArray(o)) continue;
        const t = text(o.text) || text(o.title);
        if (t) { if (/^\s*popular\s*$/i.test(t)) token = v.token; break; }
      }
    });
    if (!token) return [];
    return parseTab(await innertube('browse', { context, continuation: token }, cfg, signal));
  }

  // ---------- チャンネルのタブ（動画 / ライブ / ショート） ----------
  const TAB_PARAMS = {
    video: 'EgZ2aWRlb3PyBgQKAjoA',
    short: 'EgZzaG9ydHPyBgUKA5oBAA==',
    live: 'EgdzdHJlYW1z8gYECgJ6AA=='
  };
  const UNIT = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };
  const UNIT_JA = { '秒': 1e3, '分': 6e4, '時間': 36e5, '日': 864e5, '週間': 6048e5, 'か月': 2592e6, 'ヶ月': 2592e6, 'ヵ月': 2592e6, '年': 31536e6 };

  function agoMs(s) {
    if (!s) return null;
    let m = s.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
    if (m) return +m[1] * UNIT[m[2].toLowerCase()];
    m = s.match(/(\d+)\s*(秒|分|時間|日|週間|か月|ヶ月|ヵ月|年)前/);
    if (m) return +m[1] * UNIT_JA[m[2]];
    return null;
  }

  // 視聴済みの割合（YouTubeの「続きから再生」バー）
  function watchedPct(obj) {
    let pct = 0;
    walk(obj, (k, v) => {
      if (k === 'thumbnailOverlayResumePlaybackRenderer' && v?.percentDurationWatched != null) pct = Math.max(pct, +v.percentDurationWatched || 0);
      if (k === 'thumbnailOverlayProgressBarViewModel' && v?.startPercent != null) pct = Math.max(pct, +v.startPercent || 0);
    });
    return pct;
  }

  // 動画の長さ（「12:34」「1:02:03」の表示から秒に）
  function durationOf(obj) {
    let found = 0;
    const scan = o => {
      if (found || !o || typeof o !== 'object') return;
      for (const k in o) {
        const v = o[k];
        if (typeof v === 'string') {
          const m = v.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
          if (m) { found = (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3]; return; }
        } else scan(v);
        if (found) return;
      }
    };
    scan(obj);
    return found;
  }

  function deepAgo(obj, title) {
    let found = null;
    const scan = o => {
      if (found != null || !o || typeof o !== 'object') return;
      for (const k in o) {
        const v = o[k];
        if (typeof v === 'string') {
          if (v.length < 80 && v !== title) { const d = agoMs(v); if (d != null) { found = d; return; } }
        } else scan(v);
        if (found != null) return;
      }
    };
    scan(obj);
    return found;
  }

  function viewsNum(s) {
    if (!s) return 0;
    let m = s.replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
    if (/[万億]/.test(s)) {
      m = s.replace(/,/g, '').match(/([\d.]+)\s*(万|億)?/);
      return m ? Math.round(+m[1] * (m[2] === '億' ? 1e8 : m[2] === '万' ? 1e4 : 1)) : 0;
    }
    return m ? Math.round(+m[1] * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1)) : 0;
  }

  const lastUrl = arr => {
    let u = arr?.[arr.length - 1]?.url || '';
    if (u.startsWith('//')) u = 'https:' + u;
    return u;
  };

  function parseTab(json) {
    const out = [];
    const seen = new Set();
    let cur = null;
    const push = it => { if (it.v && !seen.has(it.v)) { seen.add(it.v); it._raw = cur; out.push(it); } };
    walk(json, (k, v) => {
      cur = v;
      if (!v || typeof v !== 'object') return;
      if (k === 'videoRenderer' || k === 'gridVideoRenderer' || k === 'playlistVideoRenderer' || k === 'compactVideoRenderer') {
        const badges = JSON.stringify(v.badges || []) + JSON.stringify(v.thumbnailOverlays || []);
        const run = (v.ownerText || v.longBylineText || v.shortBylineText)?.runs?.[0];
        push({
          ...chInfo(run?.navigationEndpoint?.browseEndpoint, run?.text),
          src: k,
          v: v.videoId,
          t: text(v.title),
          ago: text(v.publishedTimeText),
          n: viewsNum(text(v.viewCountText) || text(v.shortViewCountText)),
          thumb: lastUrl(v.thumbnail?.thumbnails),
          live: /LIVE/.test(badges) && !v.upcomingEventData && !text(v.publishedTimeText),
          upcoming: v.upcomingEventData ? +v.upcomingEventData.startTime * 1000 : null
        });
      } else if (k === 'lockupViewModel' && v.contentId && !/PLAYLIST|CHANNEL/.test(v.contentType || '')) {
        const parts = [];
        walk(v.metadata, (kk, vv) => { if (kk === 'metadataParts' && Array.isArray(vv)) vv.forEach(p => parts.push(text(p?.text))); });
        const ago = parts.find(p => agoMs(p) != null) || '';
        const all = JSON.stringify(v.contentImage || {});
        let thumb = '';
        walk(v.contentImage, (kk, vv) => { if (!thumb && kk === 'sources' && Array.isArray(vv)) thumb = lastUrl(vv); });
        let be = null;
        walk(v.metadata, (kk, vv) => { if (!be && kk === 'browseEndpoint' && vv?.browseId?.startsWith('UC')) be = vv; });
        push({
          ...chInfo(be, parts.find(p => p && agoMs(p) == null && !/view|視聴|watching/i.test(p))),
          v: v.contentId,
          t: text(v.metadata?.lockupMetadataViewModel?.title),
          ago,
          n: viewsNum(parts.find(p => /view|視聴/i.test(p)) || ''),
          thumb,
          live: /LIVE/.test(all) && !ago,
          upcoming: null
        });
      } else if (k === 'shortsLockupViewModel') {
        const id = v.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || (v.entityId || '').replace(/^shorts-shelf-item-/, '');
        push({ v: id, t: text(v.overlayMetadata?.primaryText) || text(v.accessibilityText), ago: '', n: viewsNum(text(v.overlayMetadata?.secondaryText)), thumb: lastUrl(v.thumbnail?.sources), live: false, upcoming: null, short: true });
      } else if (k === 'reelItemRenderer') {
        push({ v: v.videoId, t: text(v.headline), ago: '', n: viewsNum(text(v.viewCountText)), thumb: lastUrl(v.thumbnail?.thumbnails), live: false, upcoming: null, short: true });
      }
    });
    const now = Date.now();
    return out.map((it, i) => {
      let d = agoMs(it.ago);
      if (d == null && it._raw) d = deepAgo(it._raw, it.t); // 項目の中の文字列を総当たりで探す
      if (it._raw) { it.w = watchedPct(it._raw); it.dur = durationOf(it._raw); it.mo = membersOnly(it._raw); }
      delete it._raw;
      return { ...it, p: it.upcoming || (it.live ? now : d != null ? now - d - i : null), i };
    });
  }

  // メンバー限定の動画か（バッジ・サムネの上の表示に「メンバー限定」の印があるもの）
  function membersOnly(raw) {
    try {
      const s = JSON.stringify([raw.badges, raw.thumbnailOverlays, raw.metadata, raw.contentImage, raw.overlayMetadata, raw.badge]);
      return /BADGE_STYLE_TYPE_MEMBERS_ONLY|"Members only"|メンバー限定|MEMBERS_ONLY/i.test(s);
    } catch { return false; }
  }

  function chInfo(be, name) {
    const chId = be?.browseId?.startsWith('UC') ? be.browseId : null;
    const chKey = TG.channelKey(be?.canonicalBaseUrl) || (chId ? 'channel/' + chId : null);
    return { chId, chKey, chName: name || '' };
  }

  // 一覧の「続き」の目印（ジャンル切り替えボタン等のものは使わない）
  function lastToken(json) {
    let token = null;
    walk(json, (k, v) => {
      if (k !== 'continuationItemRenderer' || !v) return;
      walk(v, (kk, vv) => { if (kk === 'continuationCommand' && vv?.token) token = vv.token; });
    });
    return token;
  }

  // ホームのおすすめ（1ページ分）。token を渡すと続きを取得
  async function recommended(token, signal) {
    const cfg = await getCfg();
    const context = structuredClone(cfg.INNERTUBE_CONTEXT || {});
    context.client = { ...(context.client || {}), hl: 'en' };
    const body = token ? { context, continuation: token } : { context, browseId: 'FEwhat_to_watch' };
    const json = await innertube('browse', body, cfg, signal);
    return { items: parseTab(json), token: lastToken(json) };
  }

  // 返ってきたタブが本当に目的のタブか確認する（そのタブが無いチャンネルでは、YouTubeは「ホーム」等を返してくる）
  const TAB_SUFFIX = { video: '/videos', live: '/streams', short: '/shorts' };
  const tabUrl = t => t?.endpoint?.commandMetadata?.webCommandMetadata?.url || '';
  function findTabs(json) {
    const tabs = [];
    walk(json, (k, v) => { if ((k === 'tabRenderer' || k === 'expandableTabRenderer') && v) tabs.push(v); });
    return tabs;
  }

  // 登録チャンネルの新着（YouTubeの「登録チャンネル」フィード）。maxAge より古くなるか maxPages で止める
  async function subsFeed({ maxPages = 4, maxAge = 3 * 864e5 } = {}, signal) {
    const cfg = await getCfg();
    const context = structuredClone(cfg.INNERTUBE_CONTEXT || {});
    context.client = { ...(context.client || {}), hl: 'en' };
    let token = null, out = [];
    for (let page = 0; page < maxPages; page++) {
      const json = await innertube('browse', token ? { context, continuation: token } : { context, browseId: 'FEsubscriptions' }, cfg, signal);
      const list = parseTab(json).filter(x => x.chKey && x.p);
      out = out.concat(list);
      token = lastToken(json);
      if (!token || !list.length || list.every(x => Date.now() - x.p > maxAge)) break;
    }
    const seen = new Set();
    return out.filter(x => !seen.has(x.v) && seen.add(x.v) && Date.now() - x.p <= maxAge);
  }

  // ---------- コメント ----------
  // 1ページ分のコメントと次ページの目印を取り出す（新形式 commentEntityPayload / 旧形式 commentRenderer の両対応）
  function parseComments(json) {
    const byId = new Map(), order = [];
    walk(json, (k, v) => {
      if (k === 'commentEntityPayload' && v?.properties) {
        const id = v.properties.commentId;
        byId.set(id, {
          id, text: text(v.properties.content), author: v.author?.displayName || '', chId: v.author?.channelId || '',
          likes: v.toolbar?.likeCountNotliked || v.toolbar?.likeCountLiked || '', time: v.properties.publishedTime || '',
          replies: v.toolbar?.replyCount || ''
        });
      } else if (k === 'commentRenderer' && v?.commentId) {
        byId.set(v.commentId, {
          id: v.commentId, text: text(v.contentText), author: text(v.authorText), chId: v.authorEndpoint?.browseEndpoint?.browseId || '',
          likes: text(v.voteCount), time: text(v.publishedTimeText), replies: v.replyCount || ''
        });
        order.push(v.commentId);
      } else if (k === 'commentViewModel' && v?.commentId) {
        order.push(v.commentId);
      }
    });
    const ids = order.length ? [...new Set(order)] : [...byId.keys()];
    const items = ids.map(id => byId.get(id)).filter(c => c && c.text);
    // 次ページ：返ってきた一覧の最後にある continuationItemRenderer（返信の続きは使わない）
    let token = null;
    walk(json, (k, v) => {
      if ((k === 'appendContinuationItemsAction' || k === 'reloadContinuationItemsCommand') && Array.isArray(v?.continuationItems)) {
        const last = v.continuationItems[v.continuationItems.length - 1];
        if (last?.continuationItemRenderer) walk(last, (kk, vv) => { if (kk === 'continuationCommand' && vv?.token) token = vv.token; });
      }
    });
    return { items, token };
  }

  // 動画のコメント（最初のページ）。sort: 'top'（評価順）| 'new'（新しい順）
  async function comments(videoId, signal, sort = 'top') {
    const cfg = await getCfg();
    const json = await innertube('next', { videoId }, cfg, signal);
    let token = null;
    walk(json, (k, v) => {
      if (token || k !== 'itemSectionRenderer' || !/comment/i.test(v?.sectionIdentifier || '')) return;
      walk(v, (kk, vv) => { if (!token && kk === 'continuationCommand' && vv?.token) token = vv.token; });
    });
    if (!token) return { items: [], token: null, disabled: true };
    let first = await innertube('next', { continuation: token }, cfg, signal);
    if (sort === 'new') {
      // 並び替えメニューの「新しい順」の目印で取り直す
      let newTok = null;
      walkPath(first, (k, v, stack) => {
        if (newTok || k !== 'continuationCommand' || !v?.token) return;
        for (let i = stack.length - 1; i >= Math.max(0, stack.length - 6); i--) {
          const t = text(stack[i]?.title);
          if (t) { if (/newest|新しい/i.test(t)) newTok = v.token; break; }
        }
      });
      if (newTok) first = await innertube('next', { continuation: newTok }, cfg, signal);
    }
    return parseComments(first);
  }

  async function commentsMore(token, signal) {
    return parseComments(await innertube('next', { continuation: token }, await getCfg(), signal));
  }

  // ---------- YouTubeの視聴履歴（スマホ・テレビなど他の端末の分も含む） ----------
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const WDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  // 見出し（Today / Yesterday / Monday / Oct 20 / Oct 20, 2025 / 今日 / 10月20日…）→ その日の0時
  function parseDay(title) {
    const t = (title || '').trim().toLowerCase();
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const ago = n => d0.getTime() - n * 864e5;
    if (/^(today|今日)$/.test(t)) return ago(0);
    if (/^(yesterday|昨日)$/.test(t)) return ago(1);
    const wd = WDAYS.indexOf(t.replace(/s$/, ''));
    const jwd = '日月火水木金土'.indexOf((t.match(/^(.)曜日?$/) || [])[1]);
    const w = wd >= 0 ? wd : jwd;
    if (w >= 0) { let n = (d0.getDay() - w + 7) % 7; if (n === 0) n = 7; return ago(n); }
    let m = t.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?$/);
    let y, mo, d;
    if (m && m[1] in MONTHS) { mo = MONTHS[m[1]]; d = +m[2]; y = m[3] ? +m[3] : null; }
    m = !mo && mo !== 0 ? t.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/) : null;
    if (m) { y = m[1] ? +m[1] : null; mo = +m[2] - 1; d = +m[3]; }
    if (mo == null) return null;
    let dt = new Date(y || d0.getFullYear(), mo, d).getTime();
    if (!y && dt > d0.getTime()) dt = new Date(d0.getFullYear() - 1, mo, d).getTime();
    return dt;
  }

  async function watchHistory({ maxPages = 10, stopBefore = 0 } = {}, signal) {
    const cfg = await getCfg();
    const context = structuredClone(cfg.INNERTUBE_CONTEXT || {});
    context.client = { ...(context.client || {}), hl: 'en' };
    let token = null, out = [], lastDay = null;
    for (let page = 0; page < maxPages; page++) {
      const json = await innertube('browse', token ? { context, continuation: token } : { context, browseId: 'FEhistory' }, cfg, signal);
      walk(json, (k, v) => {
        if (k !== 'itemSectionRenderer' || !v) return;
        let title = '';
        walk(v.header || {}, (kk, vv) => { if (!title && (kk === 'title' || kk === 'text')) title = text(vv); });
        if (!title) walk(v.contents || [], (kk, vv) => { if (!title && kk === 'itemSectionHeaderRenderer') title = text(vv.title); });
        const day = parseDay(title) ?? lastDay; // 見出しの無い続きのページは前の日付のまま
        if (day != null) lastDay = day;
        for (const x of parseTab({ contents: v.contents })) out.push({ ...x, day });
      });
      token = lastToken(json);
      if (!token || (stopBefore && lastDay != null && lastDay < stopBefore)) break;
    }
    const seen = new Set();
    return out.filter(x => x.v && !seen.has(x.v) && seen.add(x.v));
  }

  // チャンネルが「注目チャンネル」に載せている別のチャンネル（ホームの棚。専用のタブがあればそちらも）
  async function featuredChannels(id, signal) {
    const cfg = await getCfg();
    const context = structuredClone(cfg.INNERTUBE_CONTEXT || {});
    context.client = { ...(context.client || {}), hl: 'en' };
    const get = params => innertube('browse', { context, browseId: id, ...(params ? { params } : {}) }, cfg, signal);
    const jsons = [await get()];
    const chTab = findTabs(jsons[0]).find(t => tabUrl(t).endsWith('/channels'));
    const p = chTab?.endpoint?.browseEndpoint?.params;
    if (p) jsons.push(await get(p));
    const out = new Map();
    for (const json of jsons) {
      walk(json, (k, v) => {
        if ((k === 'gridChannelRenderer' || k === 'channelRenderer') && v?.channelId) out.set(v.channelId, { id: v.channelId, name: text(v.title) });
        else if (k === 'lockupViewModel' && /CHANNEL/.test(v?.contentType || '') && String(v.contentId || '').startsWith('UC')) out.set(v.contentId, { id: v.contentId, name: text(v.metadata?.lockupMetadataViewModel?.title) });
      });
    }
    out.delete(id);
    return [...out.values()];
  }

  async function channelTab(id, tab, signal) {
    const cfg = await getCfg();
    const context = structuredClone(cfg.INNERTUBE_CONTEXT || {});
    context.client = { ...(context.client || {}), hl: 'en' }; // 「◯日前」を確実に読めるよう英語で取得
    const get = params => innertube('browse', { context, browseId: id, params }, cfg, signal);
    let json = await get(TAB_PARAMS[tab]);
    let tabs = findTabs(json);
    if (!tabs.some(t => tabUrl(t))) return parseTab(json); // タブ情報が無い形式ならそのまま
    const ok = t => tabUrl(t).endsWith(TAB_SUFFIX[tab]);
    let sel = tabs.find(t => t.selected);
    if (!sel || !ok(sel)) {
      const want = tabs.find(ok);
      if (!want) return []; // このチャンネルにはそのタブが無い（ライブ配信なし等）
      const p = want.endpoint?.browseEndpoint?.params;
      if (!p || p === TAB_PARAMS[tab]) return [];
      TAB_PARAMS[tab] = p; // 正しい指定を覚えて取り直す
      json = await get(p);
      sel = findTabs(json).find(t => t.selected);
      if (!sel || !ok(sel)) return [];
    }
    return parseTab(sel.content || sel);
  }


  // ---------- チャンネル登録・通知 ----------
  let cfgCache = null;
  async function getCfg() {
    if (cfgCache?.INNERTUBE_CONTEXT) return cfgCache;
    const cfg = {};
    for (const s of document.scripts) {
      const t = s.textContent;
      if (t && t.includes('ytcfg.set({')) Object.assign(cfg, findCfg(t));
    }
    if (!cfg.INNERTUBE_CONTEXT) {
      const html = await (await fetch('/feed/channels', { credentials: 'include' })).text();
      Object.assign(cfg, findCfg(html));
    }
    cfgCache = cfg;
    return cfg;
  }

  async function call(endpoint, body) {
    const json = await innertube(endpoint, body, await getCfg());
    if (json?.error) throw new Error(json.error.message || 'YouTube API エラー');
    return json;
  }

  // チャンネルページから通知設定の選択肢を読む
  async function channelSubInfo(key) {
    const html = await (await fetch(TG.channelUrl(key), { credentials: 'include' })).text();
    const data = findJson(html, 'ytInitialData = ') || findJson(html, 'ytInitialData"] = ');
    const opts = new Map();
    let subscribed = null;
    walkPath(data, (k, v, stack) => {
      if (k === 'modifyChannelNotificationPreferenceEndpoint' && v?.params) {
        for (let i = stack.length - 1; i >= Math.max(0, stack.length - 9); i--) {
          const o = stack[i];
          if (Array.isArray(o)) continue;
          const t = text(o.text) || text(o.title);
          if (t) {
            const sel = !!(o.isSelected ?? o.selected);
            if (!opts.has(t)) opts.set(t, { label: t, params: v.params, selected: sel });
            else if (sel) opts.get(t).selected = true;
            break;
          }
        }
      }
      if (subscribed === null && (k === 'subscribed' || k === 'isSubscribed') && typeof v === 'boolean') subscribed = v;
    });
    return { options: [...opts.values()], subscribed };
  }

  async function setSubscribed(id, on) {
    await call(on ? 'subscription/subscribe' : 'subscription/unsubscribe', {
      channelIds: [id],
      params: on ? 'EgIIAhgA' : 'CgIIAhgA'
    });
  }

  async function setNotification(params) {
    await call('notification/modify_channel_preference', { params });
  }

  // 動画ID → チャンネル（oEmbedで取れない埋め込み禁止の動画などに使う）
  async function videoOwner(videoId) {
    const j = await call('player', { videoId });
    const d = j?.videoDetails;
    return d?.channelId ? { k: 'channel/' + d.channelId, n: d.author || '', t: d.title || '', d: +d.lengthSeconds || 0, kw: d.keywords || [] } : null;
  }

  // YouTube本体の「後で見る」再生リスト（最大 maxPages×100本）
  // 再生リストの中身（id='WL' で後で見る）
  async function playlistItems(id, { maxPages = 10 } = {}, signal) {
    const cfg = await getCfg();
    const context = structuredClone(cfg.INNERTUBE_CONTEXT || {});
    context.client = { ...(context.client || {}), hl: 'en' };
    const out = [];
    let token = null;
    for (let i = 0; i < maxPages; i++) {
      const json = await innertube('browse', token ? { context, continuation: token } : { context, browseId: 'VL' + id }, cfg, signal);
      // 再生リストのページには「おすすめの動画」も付いてくるので、リスト本体（playlistVideoListRenderer）だけを見る
      let scope = json;
      if (!token) {
        const nodes = [];
        walk(json, (k, v) => { if (k === 'playlistVideoListRenderer' && v) nodes.push(v); });
        if (nodes.length) scope = nodes;
      }
      const got = parseTab(scope);
      const own = got.filter(x => x.src === 'playlistVideoRenderer');
      out.push(...(own.length ? own : got));
      token = lastToken(scope);
      if (!token) break;
    }
    const seen = new Set();
    return out.filter(x => x.v && !seen.has(x.v) && seen.add(x.v));
  }
  // 自分の再生リストの一覧（ライブラリの「再生リスト」）
  async function myPlaylists(signal) {
    const cfg = await getCfg();
    const context = structuredClone(cfg.INNERTUBE_CONTEXT || {});
    context.client = { ...(context.client || {}), hl: 'en' };
    const out = new Map();
    const countOf = o => { const m = JSON.stringify(o || {}).match(/"(\d[\d,]*) (?:videos?|本の動画)"/); return m ? +m[1].replace(/,/g, '') : null; };
    const grab = json => walk(json, (k, v) => {
      if (!v || typeof v !== 'object') return;
      if (k === 'lockupViewModel' && /PLAYLIST/.test(v.contentType || '') && v.contentId) {
        // 自分の再生リストは「Private／Public／Unlisted」の表示がある。無いものはライブラリに保存したほかの人の再生リスト
        const parts = [];
        walk(v.metadata, (kk, vv) => { if (kk === 'metadataParts' && Array.isArray(vv)) vv.forEach(p => parts.push(text(p?.text))); });
        const all = parts.join(' ');
        const own = v.contentId === 'LL' || /\b(Private|Public|Unlisted)\b|非公開|限定公開|公開/.test(all);
        let thumb = '';
        walk(v.contentImage, (kk, vv) => { if (!thumb && kk === 'sources' && Array.isArray(vv)) thumb = lastUrl(vv); });
        const owner = own ? '' : parts.find(p => p && !/playlist|プレイリスト|updated|更新|view full|全体|^\d/i.test(p)) || '';
        out.set(v.contentId, { id: v.contentId, title: text(v.metadata?.lockupMetadataViewModel?.title), count: countOf(v.contentImage), saved: !own, owner, thumb });
      } else if ((k === 'gridPlaylistRenderer' || k === 'playlistRenderer') && v.playlistId) {
        out.set(v.playlistId, { id: v.playlistId, title: text(v.title), count: +(text(v.videoCountText || v.videoCountShortText).replace(/[^\d]/g, '')) || null });
      }
    });
    for (const browseId of ['FEplaylist_aggregation', 'FElibrary']) {
      try {
        let token = null;
        for (let i = 0; i < 4; i++) {
          const json = await innertube('browse', token ? { context, continuation: token } : { context, browseId }, cfg, signal);
          grab(json);
          token = lastToken(json);
          if (!token) break;
        }
        if (out.size) break;
      } catch (e) { if (signal?.aborted) throw e; }
    }
    out.delete('WL');
    return [...out.values()].filter(p => p.title);
  }
  async function addToPlaylist(videoId, playlistId) {
    const j = await call('browse/edit_playlist', { playlistId, actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }] });
    if (j?.status && j.status !== 'STATUS_SUCCEEDED') throw new Error(j.status);
    return true;
  }
  async function removeFromPlaylist(videoId, playlistId) {
    const j = await call('browse/edit_playlist', { playlistId, actions: [{ action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: videoId }] });
    if (j?.status && j.status !== 'STATUS_SUCCEEDED') throw new Error(j.status);
    return true;
  }
  const watchLater = (opts = {}, signal) => playlistItems('WL', opts, signal);
  // 再生リストの作成（非公開）・名前の変更・削除
  async function createPlaylist(title) {
    const j = await call('playlist/create', { title, privacyStatus: 'PRIVATE', videoIds: [] });
    if (!j?.playlistId) throw new Error('作成できませんでした');
    return j.playlistId;
  }
  async function renamePlaylist(playlistId, playlistName) {
    const j = await call('browse/edit_playlist', { playlistId, actions: [{ action: 'ACTION_SET_PLAYLIST_NAME', playlistName }] });
    if (j?.status && j.status !== 'STATUS_SUCCEEDED') throw new Error(j.status);
    return true;
  }
  // @ハンドル → チャンネルID
  async function resolveHandle(handle) {
    const j = await call('navigation/resolve_url', { url: 'https://www.youtube.com/' + handle.replace(/^\/?/, '') });
    let id = '';
    walk(j, (k, v) => { if (!id && k === 'browseId' && typeof v === 'string' && v.startsWith('UC')) id = v; });
    return id;
  }
  // チャンネルの表示名（RSS が小さいので先に。だめならチャンネルのページの情報から）
  async function channelTitle(id) {
    try {
      const r = await fetch(`/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`, { credentials: 'omit' });
      if (r.ok) { const t = (await r.text()).match(/<title>([^<]*)<\/title>/)?.[1]; if (t) return t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
    } catch { /* 次へ */ }
    const cfg = await getCfg();
    const j = await innertube('browse', { context: cfg.INNERTUBE_CONTEXT, browseId: id }, cfg);
    return j?.metadata?.channelMetadataRenderer?.title || '';
  }
  // ライブラリに保存したほかの人の再生リストを、ライブラリから外す
  async function unsavePlaylist(playlistId) {
    await call('like/removelike', { target: { playlistId } });
    return true;
  }
  async function deletePlaylist(playlistId) {
    await call('playlist/delete', { playlistId });
    return true;
  }

  // YouTube本体の「後で見る」から削除
  async function removeFromWatchLater(videoId) {
    const j = await call('browse/edit_playlist', { playlistId: 'WL', actions: [{ action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: videoId }] });
    if (j?.status && j.status !== 'STATUS_SUCCEEDED') throw new Error(j.status);
    return true;
  }

  // ショートの連続再生と同じ「次のショート」の流れ（おすすめショートの追加読み込み用）
  async function shortsSequence(seed, token, signal) {
    const cfg = await getCfg();
    let seq = token;
    if (!seq) {
      const j = await innertube('reel/reel_item_watch', { playerRequest: { videoId: seed }, disablePlayerResponse: true }, cfg, signal);
      seq = j?.sequenceContinuation;
      if (!seq) walk(j, (k, v) => { if (!seq && k === 'sequenceContinuation' && typeof v === 'string') seq = v; });
      if (!seq) throw new Error('ショートの続きが見つかりません');
    }
    const j = await innertube('reel/reel_watch_sequence', { sequenceParams: seq }, cfg, signal);
    const ids = [];
    walk(j?.entries || j, (k, v) => { if (k === 'reelWatchEndpoint' && v?.videoId && !ids.includes(v.videoId)) ids.push(v.videoId); });
    let next = null;
    walk(j?.continuationEndpoint || {}, (k, v) => { if (k === 'continuationCommand' && v?.token) next = v.token; });
    if (!next) walk(j, (k, v) => { if (!next && k === 'continuationCommand' && v?.token) next = v.token; });
    return { ids, token: next };
  }

  // YouTube検索（1ページ分）。token を渡すと続き
  // params … 検索の絞り込み（例：'EgQIARAB' ＝ 1時間以内・動画）
  async function search(query, token, signal, params, { anon = false } = {}) {
    const cfg = await getCfg();
    const context = structuredClone(cfg.INNERTUBE_CONTEXT || {});
    context.client = { ...(context.client || {}), hl: 'en' };
    const json = await innertube('search', token ? { context, continuation: token } : { context, query, ...(params ? { params } : {}) }, cfg, signal, anon);
    return { items: parseTab(json), token: lastToken(json) };
  }

  // 登録チャンネルのフィード1ページ分（新着動画の続きの読み込み用）
  async function subsPage(token, signal) {
    const cfg = await getCfg();
    const context = structuredClone(cfg.INNERTUBE_CONTEXT || {});
    context.client = { ...(context.client || {}), hl: 'en' };
    const json = await innertube('browse', token ? { context, continuation: token } : { context, browseId: 'FEsubscriptions' }, cfg, signal);
    return { items: parseTab(json).filter(x => x.chKey && x.p), token: lastToken(json) };
  }

  // 関連動画（再生画面の横に出るもの）。おすすめの続きの読み込みに使う
  async function related(videoId, signal, { anon = false } = {}) {
    const cfg = await getCfg();
    const context = structuredClone(cfg.INNERTUBE_CONTEXT || {});
    context.client = { ...(context.client || {}), hl: 'en' };
    const json = await innertube('next', { context, videoId }, cfg, signal, anon);
    const sec = json?.contents?.twoColumnWatchNextResults?.secondaryResults || json;
    return parseTab(sec).filter(x => x.v && x.v !== videoId);
  }

  // 動画の概要欄（と文字起こし）… 振り分け補助で使う
  async function videoText(videoId, { transcript = false } = {}, signal) {
    const cfg = await getCfg();
    const out = { desc: '', tr: '' };
    try {
      const p = await innertube('player', { videoId }, cfg, signal);
      out.desc = p?.videoDetails?.shortDescription || '';
    } catch (e) { if (signal?.aborted) throw e; }
    if (!transcript) return out;
    try {
      const n = await innertube('next', { videoId }, cfg, signal);
      let params = null;
      walk(n, (k, v) => { if (!params && k === 'getTranscriptEndpoint' && v?.params) params = v.params; });
      if (params) {
        const t = await innertube('get_transcript', { params }, cfg, signal);
        const parts = [];
        walk(t, (k, v) => {
          if (k === 'transcriptSegmentRenderer' && v) parts.push(text(v.snippet));
          else if (k === 'transcriptSegmentViewModel' && v) parts.push(text(v.simpleText || v.snippet));
        });
        out.tr = parts.join(' ').slice(0, 20000);
      }
    } catch (e) { if (signal?.aborted) throw e; }
    return out;
  }
  // サムネのプレビュー用：動画のコマ割り画像（ストーリーボード）。一番大きいサイズを返す
  const sbMem = new Map();
  async function storyboard(videoId, signal) {
    if (sbMem.has(videoId)) return sbMem.get(videoId);
    const cfg = await getCfg();
    const p = await innertube('player', { videoId }, cfg, signal);
    const spec = p?.storyboards?.playerStoryboardSpecRenderer?.spec || '';
    let out = null;
    if (spec) {
      const [base, ...lv] = spec.split('|');
      const i = lv.length - 1, f = (lv[i] || '').split('#');
      if (f.length >= 8) {
        const [w, h, count, cols, rows, interval, name, sigh] = f;
        out = { w: +w, h: +h, count: +count, cols: +cols, rows: +rows, interval: +interval || 0, dur: +p?.videoDetails?.lengthSeconds || 0,
          url: n => base.replace('$L', i).replace('$N', name.replace('$M', n)) + (base.includes('?') ? '&' : '?') + 'sigh=' + sigh };
      }
    }
    sbMem.set(videoId, out);
    return out;
  }
  // チャンネルの説明文
  async function channelDesc(id, signal) {
    try {
      const j = await innertube('browse', { browseId: id }, await getCfg(), signal);
      return j?.metadata?.channelMetadataRenderer?.description || '';
    } catch (e) { if (signal?.aborted) throw e; return ''; }
  }

  // 文字起こし（時刻つき）：[{ s: 開始秒, e: 終了秒, t: 文 }]
  async function transcript(videoId, signal) {
    const cfg = await getCfg();
    const n = await innertube('next', { videoId }, cfg, signal);
    let params = null;
    walk(n, (k, v) => { if (!params && k === 'getTranscriptEndpoint' && v?.params) params = v.params; });
    if (!params) return null;
    const t = await innertube('get_transcript', { params }, cfg, signal);
    const out = [];
    walk(t, (k, v) => {
      if (!v || typeof v !== 'object') return;
      if (k === 'transcriptSegmentRenderer') out.push({ s: (+v.startMs || 0) / 1000, e: (+v.endMs || 0) / 1000, t: text(v.snippet) });
      else if (k === 'transcriptSegmentViewModel') out.push({ s: (+(v.startOffsetMs ?? v.startMs) || 0) / 1000, e: (+(v.endOffsetMs ?? v.endMs) || 0) / 1000, t: text(v.simpleText || v.snippet) });
    });
    return out.filter(x => x.t).sort((a, b) => a.s - b.s);
  }

  return { featuredChannels, unsavePlaylist, resolveHandle, channelTitle, createPlaylist, renamePlaylist, deletePlaylist, storyboard, transcript, addToPlaylist, videoText, channelDesc, related, playlistItems, myPlaylists, removeFromPlaylist, subsPage, search, shortsSequence, removeFromWatchLater, watchLater, videoOwner, fetchSubscriptions, fetchMeta, resolveId, channelSubInfo, setSubscribed, setNotification, channelTab, parseTab, recommended, channelPopular, subsFeed, comments, commentsMore, watchHistory, parseDay };
})();
