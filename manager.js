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
  // 「未分類」で、フォルダに入れた直後のチャンネルは、この画面にいる間は残す(続けて、別のフォルダにも入れられるように)。ほかの画面へ移ったら、消える
  const justFiled = new Set(); let justView = '';
  function visible() {
    const q = $('#q').value.trim().toLowerCase();
    let l = chans().filter(c => view === 'all' ? true : view === 'none' ? (!filed(c).length || justFiled.has(c.key)) : inTree(c, view));
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
    $('#grid').hidden = $('#bulk').hidden = $('#empty').hidden = true; $('#howto').hidden = true; closePick();
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
    if (justView !== view) { justView = view; justFiled.clear(); }
    $('#chview').hidden = true; $('#howto').hidden = false; $('#grid').hidden = false; document.querySelector('header').hidden = false;
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
        <div class="tags">${filed(c).map(id => { const x = grp(id); return `<span class="tag" style="--c:${x.color}">${TF.iconHtml(x.icon)} ${esc(x.name)}<button type="button" class="tx" data-rmg="${x.id}" title="「${esc(x.name)}」から外す">×</button></span>`; }).join('')}<button type="button" class="tag plus fbtn" title="入れるフォルダを選ぶ(いくつでも選べます)">📁 フォルダ${filed(c).length ? 'を変える' : 'に入れる'}</button></div>
        ${assistOn() && !filed(c).length ? `<div class="sugg" data-k="${esc(c.key)}">${suggHtml(c)}</div>` : ''}</div></div>`).join('');
    observeAvatars($('#grid')); paintAssist(); observeSugg();
    drawBulk(); drawStats();
  }
  function drawBulk() {
    if (!bulkOn() && sel.size) sel.clear();
    document.body.classList.toggle('nobulk', !bulkOn());
    { const h = $('#howto'); if (h) h.textContent = 'フォルダへの登録: チャンネルの「📁 フォルダ」を押して、入れたいフォルダにチェックを付けます(1つのチャンネルを、いくつものフォルダに入れられます)。' + (bulkOn() ? 'まとめて入れるときは、カードを押して選んでから「📁 フォルダを選ぶ」。' : '') + '左のフォルダへドラッグしても入ります。'; }
    $('#bulk').hidden = !sel.size;
    $('#bcnt').textContent = `${sel.size}件選択中`;
    $('#bgroups').innerHTML = `<button data-pick="1" class="pk">📁 フォルダを選ぶ(まとめて入れる / 外す)</button>` + (grp(view) ? `<button data-rm="${view}" style="--c:#ef4444">このフォルダから外す</button>` : '');
  }

  // ---- フォルダを選ぶ画面(チャンネルの登録) ----
  //   手順: ① チャンネルの「📁 フォルダ」を押す(まとめて入れるときは、カードを選んでから「📁 フォルダを選ぶ」)
  //         ② 入れたいフォルダにチェックを付ける(いくつでも。押すたびに、その場で保存)  ③ 閉じる
  //   1つのチャンネルを、いくつものフォルダに入れるのが、この画面だけで済む(以前は、ドラッグするたびに一覧から消えたり、ボタンの長い列から探したりしていた)。
  //   チェックの見た目: ✓ = 選んだチャンネルが全部入っている / − = 一部だけ入っている / 空 = 入っていない
  let pick = null; // { keys: [チャンネルのキー], q: 絞り込み }
  const closePick = () => { pick = null; const p = $('#fpick'); if (p) p.remove(); };
  function openPick(keys, anchor) {
    closePick(); if (!keys.length) return;
    pick = { keys, q: '' };
    const p = document.createElement('div'); p.id = 'fpick';
    p.innerHTML = `<div class="fp-h"><b></b><button type="button" data-fp="x" title="閉じる">✕</button></div>
      <p class="fp-note">入れたいフォルダを押して、チェックを付けます(いくつでも)。もう一度押すと外れます。</p>
      <input class="fp-q" type="search" placeholder="フォルダを絞り込み" autocomplete="off">
      <div class="fp-l"></div>
      <div class="fp-f"><input class="fp-new" placeholder="新しいフォルダの名前" maxlength="30"><button type="button" data-fp="new">＋ 作って入れる</button></div>
      <div class="fp-b"><button type="button" class="pri" data-fp="x">閉じる</button></div>`;
    document.body.appendChild(p);
    const r = anchor ? anchor.getBoundingClientRect() : null, w = p.offsetWidth, h = Math.min(p.offsetHeight, innerHeight - 16);
    p.style.left = Math.max(8, Math.min(innerWidth - w - 8, r ? r.left : (innerWidth - w) / 2)) + 'px';
    p.style.top = Math.max(8, Math.min(innerHeight - h - 8, r ? r.bottom + 6 : (innerHeight - h) / 2)) + 'px';
    drawPick();
  }
  function drawPick() {
    const p = $('#fpick'); if (!p || !pick) return;
    pick.keys = pick.keys.filter(k => S.channels[k]); if (!pick.keys.length) return closePick();
    const cs = pick.keys.map(k => S.channels[k]), q = pick.q.toLowerCase();
    p.querySelector('.fp-h b').textContent = cs.length === 1 ? `「${nameOf(cs[0])}」を入れるフォルダ` : `${cs.length}件のチャンネルを入れるフォルダ`;
    const l = p.querySelector('.fp-l'), top = l.scrollTop;
    l.innerHTML = TF.flat(S.groups).filter(({ g }) => !q || g.name.toLowerCase().includes(q)).map(({ g, depth }) => {
      const n = cs.filter(c => c.groups.includes(g.id)).length, st = n === cs.length ? 'on' : n ? 'mix' : '';
      return `<button type="button" class="fp-it ${st}" data-g="${g.id}" style="--c:${g.color};padding-left:${10 + (q ? 0 : depth) * 18}px"><i class="fp-ck">${st === 'on' ? '✓' : st === 'mix' ? '−' : ''}</i><span class="ic">${TF.iconHtml(g.icon)}</span><span class="nm">${esc(g.name)}</span>${st === 'mix' ? `<small>${n}/${cs.length}</small>` : ''}</button>`;
    }).join('') || '<p class="fp-note">合うフォルダがありません。</p>';
    l.scrollTop = top;
  }
  document.addEventListener('click', e => {
    const p = $('#fpick'); if (!p || !pick || !p.contains(e.target)) return;
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.fp === 'x') return closePick();
    if (b.dataset.fp === 'new') {
      const i = p.querySelector('.fp-new'), name = i.value.trim(); if (!name) return i.focus();
      const id = TF.uid(), keys = pick.keys.slice(); i.value = '';
      return void TF.mutate(st => { st.groups.push({ id, name, icon: TF.suggestIcon(name) || '📁', color: TF.PALETTE[st.groups.length % TF.PALETTE.length] }); keys.forEach(k => { const c = st.channels[k]; if (c && !c.groups.includes(id)) c.groups.push(id); }); }).then(() => { keys.forEach(k => justFiled.add(k)); toast(`「${name}」を作って、入れました`); });
    }
    const gid = b.dataset.g; if (!gid) return;
    const keys = pick.keys.slice(), all = keys.every(k => S.channels[k] && S.channels[k].groups.includes(gid));
    TF.mutate(st => keys.forEach(k => { const c = st.channels[k]; if (!c) return; if (all) c.groups = c.groups.filter(x => x !== gid); else if (!c.groups.includes(gid)) c.groups.push(gid); }))
      .then(() => { keys.forEach(k => justFiled.add(k)); toast(`${keys.length > 1 ? keys.length + '件を' : ''}「${grp(gid) ? grp(gid).name : ''}」${all ? 'から外しました' : 'に入れました'}`); });
  });
  document.addEventListener('input', e => { if (pick && e.target.classList && e.target.classList.contains('fp-q')) { pick.q = e.target.value.trim(); drawPick(); } });
  document.addEventListener('keydown', e => { if (!pick) return; if (e.key === 'Escape') return closePick(); if (e.key === 'Enter' && !e.isComposing && e.target.classList && e.target.classList.contains('fp-new')) { e.preventDefault(); $('#fpick [data-fp="new"]').click(); } });
  document.addEventListener('mousedown', e => { const p = $('#fpick'); if (p && !p.contains(e.target) && !e.target.closest('.fbtn, [data-pick]')) closePick(); }, true);
  const draw = () => { drawNav(); drawGrid(); drawPick(); };

  const addTo = (keys, gid, from) => TF.mutate(s => keys.forEach(k => {
    const c = s.channels[k]; if (!c) return;
    if (from && from !== gid) c.groups = c.groups.filter(x => x !== from);
    if (!c.groups.includes(gid)) c.groups.push(gid);
  })).then(() => keys.forEach(k => justFiled.add(k))).then(() => toast(`${keys.length}件を「${grp(gid).name}」${from ? 'へ移動' : 'に追加'}しました`));
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
    const k = card.dataset.k;
    const fb = e.target.closest('.fbtn'); if (fb) return openPick([k], fb); // 📁 フォルダ: このチャンネルを入れるフォルダを選ぶ
    const tx = e.target.closest('.tx[data-rmg]'); if (tx) { const gid = tx.dataset.rmg; justFiled.add(k); return void TF.mutate(st => { const c = st.channels[k]; if (c) c.groups = c.groups.filter(x => x !== gid); }).then(() => toast('フォルダから外しました')); } // タグの ×
    if (!bulkOn()) return; // 「まとめて入れる」を非表示にしているときは、カードを押しても選ばない
    sel.has(k) ? sel.delete(k) : sel.add(k); drawGrid();
  });
  $('#grid').addEventListener('dragstart', e => {
    const card = e.target.closest('.card'); if (!card) return;
    const k = card.dataset.k;
    e.dataTransfer.setData('text/plain', JSON.stringify({ t: 'ch', keys: sel.has(k) ? [...sel] : [k] }));
  });
  $('#bgroups').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pick) return openPick([...sel], b);
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
    $('#gkw').value = g && g.kw ? g.kw.join(', ') : ''; $('#gkw').placeholder = TF.defaultKw(g ? g.name : '').slice(0, 8).join(', ') || 'グルメ, ラーメン, -ゲーム';
    $('#gimg').value = g && TF.isImgIcon(g.icon) && !/^data:/i.test(g.icon) ? g.icon : '';
    $('#gdel').style.visibility = g && S.groups.length > 1 ? 'visible' : 'hidden';
    drawPickers(); $('#dlg').showModal();
  }
  const paintSync = s => { const e = $('#drvst'); if (!e) return; const hm = s && s.at ? new Date(s.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : ''; const t = s ? ({ syncing: '☁ 同期中…', ok: '☁ ' + s.msg + (hm ? ' (' + hm + ')' : ''), error: '⚠ ' + s.msg }[s.state] || '') : ''; e.textContent = t; e.className = 'gdrv' + (s && s.state === 'error' ? ' err' : ''); e.title = s && s.at ? new Date(s.at).toLocaleString() : ''; };
  chrome.storage.local.get('syncStatus').then(r => paintSync(r.syncStatus));
  chrome.storage.onChanged.addListener((ch, a) => { if (a === 'local' && ch.syncStatus) paintSync(ch.syncStatus.newValue); });
  const ib = $('#ytimp');
  chrome.runtime.onMessage.addListener(m => { if (m && m.type === 'importProgress' && ib.disabled) ib.textContent = `取り込み中… ${m.n}件`; });
  // 取り込みと同時に、YouTube で登録を解除したチャンネルを、一覧から消す(フォルダからも外れる)。消す数が多すぎるときだけ、確かめる
  const runImport = force => {
    ib.disabled = true; ib.textContent = '取り込み中…';
    chrome.runtime.sendMessage({ type: 'importSubs', force: !!force }, r => {
      ib.disabled = false; ib.textContent = '⟳ YouTubeから取り込む';
      if (r && !r.error) {
        toast(`✓ ${r.count}件のチャンネルを取り込みました` + (r.removed ? `(登録を解除した ${r.removed}件を消しました)` : ''));
        if (r.held && confirm(`YouTube の登録チャンネルに無いチャンネルが、${r.held}件あります(一覧の半分より多い数です)。\nこれらを、TubeFolio2 の一覧とフォルダから消しますか?\n\n※ 取り込みがうまくいっていないだけのこともあります。心当たりがなければ「キャンセル」を押してください。`)) runImport(true);
      }
      else if (confirm('バックグラウンド取り込みに失敗しました(' + ((r && r.error) || '不明') + ')。YouTubeのタブを開いて取り込みますか?')) window.open('https://www.youtube.com/feed/channels?tf_import=1', '_blank');
    });
  };
  ib.onclick = () => runImport(false);
  $('#gcancel').onclick = () => $('#dlg').close();
  $('#gform').onsubmit = () => {
    const name = $('#gname').value.trim(); if (!name) return;
    const parent = $('#gparent').value || null;
    if (!edit.id && edit.icon === TF.ICONS[0]) edit.icon = TF.suggestIcon(name) || edit.icon;
    TF.mutate(s => {
      const kw = TF.kwList($('#gkw').value);
      if (edit.id) { const g0 = s.groups.find(g => g.id === edit.id); Object.assign(g0, { name, icon: edit.icon, color: edit.color, parent }); if (kw.length) g0.kw = kw; else delete g0.kw; }
      else s.groups.push({ id: TF.uid(), name, icon: edit.icon, color: edit.color, parent, ...(kw.length ? { kw } : {}) });
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
    const KEYS = TF.SYNC_KEYS;
    const closeFly = () => { const f = $('#gfly'); if (f) f.remove(); };
    const act = async g => {
      if (g === 'reload') { closeFly(); toast('拡張機能を再読み込みします…'); setTimeout(() => chrome.runtime.reload(), 400); }
      else if (g === 'log') { closeFly(); chrome.runtime.sendMessage({ type: 'openLog' }); }
      else if (g === 'assist') { closeFly(); openAssistCfg(); }
      else if (g === 'assistTgl') { TF.mutate(s => { s.settings.assist = !s.settings.assist; }).then(() => { const b = $('#gAssist'); if (b) b.textContent = assistOn() ? '🪄 振り分け補助:オン' : '🪄 振り分け補助:オフ'; }); }
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
      f.innerHTML = `<div class="gtabs">${[['org', '📂 整理'], ['sync', '☁ 同期'], ['etc', '🔧 その他']].map(([k, l]) => `<button class="gtab${k === (f.dataset.cur = (() => { try { return localStorage.getItem('tfMgrTab') || 'org'; } catch (e) { return 'org'; } })()) ? ' on' : ''}" data-tb="${k}">${l}</button>`).join('')}</div>
        <div data-gt="org"><div class="fh">登録チャンネル</div><button data-g="yt">⟳ YouTubeから取り込む</button>
        <div class="fh">まとめて入れる(カードを押して選ぶ)</div><div class="fseg">${[[1, '表示'], [0, '非表示']].map(([v, l]) => `<button data-bs="${v}" class="${bulkOn() === !!v ? 'act' : ''}">${l}</button>`).join('')}</div>
        <div class="fh">振り分け補助(登録の補助)</div><button data-g="assistTgl" id="gAssist">${assistOn() ? '🪄 振り分け補助:オン' : '🪄 振り分け補助:オフ'}</button><button data-g="assist">⚙ 補助の設定(点数・キーワード)</button>
        <div class="fh">マウスオーバーで出す動画の数</div><div class="fseg">${[1, 2, 3, 4].map(n => `<button data-hv="${n}" class="${hv0 === n ? 'act' : ''}">${n}本</button>`).join('')}</div>
        <div class="fh">マウスオーバーで出す種類</div><div class="fseg">${TYPES.map(([f, lb]) => `<button data-ht="${f}" class="${ht0 === f ? 'act' : ''}">${lb.replace(/^\S+ /, '').replace('ライブ配信', 'ライブ・配信')}</button>`).join('')}</div></div>
        <div data-gt="sync"><div class="fh">Google Drive</div><button data-g="sync">☁ 今すぐ同期</button><button data-g="up">⬆ この端末の内容をアップロード</button><button data-g="down">⬇ Driveの内容をダウンロード</button><div class="fn" id="gfly-st"></div>
        <div class="fh">ファイル(JSON)</div><button data-g="exp">📤 JSONで書き出す</button><button data-g="imp">📥 JSONから読み込む</button></div>
        <div data-gt="etc"><button data-g="log">📜 動作ログを開く</button><button data-g="reload">🔄 拡張機能を再読み込み(更新を反映)</button></div>`;
      document.body.appendChild(f);
      const r = b.getBoundingClientRect(); f.style.top = Math.round(r.bottom + 8) + 'px'; f.style.left = Math.max(8, Math.min(r.right - 250, innerWidth - 258)) + 'px';
      const showT = t => { f.dataset.cur = t; f.querySelectorAll('.gtab').forEach(b => b.classList.toggle('on', b.dataset.tb === t)); f.querySelectorAll('[data-gt]').forEach(d => { d.hidden = d.dataset.gt !== t; }); try { localStorage.setItem('tfMgrTab', t); } catch (e) { /* なし */ } };
      showT(f.dataset.cur || 'org');
      f.addEventListener('click', ev => {
        const gtb = ev.target.closest('.gtab'); if (gtb) { showT(gtb.dataset.tb); return; }
        const hb = ev.target.closest('button[data-hv]');
        if (hb) { TF.mutate(st => { st.settings.hoverVideos = +hb.dataset.hv; }); f.querySelectorAll('[data-hv]').forEach(x => x.classList.toggle('act', x === hb)); return; }
        const bs = ev.target.closest('button[data-bs]');
        if (bs) { TF.mutate(st => { st.settings.bulkSel = bs.dataset.bs === '1'; }); f.querySelectorAll('[data-bs]').forEach(x => x.classList.toggle('act', x === bs)); return; }
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


  // ---- 振り分け補助(旧TubeFolioから移植): フォルダに入っていないチャンネルに、「入れるフォルダの候補」を出す ----
  //  点数 = チャンネル名・最近の動画タイトル・チャンネルの説明文に、フォルダのキーワードが何回出るか。キーワードは、フォルダの編集で設定(未設定ならフォルダ名から自動)
  //  設定(settings.assist / settings.assistRules)は、Drive同期の対象。取得したタイトルは、取り直せるので、同期しない(storage の chTitles)
  const RULES_DEF = { nameScore: 3, titleScore: 1, titleCount: 15, minScore: 2, bulkMin: 4, maxSugg: 3, useDict: true, fuzzy: true, useShorts: true, subfolder: true, useDesc: true, descScore: 1 };
  const rules = () => ({ ...RULES_DEF, ...((S.settings && S.settings.assistRules) || {}) });
  const assistOn = () => !!(S.settings && S.settings.assist);
  const bulkOn = () => !(S.settings && S.settings.bulkSel === false); // カードを押して選び、まとめてフォルダに入れる機能(⚙ チャンネル管理の設定 → 整理 で、表示 / 非表示)
  let chTitles = {}; chrome.storage.local.get('chTitles').then(r => { chTitles = r.chTitles || {}; });
  const nrm = t => { t = String(t || ''); if (!rules().fuzzy) return t.toLowerCase(); return t.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60)); };
  const pathName = g => { const n = []; let x = g, i = 0; while (x && i++ < 6) { n.unshift(x.name); x = x.parent ? grp(x.parent) : null; } return n.join(' ＞ '); };
  const kwOf = g => {
    const src = g.kw && g.kw.length ? g.kw : rules().useDict ? TF.defaultKw(g.name) : [], inc = [], exc = [];
    for (const x of src) { const k = String(x).trim(); if (!k) continue; if (/^[-－ー]/.test(k) && k.length > 1) exc.push(nrm(k.slice(1))); else inc.push(nrm(k)); }
    return { inc, exc };
  };
  function suggest(c) {
    const R = rules(), e = chTitles[c.key] || {};
    const name = nrm(nameOf(c)), titles = (e.t || []).slice(0, R.titleCount).map(nrm), descs = R.useDesc && e.cd ? [nrm(e.cd)] : [];
    const all = [name, ...titles, ...descs], res = [];
    for (const g of S.groups) {
      if (!R.subfolder && g.parent) continue;
      const { inc, exc } = kwOf(g);
      if (exc.some(k => all.some(t => t.includes(k)))) continue;
      const by = { n: 0, t: 0, d: 0 };
      for (const k of inc) { if (name.includes(k)) by.n += R.nameScore; by.t += titles.filter(t => t.includes(k)).length * R.titleScore; by.d += descs.filter(t => t.includes(k)).length * R.descScore; }
      const sc = by.n + by.t + by.d;
      if (sc >= R.minScore && sc > 0) res.push({ g, sc, by });
    }
    return res.sort((a, b) => b.sc - a.sc).slice(0, R.maxSugg);
  }
  function suggHtml(c) {
    const R = rules(), has = !!chTitles[c.key], list = suggest(c);
    return '<span class="sg-lb">🪄 候補</span>' + (list.map(({ g, sc, by }) => `<button class="sg" data-g="${esc(g.id)}" style="--c:${esc(g.color)}" title="一致度 ${sc}(名前 ${by.n}・タイトル ${by.t}・説明文 ${by.d})">＋${esc(pathName(g))}${sc >= R.bulkMin * 1.5 ? ' ★' : ''}</button>`).join('') || `<span class="sg-none">${has ? '候補なし(フォルダの編集でキーワードを足すと出やすくなります)' : 'タイトルを確認中…'}</span>`);
  }
  const bulkPlan = () => visible().filter(c => !filed(c).length).map(c => { const t = suggest(c)[0]; return t && t.sc >= rules().bulkMin ? { key: c.key, g: t.g } : null; }).filter(Boolean);
  function paintAssist() {
    const b = $('#assistBtn'); b.classList.toggle('on', assistOn()); b.textContent = assistOn() ? '🪄 振り分け補助:オン' : '🪄 振り分け補助:オフ';
    { const n0 = chans().filter(c => !filed(c).length).length; b.title = `フォルダに入っていないチャンネル(今 ${n0}件)に、入れるフォルダの候補を出します。候補を押すと、そのフォルダに入ります(キーワードは、横の ⚙ か、フォルダの編集で設定)`; }
    const bb = $('#bulkAssist'), n = assistOn() ? bulkPlan().length : 0; bb.hidden = !n; bb.textContent = `🪄 一括適用 ${n}`; bb.title = `一致度の高い候補(${rules().bulkMin}点以上)を ${n} チャンネルにまとめて適用`;
  }
  let sIO = null, tQ = [], tBusy = 0, tSave = 0;
  function observeSugg() {
    if (sIO) sIO.disconnect(); if (!assistOn()) return;
    sIO = new IntersectionObserver(ents => { for (const en of ents) { if (!en.isIntersecting) continue; sIO.unobserve(en.target); const k = en.target.dataset.k, e = chTitles[k]; if (!e || Date.now() - e.at > 14 * 864e5) { tQ.push(k); pump(); } } }, { root: null, rootMargin: '300px' });
    document.querySelectorAll('.sugg').forEach(x => sIO.observe(x));
  }
  function pump() {
    while (tBusy < 3 && tQ.length) {
      const k = tQ.shift(); if (!S.channels[k]) continue; tBusy++;
      new Promise(res => chrome.runtime.sendMessage({ type: 'chText', key: k }, res)).then(r => {
        chTitles[k] = { at: Date.now(), t: (r && r.t) || [], cd: (r && r.cd) || '' };
        const el = [...document.querySelectorAll('.sugg')].find(x => x.dataset.k === k); if (el) el.innerHTML = suggHtml(S.channels[k]);
        paintAssist(); clearTimeout(tSave); tSave = setTimeout(() => chrome.storage.local.set({ chTitles }), 2000);
      }).finally(() => { tBusy--; pump(); });
    }
  }
  $('#assistCfg').onclick = () => openAssistCfg();
  $('#assistBtn').onclick = () => TF.mutate(s => { s.settings.assist = !s.settings.assist; });
  $('#bulkAssist').onclick = () => {
    const plan = bulkPlan(); if (!plan.length) return;
    const sample = plan.slice(0, 8).map(p => `${nameOf(S.channels[p.key])} → ${p.g.name}`).join('\n');
    if (!confirm(`候補の一番上のフォルダに、${plan.length} チャンネルをまとめて振り分けますか?\n\n${sample}${plan.length > 8 ? '\n…' : ''}`)) return;
    TF.mutate(s => plan.forEach(p => { const c = s.channels[p.key]; if (c && !c.groups.includes(p.g.id)) c.groups.push(p.g.id); })).then(() => toast(`${plan.length} チャンネルを振り分けました`));
  };
  $('#grid').addEventListener('click', e => { const b = e.target.closest('.sugg .sg'); if (!b) return; e.stopPropagation(); addTo([b.closest('.sugg').dataset.k], b.dataset.g); }, true);
  // 設定画面(点数・出し方)
  function openAssistCfg() {
    const R = rules(); let d = $('#adlg'); if (d) d.remove();
    d = document.createElement('dialog'); d.id = 'adlg';
    const num = (k, lb, mn, mx, note = '') => `<label class="ar-row"><span>${lb}${note ? `<em>${note}</em>` : ''}</span><input type="number" data-r="${k}" min="${mn}" max="${mx}" value="${R[k]}"></label>`;
    const chk = (k, lb) => `<label class="ar-chk"><input type="checkbox" data-r="${k}" ${R[k] ? 'checked' : ''}><span>${lb}</span></label>`;
    d.innerHTML = `<div class="ar"><h3>🪄 振り分け補助の設定</h3>
      <label class="ar-chk"><input type="checkbox" id="ar-on" ${assistOn() ? 'checked' : ''}><span><b>振り分け補助を使う</b>(フォルダに入っていないチャンネルに、フォルダの候補を出します)</span></label>
      <p class="ar-note">フォルダに入っていないチャンネルごとに、チャンネル名・最近の動画タイトル・説明文に、フォルダのキーワードが何回出るかで点数をつけ、点数の高いフォルダを候補に出します。キーワードは、フォルダの編集で設定します(空欄ならフォルダ名から自動)。</p>
      <div class="ar-sub">点数のつけ方</div>
      ${num('nameScore', 'チャンネル名に入っている', 0, 20, '1語につき')}${num('titleScore', '動画タイトルに入っている', 0, 20, '1本・1語につき')}${num('titleCount', '見る動画タイトルの本数', 3, 30, '最近の動画から')}
      ${chk('useDesc', 'チャンネルの説明文も見る')}${num('descScore', '説明文に入っている', 0, 20, '1語につき')}
      <div class="ar-sub">候補の出し方</div>
      ${num('minScore', '候補に出す最低点', 1, 50)}${num('bulkMin', '「一括適用」の最低点', 1, 50, '一番上の候補だけ')}${num('maxSugg', '候補の数', 1, 6)}
      ${chk('useDict', 'キーワード未設定のフォルダは、フォルダ名から自動でキーワードを作る')}${chk('fuzzy', 'ひらがな/カタカナ・全角/半角・大文字/小文字を区別しない')}${chk('useShorts', '動画が無いチャンネルは、ショートのタイトルを見る')}${chk('subfolder', '中のフォルダ(サブフォルダ)も候補にする')}
      <div class="ar-sub">フォルダごとのキーワード(タグ)</div>
      <p class="ar-note">「,」区切り。空欄なら、薄く表示された自動のキーワードを使います。<b>-言葉</b> と書くと、除外語になります(例: ゲーム, 実況, -ポケカ)。再生画面の「🏷 タグ」のフォルダ候補にも使います。</p>
      <input type="search" id="arq" class="ar-find" placeholder="フォルダ名で絞り込み" autocomplete="off">
      <div class="ar-kws">${TF.flat(S.groups).map(({ g, depth }) => `<label class="ar-kw" data-n="${esc(g.name.toLowerCase())}" style="padding-left:${depth * 16}px"><span><i style="background:${esc(g.color)}"></i>${esc(g.name)}</span><textarea rows="2" data-kw="${esc(g.id)}" placeholder="${esc(TF.defaultKw(g.name).slice(0, 12).join(', ') || 'キーワード')}">${esc((g.kw || []).join(', '))}</textarea></label>`).join('') || '<p class="ar-note">フォルダがありません</p>'}</div>
      <div class="ar-btns"><button type="button" data-a="reset">初期値に戻す</button><button type="button" class="pri" data-a="close">閉じる</button></div></div>`;
    document.body.appendChild(d);
    d.addEventListener('change', e => { const i = e.target.closest('[data-r]'); if (!i) return; const k = i.dataset.r; const v = i.type === 'checkbox' ? i.checked : Math.max(+i.min, Math.min(+i.max, Math.round(+i.value || RULES_DEF[k]))); if (i.type !== 'checkbox') i.value = v; TF.mutate(s => { const r = { ...(s.settings.assistRules || {}) }; if (v === RULES_DEF[k]) delete r[k]; else r[k] = v; s.settings.assistRules = r; }); });
    d.addEventListener('input', e => { if (e.target.id !== 'arq') return; const w = e.target.value.trim().toLowerCase(); d.querySelectorAll('.ar-kw').forEach(l => { l.hidden = !!w && !l.dataset.n.includes(w); }); });
    d.addEventListener('change', e => { const i = e.target.closest('[data-kw]'); if (!i) return; const kw = TF.kwList(i.value); TF.mutate(s => { const g = s.groups.find(x => x.id === i.dataset.kw); if (!g) return; if (kw.length) g.kw = kw; else delete g.kw; }); });
    d.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; if (a.dataset.a === 'reset') { TF.mutate(s => { s.settings.assistRules = {}; }).then(() => { d.close(); openAssistCfg(); }); } else d.close(); });
    d.addEventListener('change', e => { if (e.target.id === 'ar-on') TF.mutate(s => { s.settings.assist = e.target.checked; }); });
    d.addEventListener('close', () => d.remove()); d.showModal();
  }

  // 再生済みの動画(視聴履歴 hist にある動画)は、サムネを薄くして「✓」の印を出す(チャンネルの動画一覧・乗せたときの最新動画)。設定 dimPlayed(既定オン)
  {
    let played = new Set(), on = true, t = 0;
    const mark = () => document.querySelectorAll('a.vcard, #hv a[href*="watch?v="], #hv a[href*="/shorts/"]').forEach(a => { const m = (a.getAttribute('href') || '').match(/[?&]v=([\w-]{11})/) || (a.getAttribute('href') || '').match(/\/shorts\/([\w-]{11})/), p = on && !!m && played.has(m[1]); if (a.classList.contains('played') !== p) a.classList.toggle('played', p); });
    const load = () => chrome.storage.local.get(['hist', 'settings']).then(r => { played = TF.playedSet(r.hist); on = (r.settings || {}).dimPlayed !== false; mark(); }).catch(() => {});
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(mark, 150); }).observe(document.body, { childList: true, subtree: true });
    chrome.storage.onChanged.addListener((ch, a) => { if (a === 'local' && (ch.hist || ch.settings)) load(); });
    load();
  }
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
