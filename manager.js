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
  function drawStats() {
    const list = inView(), done = list.filter(c => act[c.key]), todo = list.length - done.length;
    const rows = !statsOpen ? '' : TYPES.map(([f, label]) => {
      const cnt = Object.fromEntries(BK.map(b => [b[0], 0]));
      done.forEach(c => cnt[bucketOf(act[c.key][f])]++);
      const n = done.length || 1;
      return `<div class="sr"><div class="sl">${label}</div>
        <div class="bar">${BK.map(b => cnt[b[0]] ? `<i style="width:${cnt[b[0]] / n * 100}%;background:${b[3]}" title="${b[1]} ${cnt[b[0]]}件"></i>` : '').join('')}</div>
        <div class="lg">${BK.map(b => `<button class="${actFilter && actFilter.f === f && actFilter.b === b[0] ? 'on' : ''}" data-f="${f}" data-b="${b[0]}" title="${b[1]} ${cnt[b[0]]}件" ${cnt[b[0]] ? '' : 'disabled'}>
          <i style="background:${b[3]}"></i>${b[1]} <b>${(cnt[b[0]] / n * 100).toFixed(cnt[b[0]] && cnt[b[0]] / n < .1 ? 1 : 0)}%</b></button>`).join('')}</div></div>`;
    }).join('');
    $('#stats').innerHTML = `<div class="sh"><button class="tg" id="tgl" title="開閉">${statsOpen ? '▾' : '▸'}</button><b>📊 投稿の新しさ</b>
      <span>${done.length}/${list.length} チャンネル集計済み${actFilter ? ' ・ <a href="#" id="clrf">絞り込み解除</a>' : ''}</span>
      <span class="sp"></span><span class="prog">${esc(prog)}</span>
      <button class="btn" id="scanBtn">${scanning ? '■ 中止' : todo ? `⟳ 未集計 ${todo}件を集計` : '⟳ 再集計'}</button></div>${rows}`;
  }
  $('#stats').addEventListener('click', e => {
    if (e.target.closest('#tgl') || (e.target.closest('.sh') && !e.target.closest('button, a'))) { statsOpen = !statsOpen; localStorage.setItem('tfStats', statsOpen ? '1' : '0'); return drawStats(); }
    if (e.target.closest('#scanBtn')) return scanning ? (stopScan = true) : runScan();
    if (e.target.closest('#clrf')) { e.preventDefault(); actFilter = null; return drawGrid(); }
    const b = e.target.closest('.lg button'); if (!b) return;
    const same = actFilter && actFilter.f === b.dataset.f && actFilter.b === b.dataset.b;
    actFilter = same ? null : { f: b.dataset.f, b: b.dataset.b }; drawGrid();
  });
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
    return l.sort($('#sort').value === 'name' ? byName : (a, b) => b.addedAt - a.addedAt);
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
        <span class="cv${kids.length || direct.length ? '' : ' none'}">${isOpen ? '▾' : '▸'}</span><span class="ic">${esc(g.icon)}</span>
        <span class="nm">${esc(g.name)}</span><span class="n">${total}</span><span class="sub" title="サブフォルダを作成">＋</span><span class="ed" title="編集">✎</span></div>` +
        (isOpen ? treeHtml(g.id, depth + 1) + direct.map(c => `<div class="tc" data-k="${esc(c.key)}" data-from="${g.id}" draggable="true" style="--d:${depth + 1}">${avHtml(c, 'av mini')}<span class="nm">${esc(nameOf(c))}</span></div>`).join('') : '');
    }).join('');
  }
  function drawNav() {
    const nv = (id, ic, nm, n) => `<div class="tn${view === id ? ' act' : ''}" data-g="${id}" data-fixed="1" style="--d:0"><span class="cv none">▸</span><span class="ic">${ic}</span><span class="nm">${nm}</span><span class="n">${n}</span></div>`;
    $('#nav').innerHTML = nv('all', '🗂️', 'すべて', chans().length) + nv('none', '📥', '未分類', chans().filter(c => !filed(c).length).length) + treeHtml(null, 0);
    observeAvatars($('#nav'));
  }

  function drawGrid() {
    const l = visible();
    const g = grp(view);
    $('#ttl').textContent = view === 'all' ? 'すべてのチャンネル' : view === 'none' ? '未分類' : (g.icon + ' ' + g.name);
    $('#sub').textContent = `${l.length} チャンネル` + (g ? ' ・ サブフォルダ内も含む' : '');
    $('#empty').hidden = l.length > 0;
    if (!l.length) $('#empty').innerHTML = chans().length ? '該当するチャンネルがありません' :
      'まだチャンネルがありません。<br>右上の「YouTubeから取り込む」で登録チャンネルを読み込みましょう。';
    $('#grid').innerHTML = l.map(c => `<div class="card${sel.has(c.key) ? ' sel' : ''}" draggable="true" data-k="${esc(c.key)}">
      <input type="checkbox" class="chk" ${sel.has(c.key) ? 'checked' : ''}>
      ${avHtml(c)}
      <div class="info"><a href="${esc(chUrl(c.key))}" target="_blank">${esc(nameOf(c))}</a>
        <small>${esc(c.key)}</small>
        <div class="acts">${act[c.key] ? TYPES.map(([f, lb]) => `<span style="--c:${BK.find(b => b[0] === bucketOf(act[c.key][f]))[3]}">${lb.slice(0, 2)} ${agoText(act[c.key][f])}</span>`).join('') : ''}</div>
        <div class="tags">${filed(c).map(id => { const x = grp(id); return `<span class="tag" style="--c:${x.color}">${esc(x.icon)} ${esc(x.name)}</span>`; }).join('')}</div></div></div>`).join('');
    observeAvatars($('#grid'));
    drawBulk(); drawStats();
  }
  function drawBulk() {
    $('#bulk').hidden = !sel.size;
    $('#bcnt').textContent = `${sel.size}件選択中`;
    $('#bgroups').innerHTML = TF.flat(S.groups).map(({ g, depth }) => `<button data-g="${g.id}" style="--c:${g.color}">${depth ? '↳ ' : ''}${esc(g.icon)} ${esc(g.name)} に追加</button>`).join('') +
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

  // ---- イベント: ツリー ----
  $('#nav').addEventListener('click', e => {
    const tc = e.target.closest('.tc');
    if (tc) return void window.open(chUrl(tc.dataset.k), '_blank');
    const tn = e.target.closest('.tn'); if (!tn) return;
    const id = tn.dataset.g;
    if (e.target.closest('.ed')) return openDlg(id);
    if (e.target.closest('.sub')) { open.add(id); saveOpen(); return openDlg('new', id); }
    if (e.target.closest('.cv') && !tn.dataset.fixed) { open.has(id) ? open.delete(id) : open.add(id); saveOpen(); return drawNav(); }
    view = id; sel.clear(); if (grp(id)) { open.add(id); saveOpen(); } draw();
  });
  $('#nav').addEventListener('dragstart', e => {
    const tc = e.target.closest('.tc'), tn = e.target.closest('.tn');
    const p = tc ? { t: 'ch', keys: [tc.dataset.k], from: tc.dataset.from } : tn && !tn.dataset.fixed ? { t: 'g', id: tn.dataset.g } : null;
    if (!p) return e.preventDefault();
    e.dataTransfer.setData('text/plain', JSON.stringify(p));
  });
  $('#nav').addEventListener('dragover', e => { const tn = e.target.closest('.tn'); if (tn) { e.preventDefault(); tn.classList.add('drop'); } });
  $('#nav').addEventListener('dragleave', e => { const tn = e.target.closest('.tn'); if (tn) tn.classList.remove('drop'); });
  $('#nav').addEventListener('drop', e => {
    const tn = e.target.closest('.tn'); if (!tn) return;
    e.preventDefault(); tn.classList.remove('drop');
    let p; try { p = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (x) { return; }
    const id = tn.dataset.g;
    if (p.t === 'ch') { if (grp(id)) addTo(p.keys, id, p.from); }
    else if (p.t === 'g') {
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
  $('#q').oninput = drawGrid; $('#sort').onchange = drawGrid;

  // ---- ホバー: 最新動画2件 ----
  const hv = $('#hv'); let hvK = null, hvT = 0; const infoCache = new Map();
  const ago = iso => {
    const m = (Date.now() - new Date(iso)) / 60000;
    return m < 60 ? `${Math.max(1, m | 0)}分前` : m < 1440 ? `${(m / 60) | 0}時間前` : m < 43200 ? `${(m / 1440) | 0}日前` : `${(m / 43200) | 0}か月前`;
  };
  function hvShow(elm, k) {
    const c = S.channels[k]; if (!c) return;
    const r = elm.getBoundingClientRect();
    hv.innerHTML = `<div class="hv-h">${avHtml(c, 'av mini')}<b>${esc(nameOf(c))}</b></div><div class="hv-b" id="hvb"><div class="hv-load">最新の動画を読み込み中…</div></div>`;
    hv.hidden = false;
    const w = 340; let x = r.right + 10; if (x + w > innerWidth) x = Math.max(8, r.left - w - 10);
    hv.style.left = x + 'px'; hv.style.top = Math.max(8, Math.min(r.top, innerHeight - 240)) + 'px';
    const render = d => {
      if (hvK !== k) return;
      const b = $('#hvb'); if (!b) return;
      b.innerHTML = d && d.videos && d.videos.length ? d.videos.map(v => `<a class="hv-v" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank">
        <img src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt=""><span><b>${esc(v.title)}</b><small>${ago(v.published)}</small></span></a>`).join('')
        : '<div class="hv-load">動画を取得できませんでした</div>';
    };
    if (infoCache.has(k)) return render(infoCache.get(k));
    chrome.runtime.sendMessage({ type: 'chInfo', key: k }, d => { if (d && !d.error) infoCache.set(k, d); render(d); });
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
    $('#icons').innerHTML = TF.ICONS.map(i => `<button type="button" data-i="${i}" class="${edit.icon === i ? 'act' : ''}">${i}</button>`).join('');
    $('#colors').innerHTML = TF.PALETTE.map(c => `<button type="button" data-c="${c}" class="${edit.color === c ? 'act' : ''}" style="background:${c}"></button>`).join('');
  }
  $('#icons').onclick = e => { const b = e.target.closest('button'); if (b) { edit.icon = b.dataset.i; drawPickers(); } };
  $('#colors').onclick = e => { const b = e.target.closest('button'); if (b) { edit.color = b.dataset.c; drawPickers(); } };
  function openDlg(id, parent) {
    const g = id && id !== 'new' ? grp(id) : null;
    edit = { id: g ? g.id : null, icon: g ? g.icon : TF.ICONS[0], color: g ? g.color : TF.PALETTE[S.groups.length % TF.PALETTE.length] };
    $('#dtitle').textContent = g ? 'フォルダを編集' : 'フォルダを作成';
    $('#gname').value = g ? g.name : '';
    const bad = g ? TF.subtree(S.groups, g.id) : new Set();
    const cur = g ? (g.parent || '') : (parent || '');
    $('#gparent').innerHTML = '<option value="">（なし：最上位）</option>' + TF.flat(S.groups).filter(x => !bad.has(x.g.id))
      .map(({ g: x, depth }) => `<option value="${x.id}" ${cur === x.id ? 'selected' : ''}>${'　'.repeat(depth)}${esc(x.icon)} ${esc(x.name)}</option>`).join('');
    $('#gdel').style.visibility = g && S.groups.length > 1 ? 'visible' : 'hidden';
    drawPickers(); $('#dlg').showModal();
  }
  $('#addGroup').onclick = () => openDlg('new');
  $('#gcancel').onclick = () => $('#dlg').close();
  $('#gform').onsubmit = () => {
    const name = $('#gname').value.trim(); if (!name) return;
    const parent = $('#gparent').value || null;
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

  // ---- バックアップ ----
  $('#exp').onclick = async () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([await TF.exportJson()], { type: 'application/json' }));
    a.download = 'tubefolio2-backup.json'; a.click(); toast('バックアップを書き出しました');
  };
  $('#imp').onclick = () => $('#file').click();
  $('#file').onchange = async e => {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(d.groups) || typeof d.channels !== 'object') throw 0;
      if (!confirm('現在のデータを置き換えて復元しますか?')) return;
      await TF.mutate(s => { s.groups = d.groups; s.channels = d.channels; });
      toast('復元しました');
    } catch (err) { toast('ファイルを読み込めませんでした'); }
    e.target.value = '';
  };

  (async function init() {
    S = await TF.get();
    const st = await chrome.storage.local.get(['meta', 'activity']); meta = st.meta || {}; act = st.activity || {};
    draw();
    chrome.storage.onChanged.addListener(async ch => {
      if (!(ch.groups || ch.channels || ch.settings)) return; // meta更新では再描画しない
      S = await TF.get();
      if (view !== 'all' && view !== 'none' && !grp(view)) view = 'all';
      draw();
    });
  })();
})();
