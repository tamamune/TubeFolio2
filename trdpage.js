// 急上昇動画(日本・実験)の2つのページ。上のバーの 🧪 実験メニューから開く。page.js から呼ばれる。
//   trdPage()    p=trd     日付別(youtube-trending.info。1日あたり最大約200本。日付を1日ずつさかのぼれる)。データは background.js の trendDay()
//   trdApiPage() p=trdapi  YouTube Data API v3(chart=mostPopular・日本)。今の急上昇(最大200本)。APIキーが必要(自分で用意。この端末だけに保存)。background.js の trendApi()
//   YouTube の内部のデータ(browse の FEtrending)は、急上昇タブが廃止されたため、取れません(確認済み)
//   どちらも読み取り専用。動画・チャンネルは、押すと YouTube で開く
const TRD_WD = '日月火水木金土';
const trdChg = c => { c = String(c || ''); if (!c) return ''; const cls = c === 'NEW' ? 'new' : /^\+/.test(c) ? 'up' : /^-/.test(c) ? 'dn' : 'eq'; return `<span class="tr-chg ${cls}">${c === 'NEW' ? 'NEW' : c === '=' ? '＝' : /^\+/.test(c) ? '▲' + c.slice(1) : /^-/.test(c) ? '▼' + c.slice(1) : esc(c)}</span>`; };
// 投稿日 → 「2日前」「1 週間前」のような、YouTube のホームと同じ言い方
const trdAgo = ymd => { if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return ''; const d = Math.floor((Date.now() - new Date(ymd + 'T00:00:00').getTime()) / 864e5); if (d < 1) return '今日'; if (d < 7) return d + '日前'; if (d < 30) return Math.floor(d / 7) + ' 週間前'; if (d < 365) return Math.floor(d / 30) + ' か月前'; return Math.floor(d / 365) + ' 年前'; };
// YouTube のホームの見た目: 枠なしのカード・角丸のサムネ・右下に長さ・下にタイトル(2行)・チャンネル名・「〇回視聴 ・ 〇日前」
const trdCard = v => `<div class="tr-card${v.rank <= 3 ? ' top' : ''}">
  <a class="tr-th" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_top" title="${esc(v.title)}"><img loading="lazy" src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt=""><span class="tr-rk">${v.rank}</span>${trdChg(v.chg)}<span class="tr-len">${esc(v.len)}</span></a>
  <div class="tr-b"><a class="tr-t" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_top" title="${esc(v.title)}">${esc(v.title)}</a>
    <div class="tr-c">${v.chId ? `<a href="https://www.youtube.com/channel/${esc(v.chId)}" target="_top">${esc(v.ch)}</a>` : esc(v.ch)}</div>
    <div class="tr-m">${esc(v.views)} 回視聴${v.pub ? ' ・ ' + esc(trdAgo(v.pub)) : ''}</div>
    <div class="tr-m2">${v.likes ? `👍 ${esc(v.likes)}` : ''}${v.comments ? ` 💬 ${esc(v.comments)}` : ''}${v.cat ? ` ・ ${esc(v.cat)}` : ''}</div></div></div>`;
