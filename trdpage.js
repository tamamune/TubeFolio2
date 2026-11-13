// 急上昇動画(日本・日付別・実験)。上のバーの 🧪 実験メニュー →「📈 急上昇動画」。page.html?p=trd。page.js から trdPage() で呼ばれる。
//   データは background.js の trendDay()(youtube-trending.info の日別ページ。1日あたり最大約200本)。日付を1日ずつさかのぼれる。
//   読み取り専用。動画・チャンネルは、押すと YouTube で開く
function trdPage() {
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
  const WD = '日月火水木金土';
  const label = s => { const d = new Date(s + 'T00:00:00'); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`; };
  let date = today(), vids = [], cat = '', q = '', shown = 60, seq = 0, tried = false;
  main.innerHTML = `<div class="head"><h1>${esc(TITLE)}</h1><span class="sub">日本・1日ごと(データ: youtube-trending.info)</span></div>
    <div class="tr-nav"><button id="tr-prev" title="前の日">◀</button><input type="date" id="tr-date" min="2024-01-01"><button id="tr-next" title="次の日">▶</button><button id="tr-now" title="今日">今日</button>
      <input id="tr-q" type="search" placeholder="タイトル・チャンネルで絞り込み" autocomplete="off"><select id="tr-cat"><option value="">すべてのカテゴリ</option></select><span id="tr-n" class="sub"></span></div>
    <div id="tr-list"><p class="empty">読み込み中…</p></div>`;
  const inp = $('#tr-date'), list = $('#tr-list'), sel = $('#tr-cat');
  inp.max = today();

  function draw() {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = vids.filter(v => (!cat || v.cat === cat) && (!words.length || words.every(w => (v.title + ' ' + v.ch).toLowerCase().includes(w))));
    $('#tr-n').textContent = vids.length ? `${hit.length} / ${vids.length}本` : '';
    if (!hit.length) { list.innerHTML = `<p class="empty">${vids.length ? '該当する動画がありません' : '読み込み中…'}</p>`; return; }
    const chg = c => { c = String(c || ''); const cls = c === 'NEW' ? 'new' : /^\+/.test(c) ? 'up' : /^-/.test(c) ? 'dn' : 'eq'; return `<span class="tr-chg ${cls}">${c === 'NEW' ? 'NEW' : c === '=' ? '＝' : /^\+/.test(c) ? '▲' + c.slice(1) : /^-/.test(c) ? '▼' + c.slice(1) : esc(c)}</span>`; };
    list.innerHTML = `<div class="tr-grid">${hit.slice(0, shown).map(v => `<div class="tr-card${v.rank <= 3 ? ' top' : ''}">
      <a class="tr-th" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_top" title="${esc(v.title)}"><img loading="lazy" src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt=""><span class="tr-rk">#${v.rank}</span>${chg(v.chg)}<span class="tr-len">${esc(v.len)}</span></a>
      <div class="tr-b"><a class="tr-t" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_top">${esc(v.title)}</a>
        <div class="tr-s"><span title="再生回数">👁 ${esc(v.views)}</span>${v.likes ? `<span title="高評価">👍 ${esc(v.likes)}</span>` : ''}${v.comments ? `<span title="コメント">💬 ${esc(v.comments)}</span>` : ''}</div>
        <div class="tr-c">${v.chId ? `<a href="https://www.youtube.com/channel/${esc(v.chId)}" target="_top">${esc(v.ch)}</a>` : esc(v.ch)}<small>${esc(v.cat)}${v.pub ? ' ・ 投稿 ' + esc(v.pub) : ''}</small></div></div></div>`).join('')}</div>
      ${hit.length > shown ? `<button class="tr-more" id="tr-more">もっと見る(残り ${hit.length - shown}本)</button>` : ''}`;
  }
  function fillCats() {
    const cs = [...new Set(vids.map(v => v.cat).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">すべてのカテゴリ</option>' + cs.map(c => `<option value="${esc(c)}"${c === cat ? ' selected' : ''}>${esc(c)}</option>`).join('');
    if (cat && !cs.includes(cat)) cat = '';
  }
  function load(d) {
    date = d; inp.value = d; shown = 60; const my = ++seq; vids = [];
    $('#tr-next').disabled = d >= today();
    list.innerHTML = '<p class="empty">読み込み中…</p>'; $('#tr-n').textContent = '';
    chrome.runtime.sendMessage({ type: 'trendDay', date: d }, r => {
      if (my !== seq) return;
      if (chrome.runtime.lastError || !r || r.error) {
        if (d === today() && !tried) { tried = true; return load(addDays(d, -1)); } // 今日の分が、まだ無いときは、昨日
        list.innerHTML = `<p class="empty">${esc((r && r.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || '読み込めませんでした')}(${esc(label(d))})</p>`; return;
      }
      vids = r.videos || []; fillCats(); draw();
    });
  }
  $('#tr-prev').onclick = () => load(addDays(date, -1));
  $('#tr-next').onclick = () => { if (date < today()) load(addDays(date, 1)); };
  $('#tr-now').onclick = () => { tried = false; load(today()); };
  inp.onchange = () => { if (/^\d{4}-\d{2}-\d{2}$/.test(inp.value)) load(inp.value > today() ? today() : inp.value); };
  $('#tr-q').oninput = e => { q = e.target.value; shown = 60; draw(); };
  sel.onchange = () => { cat = sel.value; shown = 60; draw(); };
  list.addEventListener('click', e => { if (e.target.id === 'tr-more') { shown += 60; draw(); } });
  load(date);
}
