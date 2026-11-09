(() => {
  const $ = s => document.querySelector(s);
  const esc = t => String(t || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let statsOpen = localStorage.getItem('tfStats') !== '0', S, meta = {}, act = {}, actFilter = null, scanning = false, stopScan = false, prog = '', view = 'all', sel = new Set(), edit = null;
  const open = new Set(JSON.parse(localStorage.getItem('tfOpen') || '[]'));
  const saveOpen = () => localStorage.setItem('tfOpen', JSON.stringify([...open]));
  const grp = id => S.groups.find(g => g.id === id);
  const chans = () => Object.values(S.channels);
  const filed = c => c.groups.filter(grp);
  const nameOf = c => TF.clean(c.name) || c.key;
  const avatarOf = c => c.avatar || (meta[c.key] && meta[c.key].avatar) || '';
  const chUrl = k => 'https://www.youtube.com/' + (k.startsWith('@') ? k : 'channel/' + k);
  const inTree = (c, id) => { const sub = TF.subtree(S.groups, id); return c.groups.some(g => sub.has(g)); };
  const byName = (a, b) => nameOf(a).localeCompare(nameOf(b), 'ja');

  function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2400); }

  // ---- アバター遅延取得 ----
  const asked = new Set();
  function wantAvatar(k) {
    if (asked.has(k) || (meta[k] && meta[k].avatar)) return;
    asked.add(k);
    chrome.runtime.sendMessage({ type: 'avatar', key: k }, r => {
      if (!r || r.error || !r.avatar) return;
      meta[k] = { ...meta[k], ...r };
      document.querySelectorAll('.av[data-k="' + CSS.escape(k) + '"]').forEach(e => { e.style.backgroundImage = `url('${r.avatar}')`; e.textContent = ''; });
    });
  }
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); wantAvatar(e.target.dataset.k); } }), { rootMargin: '200px' });
  const avHtml = (c, cls = 'av') => {
    const a = avatarOf(c);
    return `<div class="${cls}" data-k="${esc(c.key)}" ${a ? `style="background-image:url('${esc(a)}')"` : ''}>${a ? '' : esc((nameOf(c) || '?')[0])}</div>`;
  };
  const observeAvatars = root => root.querySelectorAll('.av:not([style])').forEach(e => io.observe(e));

  // ---- 投稿の新しさ ----
  const BK = [['d3', '3日以内', 3, '#16a34a'], ['d7', '7日以内', 7, '#84cc16'], ['d14', '2週間以内', 14, '#65a30d'], ['m1', '1か月以内', 30, '#ca8a04'], ['m3', '3か月以内', 91, '#ea580c'],
    ['m6', '6か月以内', 182, '#dc2626'], ['y1', '1年以内', 365, '#9333ea'], ['y1p', '1年以上', Infinity, '#64748b'], ['none', '投稿なし', -1, '#94a3b8']];
  const TYPES = [['v', '🎬 動画'], ['s', '📱 ショート'], ['l', '🔴 ライブ配信']];
  const bucketOf = ts => {
    if (!ts) return 'none';
    const d = (Date.now() - ts) / 864e5;
    return BK.find(b => b[2] >= 0 && d <= b[2])[0];
  };
  const agoText = ts => {
    if (!ts) return 'なし';
    const d = (Date.now() - ts) / 864e5;
    return d < 1 ? '今日' : d < 30 ? `${d | 0}日前` : d < 365 ? `${(d / 30) | 0}か月前` : `${(d / 365) | 0}年前`;
  };
  const inView = () => chans().filter(c => view === 'all' ? true : view === 'none' ? !filed(c).length : inTree(c, view));
  // ---- 投稿の新しさ: ガラスバーのボタンから、ツールと同じガラスのメニューで表示 ----
  function drawStats() {
    const tg = document.getElementById('statsTgl'); if (tg) tg.classList.toggle('on', !!actFilter);
    const box = document.getElementById('sfly'); if (!box) return;
    const list = inView(), done = list.filter(c => act[c.key]), todo = list.length - done.length;
    const cnts = {}; TYPES.forEach(([f]) => { const cnt = Object.fromEntries(BK.map(b => [b[0], 0])); done.forEach(c => cnt[bucketOf(act[c.key][f])]++); cnts[f] = cnt; });
    const n = done.length || 1, pct = c => (c / n * 100).toFixed(c && c / n < .1 ? 1 : 0);
    const on = (f, b) => actFilter && actFilter.f === f && actFilter.b === b ? ' on' : '';
    const seg = f => BK.map(b => { const c = cnts[f][b[0]]; return c ? `<button class="seg${on(f, b[0])}" style="flex:${c};background:${b[3]}" data-f="${f}" data-b="${b[0]}" title="${b[1]} ${c}件 (${pct(c)}%)"></button>` : ''; }).join('');
    box.innerHTML = `<div class="fh">投稿情報</div>
      <div class="fn">${done.length}/${list.length} チャンネル集計済み${actFilter ? ' ・ <a href="#" id="clrf">絞り込み解除</a>' : ''}${prog ? ' ・ ' + esc(prog) : ''}</div>
      ${TYPES.map(([f, lb]) => `<button class="sl stype${f === hoverType() ? ' act' : ''}" data-ht="${f}" title="マウスオーバーで、この種類の動画を出す">${lb}</button><div class="bar big slim">${seg(f)}</div>`).join('')}
      <div class="lg shared flat">${BK.map(b => `<span><i style="background:${b[3]}"></i>${b[1]}</span>`).join('')}</div>
      <button class="sbtn" id="scanBtn">${scanning ? '■ 中止' : todo ? `⟳ 未集計 ${todo}件を集計` : '⟳ 再集計'}</button>`;
  }
  const statsClick = e => {
    const ht = e.target.closest('[data-ht]'); if (ht) { TF.mutate(st => { st.settings.hoverType = ht.dataset.ht; }); return; }
    if (e.target.closest('#scanBtn')) return scanning ? (stopScan = true) : runScan();
    if (e.target.closest('#clrf')) { e.preventDefault(); actFilter = null; return drawGrid(); }
    const b = e.target.closest('button[data-f][data-b]'); if (!b || b.disabled) return;
    const same = actFilter && actFilter.f === b.dataset.f && actFilter.b === b.dataset.b;
    actFilter = same ? null : { f: b.dataset.f, b: b.dataset.b }; drawGrid();
  };
  const closeStats = () => { const f = document.getElementById('sfly'); if (f) f.remove(); };
  function toggleStats() {
    if (document.getElementById('sfly')) return closeStats();
    const b = document.getElementById('statsTgl'), f = document.createElement('div'); f.id = 'sfly'; f.addEventListener('click', statsClick); document.body.appendChild(f);
    const r = b.getBoundingClientRect(), br = (document.getElementById('gbar') || b).getBoundingClientRect();
    f.style.top = Math.round(r.bottom + 8) + 'px'; drawStats();
    // バーの右端にそろえて開く。画面からはみ出さないように、実際の幅を測って位置を決める
    const w = f.offsetWidth; f.style.left = Math.max(8, Math.min(br.right - w, innerWidth - w - 8)) + 'px';
  }
  window.addEventListener('resize', () => closeStats());
  document.addEventListener('mousedown', e => { if (document.getElementById('sfly') && !e.target.closest('#sfly') && !e.target.closest('#statsTgl')) closeStats(); }, true);
  async function runScan() {
    const all = inView();
    const redo = all.every(c => act[c.key]);
    const q = all.filter(c => redo || !act[c.key]).map(c => c.key);
    if (!q.length) return;
    scanning = true; stopScan = false; let n = 0, fail = 0;
    const flush = () => chrome.storage.local.set({ activity: act });
    const worker = async () => {
      while (q.length && !stopScan) {
        const k = q.shift();
        const r = await new Promise(res => chrome.runtime.sendMessage({ type: 'scan', key: k }, res));
        if (r && !r.error) act[k] = r; else fail++;
        n++; prog = `${n}/${n + q.length} 処理中${fail ? ` (失敗 ${fail})` : ''}`;
        if (n % 8 === 0) { drawStats(); flush(); }
      }
    };
    drawStats();
    await Promise.all([1, 2, 3, 4].map(worker));
    scanning = false; prog = stopScan ? '中止しました' : fail ? `完了(失敗 ${fail}件)` : '完了';
    await flush(); drawGrid();
  }

  // ---- 一覧 ----
  function visible() {
    const q = $('#q').value.trim().toLowerCase();
    let l = chans().filter(c => view === 'all' ? true : view === 'none' ? !filed(c).length : inTree(c, view));
    if (q) l = l.filter(c => (nameOf(c) + ' ' + c.key).toLowerCase().includes(q));
    if (actFilter) l = l.filter(c => act[c.key] && bucketOf(act[c.key][actFilter.f]) === actFilter.b);
    return l.sort((a, b) => b.addedAt - a.addedAt);
  }

  // ---- ツリー ----
  function treeHtml(parent, depth) {
    const ids = new Set(S.groups.map(g => g.id));
    return S.groups.filter(g => parent === null ? (!g.parent || !ids.has(g.parent)) : g.parent === parent).map(g => {
      const kids = S.groups.filter(x => x.parent === g.id);
      const direct = chans().filter(c => c.groups.includes(g.id)).sort(byName);
      const isOpen = open.has(g.id);
      const total = chans().filter(c => inTree(c, g.id)).length;
      return `<div class="tn${view === g.id ? ' act' : ''}" data-g="${g.id}" draggable="true" style="--c:${g.color};--d:${depth}">
        <span class="cv${kids.length || direct.length ? '' : ' none'}">${isOpen ? '▾' : '▸'}</span><span class="ic">${TF.iconHtml(g.icon)}</span>
        <span class="nm">${esc(g.name)}</span><span class="n">${total}</span><span class="mv" data-mv="up" title="上へ">▲</span><span class="mv" data-mv="dn" title="下へ">▼</span>${g.parent && ids.has(g.parent) ? '<span class="mv" data-mv="out" title="1つ上の階層へ出す(親フォルダと並べる)">⇤</span>' : ''}<span class="sub" title="サブフォルダを作成">＋</span><span class="ed" title="編集">✎</span></div>` +
        (isOpen ? treeHtml(g.id, depth + 1) + direct.map(c => `<div class="tc" data-k="${esc(c.key)}" data-from="${g.id}" draggable="true" style="--d:${depth + 1}">${avHtml(c, 'av mini')}<span class="nm">${esc(nameOf(c))}</span></div>`).join('') : '');
    }).join('');
  }
  function drawNav() {
    const nv = (id, ic, nm, n, add) => `<div class="tn${view === id ? ' act' : ''}" data-g="${id}" data-fixed="1" style="--d:0"><span class="cv none">▸</span><span class="ic">${ic}</span><span class="nm">${nm}</span>${add ? '<span class="addg" title="フォルダを作成">＋</span>' : ''}<span class="n">${n}</span></div>`;
    $('#nav').innerHTML = nv('all', '🗂️', 'すべて', chans().length, true) + treeHtml(null, 0) + nv('none', '📥', '未分類', chans().filter(c => !filed(c).length).length); // 未分類は一番下
    observeAvatars($('#nav'));
  }

  // ---- チャンネル個別表示(YouTube左のフォルダ一覧からチャンネルを選んだとき・右ページのみで表示) ----
  const vidCache = new Map();
  function drawChannel() {
    const key = view.slice(3), c = S.channels[key];
    if (!c) { view = 'all'; return draw(); }
    $('#grid').hidden = $('#bulk').hidden = $('#empty').hidden = true;
    document.querySelector('header').hidden = true; // 検索・並び替え等はチャンネル表示では使わない
    const box = $('#chview'); box.hidden = false;
    const paint = vs => {
      const g = $('#chvids'); if (!g || view !== 'ch:' + key) return;
      g.innerHTML = vs && vs.length ? vs.map(v => `<a class="vcard" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank"><img loading="lazy" src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg"><b>${esc(v.title)}</b><small>${agoText(Date.parse(v.published))}</small></a>`).join('') : '<div class="note">動画を取得できませんでした</div>';
    };
    box.innerHTML = `<div class="chh">${avHtml(c, 'av big')}<div class="chi"><h2>${esc(nameOf(c))}</h2><small>${esc(c.key)}</small>
      <div class="tags">${filed(c).map(id => { const x = grp(id); return `<span class="tag" style="--c:${x.color}">${TF.iconHtml(x.icon)} ${esc(x.name)}</span>`; }).join('')}</div>
      <a class="btn" href="${esc(chUrl(c.key))}" target="_blank">YouTubeでチャンネルを開く ↗</a></div></div>
      <div id="chvids" class="vgrid"><div class="note">読み込み中…</div></div>`;
    observeAvatars(box);
    if (vidCache.has(key)) return paint(vidCache.get(key));
    chrome.runtime.sendMessage({ type: 'chVideos', key }, r => { const vs = r && !r.error ? r.videos : []; if (vs.length) vidCache.set(key, vs); paint(vs); });
  }

  function drawGrid() {
    if (view.startsWith('ch:')) return drawChannel();
    $('#chview').hidden = true; $('#grid').hidden = false; document.querySelector('header').hidden = false;
    const l = visible();
    const g = grp(view);
    $('#ttl').textContent = view === 'all' ? 'すべてのチャンネル' : view === 'none' ? '未分類' : (TF.iconText(g.icon) + ' ' + g.name);
    $('#sub').textContent = `${l.length} チャンネル` + (g ? ' ・ サブフォルダ内も含む' : '');
    $('#empty').hidden = l.length > 0;
    if (!l.length) $('#empty').innerHTML = chans().length ? '該当するチャンネルがありません' :
      'まだチャンネルがありません。<br>右上の「YouTubeから取り込む」で登録チャンネルを読み込みましょう。';
    $('#grid').innerHTML = l.map(c => `<div class="card${sel.has(c.key) ? ' sel' : ''}" draggable="true" data-k="${esc(c.key)}">
      <input type="checkbox" class="chk" ${sel.has(c.key) ? 'checked' : ''}>
      ${avHtml(c)}
      <div class="info"><a href="${esc(chUrl(c.key))}" target="_blank" draggable="false">${esc(nameOf(c))}</a>
        <small>${esc(c.key)}</small>
        <div class="acts">${act[c.key] ? TYPES.map(([f, lb]) => `<span style="--c:${BK.find(b => b[0] === bucketOf(act[c.key][f]))[3]}">${lb.slice(0, 2)} ${agoText(act[c.key][f])}</span>`).join('') : ''}</div>
        <div class="tags">${filed(c).map(id => { const x = grp(id); return `<span class="tag" style="--c:${x.color}">${TF.iconHtml(x.icon)} ${esc(x.name)}</span>`; }).join('')}</div></div></div>`).join('');
    observeAvatars($('#grid'));
    drawBulk(); drawStats();
  }
  function drawBulk() {
    $('#bulk').hidden = !sel.size;
    $('#bcnt').textContent = `${sel.size}件選択中`;
    $('#bgroups').innerHTML = TF.flat(S.groups).map(({ g, depth }) => `<button data-g="${g.id}" style="--c:${g.color}">${depth ? '↳ ' : ''}${TF.iconHtml(g.icon)} ${esc(g.name)} に追加</button>`).join('') +
      (grp(view) ? `<button data-rm="${view}" style="--c:#ef4444">このフォルダから外す</button>` : '');
  }
  const draw = () => { drawNav(); drawGrid(); };

  const addTo = (keys, gid, from) => TF.mutate(s => keys.forEach(k => {
    const c = s.channels[k]; if (!c) return;
    if (from && from !== gid) c.groups = c.groups.filter(x => x !== from);
    if (!c.groups.includes(gid)) c.groups.push(gid);
  })).then(() => toast(`${keys.length}件を「${grp(gid).name}」${from ? 'へ移動' : 'に追加'}しました`));
  const removeFrom = (keys, gid) => TF.mutate(s => keys.forEach(k => { const c = s.channels[k]; if (c) c.groups = c.groups.filter(x => x !== gid); }))
    .then(() => { sel.clear(); toast('フォルダから外しました'); });

  // ---- フォルダの並べ替え(同じ親の中で上下 / 階層を出す / ドラッグで前後に) ----
  const parentOf = g => (g.parent && grp(g.parent) ? g.parent : null);
  function moveGroup(id, targetId, where) { // target の前/後ろへ(target と同じ親の並びに入る)
    if (TF.subtree(S.groups, id).has(targetId)) return toast('自分の中には移動できません');
    TF.mutate(s => {
      const g = s.groups.find(x => x.id === id), t = s.groups.find(x => x.id === targetId); if (!g || !t || g === t) return;
      s.groups.splice(s.groups.indexOf(g), 1);
      g.parent = (t.parent && s.groups.some(x => x.id === t.parent)) ? t.parent : null;
      const i = s.groups.indexOf(t); s.groups.splice(where === 'before' ? i : i + 1, 0, g);
    });
  }
  function stepGroup(id, dir) {
    const me = grp(id); if (!me) return;
    const sibs = S.groups.filter(x => parentOf(x) === parentOf(me)), i = sibs.findIndex(x => x.id === id), t = sibs[i + dir];
    if (t) moveGroup(id, t.id, dir < 0 ? 'before' : 'after');
  }
  function outGroup(id) { // 親の1つ上の階層へ。親フォルダのすぐ後ろに並べる
    const me = grp(id), par = me && grp(me.parent); if (!par) return;
    moveGroup(id, par.id, 'after');
  }
  let dragP = null;
  // ---- イベント: ツリー ----
  $('#nav').addEventListener('click', e => {
    const tc = e.target.closest('.tc');
    if (tc) return void window.open(chUrl(tc.dataset.k), '_blank');
    const tn = e.target.closest('.tn'); if (!tn) return;
    const id = tn.dataset.g;
    if (e.target.closest('.addg')) return openDlg('new');
    const mv = e.target.closest('.mv'); if (mv) { const m = mv.dataset.mv; return m === 'out' ? outGroup(id) : stepGroup(id, m === 'up' ? -1 : 1); }
    if (e.target.closest('.ed')) return openDlg(id);
    if (e.target.closest('.sub')) { open.add(id); saveOpen(); return openDlg('new', id); }
    if (e.target.closest('.cv') && !tn.dataset.fixed) { open.has(id) ? open.delete(id) : open.add(id); saveOpen(); return drawNav(); }
    view = id; sel.clear(); if (grp(id)) { open.add(id); saveOpen(); } draw();
  });
  $('#nav').addEventListener('dragstart', e => {
    const tc = e.target.closest('.tc'), tn = e.target.closest('.tn');
    const p = tc ? { t: 'ch', keys: [tc.dataset.k], from: tc.dataset.from } : tn && !tn.dataset.fixed ? { t: 'g', id: tn.dataset.g } : null;
    if (!p) return e.preventDefault();
    e.dataTransfer.setData('text/plain', JSON.stringify(p)); dragP = p;
  });
  $('#nav').addEventListener('dragend', () => { dragP = null; document.querySelectorAll('#nav .drop, #nav .drop-b, #nav .drop-a').forEach(x => x.classList.remove('drop', 'drop-b', 'drop-a')); });
  // フォルダをドラッグ中は、行の上1/4=その前、下1/4=その後ろ(並べ替え・同じ階層に出す)、真ん中=その中へ
  const zoneOf = (e, tn) => { if (!dragP || dragP.t !== 'g' || tn.dataset.fixed) return 'in'; const r = tn.getBoundingClientRect(), y = (e.clientY - r.top) / r.height; return y < .27 ? 'before' : y > .73 ? 'after' : 'in'; };
  const clearDrop = tn => tn.classList.remove('drop', 'drop-b', 'drop-a');
  $('#nav').addEventListener('dragover', e => { const tn = e.target.closest('.tn'); if (!tn) return; e.preventDefault(); const z = zoneOf(e, tn); clearDrop(tn); tn.classList.add(z === 'before' ? 'drop-b' : z === 'after' ? 'drop-a' : 'drop'); });
  $('#nav').addEventListener('dragleave', e => { const tn = e.target.closest('.tn'); if (tn) clearDrop(tn); });
  $('#nav').addEventListener('drop', e => {
    const tn = e.target.closest('.tn'); if (!tn) return;
    e.preventDefault(); const z = zoneOf(e, tn); clearDrop(tn);
    let p; try { p = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (x) { return; } dragP = null;
    const id = tn.dataset.g;
    if (p.t === 'ch') { if (grp(id)) addTo(p.keys, id, p.from); }
    else if (p.t === 'g') {
      if (z !== 'in' && grp(id)) return void moveGroup(p.id, id, z);
      const target = id === 'all' ? null : grp(id) ? id : undefined;
      if (target === undefined) return;
      if (target && TF.subtree(S.groups, p.id).has(target)) return toast('自分の中には移動できません');
      TF.mutate(s => { s.groups.find(g => g.id === p.id).parent = target; }); if (target) { open.add(target); saveOpen(); }
    }
  });

  // ---- イベント: カード ----
  $('#grid').addEventListener('click', e => {
    if (e.target.closest('a')) return;
    const card = e.target.closest('.card'); if (!card) return;
    const k = card.dataset.k; sel.has(k) ? sel.delete(k) : sel.add(k); drawGrid();
  });
  $('#grid').addEventListener('dragstart', e => {
    const card = e.target.closest('.card'); if (!card) return;
    const k = card.dataset.k;
    e.dataTransfer.setData('text/plain', JSON.stringify({ t: 'ch', keys: sel.has(k) ? [...sel] : [k] }));
  });
  $('#bgroups').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    b.dataset.rm ? removeFrom([...sel], b.dataset.rm) : addTo([...sel], b.dataset.g);
  });
  $('#bclr').onclick = () => { sel.clear(); drawGrid(); };
  $('#q').oninput = drawGrid;

  // ---- ホバー: 最新動画(設定の個数) ----
  const hv = $('#hv'); let hvK = null, hvT = 0; const infoCache = new Map();
  const ago = iso => {
    const m = (Date.now() - new Date(iso)) / 60000;
    return m < 60 ? `${Math.max(1, m | 0)}分前` : m < 1440 ? `${(m / 60) | 0}時間前` : m < 43200 ? `${(m / 1440) | 0}日前` : `${(m / 43200) | 0}か月前`;
  };
  // YouTubeの内部API(動画タブの先頭)から、最新の動画を取得する(RSSは使えないため)
  const apiCache = new Map();
  const TAB_PARAMS = { v: 'EgZ2aWRlb3PyBgQKAjoA', s: 'EgZzaG9ydHPyBgUKA5oBAA==', l: 'EgdzdHJlYW1z8gYECgJ6AA==' }; // 動画 / ショート / ライブ配信 のタブ
  // 投稿情報で種類(動画/ショート/ライブ)の期間を選んで一覧を絞り込んでいるときは、その種類。そうでなければ、設定の種類(初期値は動画)
  const hoverType = () => { if (actFilter && TAB_PARAMS[actFilter.f]) return actFilter.f; const t = S.settings && S.settings.hoverType; return TAB_PARAMS[t] ? t : 'v'; };
  async function apiVideos(id, type = 'v') {
    const ak = id + ':' + type, c = apiCache.get(ak); if (c && Date.now() - c.t < 20 * 60 * 1000) return c.v;
    const r = await fetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20260101.00.00', hl: 'ja', gl: 'JP' } }, browseId: id, params: TAB_PARAMS[type] || TAB_PARAMS.v }) });
    if (!r.ok) throw new Error('API ' + r.status);
    const j = await r.json(), out = [];
    const texts = x => { const t = []; (function w(o) { if (!o || typeof o !== 'object') return; if (typeof o.content === 'string') t.push(o.content); Object.values(o).forEach(w); })(x); return t; };
    (function walk(o) {
      if (!o || typeof o !== 'object' || out.length >= 4) return;
      if (o.contentId && o.metadata && o.metadata.lockupMetadataViewModel) { const m = o.metadata.lockupMetadataViewModel; out.push({ id: o.contentId, title: (m.title && m.title.content) || '', pubText: texts(m.metadata).find(t => /前|ago/i.test(t)) || '' }); return; }
      if (o.shortsLockupViewModel) { const q = o.shortsLockupViewModel, vid = q.onTap && q.onTap.innertubeCommand && q.onTap.innertubeCommand.reelWatchEndpoint && q.onTap.innertubeCommand.reelWatchEndpoint.videoId; if (vid) out.push({ id: vid, short: true, title: (q.overlayMetadata && q.overlayMetadata.primaryText && q.overlayMetadata.primaryText.content) || (q.accessibilityText || '').replace(/,.*$/, ''), pubText: (q.overlayMetadata && q.overlayMetadata.secondaryText && q.overlayMetadata.secondaryText.content) || '' }); return; }
      if (o.videoRenderer && o.videoRenderer.videoId) { const v = o.videoRenderer; out.push({ id: v.videoId, title: (v.title && v.title.runs && v.title.runs.map(x => x.text).join('')) || '', pubText: (v.publishedTimeText && v.publishedTimeText.simpleText) || '' }); return; }
      Object.values(o).forEach(walk);
    })(j);
    apiCache.set(ak, { t: Date.now(), v: out });
    return out;
  }
  function hvShow(elm, k) {
    const c = S.channels[k]; if (!c) return;
    const r = elm.getBoundingClientRect();
    hv.innerHTML = `<div class="hv-h">${avHtml(c, 'av mini')}<b>${esc(nameOf(c))}</b><small class="hv-t">${esc((TYPES.find(t => t[0] === hoverType()) || TYPES[0])[1])}</small></div><div class="hv-b" id="hvb"><div class="hv-load">最新の動画を読み込み中…</div></div>`;
    hv.hidden = false;
    const w = 340; let x = r.right + 10; if (x + w > innerWidth) x = Math.max(8, r.left - w - 10);
    hv.style.left = x + 'px'; hv.style.top = Math.max(8, Math.min(r.top, innerHeight - 240)) + 'px';
    const render = d => {
      if (hvK !== k) return;
      const b = $('#hvb'); if (!b) return;
      b.innerHTML = d && d.videos && d.videos.length ? d.videos.slice(0, Math.max(1, Math.min(4, +(S.settings && S.settings.hoverVideos) || 2))).map(v => `<a class="hv-v" href="https://www.youtube.com/${v.short ? 'shorts/' : 'watch?v='}${esc(v.id)}" target="_blank">
        <img src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt=""><span><b>${esc(v.title)}</b><small>${v.pubText ? esc(v.pubText) : +new Date(v.published) > 86400000 ? ago(v.published) : ''}</small></span></a>`).join('')
        : `<div class="hv-load">動画を取得できませんでした${d && d.error ? '<br><small>' + esc(String(d.error).slice(0, 80)) + '</small>' : ''}</div>`;
      hv.style.top = Math.max(8, Math.min(r.top, innerHeight - hv.offsetHeight - 8)) + 'px'; // 個数が多いときも、画面からはみ出さない
    };
    const n = Math.max(1, Math.min(4, +(S.settings && S.settings.hoverVideos) || 2)), ht = hoverType(), ck = k + ':' + n + ':' + ht; // 設定の個数(1〜4)と、種類(動画/ショート/ライブ)
    if (infoCache.has(ck)) return render(infoCache.get(ck));
    // この画面から直接取得する(拡張機能の背景処理が古いままでも、設定の本数が効くように)。失敗したときだけ、背景処理に頼む
    (async () => {
      try {
        let id = k.startsWith('UC') ? k : ((await chrome.storage.local.get('meta')).meta || {})[k]?.id || (S.channels[k] || {}).id;
        if (!id) { const d0 = await new Promise(res => chrome.runtime.sendMessage({ type: 'chInfo', key: k, n }, res)); id = d0 && d0.id; }
        if (!id) throw new Error('チャンネルIDが分かりません');
        const d = { videos: await apiVideos(id, ht), ver: 'mgr-api', want: n };
        if (d.videos.length) { infoCache.set(ck, d); return render(d); }
        throw new Error('一覧が空でした');
      } catch (err) {
        if (ht !== 'v') return render({ error: err.message || String(err) }); // 背景処理は動画だけ対応
        chrome.runtime.sendMessage({ type: 'chInfo', key: k, n }, d => { if (d && !d.error) infoCache.set(ck, d); render(d && !d.error ? d : { error: err.message || String(err) }); });
      }
    })();
  }
  function hover(e) {
    const t = e.target.closest('.card, .tc');
    const k = t ? t.dataset.k : null;
    if (k === hvK) return;
    clearTimeout(hvT); hv.hidden = true; hvK = k;
    if (k) hvT = setTimeout(() => hvShow(t, k), 350);
  }
  $('#grid').addEventListener('mouseover', hover); $('#nav').addEventListener('mouseover', hover);
  document.addEventListener('mouseleave', () => { clearTimeout(hvT); hv.hidden = true; hvK = null; });
  [$('#grid'), $('#nav')].forEach(x => x.addEventListener('mouseleave', () => { clearTimeout(hvT); hv.hidden = true; hvK = null; }));
  window.addEventListener('dragstart', () => { clearTimeout(hvT); hv.hidden = true; });

  // ---- フォルダ編集 ----
  function drawPickers() {
    $('#icons').innerHTML = TF.ICONS.map(i => `<button type="button" data-i="${i}" class="${edit.icon === i ? 'act' : ''}">${i}</button>`).join('') +
      '<div class="isep">アニメ風</div>' + TF.ANIME.map(a => `<button type="button" data-i="${a.uri}" title="${a.name}" class="${edit.icon === a.uri ? 'act' : ''}">${TF.iconHtml(a.uri)}</button>`).join('');
    $('#colors').innerHTML = TF.PALETTE.map(c => `<button type="button" data-c="${c}" class="${edit.color === c ? 'act' : ''}" style="background:${c}"></button>`).join('');
    $('#gprev').innerHTML = TF.isImgIcon(edit.icon) ? TF.iconHtml(edit.icon) : '';
  }
  $('#icons').onclick = e => { const b = e.target.closest('button'); if (b) { edit.icon = b.dataset.i; $('#gimg').value = ''; drawPickers(); } };
  $('#gimg').oninput = () => { const v = $('#gimg').value.trim(); if (/^https?:\/\//i.test(v)) { edit.icon = v; drawPickers(); } };
  $('#gimgfile').onclick = () => $('#gimgf').click();
  $('#gimgf').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { edit.icon = await TF.fileToIcon(f); $('#gimg').value = ''; drawPickers(); } catch (x) { toast('画像を読み込めませんでした'); }
  };
  $('#colors').onclick = e => { const b = e.target.closest('button'); if (b) { edit.color = b.dataset.c; drawPickers(); } };
  function openDlg(id, parent) {
    const g = id && id !== 'new' ? grp(id) : null;
    edit = { id: g ? g.id : null, icon: g ? g.icon : TF.ICONS[0], color: g ? g.color : TF.PALETTE[S.groups.length % TF.PALETTE.length] };
    $('#dtitle').textContent = g ? 'フォルダを編集' : 'フォルダを作成';
    $('#gname').value = g ? g.name : '';
    const bad = g ? TF.subtree(S.groups, g.id) : new Set();
    const cur = g ? (g.parent || '') : (parent || '');
    $('#gparent').innerHTML = '<option value="">（なし：最上位）</option>' + TF.flat(S.groups).filter(x => !bad.has(x.g.id))
      .map(({ g: x, depth }) => `<option value="${x.id}" ${cur === x.id ? 'selected' : ''}>${'　'.repeat(depth)}${esc(TF.iconText(x.icon))} ${esc(x.name)}</option>`).join('');
    $('#gimg').value = g && TF.isImgIcon(g.icon) && !/^data:/i.test(g.icon) ? g.icon : '';
    $('#gdel').style.visibility = g && S.groups.length > 1 ? 'visible' : 'hidden';
    drawPickers(); $('#dlg').showModal();
  }
  const paintSync = s => { const e = $('#drvst'); if (!e) return; const hm = s && s.at ? new Date(s.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : ''; const t = s ? ({ syncing: '☁ 同期中…', ok: '☁ ' + s.msg + (hm ? ' (' + hm + ')' : ''), error: '⚠ ' + s.msg }[s.state] || '') : ''; e.textContent = t; e.className = 'gdrv' + (s && s.state === 'error' ? ' err' : ''); e.title = s && s.at ? new Date(s.at).toLocaleString() : ''; };
  chrome.storage.local.get('syncStatus').then(r => paintSync(r.syncStatus));
  chrome.storage.onChanged.addListener((ch, a) => { if (a === 'local' && ch.syncStatus) paintSync(ch.syncStatus.newValue); });
  const ib = $('#ytimp');
  chrome.runtime.onMessage.addListener(m => { if (m && m.type === 'importProgress' && ib.disabled) ib.textContent = `取り込み中… ${m.n}件`; });
  ib.onclick = () => {
    ib.disabled = true; ib.textContent = '取り込み中…';
    chrome.runtime.sendMessage({ type: 'importSubs' }, r => {
      ib.disabled = false; ib.textContent = '⟳ YouTubeから取り込む';
      if (r && !r.error) toast(`✓ ${r.count}件のチャンネルを取り込みました`);
      else if (confirm('バックグラウンド取り込みに失敗しました(' + ((r && r.error) || '不明') + ')。YouTubeのタブを開いて取り込みますか?')) window.open('https://www.youtube.com/feed/channels?tf_import=1', '_blank');
    });
  };
  $('#gcancel').onclick = () => $('#dlg').close();
  $('#gform').onsubmit = () => {
    const name = $('#gname').value.trim(); if (!name) return;
    const parent = $('#gparent').value || null;
    if (!edit.id && edit.icon === TF.ICONS[0]) edit.icon = TF.suggestIcon(name) || edit.icon;
    TF.mutate(s => {
      if (edit.id) Object.assign(s.groups.find(g => g.id === edit.id), { name, icon: edit.icon, color: edit.color, parent });
      else s.groups.push({ id: TF.uid(), name, icon: edit.icon, color: edit.color, parent });
    });
    if (parent) { open.add(parent); saveOpen(); }
  };
  $('#gdel').onclick = () => {
    if (!confirm('このフォルダを削除しますか?(中のサブフォルダは1つ上へ移動し、チャンネル自体は削除されません)')) return;
    const id = edit.id;
    TF.mutate(s => {
      const g = s.groups.find(x => x.id === id);
      s.groups.forEach(x => { if (x.parent === id) x.parent = g.parent || null; });
      s.groups = s.groups.filter(x => x.id !== id);
      Object.values(s.channels).forEach(c => { c.groups = c.groups.filter(x => x !== id); });
      if (s.settings.activeGroup === id) s.settings.activeGroup = 'all';
    });
    if (view === id) view = 'all';
    $('#dlg').close();
  };

  // ---- 上のガラスバー(新着動画などのページへ / Drive・JSON) ----
  (() => {
    const bar = $('#gbar'); if (!bar) return;
    $('#statsTgl').onclick = toggleStats;
    const st = t => { const e = $('#gfly-st'); if (e) e.textContent = t; };
    const drv = (type, ask, done) => { if (ask && !confirm(ask)) return; st('通信中…'); chrome.runtime.sendMessage({ type, interactive: true }, r => { const t = r && r.ok ? '☁ ' + done : '⚠ ' + ((r && r.error) || '失敗'); st(t); toast(t); }); };
    const KEYS = ['groups', 'channels', 'settings', 'meta', 'activity'];
    const closeFly = () => { const f = $('#gfly'); if (f) f.remove(); };
    const act = async g => {
      if (g === 'reload') { closeFly(); toast('拡張機能を再読み込みします…'); setTimeout(() => chrome.runtime.reload(), 400); }
      else if (g === 'yt') { closeFly(); toast('YouTubeから取り込み中…'); $('#ytimp').click(); }
      else if (g === 'sync') drv('syncNow', null, '同期しました');
      else if (g === 'up') drv('driveUp', 'この端末の内容で、Google Driveのデータを上書きします。よろしいですか?', 'アップロードしました');
      else if (g === 'down') drv('driveDown', 'Google Driveの内容で、この端末のデータを上書きします。よろしいですか?', 'ダウンロードしました');
      else if (g === 'exp') {
        const data = await chrome.storage.local.get(KEYS), a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'TubeFolio2', version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' }));
        a.download = 'tubefolio2-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('JSONを書き出しました'); closeFly();
      } else if (g === 'imp') { closeFly(); $('#gfile').click(); }
    };
    // ツール: 1つのボタンに、同期・Drive(手動)・JSON をまとめる(メインのバーのツールと同じ、下に開くガラスのメニュー)
    bar.addEventListener('click', e => {
      const b = e.target.closest('#gmenu'); if (!b) return;
      if ($('#gfly')) return closeFly();
      const ht0 = hoverType();
      const hv0 = Math.max(1, Math.min(4, +(S.settings && S.settings.hoverVideos) || 2));
      const f = document.createElement('div'); f.id = 'gfly';
      f.innerHTML = `<div class="fh">登録チャンネル</div><button data-g="yt">⟳ YouTubeから取り込む</button>
        <div class="fh">Google Drive</div><button data-g="sync">☁ 今すぐ同期</button><button data-g="up">⬆ この端末の内容をアップロード</button><button data-g="down">⬇ Driveの内容をダウンロード</button><div class="fn" id="gfly-st"></div>
        <div class="fh">ファイル(JSON)</div><button data-g="exp">📤 JSONで書き出す</button><button data-g="imp">📥 JSONから読み込む</button>
        <button data-g="reload">🔄 拡張機能を再読み込み(更新を反映)</button>
        <div class="fh">マウスオーバーで出す動画の数</div><div class="fseg">${[1, 2, 3, 4].map(n => `<button data-hv="${n}" class="${hv0 === n ? 'act' : ''}">${n}本</button>`).join('')}</div>
        <div class="fh">マウスオーバーで出す種類</div><div class="fseg">${TYPES.map(([f, lb]) => `<button data-ht="${f}" class="${ht0 === f ? 'act' : ''}">${lb.replace(/^\S+ /, '').replace('ライブ配信', 'ライブ・配信')}</button>`).join('')}</div>`;
      document.body.appendChild(f);
      const r = b.getBoundingClientRect(); f.style.top = Math.round(r.bottom + 8) + 'px'; f.style.left = Math.max(8, Math.min(r.right - 250, innerWidth - 258)) + 'px';
      f.addEventListener('click', ev => {
        const hb = ev.target.closest('button[data-hv]');
        if (hb) { TF.mutate(st => { st.settings.hoverVideos = +hb.dataset.hv; }); f.querySelectorAll('[data-hv]').forEach(x => x.classList.toggle('act', x === hb)); return; }
        const tb = ev.target.closest('button[data-ht]');
        if (tb) { TF.mutate(st => { st.settings.hoverType = tb.dataset.ht; }); f.querySelectorAll('[data-ht]').forEach(x => x.classList.toggle('act', x === tb)); return; }
        const x = ev.target.closest('button[data-g]'); if (x) act(x.dataset.g);
      });
    });
    document.addEventListener('mousedown', e => { if ($('#gfly') && !e.target.closest('#gfly') && !e.target.closest('#gmenu')) closeFly(); }, true);
    $('#gfile').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        const d = JSON.parse(await f.text()), src = d && typeof d.data === 'object' && d.data ? d.data : d;
        if (!Array.isArray(src.groups) || !src.channels || typeof src.channels !== 'object') throw new Error('形式が違います');
        if (!confirm(`このファイルの内容で、この端末のデータを上書きします。
フォルダ ${src.groups.length}件 / チャンネル ${Object.keys(src.channels).length}件
よろしいですか?`)) return;
        const set = {}; KEYS.forEach(k => { if (src[k] !== undefined && src[k] !== null) set[k] = src[k]; });
        await chrome.storage.local.set(set); toast('JSONから読み込みました');
      } catch (err) { toast('読み込めませんでした: ' + (err.message || err)); }
    };
  })();

  (async function init() {
    S = await TF.get();
    const st = await chrome.storage.local.get(['meta', 'activity']); meta = st.meta || {}; act = st.activity || {};
    // YouTube内に埋め込み表示のとき: 表示フォルダは YouTube左メニュー側(tfView)で選ぶ
    const embed = location.search.includes('embed=1');
    const okView = () => { if (view !== 'all' && view !== 'none' && !grp(view) && !(view.startsWith('ch:') && S.channels[view.slice(3)])) view = 'all'; };
    if (embed) { document.body.classList.add('embed'); const tv = (await chrome.storage.local.get('tfView')).tfView; if (tv) view = tv; okView(); }
    draw();
    chrome.storage.onChanged.addListener(async ch => {
      if (embed && ch.tfView) { view = ch.tfView.newValue || 'all'; sel.clear(); S = await TF.get(); okView(); return draw(); }
      if (!(ch.groups || ch.channels || ch.settings)) return; // meta更新では再描画しない
      S = await TF.get();
      if (view !== 'all' && view !== 'none' && !grp(view)) view = 'all';
      draw();
    });
  })();
  document.addEventListener('mousedown', () => { if (document.body.classList.contains('embed')) { try { parent.postMessage({ tfClick: 1 }, '*'); } catch (e) { /* 無視 */ } } }, true); // YouTube内に埋め込み表示のとき、親のメニューを閉じるため
})();
