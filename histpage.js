// 視聴履歴のページ(上のバーの「視聴履歴」。page.html?p=hist)。page.js から histPage() で呼ばれる。
//   データ: storage の hist(histrec.js が、再生のたびに記録する。Drive同期の対象 = どのPCで見た分も合わさる)
//     hist = { v: { 動画ID: [タイトル, チャンネル名, チャンネルのキー, 長さ(秒), ショートなら1] }, p: [[開始(秒), 動画ID, 見た秒数], …] }
//   1ページに、上に「📊 分析」(期間を選んで、合計・日別・時間帯・曜日・チャンネル・フォルダ・よく見た動画)、下に「🗂 履歴の管理」を並べる
//   「🗂 履歴の管理」: 一覧・検索・1件ずつ/まとめて削除・CSV/JSONの書き出し・JSONの読み込み・テストデータの作成/削除
//   テストデータは、動画IDが「TFTEST」で始まる(本物の動画IDと重ならない)。「テストデータを削除」で、それだけを消せる
function histPage() {
  const DAY = 86400, TEST = /^TFTEST/;
  const hm = sec => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60); return h ? `${h}時間${m ? m + '分' : ''}` : sec < 60 ? `${sec}秒` : `${m}分`; };
  const ms = sec => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const dkey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const WD = '日月火水木金土';
  let H = { v: {}, p: [], g: 0 }, S = null, meta = {}, days = 30, q = '', shown = 200;
  try { days = +localStorage.getItem('tfHistDays') || 30; } catch (e) { /* なし */ }
  main.innerHTML = `<div class="head"><h1>${esc(TITLE)}</h1><span class="sub">この拡張機能で再生した記録(Google Drive で共有)</span><span class="sp"></span><span id="st"></span></div>
    <div class="hx-tabs"><span class="sp"></span>
      <span class="hx-seg" id="hx-days">${[[7, '7日'], [30, '30日'], [90, '90日'], [365, '1年'], [0, 'すべて']].map(([n, l]) => `<button data-d="${n}">${l}</button>`).join('')}</span></div>
    <div id="hx"><div id="hx-a"></div><div id="hx-m"></div></div><div id="hx-tip" hidden></div>`;
  const box = $('#hx'), A = $('#hx-a'), M = $('#hx-m'), tip = $('#hx-tip');
  // g = 最後に削除した時刻。削除のときに更新する(sync.js が、ほかのPCの古い記録で、消した分を戻さないために使う)
  const save = (h, deleted) => { const g = deleted ? Date.now() : H.g; return chrome.storage.local.set({ hist: g ? { v: h.v, p: h.p, g } : { v: h.v, p: h.p } }); };
  // チャンネルのキー → 登録チャンネル(フォルダを引くため)。キーが違う形(@ハンドル / UC…)でも、IDと名前で引けるようにする
  let chIdx = new Map();
  const buildIdx = () => {
    chIdx = new Map();
    Object.entries((S && S.channels) || {}).forEach(([k, c]) => { chIdx.set(k.toLowerCase(), c); if (meta[k] && meta[k].id) chIdx.set(String(meta[k].id).toLowerCase(), c); if (c && c.name) chIdx.set('n:' + String(c.name).normalize('NFKC').trim().toLowerCase(), c); });
  };
  const chOf = m => (m && (chIdx.get(String(m[2] || '').toLowerCase()) || chIdx.get('n:' + String(m[1] || '').normalize('NFKC').trim().toLowerCase()))) || null;
  const inRange = () => { const cut = days ? Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000) - (days - 1) * DAY : 0; return H.p.filter(x => x[0] >= cut); };

  // ---- 棒(横): 上位の一覧。値は文字で横に出す ----
  const tkf = v => v >= 3600 ? (v / 3600).toFixed(v >= 36000 ? 0 : 1) + "h" : Math.round(v / 60) + "分"; // 横軸の目盛りは短く(長い文字だと重なる)
  const hbars = (rows, unit) => { const max = Math.max(1, ...rows.map(r => r.val)); return rows.length ? `<div class="hx-hb">${rows.map(r => `<div class="hx-hr" data-tip="${esc(r.tip || '')}"><span class="hx-hl" title="${esc(r.name)}">${r.href ? `<a href="${esc(r.href)}" target="_top">${esc(r.name)}</a>` : esc(r.name)}</span><span class="hx-ht"><i style="width:${(r.val / max * 100).toFixed(1)}%"></i></span><span class="hx-hv">${esc(unit(r.val))}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span></div>`).join('')}<div class="hx-hr hx-hax"><span></span><span class="hx-tk">${[0, 0.25, 0.5, 0.75, 1].map(k => `<em>${k ? esc(tkf(max * k)) : '0'}</em>`).join('')}</span><span></span></div></div>` : '<p class="none">まだ記録がありません。</p>'; };
  // ---- 棒(縦): 日別・時間帯・曜日。目盛りは、いちばん上の値と半分の線だけ ----
  const vbars = (cols, labelEvery) => { const max = Math.max(60, ...cols.map(c => c.val)); return `<div class="hx-vb"><div class="hx-vy"><span>${esc(hm(max))}</span><span>${esc(hm(max / 2))}</span><span>0</span></div><div class="hx-vp"><i class="hx-g" style="bottom:50%"></i><i class="hx-g" style="bottom:100%"></i>${cols.map((c, i) => `<div class="hx-vc" data-tip="${esc(c.tip)}"><b style="height:${(c.val / max * 100).toFixed(1)}%"></b><em>${i % labelEvery === 0 ? esc(c.label) : ''}</em></div>`).join('')}</div></div>`; };

  // ---- 時間帯の傾向(曜日 × 時間のヒートマップ。就寝時間・作業時間つき) と 曜日 × フォルダ(積み上げ) ----
  const WDM = ['月', '火', '水', '木', '金', '土', '日']; // 表の行(月はじまり)。Date.getDay() は (i + 1) % 7
  let sw = { from: '23:00', to: '07:00' }, FC = null, showSleep = true, showWork = true; const hidF = new Set();
  try { showSleep = localStorage.getItem('tfHistSleep') !== '0'; showWork = localStorage.getItem('tfHistWork') !== '0'; } catch (e) { /* なし */ }
  const toMin = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const ov = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c)); // 区間 [a,b) と [c,d) の重なり
  const winOv = (from, to, m0, m1) => from <= to ? ov(m0, m1, from, to) : ov(m0, m1, from, 1440) + ov(m0, m1, 0, to); // 時間帯(日をまたいでもよい)と、一日の中の区間(分)の重なり
  // 1回の再生(開始 t 秒・sec 秒)を、1時間ごとの区間に分ける(1回で何時間もまたぐ再生も、それぞれの時間に数える。1回の再生は最大6時間まで)
  const slices = (t, sec, fn) => { let s = t, left = Math.min(sec, 6 * 3600), g = 0; while (left > 0 && g++ < 8) { const d = new Date(s * 1000), h = d.getHours(), m0 = h * 60 + d.getMinutes() + d.getSeconds() / 60, len = Math.min(left, (60 - d.getMinutes()) * 60 - d.getSeconds()); fn(d, h, m0, m0 + len / 60, len); s += len; left -= len; } };
  const hrs = sec => sec >= 3600 * 10 ? Math.round(sec / 3600) + 'h' : (sec / 3600).toFixed(1) + 'h';

  function patternHtml(P) {
    const heat = Array.from({ length: 7 }, () => new Array(24).fill(0)), slp = Array.from({ length: 7 }, () => new Array(24).fill(0)), hourSum = new Array(24).fill(0);
    const a = toMin(sw.from), b = toMin(sw.to), slots = FC && FC.on ? (FC.slots || []) : [], wmask = Array.from({ length: 7 }, () => new Array(24).fill(0));
    slots.forEach(s => { const f = toMin(s.from), t = toMin(s.to); (s.days || []).forEach(dd => { for (let h = 0; h < 24; h++) { const m0 = h * 60, m1 = m0 + 60; if (f <= t) wmask[dd][h] += ov(m0, m1, f, t); else { wmask[dd][h] += ov(m0, m1, f, 1440); wmask[(dd + 1) % 7][h] += ov(m0, m1, 0, t); } } }); });
    let sleepSec = 0, workSec = 0, all = 0;
    P.forEach(x => slices(x[0], x[2] || 0, (d, h, m0, m1, len) => {
      const w = d.getDay(); heat[w][h] += len; hourSum[h] += len; all += len;
      const so = winOv(a, b, m0, m1) * 60; if (so > 0) { sleepSec += so; slp[w][h] += so; }
      if (wmask[w][h] >= 30) workSec += len;
    }));
    const max = Math.max(1, ...heat.flat()), pk = hourSum.indexOf(Math.max(...hourSum));
    const cell = (w, h) => { // w = 0(日)〜6(土)
      const v = heat[w][h], sl = winOv(a, b, h * 60, h * 60 + 60) >= 30, wk = wmask[w][h] >= 30;
      const cls = ['hx-hc', showSleep && sl ? 'sl' : '', showSleep && slp[w][h] > 0 ? 'sw' : '', showWork && wk ? 'wk' : ''].filter(Boolean).join(' ');
      const style = v ? ` style="background:color-mix(in srgb, var(--hx-s1) ${Math.round((0.2 + 0.8 * Math.sqrt(v / max)) * 100)}%, transparent)"` : '';
      return `<i class="${cls}"${style} data-tip="${WD[w]}曜 ${h}時台 ・ ${v ? hm(v) : '見ていない'}${sl ? ' ・ 就寝時間' : ''}${wk ? ' ・ 作業時間' : ''}${slp[w][h] > 0 ? ' ・ 就寝時間に ' + hm(slp[w][h]) : ''}"></i>`;
    };
    const grid = `<div class="hx-hg">${[0, 1, 2, 3, 4, 5, 6].map(i => { const w = (i + 1) % 7; return `<span class="hx-hw">${WDM[i]}</span>${Array.from({ length: 24 }, (_, h) => cell(w, h)).join('')}`; }).join('')}<span></span>${[0, 6, 12, 18].map(h => `<em>${h}時</em>`).join('')}</div>`;
    const focusTxt = FC && FC.on ? slots.map(s => `${(s.days || []).slice().sort((x, y) => (x + 6) % 7 - (y + 6) % 7).map(d => WD[d]).join('')} ${s.from}〜${s.to}`).join(' / ') : '集中モードがオフのため表示なし';
    const pct = x => all ? ` (全体の ${Math.round(x / all * 100)}%)` : '';
    return `<section class="hx-card"><div class="hx-ch"><h2>時間帯の傾向</h2><span class="hx-cs">${all ? `いちばん多いのは ${pk}〜${(pk + 1) % 24}時` : 'まだ記録がありません'}</span></div>${grid}
      <div class="hx-pc"><span class="hx-sq sl"></span>就寝時間 <input type="time" class="hx-ti" id="hx-sf" value="${esc(sw.from)}"> 〜 <input type="time" class="hx-ti" id="hx-st" value="${esc(sw.to)}"> <label class="hx-ck"><input type="checkbox" id="hx-ss"${showSleep ? ' checked' : ''}> 表示</label></div>
      <div class="hx-pc"><span class="hx-sq wk"></span>作業時間 = 集中モードの時間帯 <span class="hx-cs">${esc(focusTxt)}</span>${FC && FC.on ? ` <label class="hx-ck"><input type="checkbox" id="hx-sk"${showWork ? ' checked' : ''}> 表示</label>` : ''}</div>
      <p class="hx-ps">🌙 就寝時間に見た: <b>${hm(sleepSec)}</b>${pct(sleepSec)}${FC && FC.on ? ` <span class="hx-sep">・</span>💼 作業時間に見た: <b>${hm(workSec)}</b>${pct(workSec)}` : ''}</p></section>`;
  }

  function stackHtml(P, now, span) {
    const byId = new Map(S.groups.map(g => [g.id, g])), PAL = (TF.PALETTE || ['#e53935', '#8e24aa', '#3949ab', '#1e88e5', '#00897b', '#43a047', '#fb8c00', '#6d4c41']);
    const root = id => { let g = byId.get(id), n = 0; while (g && g.parent && byId.has(g.parent) && n++ < 50) g = byId.get(g.parent); return g; };
    const serOf = x => { const reg = chOf(H.v[x[1]]), gid = reg && (reg.groups || []).find(id => byId.has(id)), g = gid && root(gid); return g ? g.id : '_none'; };
    const tot = new Map(); P.forEach(x => { const k = serOf(x); tot.set(k, (tot.get(k) || 0) + (x[2] || 0)); });
    const grand = [...tot.values()].reduce((s, v) => s + v, 0);
    const named = [...tot.entries()].filter(([k]) => k !== '_none').sort((p, q) => q[1] - p[1]), top = named.slice(0, 8).map(([k]) => k), topSet = new Set(top);
    const keyOf = x => { const k = serOf(x); return k === '_none' || topSet.has(k) ? k : '_other'; };
    const series = [...top.map((k, i) => ({ k, name: byId.get(k).name, color: byId.get(k).color || PAL[i % PAL.length] })), ...(named.length > 8 ? [{ k: '_other', name: 'その他のフォルダ', color: '#b0b0b0' }] : []), ...(tot.has('_none') ? [{ k: '_none', name: '登録外・おすすめ', color: '#6b6b6b' }] : [])];
    series.forEach(s => { s.val = s.k === '_other' ? named.slice(8).reduce((n, [, v]) => n + v, 0) : (tot.get(s.k) || 0); });
    // 列: 7日以内は日ごと(古い順)、それより長いときは曜日ごとの1日あたりの平均
    const daily = span <= 7, cols = [];
    if (daily) for (let i = span - 1; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); cols.push({ key: dkey(d), label: WD[d.getDay()], sub: `${d.getMonth() + 1}/${d.getDate()}`, n: 1, by: new Map() }); }
    else for (let i = 0; i < 7; i++) { const w = (i + 1) % 7; let n = 0; for (let j = 0; j < Math.min(span, 3650); j++) { const d = new Date(now); d.setDate(d.getDate() - j); if (d.getDay() === w) n++; } cols.push({ w, label: WDM[i], sub: '平均', n: Math.max(1, n), by: new Map() }); }
    P.forEach(x => { const d = new Date(x[0] * 1000), c = daily ? cols.find(c => c.key === dkey(d)) : cols[(d.getDay() + 6) % 7]; if (!c) return; const k = keyOf(x); c.by.set(k, (c.by.get(k) || 0) + (x[2] || 0) / c.n); });
    const vis = series.filter(s => !hidF.has(s.k)), sum = c => vis.reduce((n, s) => n + (c.by.get(s.k) || 0), 0), top0 = Math.max(3600 * 0.5, ...cols.map(sum)), max = top0 * 1.12; // 1.12 = 合計の文字を、枠の中に収める余白
    const sorted = vis.slice().sort((p, q) => q.val - p.val);
    const bars = cols.map(c => { const t = sum(c), tip = `${c.label}${daily ? ' ' + c.sub : ''}(${daily ? '' : '1日の平均 '}${hrs(t)}) ` + vis.filter(s => c.by.get(s.k)).sort((p, q) => (c.by.get(q.k) || 0) - (c.by.get(p.k) || 0)).slice(0, 6).map(s => `${s.name} ${hrs(c.by.get(s.k))}`).join(' ・ ');
      const segs = t ? sorted.map(s => { const v = c.by.get(s.k) || 0; return v ? `<i style="height:${(v / t * 100).toFixed(2)}%;background:${esc(s.color)}"></i>` : ''; }).join('') : '';
      return `<div class="hx-sc" data-tip="${esc(tip)}">${t ? `<div class="hx-sb" style="height:${(t / max * 100).toFixed(2)}%"><b>${t >= 180 ? hrs(t) : ''}</b>${segs}</div>` : '<u></u>'}</div>`; }).join('');
    const xl = cols.map(c => `<div><span>${esc(c.label)}</span><small>${esc(c.sub)}</small></div>`).join('');
    // 枠の中: 区切りの線(25%ごと)と、左に目盛りの文字
    const plot = `<div class="hx-sf"><div class="hx-sy">${[1, 0.75, 0.5, 0.25, 0].map(k => `<span>${k ? hrs(max * k) : '0'}</span>`).join('')}</div><div class="hx-sw"><div class="hx-sp"><i class="hx-sg" style="bottom:25%"></i><i class="hx-sg" style="bottom:50%"></i><i class="hx-sg" style="bottom:75%"></i><div class="hx-st">${bars}</div></div><div class="hx-sx">${xl}</div></div></div>`;
    const legend = series.map(s => `<button type="button" class="hx-lg${hidF.has(s.k) ? ' off' : ''}" data-f="${esc(s.k)}" title="押すと、この系列を隠す / 戻す"><i style="background:${esc(s.color)}"></i>${esc(s.name)} <b>${grand ? Math.round(s.val / grand * 100) : 0}%</b></button>`).join('');
    return `<section class="hx-card"><div class="hx-ch"><h2>曜日 × フォルダ</h2><span class="hx-cs">${daily ? '視聴時間(積み上げ)' : '1日あたりの平均(積み上げ)'}</span></div>
      ${grand ? `${plot}<div class="hx-lgd">${legend}</div>` : '<p class="none">まだ記録がありません。</p>'}</section>`;
  }

  function drawAn() {
    const P = inRange(), total = P.reduce((a, x) => a + (x[2] || 0), 0), vids = new Set(P.map(x => x[1]));
    if (!H.p.length) { A.innerHTML = `<p class="empty">まだ視聴履歴がありません。動画を5秒以上再生すると、ここに記録されます。<br>画面を試すには、下の「🛠 データの管理」の「テストデータを作成」を使ってください。</p>`; return; }
    // 日別(期間が長いときは、週・月でまとめる)
    const now = new Date(), first = P.length ? new Date(P[0][0] * 1000) : now, span = days || Math.max(1, Math.round((now - first) / 864e5) + 1);
    const unit = span <= 92 ? 'd' : span <= 400 ? 'w' : 'm', byDay = new Map();
    P.forEach(x => { const k = dkey(new Date(x[0] * 1000)); byDay.set(k, (byDay.get(k) || 0) + x[2]); });
    const cols = [];
    if (unit === 'd') for (let i = span - 1; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); const v = byDay.get(dkey(d)) || 0; cols.push({ val: v, label: `${d.getMonth() + 1}/${d.getDate()}`, tip: `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]}) ・ ${hm(v)}` }); }
    else {
      const bucket = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); if (unit === 'w') x.setDate(x.getDate() - x.getDay()); else x.setDate(1); return x; };
      const m = new Map(); for (let d = bucket(first); d <= now; unit === 'w' ? d.setDate(d.getDate() + 7) : d.setMonth(d.getMonth() + 1)) m.set(dkey(d), { d: new Date(d), val: 0 });
      P.forEach(x => { const e = m.get(dkey(bucket(new Date(x[0] * 1000)))); if (e) e.val += x[2]; });
      [...m.values()].forEach(e => cols.push({ val: e.val, label: unit === 'w' ? `${e.d.getMonth() + 1}/${e.d.getDate()}` : `${e.d.getFullYear() % 100}/${e.d.getMonth() + 1}`, tip: (unit === 'w' ? `${e.d.getMonth() + 1}月${e.d.getDate()}日からの週` : `${e.d.getFullYear()}年${e.d.getMonth() + 1}月`) + ` ・ ${hm(e.val)}` }));
    }
    const actDays = byDay.size, best = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
    // チャンネル・フォルダ・動画
    const chs = new Map(), fol = new Map(), vv = new Map(); let shortSec = 0, unfiled = 0;
    P.forEach(x => {
      const m = H.v[x[1]] || [], name = m[1] || '(チャンネル不明)', ck = m[2] || 'n:' + name;
      const c = chs.get(ck) || { name, key: m[2] || '', val: 0, n: 0 }; c.val += x[2]; c.n++; chs.set(ck, c);
      const e = vv.get(x[1]) || { val: 0, n: 0 }; e.val += x[2]; e.n++; vv.set(x[1], e);
      if (m[4]) shortSec += x[2];
      const reg = chOf(m), gs = reg ? (reg.groups || []).filter(id => S.groups.some(g => g.id === id)) : [];
      if (!gs.length) unfiled += x[2]; else gs.forEach(id => fol.set(id, (fol.get(id) || 0) + x[2]));
    });
    const chRows = [...chs.values()].sort((a, b) => b.val - a.val).slice(0, 15).map(c => ({ name: c.name, val: c.val, sub: `${c.n}回`, tip: `${c.name} ・ ${hm(c.val)} ・ ${c.n}回`, href: c.key ? 'https://www.youtube.com/' + (/^UC/.test(c.key) ? 'channel/' + c.key : c.key) : '' }));
    const folRows = [...fol.entries()].map(([id, val]) => { const g = S.groups.find(x => x.id === id); return { name: (TF.isImgIcon(g.icon) ? '' : (g.icon || '') + ' ') + g.name, val, tip: `${g.name} ・ ${hm(val)}` }; }).sort((a, b) => b.val - a.val).slice(0, 15);
    if (unfiled) folRows.push({ name: '(フォルダなし)', val: unfiled, tip: `フォルダに入れていないチャンネル ・ ${hm(unfiled)}` });
    const vRows = [...vv.entries()].sort((a, b) => b[1].val - a[1].val).slice(0, 10).map(([id, e]) => { const m = H.v[id] || []; return { name: m[0] || id, val: e.val, sub: `${e.n}回`, tip: `${m[0] || id} ・ ${m[1] || ''} ・ ${hm(e.val)} ・ ${e.n}回`, href: TEST.test(id) ? '' : 'https://www.youtube.com/watch?v=' + id }; });
    const tile = (l, v, s) => `<div class="hx-tile"><small>${esc(l)}</small><b>${esc(v)}</b>${s ? `<span>${esc(s)}</span>` : ''}</div>`;
    const period = days ? `直近${days === 365 ? '1年' : days + '日'}` : 'すべての期間';
    A.innerHTML = `<div class="hx-tiles">${tile('合計の視聴時間', hm(total), period)}${tile('見た動画', vids.size + '本', `再生 ${P.length}回`)}${tile('1日の平均', hm(total / Math.max(1, days || span)), `見た日 ${actDays}日`)}${tile('いちばん長く見た日', best ? hm(best[1]) : '—', best ? best[0].replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1年$2月$3日') : '')}${tile('ショート', hm(shortSec), total ? `全体の ${Math.round(shortSec / total * 100)}%` : '')}</div>
      <section class="hx-card"><h2>${unit === 'd' ? '日ごと' : unit === 'w' ? '週ごと' : '月ごと'}の視聴時間</h2>${vbars(cols, cols.length > 60 ? 14 : cols.length > 16 ? 7 : cols.length > 8 ? 2 : 1)}</section>
      <div class="hx-two hx-pat">${patternHtml(P)}${stackHtml(P, now, span)}</div>
      <div class="hx-two"><section class="hx-card"><h2>チャンネル(上位15)</h2>${hbars(chRows, hm)}</section>
      <section class="hx-card"><h2>フォルダ</h2><p class="hx-note">複数のフォルダに入れたチャンネルは、それぞれのフォルダに数えます。</p>${hbars(folRows, hm)}</section></div>
      <section class="hx-card"><h2>よく見た動画(上位10)</h2>${hbars(vRows, hm)}</section>`;
  }

  function drawMg() {
    const P = inRange().slice().reverse(), words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = words.length ? P.filter(x => { const m = H.v[x[1]] || [], t = ((m[0] || '') + ' ' + (m[1] || '')).toLowerCase(); return words.every(w => t.includes(w)); }) : P;
    const nTest = H.p.filter(x => TEST.test(x[1])).length;
    let last = '', rows = '';
    hit.slice(0, shown).forEach(x => {
      const d = new Date(x[0] * 1000), k = dkey(d), m = H.v[x[1]] || [], test = TEST.test(x[1]);
      if (k !== last) { last = k; const sum = hit.filter(y => dkey(new Date(y[0] * 1000)) === k).reduce((a, y) => a + y[2], 0); rows += `<div class="hx-dh">${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})<small>${hm(sum)}</small></div>`; }
      rows += `<div class="hx-row" data-k="${x[0]}|${esc(x[1])}">${test ? '<span class="hx-th ph">テスト</span>' : `<a class="hx-th" href="https://www.youtube.com/watch?v=${esc(x[1])}" target="_top"><img loading="lazy" src="https://i.ytimg.com/vi/${esc(x[1])}/default.jpg"></a>`}
        <div class="hx-tx">${test ? `<b>${esc(m[0] || x[1])}</b>` : `<a href="https://www.youtube.com/${m[4] ? 'shorts/' + esc(x[1]) : 'watch?v=' + esc(x[1])}" target="_top"><b>${esc(m[0] || x[1])}</b></a>`}<small>${esc(m[1] || '')}${m[4] ? ' ・ ショート' : ''}</small></div>
        <span class="hx-tm">${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</span><span class="hx-ws" title="見た時間 / 動画の長さ">${ms(x[2])}${m[3] ? ' / ' + ms(m[3]) : ''}</span>
        <button class="hx-x" data-del="1" title="この記録を削除">✕</button></div>`;
    });
    const keep = document.activeElement && document.activeElement.id === 'hx-q';
    const toolsOpen = !!M.querySelector('.hx-tools[open]');
    M.innerHTML = `<div class="hx-bar"><input id="hx-q" type="search" placeholder="タイトル・チャンネルで絞り込み" value="${esc(q)}" autocomplete="off"><span class="sub">${hit.length}件 ・ ${hm(hit.reduce((a, x) => a + x[2], 0))}</span><span class="sp"></span>
        ${words.length && hit.length ? '<button data-a="delhit" class="warn">絞り込んだ記録を削除</button>' : ''}</div>
      <details class="hx-tools"${toolsOpen ? ' open' : ''}><summary>🛠 データの管理(書き出し・読み込み・削除・テストデータ)</summary><div class="hx-tb">
        <button data-a="csv">📤 CSVで書き出す</button><button data-a="json">📤 JSONで書き出す</button><button data-a="imp">📥 JSONから読み込む(今の記録に足す)</button><input type="file" id="hx-file" accept=".json,application/json" hidden>
        <span class="hx-br"></span>
        <button data-a="test">🧪 テストデータを作成(60日分)</button>${nTest ? `<button data-a="untest">🧪 テストデータを削除(${nTest}件)</button>` : ''}
        <span class="hx-br"></span>
        <select id="hx-old">${[[90, '90日'], [180, '180日'], [365, '1年'], [730, '2年']].map(([n, l]) => `<option value="${n}">${l}より前</option>`).join('')}</select><button data-a="old" class="warn">の記録を削除</button>
        <button data-a="all" class="warn">すべての記録を削除</button>
        <p class="hx-note">記録は、Google Drive で、ほかのPCと共有されます(テストデータも共有されます。試し終わったら「テストデータを削除」で消してください)。削除も、次の同期で、ほかのPCに伝わります(削除する前に、ほかのPCで見て、まだ同期していなかった分は、いっしょに消えることがあります)。</p></div></details>
      ${rows ? `<div class="hx-list">${rows}</div>` : '<p class="empty">記録がありません。</p>'}
      ${hit.length > shown ? `<button class="hx-more" data-a="more">もっと見る(残り ${hit.length - shown}件)</button>` : ''}`;
    if (keep) { const i = $('#hx-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  const draw = () => {
    document.querySelectorAll('#hx-days button').forEach(b => b.classList.toggle('on', +b.dataset.d === days));
    $('#st').textContent = H.p.length ? `記録 ${H.p.length}回 ・ 動画 ${Object.keys(H.v).length}本` : '';
    tip.hidden = true; drawAn(); drawMg();
  };
  const reload = () => Promise.all([chrome.storage.local.get(['hist', 'meta', 'sleepWin', 'focus']), TF.get()]).then(([r, s]) => { const h = r.hist || {}; H = { v: h.v || {}, p: (Array.isArray(h.p) ? h.p : []).filter(x => Array.isArray(x) && x[1]).sort((a, b) => a[0] - b[0]), g: h.g || 0 }; meta = r.meta || {}; S = s; FC = r.focus || null; sw = { from: s.settings.sleepFrom || (r.sleepWin && r.sleepWin.from) || '23:00', to: s.settings.sleepTo || (r.sleepWin && r.sleepWin.to) || '07:00' }; buildIdx(); draw(); });
  const prune = h => { const used = new Set(h.p.map(x => x[1])); Object.keys(h.v).forEach(id => { if (!used.has(id)) delete h.v[id]; }); return h; };
  const removeIf = (fn, ask) => { const n = H.p.filter(fn).length; if (!n) return; if (ask && !confirm(ask.replace('{n}', n))) return; save(prune({ v: { ...H.v }, p: H.p.filter(x => !fn(x)) }), true); };
  const dl = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };

  // ---- テストデータ: 60日分。登録チャンネルがあれば、その名前も使う(フォルダ別の分析を試せるように) ----
  function makeTest() {
    const real = Object.values((S && S.channels) || {}).filter(c => c && c.name).slice(0, 8).map(c => [c.name, c.key]);
    const fake = ['テスト料理チャンネル', 'テストゲーム実況', 'テスト旅行記', 'テスト音楽ch', 'テストニュース解説', 'テストガジェット', 'テストねこ動画', 'テスト歴史講座'].map((n, i) => [n, '@tftest' + i]);
    const CATS = ['音楽', 'ゲーム', 'ニュースと政治', '教育', 'エンターテイメント', 'ハウツーとスタイル', '科学と技術', 'ペットと動物'], chs = [...real, ...fake], words = ['入門', '完全ガイド', 'まとめ', 'やってみた', 'レビュー', '第1回', '第2回', '総集編', 'ライブ配信', '徹底比較', '作業用', '初見プレイ'];
    const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1)), pick = a => a[Math.floor(Math.random() * a.length)];
    const v = { ...H.v }, p = H.p.slice(), ids = [];
    for (let i = 0; i < 160; i++) { const id = 'TFTEST' + String(i).padStart(5, '0'), c = chs[Math.floor(Math.pow(Math.random(), 1.6) * chs.length)], short = Math.random() < 0.15; v[id] = [`【テスト】${c[0].replace(/^テスト/, '')}の${pick(words)} #${i + 1}`, c[0], c[1], short ? rnd(15, 58) : rnd(180, 2400), short ? 1 : 0, pick(CATS), dkey(new Date(Date.now() - rnd(1, 900) * 864e5)), Math.random() < 0.08 ? 1 : 0, [pick(words), pick(words), c[0].replace(/^テスト/, '')]]; ids.push(id); }
    const hoursW = [1, 0, 0, 0, 0, 0, 1, 3, 3, 1, 1, 2, 5, 3, 1, 1, 2, 3, 5, 8, 10, 10, 8, 4], hsum = hoursW.reduce((a, b) => a + b, 0);
    const pickHour = () => { let r = Math.random() * hsum; for (let h = 0; h < 24; h++) { r -= hoursW[h]; if (r <= 0) return h; } return 21; };
    const today = new Date(); today.setHours(0, 0, 0, 0); const nowS = Math.floor(Date.now() / 1000);
    for (let d = 59; d >= 0; d--) {
      const day = new Date(today); day.setDate(day.getDate() - d);
      if (Math.random() < 0.08) continue; // 見なかった日
      const n = rnd(2, [0, 6].includes(day.getDay()) ? 12 : 7);
      for (let i = 0; i < n; i++) { const id = pick(ids), dur = v[id][3], t = Math.floor(day.getTime() / 1000) + pickHour() * 3600 + rnd(0, 3599); if (t > nowS) continue; const sec = Math.max(5, Math.round(dur * (Math.random() < 0.55 ? rnd(85, 100) : rnd(10, 80)) / 100)); p.push([t, id, sec, Math.min(dur, Math.round(sec * 1.1)), pick(['pc', 'pc', 'pc', 'ph', 'ph', 'tb']), pick(['home', 'home', 'search', 'sub', 'watch', 'watch', 'list', 'channel', 'direct'])]); }
    }
    p.sort((a, b) => a[0] - b[0]);
    return save(prune({ v, p }));
  }

  main.addEventListener('click', e => {
    const d = e.target.closest('#hx-days button'); if (d) { days = +d.dataset.d; shown = 200; try { localStorage.setItem('tfHistDays', String(days)); } catch (e2) { /* なし */ } return draw(); }
    const del = e.target.closest('[data-del]'); if (del) { const k = del.closest('.hx-row').dataset.k; return removeIf(x => x[0] + '|' + x[1] === k); }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'more') { shown += 300; drawMg(); }
    else if (a === 'delhit') { const words = q.toLowerCase().split(/\s+/).filter(Boolean), cut = new Set(inRange().map(x => x[0] + '|' + x[1])); removeIf(x => { if (!cut.has(x[0] + '|' + x[1])) return false; const m = H.v[x[1]] || [], s = ((m[0] || '') + ' ' + (m[1] || '')).toLowerCase(); return words.every(w => s.includes(w)); }, `「${q}」に合う {n}件の記録を削除しますか?`); }
    else if (a === 'csv') { const c = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; dl('tubefolio2-history-' + dkey(new Date()) + '.csv', '﻿' + ['日時,動画ID,タイトル,チャンネル,見た秒数,動画の長さ(秒),ショート,チャンネルのキー,フォルダ,カテゴリ,公開日,ライブ,タグ,デバイス,流入経路'].concat(H.p.map(x => { const m = H.v[x[1]] || [], dt = new Date(x[0] * 1000), reg = chOf(m), fg = reg ? (reg.groups || []).map(id => (S.groups.find(g => g.id === id) || {}).name).filter(Boolean).join(' / ') : ''; return [c(dkey(dt) + ' ' + dt.toTimeString().slice(0, 8)), c(x[1]), c(m[0]), c(m[1]), x[2], m[3] || '', m[4] ? 1 : 0, c(m[2]), c(fg), c(m[5]), c(m[6]), m[7] ? 1 : 0, c((m[8] || []).join(' ')), c(x[4]), c(x[5])].join(','); })).join('\r\n'), 'text/csv'); }
    else if (a === 'json') dl('tubefolio2-history-' + dkey(new Date()) + '.json', JSON.stringify({ app: 'TubeFolio2', kind: 'hist', exportedAt: new Date().toISOString(), hist: { v: H.v, p: H.p } }), 'application/json');
    else if (a === 'imp') $('#hx-file').click();
    else if (a === 'test') { if (confirm('テストデータ(60日分・動画160本)を作って、今の記録に足します。あとで「テストデータを削除」で消せます。よろしいですか?')) makeTest(); }
    else if (a === 'untest') removeIf(x => TEST.test(x[1]), 'テストデータ {n}件を削除しますか?(本物の記録は残ります)');
    else if (a === 'old') { const n = +$('#hx-old').value, cut = Math.floor(Date.now() / 1000) - n * DAY; removeIf(x => x[0] < cut, `${$('#hx-old').selectedOptions[0].textContent}の {n}件の記録を削除しますか?`); }
    else if (a === 'all') removeIf(() => true, 'すべての視聴履歴({n}件)を削除しますか? 元に戻せません。');
  });
  main.addEventListener('change', async e => {
    if (e.target.id !== 'hx-file') return;
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const j = JSON.parse(await f.text()), h = j.hist || (j.data && j.data.hist) || j;
      if (!h || !Array.isArray(h.p) || typeof h.v !== 'object') throw new Error('視聴履歴のファイルではありません');
      const m = new Map(); [...H.p, ...h.p].forEach(x => { if (!Array.isArray(x) || !x[1]) return; const k = x[0] + '|' + x[1], o = m.get(k); if (!o || x[2] > o[2]) m.set(k, [+x[0], String(x[1]), +x[2] || 0, ...x.slice(3)]); });
      await save(prune({ v: { ...h.v, ...H.v }, p: [...m.values()].sort((a, b) => a[0] - b[0]) }));
    } catch (err) { alert('読み込めませんでした: ' + (err.message || err)); }
  });
  let qt = 0;
  main.addEventListener('input', e => { if (e.target.id === 'hx-q') { q = e.target.value.trim(); shown = 200; clearTimeout(qt); qt = setTimeout(drawMg, 200); } });
  // 棒に乗せる / 押すと、値を浮かべて出す
  const showTip = e => { const n = e.target.closest && e.target.closest('[data-tip]'); if (!n || !n.dataset.tip) { tip.hidden = true; return; } tip.textContent = n.dataset.tip; tip.hidden = false; const r = n.getBoundingClientRect(), w = tip.offsetWidth; tip.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px'; tip.style.top = Math.max(6, r.top - tip.offsetHeight - 6) + 'px'; };
  box.addEventListener('mouseover', showTip); box.addEventListener('click', showTip); box.addEventListener('mouseleave', () => { tip.hidden = true; });
  window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
  // 時間帯の傾向の操作: 就寝時間(設定と共通: settings.sleepFrom/sleepTo と sleepWin)・表示の切り替え・凡例
  const sleepPatch = (k, v) => { sw = { ...sw, [k]: v }; TF.mutate(s => { s.settings[k === 'from' ? 'sleepFrom' : 'sleepTo'] = v; }); return chrome.storage.local.get('sleepWin').then(r => chrome.storage.local.set({ sleepWin: { on: true, from: '23:00', to: '07:00', ...(r.sleepWin || {}), [k]: v }, prefsAt: Date.now() })); };
  main.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'hx-sf') sleepPatch('from', t.value || '23:00'); else if (t.id === 'hx-st') sleepPatch('to', t.value || '07:00');
    else if (t.id === 'hx-ss') { showSleep = t.checked; try { localStorage.setItem('tfHistSleep', showSleep ? '1' : '0'); } catch (e2) { /* なし */ } drawAn(); }
    else if (t.id === 'hx-sk') { showWork = t.checked; try { localStorage.setItem('tfHistWork', showWork ? '1' : '0'); } catch (e2) { /* なし */ } drawAn(); }
  });
  main.addEventListener('click', e => { const lg = e.target.closest('.hx-lg'); if (!lg) return; const k = lg.dataset.f; if (hidF.has(k)) hidF.delete(k); else hidF.add(k); drawAn(); });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.hist || ch.channels || ch.groups || ch.sleepWin || ch.focus || ch.settings)) reload(); });
  reload();
}
