// ブックマークページ(ツールバーの「ブックマーク」)。page.js から bmPage() で呼ばれる。
//  再生画面で B キーを押すと登録される(storage の bookmarks。Drive同期の対象)。サムネは、押した瞬間のコマ。
function bmPage() {
  const main = document.querySelector('main');
  const E = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clock = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  const when = t => { const d = new Date(t); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  let list = [], q = '', editing = null;
  main.innerHTML = `<div class="head"><h1>ブックマーク</h1><span class="sub">再生画面で B キーを押すと、その場面を登録します</span><span class="sp"></span><span id="st"></span></div>
    <form class="rform" onsubmit="return false"><input id="bq" type="search" placeholder="メモ・タイトル・チャンネルで絞り込み" autocomplete="off"></form><div id="bl"></div>`;
  const box = main.querySelector('#bl'), st = main.querySelector('#st');
  const save = () => chrome.storage.local.set({ bookmarks: list });
  // 保存の形(bookmark-key.js): t = 動画のタイトル、sec = 秒。古い形(title / t = 秒)も読めるようにする
  const titleOf = b => String(b.title || (typeof b.t === 'string' ? b.t : '') || '');
  const secOf = b => { const s = Number.isFinite(+b.sec) && b.sec !== undefined ? +b.sec : typeof b.t === 'number' ? b.t : 0; return Number.isFinite(s) ? s : 0; };
  const shots = {}; // B キーを押した瞬間のコマ(storage の bmt:<id>。この端末だけ)
  const draw = () => {
    // 絞り込み: スペース区切りは「すべて含む」、「|」区切りは「どれかを含む」(検索ページと同じ)
    const ors = q.toLowerCase().split('|').map(s => s.split(/\s+/).filter(Boolean)).filter(w => w.length);
    const vis = list.filter(b => { const s = [b.note, titleOf(b), b.ch].filter(Boolean).join(' ').toLowerCase(); return !ors.length || ors.some(w => w.every(k => s.includes(k))); });
    st.textContent = `${vis.length}件${vis.length !== list.length ? ' / 全' + list.length + '件' : ''}`;
    if (!vis.length) { box.innerHTML = `<p class="empty">${list.length ? '見つかりませんでした' : '動画の再生中に B キーを押すと、ここに登録されます'}</p>`; return; }
    box.innerHTML = '<div class="grid bmg">' + vis.map(b => `<div class="card bmc" data-id="${E(b.id)}">
      <a class="th" href="https://www.youtube.com/watch?v=${E(b.v)}&t=${secOf(b)}s" target="_top" title="${E(titleOf(b))}"><img loading="lazy" src="${E(shots[b.id] || b.thumb || 'https://i.ytimg.com/vi/' + b.v + '/mqdefault.jpg')}"><span class="tm">${clock(secOf(b))}</span></a>
      <div class="inf"><div class="tx">${editing === b.id ? `<input class="bnote" maxlength="200" value="${E(b.note || '')}" placeholder="一言メモ">` : `<b class="bn${b.note ? '' : ' none'}">${E(b.note || '(メモなし)')}</b>`}<small>${E(titleOf(b))}</small><small>${E(b.ch)} ・ ${when(b.at)}</small></div>
      <span class="bact"><button data-a="edit" title="メモを編集">✎</button><button data-a="del" title="削除">🗑</button></span></div></div>`).join('') + '</div>';
    const inp = box.querySelector('.bnote'); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  };
  main.querySelector('#bq').addEventListener('input', e => { q = e.target.value; draw(); });
  box.addEventListener('click', e => {
    const c = e.target.closest('.bmc'), a = e.target.closest('[data-a]'); if (!c || !a) return;
    const b = list.find(x => x.id === c.dataset.id); if (!b) return;
    if (a.dataset.a === 'del') { if (confirm('このブックマークを削除しますか?')) { list = list.filter(x => x !== b); save(); draw(); } }
    else { editing = b.id; draw(); }
  });
  box.addEventListener('keydown', e => {
    if (!e.target.classList.contains('bnote')) return;
    const b = list.find(x => x.id === e.target.closest('.bmc').dataset.id);
    if (e.key === 'Enter' && !e.isComposing) { b.note = e.target.value.trim(); editing = null; save(); draw(); } else if (e.key === 'Escape') { editing = null; draw(); }
  });
  box.addEventListener('focusout', e => { if (e.target.classList && e.target.classList.contains('bnote') && editing) { const b = list.find(x => x.id === e.target.closest('.bmc').dataset.id); if (b) { b.note = e.target.value.trim(); save(); } editing = null; draw(); } });
  const load = () => chrome.storage.local.get('bookmarks').then(async r => {
    if (editing) return; list = r.bookmarks || [];
    const need = list.filter(b => b.id && !(b.id in shots)).map(b => 'bmt:' + b.id);
    if (need.length) { try { const s = await chrome.storage.local.get(need); list.forEach(b => { if (b.id && !(b.id in shots)) shots[b.id] = s['bmt:' + b.id] || ''; }); } catch (e) { /* 無し */ } }
    draw();
  });
  chrome.storage.onChanged.addListener((ch, a) => { if (a === 'local' && ch.bookmarks) load(); });
  load();
}