// 一覧(絞り込み・カテゴリ・もっと見る)の共通部分
function trdList(box, nEl, getVids) {
  let cat = '', q = '', shown = 60;
  const sel = $('#tr-cat');
  const draw = () => {
    const vids = getVids(), words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = vids.filter(v => (!cat || v.cat === cat) && (!words.length || words.every(w => (v.title + ' ' + v.ch).toLowerCase().includes(w))));
    nEl.textContent = vids.length ? `${hit.length} / ${vids.length}本` : '';
    if (!hit.length) { box.innerHTML = `<p class="empty">${vids.length ? '該当する動画がありません' : '読み込み中…'}</p>`; return; }
    box.innerHTML = `<div class="tr-grid">${hit.slice(0, shown).map(trdCard).join('')}</div>${hit.length > shown ? `<button class="tr-more" id="tr-more">もっと見る(残り ${hit.length - shown}本)</button>` : ''}`;
  };
  const cats = () => {
    const cs = [...new Set(getVids().map(v => v.cat).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">すべてのカテゴリ</option>' + cs.map(c => `<option value="${esc(c)}"${c === cat ? ' selected' : ''}>${esc(c)}</option>`).join('');
    if (cat && !cs.includes(cat)) cat = '';
  };
  $('#tr-q').oninput = e => { q = e.target.value; shown = 60; draw(); };
  sel.onchange = () => { cat = sel.value; shown = 60; draw(); };
  box.addEventListener('click', e => { if (e.target.id === 'tr-more') { shown += 60; draw(); } });
  return { draw, cats, reset() { shown = 60; } };
}

function trdPage() {
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
  const label = s => { const d = new Date(s + 'T00:00:00'); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${TRD_WD[d.getDay()]})`; };
  let date = today(), vids = [], seq = 0, tried = false;
  main.innerHTML = `<div class="head"><h1>${esc(TITLE)}</h1><span class="sub">日本・1日ごと(データ: youtube-trending.info)</span></div>
    <div class="tr-nav"><button id="tr-prev" title="前の日">◀</button><input type="date" id="tr-date" min="2024-01-01"><button id="tr-next" title="次の日">▶</button><button id="tr-now" title="今日">今日</button>
      <input id="tr-q" type="search" placeholder="タイトル・チャンネルで絞り込み" autocomplete="off"><select id="tr-cat"><option value="">すべてのカテゴリ</option></select><span id="tr-n" class="sub"></span></div>
    <div id="tr-list"><p class="empty">読み込み中…</p></div>`;
  const inp = $('#tr-date'), list = $('#tr-list');
  inp.max = today();
  const L = trdList(list, $('#tr-n'), () => vids);
  function load(d) {
    date = d; inp.value = d; L.reset(); const my = ++seq; vids = [];
    $('#tr-next').disabled = d >= today();
    list.innerHTML = '<p class="empty">読み込み中…</p>'; $('#tr-n').textContent = '';
    chrome.runtime.sendMessage({ type: 'trendDay', date: d }, r => {
      if (my !== seq) return;
      if (chrome.runtime.lastError || !r || r.error) {
        if (d === today() && !tried) { tried = true; return load(addDays(d, -1)); } // 今日の分が、まだ無いときは、昨日
        list.innerHTML = `<p class="empty">${esc((r && r.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || '読み込めませんでした')}(${esc(label(d))})</p>`; return;
      }
      vids = r.videos || []; L.cats(); L.draw();
    });
  }
  $('#tr-prev').onclick = () => load(addDays(date, -1));
  $('#tr-next').onclick = () => { if (date < today()) load(addDays(date, 1)); };
  $('#tr-now').onclick = () => { tried = false; load(today()); };
  inp.onchange = () => { if (/^\d{4}-\d{2}-\d{2}$/.test(inp.value)) load(inp.value > today() ? today() : inp.value); };
  load(date);
}

function trdApiPage() {
  let vids = [], busy = false;
  main.innerHTML = `<div class="head"><h1>${esc(TITLE)}</h1><span class="sub">日本・今の急上昇(YouTube Data API v3 の mostPopular。最大200本)</span></div>
    <div id="tr-key" class="tr-keybox"></div>
    <div class="tr-nav"><button id="tr-reload" title="取り直す">↻ 取り直す</button><input id="tr-q" type="search" placeholder="タイトル・チャンネルで絞り込み" autocomplete="off"><select id="tr-cat"><option value="">すべてのカテゴリ</option></select><span id="tr-n" class="sub"></span><span class="sp"></span><button id="tr-keybtn" title="APIキーを変える・消す">🔑 APIキー</button></div>
    <div id="tr-list"><p class="empty">読み込み中…</p></div>`;
  const list = $('#tr-list'), kb = $('#tr-key');
  const L = trdList(list, $('#tr-n'), () => vids);
  const getKey = () => chrome.storage.local.get('ytApiKey').then(r => String(r.ytApiKey || ''));
  function keyBox(msg) {
    kb.hidden = false;
    kb.innerHTML = `<p>${msg ? `<b class="tr-err">${esc(msg)}</b><br>` : ''}YouTube の公式API(Data API v3)で、今の日本の急上昇を取ります。<b>自分のAPIキー</b>が必要です(無料・1日の上限 10,000 のうち、1回の取得で約4使います)。<br>
      キーの作り方: Google Cloud Console → プロジェクトを作る → 「YouTube Data API v3」を有効にする → 「認証情報」→「APIキー」を作成。キーは、<b>この端末だけ</b>に保存し、Google Drive では共有しません。</p>
      <div class="tr-keyrow"><input id="tr-kin" type="password" placeholder="APIキーを貼り付け" autocomplete="off" spellcheck="false"><button id="tr-ksave">保存して取得</button><button id="tr-kdel">キーを消す</button></div>`;
  }
  async function load() {
    if (busy) return; const key = await getKey();
    if (!key) { vids = []; list.innerHTML = ''; $('#tr-n').textContent = ''; keyBox(''); return; }
    kb.hidden = true; busy = true; list.innerHTML = '<p class="empty">読み込み中…(4回に分けて取得します)</p>'; $('#tr-n').textContent = '';
    chrome.runtime.sendMessage({ type: 'trendApi', key, region: 'JP' }, r => {
      busy = false;
      if (chrome.runtime.lastError || !r || r.error) { vids = []; list.innerHTML = ''; keyBox((r && r.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || '取得できませんでした'); return; }
      vids = r.videos || []; L.reset(); L.cats(); L.draw();
    });
  }
  kb.addEventListener('click', async e => {
    if (e.target.id === 'tr-ksave') { const v = $('#tr-kin').value.trim(); if (!/^[\w-]{20,80}$/.test(v)) { keyBox('APIキーの形が正しくありません(英数字・- _ の20文字以上)'); return; } await chrome.storage.local.set({ ytApiKey: v }); load(); }
    if (e.target.id === 'tr-kdel') { await chrome.storage.local.remove('ytApiKey'); vids = []; keyBox('キーを消しました'); list.innerHTML = ''; $('#tr-n').textContent = ''; }
  });
  $('#tr-reload').onclick = () => load();
  $('#tr-keybtn').onclick = () => { if (kb.hidden) keyBox(''); else kb.hidden = true; };
  kb.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'tr-kin') $('#tr-ksave').click(); });
  load();
}
