// 再生画面・一覧の追加機能（v4.44）
//   ・⏩ SponsorBlock：スポンサー・自己宣伝・チャンネル登録のお願い・オープニング（茶番）の区間を自動で飛ばす
//   ・👎 低評価率の警告：再生時に Return YouTube Dislike の推定で低評価率が 30% 以上なら表示
//   ・👎 一覧のサムネに低評価率（ホーム・検索・関連動画など）
//   ・⚠️ GitHub の賞味期限：概要欄の GitHub リポジトリが長く更新されていなければ、プレイヤーに大きな透かし
//   ・📖 Wikipedia：タイトル・タグの固有名詞の要約を関連動画の上に（✕ で閉じられる）
//   ・📼 削除された動画：TubeFolio の「後で見る」で、Wayback Machine に残っていればサムネ・行き先をアーカイブに
//   ・☀️ 晴れの日の外出のすすめ：休日に一定時間以上見ていて、外が晴れて過ごしやすい気温ならプレイヤーを隠して警告
//   設定は px（設定 → 💬 再生画面）：sb, rydWarn, disBadge, gh, ghYears, wiki, out, outMin, outCity
//   外部への通信は background.js の 'xfetch'（決まったサイトだけ）を通す
const TGXtra = (() => {
  const esc = TG.esc;
  const DEF = { cmtName: true, sb: true, sbUndo: true, sbHl: true, sbPriv: true, rydWarn: true, wb: true, disBadge: true, gh: true, ghYears: 2, wiki: true, out: true, outMin: 120, outCity: '', outLo: 15, outHi: 28 };
  let cfg = { ...DEF };
  const load = async () => { const { px = {} } = await chrome.storage.local.get('px'); cfg = { ...DEF, ...px }; };
  load();
  chrome.storage.onChanged.addListener(ch => {
    if (!ch.px) return;
    const was = cfg.disBadge;
    load().then(() => {
      if (was && !cfg.disBadge) document.querySelectorAll('.tg-disb').forEach(e => e.remove());
      if (!cfg.disBadge) document.querySelectorAll('[data-tgdis]').forEach(e => delete e.dataset.tgdis);
      if (cfg.disBadge && !was) badges();
      paintNames();
    });
  });

  const xfetch = (url, as = 'json', st = false) => chrome.runtime.sendMessage({ type: 'xfetch', url, as, st }).catch(() => null);
  const player = () => document.querySelector('#movie_player');
  const video = () => player()?.querySelector('video');
  const curVid = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
  const adShowing = () => !!document.querySelector('#movie_player.ad-showing');
  const log = (c, m, l) => { try { TG.log(c, m, l); } catch { /* なし */ } };
  function flash(text) {
    const p = player();
    if (!p) return;
    let d = p.querySelector('.tg-px-flash');
    if (!d) { d = document.createElement('div'); d.className = 'tg-px-flash'; p.appendChild(d); }
    d.textContent = text;
    d.classList.remove('on'); void d.offsetWidth; d.classList.add('on');
  }
  // YouTube のページ側（mainworld.js）に頼んで、動画の情報（概要欄・タグ）を読む
  let mSeq = 0;
  function main(op, args) {
    return new Promise(res => {
      const id = 'x' + (++mSeq);
      const on = e => { let d; try { d = JSON.parse(e.detail); } catch { return; } if (d.id !== id) return; document.removeEventListener('tg-res', on); clearTimeout(t); res(d.result); };
      const t = setTimeout(() => { document.removeEventListener('tg-res', on); res(null); }, 2000);
      document.addEventListener('tg-res', on);
      document.dispatchEvent(new CustomEvent('tg-cmd', { detail: JSON.stringify({ id, op, args }) }));
    });
  }
  // 関連動画の欄（画面が狭いと動画の下へ移るので、見えている方）
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
  //   区間は https://sponsor.ajay.app の公開API（有志が登録・データは CC BY-NC-SA 4.0）から取る。コードは使っていない
  const SB_ALL = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'filler', 'music_offtopic', 'poi_highlight'];
  const SB_NAME = { sponsor: 'スポンサー', selfpromo: '宣伝', interaction: '登録のお願い', intro: 'オープニング', outro: 'エンディング', preview: '予告・ダイジェスト', filler: '雑談・脱線', music_offtopic: '音楽以外の部分', poi_highlight: 'ハイライト' };
  const SB_COLOR = { sponsor: '#00d400', selfpromo: '#ffff00', interaction: '#cc00ff', intro: '#00ffff', outro: '#0202ed', preview: '#008fd6', filler: '#7300ff', music_offtopic: '#ff9900', poi_highlight: '#ff1684' };
  const SB_DEFMODE = { sponsor: 'skip', selfpromo: 'skip', interaction: 'skip', intro: 'skip', outro: 'show', preview: 'show', filler: 'show', music_offtopic: 'show', poi_highlight: 'show' };
  const sbMode = c => (c === 'poi_highlight' ? (cfg.sbc_poi_highlight === 'off' ? 'off' : 'show') : (cfg['sbc_' + c] || SB_DEFMODE[c] || 'off')); // skip / show / off
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  let sb = { v: null, segs: [], loading: false, state: 'loading', ignore: new Set(), manual: -1 }; // state: loading / found / none（登録なし）/ error
  const sha256hex = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join('');
  const sbVisible = () => sb.segs.filter(g => sbMode(g.c) !== 'off');

  // プレイヤーの中に出す小さな案内（ボタンつき）
  let toastT = 0;
  function toast(text, btn, fn, ms) {
    const p = player();
    if (!p) return;
    p.querySelector('.tg-sbtoast')?.remove();
    clearTimeout(toastT);
    const d = document.createElement('div');
    d.className = 'tg-sbtoast';
    d.dataset.v = curVid() || '';
    const s = document.createElement('span');
    s.textContent = text;
    d.appendChild(s);
    if (btn) {
      const b = document.createElement('button');
      b.textContent = btn;
      ['mousedown', 'keydown', 'dblclick'].forEach(t => b.addEventListener(t, e => e.stopPropagation()));
      b.addEventListener('click', e => { e.stopPropagation(); d.remove(); fn(); });
      d.appendChild(b);
    }
    p.appendChild(d);
    toastT = setTimeout(() => d.remove(), ms);
  }

  async function sbLoad(v) {
    sb = { v, segs: [], loading: true, state: 'loading', ignore: new Set(), manual: -1 };
    const q = `categories=${encodeURIComponent(JSON.stringify(SB_ALL))}&actionTypes=${encodeURIComponent(JSON.stringify(['skip', 'poi']))}`;
    let url = null;
    if (cfg.sbPriv !== false) {
      try { url = `https://sponsor.ajay.app/api/skipSegments/${(await sha256hex(v)).slice(0, 4)}?${q}`; } catch { url = null; }
    }
    const hashed = !!url;
    if (!url) url = `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(v)}&${q}`;
    const raw = await xfetch(url, 'json', true);
    if (sb.v !== v) return;
    sb.loading = false;
    let arr = null; // null＝取得できず
    if (Array.isArray(raw)) arr = hashed ? (raw.find(x => x.videoID === v)?.segments || []) : raw;
    else if (raw?._http === 404) arr = [];
    sb.segs = (arr || []).map(x => ({ s: x.segment[0], e: x.segment[1], c: x.category, poi: x.actionType === 'poi' }))
      .filter(x => x.poi || (x.e - x.s >= 0.5)).sort((a, b) => a.s - b.s);
    sb.state = sb.segs.length ? 'found' : arr ? 'none' : 'error';
    if (sb.segs.length) {
      log('SponsorBlock', `${v}：登録された区間 ${sb.segs.length} か所（${[...new Set(sb.segs.map(x => SB_NAME[x.c] || x.c))].join('・')}）${hashed ? '' : '・動画IDで照会'}`);
      const hl = sb.segs.find(g => g.poi && sbMode(g.c) !== 'off');
      if (hl && cfg.sbHl !== false) toast('⭐ ハイライト（見どころ）が登録されています', `⭐ ${mmss(hl.s)} へ移動`, () => { const e = video(); if (e) e.currentTime = hl.s; }, 8000);
      else if (sbVisible().length) flash(`⏩ 登録された区間が ${sbVisible().length} か所あります（SponsorBlock）`);
      const vEl = video();
      if (vEl && !vEl.paused && !sbRaf) sbCheck();
    } else log('SponsorBlock', `${v}：${sb.state === 'none' ? '登録なし' : '取得できず'}`);
  }

  // 動画の下の案内と、シークバーの色つきの印（YouTube が描き直しても付け直す）
  function sbPaint() {
    const v = curVid();
    document.querySelectorAll('.tg-sbinfo, .tg-sbmarks, .tg-sbtoast').forEach(e => { if (e.dataset.v !== v) e.remove(); });
    if (!v || sb.v !== v || sb.state === 'loading') return;
    const vis = sbVisible();
    const modeKey = [sb.state, vis.length, cfg.sb, cfg.sbHl, SB_ALL.map(sbMode).join('')].join('|');
    const host = document.querySelector('ytd-watch-metadata #title');
    let el = document.querySelector('.tg-sbinfo');
    if (host && (!el || el.dataset.key !== modeKey)) {
      el?.remove();
      el = document.createElement('div');
      el.dataset.v = v; el.dataset.key = modeKey;
      el.className = 'tg-sbinfo ' + sb.state;
      if (sb.state === 'found') {
        const auto = vis.filter(g => !g.poi && sbMode(g.c) === 'skip').length;
        const kinds = [...new Set(vis.map(x => SB_NAME[x.c] || x.c))].join('・');
        const tot = Math.round(vis.filter(g => !g.poi).reduce((a, g) => a + (g.e - g.s), 0));
        el.textContent = vis.length
          ? `⏩ SponsorBlock：この動画には ${vis.length} か所の区間が登録されています（${kinds}${tot ? '・合計 ' + tot + '秒' : ''}）。${cfg.sb ? (auto ? `うち ${auto} か所を再生中に自動で飛ばします。` : '自動で飛ばす対象はありません（案内だけ）。') : '※「自動で飛ばす」が設定でオフです。'}`
          : '⏩ SponsorBlock：区間が登録されていますが、設定で「無視」にしている種類です。';
        const hl = vis.find(g => g.poi);
        if (hl && cfg.sbHl !== false) {
          const b = document.createElement('button');
          b.className = 'tg-sbhl';
          b.textContent = `⭐ ハイライトへ移動（${mmss(hl.s)}）`;
          b.addEventListener('click', () => { const e = video(); if (e) { e.currentTime = hl.s; e.play?.(); } });
          el.append(' ', b);
        }
      } else if (sb.state === 'none') {
        el.textContent = '⏩ SponsorBlock：この動画には登録がありません（飛ばす区間なし）。日本語の動画は登録が少なめです。';
      } else el.textContent = '⏩ SponsorBlock：サーバーに接続できず、確認できませんでした。';
      host.after(el);
    }
    // シークバーの印
    const bar = document.querySelector('#movie_player .ytp-progress-bar');
    const dur = video()?.duration;
    if (bar && dur > 0 && isFinite(dur) && sb.state === 'found') {
      const k = v + ':' + modeKey + ':' + Math.round(dur);
      let m = bar.querySelector('.tg-sbmarks');
      if (!m || m.dataset.k !== k) {
        m?.remove();
        m = document.createElement('div');
        m.className = 'tg-sbmarks'; m.dataset.v = v; m.dataset.k = k;
        m.innerHTML = vis.map(g => `<i style="left:${(g.s / dur * 100).toFixed(3)}%;width:${g.poi ? 0.4 : Math.max(0.2, (g.e - g.s) / dur * 100).toFixed(3)}%;background:${SB_COLOR[g.c] || '#0f0'}" title="${SB_NAME[g.c] || g.c}"></i>`).join('');
        bar.appendChild(m);
      }
    }
  }

  let sbRaf = 0;
  function sbCheck() {
    sbRaf = 0;
    const vEl = video();
    if (!vEl || !sb.segs.length || adShowing() || sb.v !== curVid()) return;
    const t = vEl.currentTime;
    let manual = -1;
    for (let i = 0; i < sb.segs.length; i++) {
      const g = sb.segs[i];
      if (g.poi || sb.ignore.has(i)) continue;
      const m = sbMode(g.c);
      if (m === 'off' || !(t >= g.s && t < g.e - 0.2)) continue;
      if (m === 'skip' && cfg.sb) {
        vEl.currentTime = Math.min(g.e, (vEl.duration || g.e) - 0.1);
        const msg = `⏩ ${SB_NAME[g.c] || g.c}を飛ばしました（${Math.round(g.e - g.s)}秒）`;
        if (cfg.sbUndo !== false) toast(msg, '↩ 戻す', () => { sb.ignore.add(i); const e = video(); if (e) e.currentTime = g.s; }, 6000);
        else flash(msg);
        break;
      }
      manual = i; // 案内だけ：区間にいる間、「飛ばす」ボタンを出す
      break;
    }
    if (manual >= 0 && manual !== sb.manual) {
      const g = sb.segs[manual];
      toast(`${SB_NAME[g.c] || g.c}の区間です`, '⏩ 飛ばす', () => { sb.ignore.add(manual); const e = video(); if (e) e.currentTime = Math.min(g.e, (e.duration || g.e) - 0.1); }, Math.max(2000, (g.e - t) * 1000));
    } else if (manual < 0 && sb.manual >= 0) document.querySelector('.tg-sbtoast')?.remove();
    sb.manual = manual;
    if (!vEl.paused) sbRaf = requestAnimationFrame(sbCheck); // 再生中は毎フレーム確認（区間に入った瞬間に飛ばす）
  }
  document.addEventListener('playing', e => { if (e.target === video() && !sbRaf) sbRaf = requestAnimationFrame(sbCheck); }, true);
  document.addEventListener('seeked', e => { if (e.target === video()) sbCheck(); }, true);

  // ================= 👎 再生時の低評価率の警告 =================
  let rydFor = null;
  async function rydWarn(v) {
    rydFor = v;
    document.querySelectorAll('.tg-rydwarn').forEach(e => e.remove());
    if (!cfg.rydWarn) return;
    const r = await chrome.runtime.sendMessage({ type: 'ryd', v }).catch(() => null);
    if (rydFor !== v || !r || r.likes + r.dislikes < 20) return;
    const ratio = r.dislikes / (r.likes + r.dislikes);
    if (ratio < 0.3) return;
    const pct = Math.round(ratio * 100);
    flash(`⚠️ 低評価率 ${pct}%（推定）の動画です`);
    const host = document.querySelector('ytd-watch-metadata #title');
    if (host) {
      const el = document.createElement('div');
      el.className = 'tg-rydwarn';
      el.textContent = `⚠️ 低評価率が 30% を超えています：👎 ${pct}%（推定 👍 ${r.likes.toLocaleString()}・👎 ${r.dislikes.toLocaleString()}）`;
      host.after(el);
    }
    log('低評価率', `${v}：低評価率 ${pct}%`);
  }

  // ================= ⚠️ GitHub の賞味期限 =================
  let ghFor = null;
  async function ghCheck(v, desc) {
    ghFor = v;
    player()?.querySelector('.tg-ghwm')?.remove();
    if (!cfg.gh) return;
    const repos = [...new Set([...String(desc || '').matchAll(/github\.com\/([\w.-]+)\/([\w.-]+)/gi)]
      .map(m => `${m[1]}/${m[2].replace(/\.git$/i, '')}`)
      .filter(r => !/^(sponsors|orgs|features|topics|settings|marketplace|apps|login|about|collections|explore)\//i.test(r)))].slice(0, 3);
    if (!repos.length) return;
    const { ghCache = {} } = await chrome.storage.local.get('ghCache');
    let newest = 0, name = '';
    for (const repo of repos) {
      let c = ghCache[repo];
      if (!c || Date.now() - c.at > 7 * 864e5) {
        const j = await xfetch(`https://api.github.com/repos/${repo}`);
        c = { at: Date.now(), p: j?.pushed_at ? Date.parse(j.pushed_at) : 0 };
        ghCache[repo] = c;
      }
      if (c.p > newest) { newest = c.p; name = repo; }
    }
    const keys = Object.keys(ghCache);
    if (keys.length > 300) keys.sort((a, b) => ghCache[a].at - ghCache[b].at).slice(0, keys.length - 300).forEach(k => delete ghCache[k]);
    chrome.storage.local.set({ ghCache });
    if (ghFor !== v || !newest) return;
    const years = (Date.now() - newest) / (365.25 * 864e5);
    if (years < (+cfg.ghYears || 2)) return;
    const p = player();
    if (!p) return;
    const wm = document.createElement('div');
    wm.className = 'tg-ghwm';
    wm.innerHTML = `<div>⚠️この技術は古いです</div><small>（${esc(name)} 最終更新: ${new Date(newest).getFullYear()}年）</small>`;
    p.appendChild(wm);
    log('GitHub', `${v}：${name} は ${Math.floor(years)} 年以上更新されていません`);
  }

  // ================= 📖 Wikipedia =================
  let wikiFor = null;
  const wikiClosed = new Set();
  function wikiTerms(title, kw) {
    const out = [];
    const add = t => { t = String(t || '').replace(/[#＃【】「」『』\[\]()（）]/g, '').trim(); if (t.length >= 2 && t.length <= 30 && !out.includes(t)) out.push(t); };
    for (const m of String(title).matchAll(/[【「『]([^】」』]{2,30})[】」』]/g)) add(m[1]);
    (kw || []).slice(0, 6).forEach(add);
    for (const m of String(title).matchAll(/[゠-ヿー]{3,}|[一-鿿]{2,}[゠-ヿ一-鿿]*/g)) add(m[0]);
    return out.slice(0, 8);
  }
  async function wiki(v, title, kw) {
    wikiFor = v;
    document.getElementById('tg-wiki')?.remove();
    if (!cfg.wiki || wikiClosed.has(v)) return;
    const terms = wikiTerms(title, kw);
    if (!terms.length) return;
    const pages = [];
    for (const t of terms) {
      if (pages.length >= 3 || wikiFor !== v) break;
      const s = await xfetch(`https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(t)}&srlimit=1&format=json`);
      const hit = s?.query?.search?.[0]?.title;
      if (!hit || pages.some(p => p.title === hit)) continue;
      const sum = await xfetch(`https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.replace(/ /g, '_'))}`);
      if (!sum?.extract || sum.type === 'disambiguation') continue;
      pages.push({ title: sum.title || hit, text: sum.extract, url: sum.content_urls?.desktop?.page || `https://ja.wikipedia.org/wiki/${encodeURIComponent(hit)}`, img: sum.thumbnail?.source || '' });
    }
    if (wikiFor !== v || !pages.length) return;
    const host = sideHost();
    if (!host) return;
    const box = document.createElement('div');
    box.id = 'tg-wiki';
    box.dataset.v = v;
    box.innerHTML = `<div class="tg-wiki-h">📖 Wikipedia で事実を確認<button class="tg-wiki-x" title="閉じる（この動画では出さない）">✕</button></div>`
      + pages.map(p => `<a class="tg-wiki-it" href="${esc(p.url)}" target="_blank" rel="noopener">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy">` : ''}<div><b>${esc(p.title)}</b><p>${esc(p.text)}</p></div></a>`).join('');
    box.querySelector('.tg-wiki-x').addEventListener('click', e => { e.preventDefault(); wikiClosed.add(v); box.remove(); });
    host.prepend(box);
  }
  function keepWiki() { // YouTube が横の欄を作り直したり、幅が変わって置き場所が移ったら付け直す
    const box = document.getElementById('tg-wiki');
    const host = sideHost();
    if (box && host && !host.contains(box) && box.dataset.v === curVid()) host.prepend(box);
  }

  // ================= ☀️ 晴れの日の外出のすすめ =================
  let outSnooze = 0, wx = { at: 0, d: null }, geo = null;
  async function weather() {
    if (Date.now() - wx.at < 30 * 60e3) return wx.d;
    if (!geo || geo.city !== cfg.outCity) {
      if (cfg.outCity) {
        const g = await xfetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cfg.outCity)}&count=1&language=ja`);
        const r = g?.results?.[0];
        geo = r ? { city: cfg.outCity, lat: r.latitude, lon: r.longitude, name: r.name } : null;
      } else {
        const g = await xfetch('https://ipapi.co/json/');
        geo = g?.latitude ? { city: '', lat: g.latitude, lon: g.longitude, name: g.city || '' } : null;
      }
    }
    if (!geo) return null;
    const j = await xfetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code,is_day&timezone=auto`);
    wx = { at: Date.now(), d: j?.current ? { t: j.current.temperature_2m, code: j.current.weather_code, day: !!j.current.is_day, name: geo.name } : null };
    return wx.d;
  }
  async function outCheck() {
    const p = player();
    const box = p?.querySelector('.tg-outdoor');
    if (!cfg.out || !curVid() || Date.now() < outSnooze) { box?.remove(); return; }
    if (box) { video()?.pause(); return; } // 出している間は止めておく
    const d = new Date();
    if (d.getDay() !== 0 && d.getDay() !== 6) return; // 休日（土日）だけ
    const { daily = {} } = await chrome.storage.local.get('daily');
    const watched = (daily[TG.dayKey()] || 0) / 60;
    if (watched < (+cfg.outMin || 120)) return;
    const w = await weather();
    if (!w || !w.day || w.code > 1 || w.t < (+cfg.outLo || 15) || w.t > (+cfg.outHi || 28)) return;
    if (!p || p.querySelector('.tg-outdoor')) return;
    video()?.pause();
    const el = document.createElement('div');
    el.className = 'tg-outdoor';
    el.innerHTML = `<div class="tg-out-in"><div class="tg-out-sun">☀️</div>
      <div class="tg-out-t">現在${Math.round(w.t)}℃の快晴です。外に出ましょう</div>
      <div class="tg-out-s">${w.name ? esc(w.name) + '・' : ''}今日はもう ${Math.floor(watched / 60)}時間${Math.round(watched % 60)}分 見ています</div>
      <button class="tg-out-snz">どうしても見る（15分）</button></div>`;
    ['mousedown', 'mouseup', 'click', 'dblclick', 'keydown'].forEach(t => el.addEventListener(t, e => e.stopPropagation()));
    el.querySelector('.tg-out-snz').addEventListener('click', () => { outSnooze = Date.now() + 15 * 60e3; el.remove(); log('外出', '15分だけ見る'); });
    p.appendChild(el);
    log('外出', `晴れ ${Math.round(w.t)}℃・今日 ${Math.round(watched)} 分視聴でプレイヤーを隠しました`);
  }

  // ================= 👎 一覧のサムネに低評価率 =================
  const rydMem = new Map(); // 動画ID → 割合（-1＝不明）
  const rydQ = [];
  let rydBusy = 0;
  const ITEM = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model, ytd-playlist-video-renderer';
  const THUMB = 'ytd-thumbnail, yt-thumbnail-view-model, .yt-lockup-view-model__content-image, a#thumbnail';
  function paintBadge(item, v) {
    const r = rydMem.get(v);
    if (r == null || r < 0) return;
    const th = item.classList.contains('tg-card') ? item.querySelector('.tg-thumb') : item.querySelector(THUMB);
    if (!th) return;
    let b = th.querySelector(':scope > .tg-disb');
    if (!b) { b = document.createElement('span'); b.className = 'tg-disb'; th.appendChild(b); }
    const pct = Math.round(r * 100);
    b.textContent = `👎 ${pct}%`;
    b.classList.toggle('hi', r >= 0.3);
    b.title = `低評価の割合（Return YouTube Dislike の推定）${r >= 0.3 ? '・30% 以上' : ''}`;
  }
  async function pumpRyd() {
    while (rydQ.length && rydBusy < 3) {
      const { item, v } = rydQ.shift();
      if (rydMem.has(v)) { paintBadge(item, v); continue; }
      rydBusy++;
      chrome.runtime.sendMessage({ type: 'ryd', v }).catch(() => null).then(r => {
        rydMem.set(v, r && r.likes + r.dislikes >= 5 ? r.dislikes / (r.likes + r.dislikes) : -1);
        if (item.dataset.tgdis === v && cfg.disBadge) paintBadge(item, v);
      }).finally(() => { rydBusy--; pumpRyd(); });
    }
  }
  function badges() {
    if (!cfg.disBadge || document.hidden) return;
    const H = innerHeight + 800;
    for (const item of document.querySelectorAll(ITEM + ', .tg-card[data-v]')) {
      const own = item.classList.contains('tg-card'); // TubeFolio の一覧のカード
      if (!own && item.closest('#tg-feed, #tg-hf-list, #tg-manager, ytd-miniplayer')) continue;
      if (own && item.closest('[data-type="short"]')) continue;
      const a = item.querySelector('a[href*="watch?v="]');
      const v = own ? item.dataset.v : (a?.getAttribute('href') || '').match(/[?&]v=([\w-]{11})/)?.[1];
      if (!v) continue;
      if (item.dataset.tgdis === v) { if (rydMem.has(v) && !item.querySelector('.tg-disb')) paintBadge(item, v); continue; }
      const rc = item.getBoundingClientRect();
      if (!rc.height || rc.top > H || rc.bottom < -400) continue;
      item.dataset.tgdis = v;
      item.querySelector('.tg-disb')?.remove();
      if (rydMem.has(v)) paintBadge(item, v);
      else rydQ.push({ item, v });
    }
    pumpRyd();
  }
  let bT = 0;
  const badgesSoon = () => { if (!bT) bT = setTimeout(() => { bT = 0; badges(); }, 400); };
  window.addEventListener('scroll', badgesSoon, { passive: true });
  document.addEventListener('yt-navigate-finish', () => setTimeout(badges, 800));

  // ================= 📼 削除された動画を Wayback Machine から（TubeFolio の「後で見る」） =================
  //   タイトルが「[Deleted video]」「[Private video]」、またはサムネが無い（灰色の小さい画像）動画を見つけたら、
  //   archive.org に保存されたページ・サムネを探し、サムネを当時の画像に、押したときの行き先をアーカイブに差し替える
  const DEAD = /^\[(deleted|private) video\]$|^(削除された動画|非公開動画)$/i;
  let wbCache = null, wbBusy = false;
  async function wbLookup(v) {
    if (!wbCache) wbCache = (await chrome.storage.local.get('wbCache')).wbCache || {};
    const c = wbCache[v];
    if (c && Date.now() - c.at < 30 * 864e5) return c;
    const page = await xfetch(`https://archive.org/wayback/available?url=${encodeURIComponent('youtube.com/watch?v=' + v)}`);
    const img = await xfetch(`https://archive.org/wayback/available?url=${encodeURIComponent('i.ytimg.com/vi/' + v + '/hqdefault.jpg')}`);
    const pu = page?.archived_snapshots?.closest?.available ? page.archived_snapshots.closest.url : '';
    const iu = img?.archived_snapshots?.closest?.available ? img.archived_snapshots.closest.url.replace(/\/web\/(\d+)\//, '/web/$1id_/') : '';
    const r = { at: Date.now(), page: pu.replace(/^http:/, 'https:'), img: iu.replace(/^http:/, 'https:') };
    wbCache[v] = r;
    const ks = Object.keys(wbCache);
    if (ks.length > 500) ks.sort((a, b) => wbCache[a].at - wbCache[b].at).slice(0, ks.length - 500).forEach(k => delete wbCache[k]);
    chrome.storage.local.set({ wbCache });
    return r;
  }
  function isDead(card) {
    if (DEAD.test(card.querySelector('.tg-title')?.textContent?.trim() || '')) return true;
    const img = card.querySelector('.tg-thumb img');
    return !!img && img.complete && img.naturalWidth > 0 && img.naturalWidth <= 120 && img.src === img.dataset.fb;
  }
  async function wayback() {
    if (wbBusy || cfg.wb === false) return;
    const cards = [...document.querySelectorAll('#tg-feed[data-type="later"] .tg-card[data-v]:not([data-tgwb])')].filter(isDead);
    if (!cards.length) return;
    wbBusy = true;
    try {
      for (const card of cards.slice(0, 6)) {
        const v = card.dataset.v;
        card.dataset.tgwb = '1';
        const th = card.querySelector('.tg-thumb');
        const tag = document.createElement('span');
        tag.className = 'tg-wbtag';
        tag.textContent = '📼 アーカイブを確認中…';
        th?.appendChild(tag);
        const r = await wbLookup(v);
        if (r.img) { const img = th?.querySelector('img'); if (img) { img.dataset.fb = r.img; img.src = r.img; } }
        if (r.page) {
          card.dataset.tgwbUrl = r.page;
          card.classList.add('tg-wbok');
          tag.textContent = '📼 アーカイブで見る';
          card.title = 'この動画は削除されています。押すと Internet Archive に保存されたページを開きます';
        } else {
          card.classList.add('tg-wbng');
          tag.textContent = '🚫 アーカイブなし';
        }
        log('アーカイブ', `${v}：${r.page ? 'Wayback Machine に保存あり' : '保存なし'}`);
      }
    } finally { wbBusy = false; }
  }
  // アーカイブがある削除済みの動画は、押したら（後で見るの連続再生より先に）アーカイブを開く
  document.addEventListener('click', e => {
    const card = e.target.closest?.('.tg-card[data-tgwb-url]');
    if (!card || e.target.closest('button')) return;
    e.preventDefault(); e.stopPropagation();
    window.open(card.dataset.tgwbUrl, '_blank', 'noopener');
  }, true);

  // ================= 👤 コメントの名前：@ハンドル の代わりにユーザー名（チャンネルの表示名） =================
  //   YouTube のコメント欄と、TubeFolio の流れるコメントの両方。設定 px.cmtName（true＝ユーザー名・false＝@ハンドルのまま）
  //   名前は cmtNames（@ハンドル／チャンネルID → 名前）に覚えて、同じ人は調べ直さない
  let names = null, nameQ = [], nameBusy = 0, nameSaveT = 0;
  const NAME_SEL = 'ytd-comment-view-model #author-text, ytd-comment-renderer #author-text, .tg-c-author[data-chid]';
  async function loadNames() { if (!names) names = new Map(Object.entries((await chrome.storage.local.get('cmtNames')).cmtNames || {})); return names; }
  function saveNames() {
    clearTimeout(nameSaveT);
    nameSaveT = setTimeout(() => { const o = Object.fromEntries([...names].slice(-3000)); chrome.storage.local.set({ cmtNames: o }); }, 3000);
  }
  async function lookup(key) { // key：@ハンドル または UC…
    const id = key.startsWith('UC') ? key : await YTAPI.resolveHandle(key);
    if (!id) return '';
    if (names.has(id)) return names.get(id);
    const n = await YTAPI.channelTitle(id);
    if (n) names.set(id, n);
    return n;
  }
  function pumpNames() {
    while (nameQ.length && nameBusy < 3) {
      const key = nameQ.shift();
      if (names.has(key)) continue;
      nameBusy++;
      lookup(key).then(n => { names.set(key, n || ''); saveNames(); paintNames(); }, () => names.set(key, '')).finally(() => { nameBusy--; pumpNames(); });
    }
  }
  const keyOf = el => el.dataset.chid || (el.getAttribute('href') || el.closest('a')?.getAttribute('href') || '').match(/\/(@[^/?#]+)/)?.[1] || (el.getAttribute('href') || '').match(/\/channel\/(UC[\w-]+)/)?.[1] || '';
  function paintNames() {
    if (!names) return;
    for (const el of document.querySelectorAll(NAME_SEL)) {
      const txt = el.querySelector('span') || el;
      if (!cfg.cmtName) { // 戻す
        if (el.dataset.tgOrig != null) { txt.textContent = el.dataset.tgOrig; delete el.dataset.tgOrig; }
        continue;
      }
      const key = keyOf(el);
      if (!key) continue;
      const shown = (txt.textContent || '').trim();
      if (el.dataset.tgOrig != null && shown === names.get(key)) continue; // 済み
      if (el.dataset.tgOrig != null && shown !== names.get(key)) delete el.dataset.tgOrig; // YouTube が描き直した
      if (!names.has(key)) { if (!nameQ.includes(key)) nameQ.push(key); continue; }
      const n = names.get(key);
      if (!n || n === shown) continue;
      el.dataset.tgOrig = shown;
      txt.textContent = n;
      el.title = `${n}（${shown}）`;
    }
    pumpNames();
  }
  let nameLast = 0;
  async function commentNames() {
    if (location.pathname !== '/watch' || Date.now() - nameLast < 1200) return;
    nameLast = Date.now();
    await loadNames();
    paintNames();
  }

  // ================= 見回り =================
  let lastV = null;
  async function tick() {
    badges();
    commentNames().catch(() => {});
    wayback().catch(() => {});
    const v = curVid();
    if (!v) { lastV = null; document.getElementById('tg-wiki')?.remove(); return; }
    keepWiki();
    sbPaint();
    if (v !== lastV) {
      lastV = v;
      sbLoad(v); // 飛ばす設定がオフでも、対象かどうかの案内のために調べる
      rydWarn(v);
      // 動画の情報が読めるまで少し待つ
      let m = null;
      for (let i = 0; i < 6 && !m; i++) { const r = await main('meta'); if (r?.v === v) m = r; else await new Promise(r2 => setTimeout(r2, 700)); }
      if (lastV !== v) return;
      const title = document.querySelector('ytd-watch-metadata h1')?.textContent?.trim() || document.title.replace(/ - YouTube$/, '');
      ghCheck(v, m?.desc || '');
      wiki(v, title, m?.kw || []);
    }
    outCheck().catch(() => {});
  }
  setInterval(() => { tick().catch(() => {}); }, 1500);

  return { badges };
})();
