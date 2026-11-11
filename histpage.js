// 視聴履歴のページ(上のバーの「視聴履歴」。page.html?p=hist)。page.js から histPage() で呼ばれる。
//   データ: storage の hist(histrec.js が、再生のたびに記録する。Drive同期の対象 = どのPCで見た分も合わさる)
//     hist = { v: { 動画ID: [タイトル, チャンネル名, チャンネルのキー, 長さ(秒), ショートなら1] }, p: [[開始(秒), 動画ID, 見た秒数], …] }
//   「📊 分析」: 期間を選んで、合計・日別・時間帯・曜日・チャンネル・フォルダ・よく見た動画を出す
//   「🗂 履歴の管理」: 一覧・検索・1件ずつ/まとめて削除・CSV/JSONの書き出し・JSONの読み込み・テストデータの作成/削除
//   テストデータは、動画IDが「TFTEST」で始まる(本物の動画IDと重ならない)。「テストデータを削除」で、それだけを消せる
function histPage() {
  const DAY = 86400, TEST = /^TFTEST/;
  const hm = sec => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60); return h ? `${h}時間${m ? m + '分' : ''}` : sec < 60 ? `${sec}秒` : `${m}分`; };
  const ms = sec => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const dkey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const WD = '日月火水木金土';
  let H = { v: {}, p: [], g: 0 }, S = null, meta = {}, tab = 'an', days = 30, q = '', shown = 200;
  try { tab = localStorage.getItem('tfHistTab') || 'an'; days = +localStorage.getItem('tfHistDays') || 30; } catch (e) { /* なし */ }
  main.innerHTML = `<div class="head"><h1>${esc(TITLE)}</h1><span class="sub">この拡張機能で再生した記録(Google Drive で共有)</span><span class="sp"></span><span id="st"></span></div>
    <div class="hx-tabs"><button data-tab="an">📊 分析</button><button data-tab="mg">🗂 履歴の管理</button><span class="sp"></span>
      <span class="hx-seg" id="hx-days">${[[7, '7日'], [30, '30日'], [90, '90日'], [365, '1年'], [0, 'すべて']].map(([n, l]) => `<button data-d="${n}">${l}</button>`).join('')}</span></div>
    <div id="hx"></div><div id="hx-tip" hidden></div>`;
  const box = $('#hx'), tip = $('#hx-tip');
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
  const hbars = (rows, unit) => { const max = Math.max(1, ...rows.map(r => r.val)); return rows.length ? `<div class="hx-hb">${rows.map(r => `<div class="hx-hr" data-tip="${esc(r.tip || '')}"><span class="hx-hl" title="${esc(r.name)}">${r.href ? `<a href="${esc(r.href)}" target="_top">${esc(r.name)}</a>` : esc(r.name)}</span><span class="hx-ht"><i style="width:${(r.val / max * 100).toFixed(1)}%"></i></span><span class="hx-hv">${esc(unit(r.val))}${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span></div>`).join('')}</div>` : '<p class="none">まだ記録がありません。</p>'; };
  // ---- 棒(縦): 日別・時間帯・曜日。目盛りは、いちばん上の値と半分の線だけ ----
  const vbars = (cols, labelEvery) => { const max = Math.max(60, ...cols.map(c => c.val)); return `<div class="hx-vb"><div class="hx-vy"><span>${esc(hm(max))}</span><span>${esc(hm(max / 2))}</span><span>0</span></div><div class="hx-vp"><i class="hx-g" style="bottom:50%"></i><i class="hx-g" style="bottom:100%"></i>${cols.map((c, i) => `<div class="hx-vc" data-tip="${esc(c.tip)}"><b style="height:${(c.val / max * 100).toFixed(1)}%"></b><em>${i % labelEvery === 0 ? esc(c.label) : ''}</em></div>`).join('')}</div></div>`; };

  function drawAn() {
    const P = inRange(), total = P.reduce((a, x) => a + (x[2] || 0), 0), vids = new Set(P.map(x => x[1]));
    if (!H.p.length) { box.innerHTML = `<p class="empty">まだ視聴履歴がありません。動画を5秒以上再生すると、ここに記録されます。<br>画面を試すには、「🗂 履歴の管理」の「テストデータを作成」を使ってください。</p>`; return; }
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
    // 時間帯・曜日
    const hours = new Array(24).fill(0), wds = new Array(7).fill(0);
    P.forEach(x => { const d = new Date(x[0] * 1000); hours[d.getHours()] += x[2]; wds[d.getDay()] += x[2]; });
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
    box.innerHTML = `<div class="hx-tiles">${tile('合計の視聴時間', hm(total), period)}${tile('見た動画', vids.size + '本', `再生 ${P.length}回`)}${tile('1日の平均', hm(total / Math.max(1, days || span)), `見た日 ${actDays}日`)}${tile('いちばん長く見た日', best ? hm(best[1]) : '—', best ? best[0].replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1年$2月$3日') : '')}${tile('ショート', hm(shortSec), total ? `全体の ${Math.round(shortSec / total * 100)}%` : '')}</div>
      <section class="hx-card"><h2>${unit === 'd' ? '日ごと' : unit === 'w' ? '週ごと' : '月ごと'}の視聴時間</h2>${vbars(cols, cols.length > 60 ? 14 : cols.length > 16 ? 7 : cols.length > 8 ? 2 : 1)}</section>
      <div class="hx-two"><section class="hx-card"><h2>時間帯(何時に見ているか)</h2>${vbars(hours.map((v, h) => ({ val: v, label: h + '時', tip: `${h}時台 ・ ${hm(v)}` })), 3)}</section>
      <section class="hx-card"><h2>曜日</h2>${vbars(wds.map((v, i) => ({ val: v, label: WD[i], tip: `${WD[i]}曜日 ・ ${hm(v)}` })), 1)}</section></div>
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
    const toolsOpen = !!box.querySelector('.hx-tools[open]');
    box.innerHTML = `<div class="hx-bar"><input id="hx-q" type="search" placeholder="タイトル・チャンネルで絞り込み" value="${esc(q)}" autocomplete="off"><span class="sub">${hit.length}件 ・ ${hm(hit.reduce((a, x) => a + x[2], 0))}</span><span class="sp"></span>
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
    document.querySelectorAll('.hx-tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('#hx-days button').forEach(b => b.classList.toggle('on', +b.dataset.d === days));
    $('#st').textContent = H.p.length ? `記録 ${H.p.length}回 ・ 動画 ${Object.keys(H.v).length}本` : '';
    tip.hidden = true; (tab === 'mg' ? drawMg : drawAn)();
  };
  const reload = () => Promise.all([chrome.storage.local.get(['hist', 'meta']), TF.get()]).then(([r, s]) => { const h = r.hist || {}; H = { v: h.v || {}, p: (Array.isArray(h.p) ? h.p : []).filter(x => Array.isArray(x) && x[1]).sort((a, b) => a[0] - b[0]), g: h.g || 0 }; meta = r.meta || {}; S = s; buildIdx(); draw(); });
  const prune = h => { const used = new Set(h.p.map(x => x[1])); Object.keys(h.v).forEach(id => { if (!used.has(id)) delete h.v[id]; }); return h; };
  const removeIf = (fn, ask) => { const n = H.p.filter(fn).length; if (!n) return; if (ask && !confirm(ask.replace('{n}', n))) return; save(prune({ v: { ...H.v }, p: H.p.filter(x => !fn(x)) }), true); };
  const dl = (name, text, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };

  // ---- テストデータ: 60日分。登録チャンネルがあれば、その名前も使う(フォルダ別の分析を試せるように) ----
  function makeTest() {
    const real = Object.values((S && S.channels) || {}).filter(c => c && c.name).slice(0, 8).map(c => [c.name, c.key]);
    const fake = ['テスト料理チャンネル', 'テストゲーム実況', 'テスト旅行記', 'テスト音楽ch', 'テストニュース解説', 'テストガジェット', 'テストねこ動画', 'テスト歴史講座'].map((n, i) => [n, '@tftest' + i]);
    const chs = [...real, ...fake], words = ['入門', '完全ガイド', 'まとめ', 'やってみた', 'レビュー', '第1回', '第2回', '総集編', 'ライブ配信', '徹底比較', '作業用', '初見プレイ'];
    const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1)), pick = a => a[Math.floor(Math.random() * a.length)];
    const v = { ...H.v }, p = H.p.slice(), ids = [];
    for (let i = 0; i < 160; i++) { const id = 'TFTEST' + String(i).padStart(5, '0'), c = chs[Math.floor(Math.pow(Math.random(), 1.6) * chs.length)], short = Math.random() < 0.15; v[id] = [`【テスト】${c[0].replace(/^テスト/, '')}の${pick(words)} #${i + 1}`, c[0], c[1], short ? rnd(15, 58) : rnd(180, 2400), short ? 1 : 0]; ids.push(id); }
    const hoursW = [1, 0, 0, 0, 0, 0, 1, 3, 3, 1, 1, 2, 5, 3, 1, 1, 2, 3, 5, 8, 10, 10, 8, 4], hsum = hoursW.reduce((a, b) => a + b, 0);
    const pickHour = () => { let r = Math.random() * hsum; for (let h = 0; h < 24; h++) { r -= hoursW[h]; if (r <= 0) return h; } return 21; };
    const today = new Date(); today.setHours(0, 0, 0, 0); const nowS = Math.floor(Date.now() / 1000);
    for (let d = 59; d >= 0; d--) {
      const day = new Date(today); day.setDate(day.getDate() - d);
      if (Math.random() < 0.08) continue; // 見なかった日
      const n = rnd(2, [0, 6].includes(day.getDay()) ? 12 : 7);
      for (let i = 0; i < n; i++) { const id = pick(ids), dur = v[id][3], t = Math.floor(day.getTime() / 1000) + pickHour() * 3600 + rnd(0, 3599); if (t > nowS) continue; p.push([t, id, Math.max(5, Math.round(dur * (Math.random() < 0.55 ? rnd(85, 100) : rnd(10, 80)) / 100))]); }
    }
    p.sort((a, b) => a[0] - b[0]);
    return save(prune({ v, p }));
  }

  main.addEventListener('click', e => {
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; shown = 200; try { localStorage.setItem('tfHistTab', tab); } catch (e2) { /* なし */ } return draw(); }
    const d = e.target.closest('#hx-days button'); if (d) { days = +d.dataset.d; shown = 200; try { localStorage.setItem('tfHistDays', String(days)); } catch (e2) { /* なし */ } return draw(); }
    const del = e.target.closest('[data-del]'); if (del) { const k = del.closest('.hx-row').dataset.k; return removeIf(x => x[0] + '|' + x[1] === k); }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'more') { shown += 300; drawMg(); }
    else if (a === 'delhit') { const words = q.toLowerCase().split(/\s+/).filter(Boolean), cut = new Set(inRange().map(x => x[0] + '|' + x[1])); removeIf(x => { if (!cut.has(x[0] + '|' + x[1])) return false; const m = H.v[x[1]] || [], s = ((m[0] || '') + ' ' + (m[1] || '')).toLowerCase(); return words.every(w => s.includes(w)); }, `「${q}」に合う {n}件の記録を削除しますか?`); }
    else if (a === 'csv') { const c = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; dl('tubefolio2-history-' + dkey(new Date()) + '.csv', '﻿' + ['日時,動画ID,タイトル,チャンネル,見た秒数,動画の長さ(秒),ショート'].concat(H.p.map(x => { const m = H.v[x[1]] || [], dt = new Date(x[0] * 1000); return [c(dkey(dt) + ' ' + dt.toTimeString().slice(0, 8)), c(x[1]), c(m[0]), c(m[1]), x[2], m[3] || '', m[4] ? 1 : 0].join(','); })).join('\r\n'), 'text/csv'); }
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
      const m = new Map(); [...H.p, ...h.p].forEach(x => { if (!Array.isArray(x) || !x[1]) return; const k = x[0] + '|' + x[1], o = m.get(k); if (!o || x[2] > o[2]) m.set(k, [+x[0], String(x[1]), +x[2] || 0]); });
      await save(prune({ v: { ...h.v, ...H.v }, p: [...m.values()].sort((a, b) => a[0] - b[0]) }));
    } catch (err) { alert('読み込めませんでした: ' + (err.message || err)); }
  });
  let qt = 0;
  main.addEventListener('input', e => { if (e.target.id === 'hx-q') { q = e.target.value.trim(); shown = 200; clearTimeout(qt); qt = setTimeout(drawMg, 200); } });
  // 棒に乗せる / 押すと、値を浮かべて出す
  const showTip = e => { const n = e.target.closest && e.target.closest('[data-tip]'); if (!n || !n.dataset.tip) { tip.hidden = true; return; } tip.textContent = n.dataset.tip; tip.hidden = false; const r = n.getBoundingClientRect(), w = tip.offsetWidth; tip.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px'; tip.style.top = Math.max(6, r.top - tip.offsetHeight - 6) + 'px'; };
  box.addEventListener('mouseover', showTip); box.addEventListener('click', showTip); box.addEventListener('mouseleave', () => { tip.hidden = true; });
  window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.hist || ch.channels || ch.groups)) reload(); });
  reload();
}
