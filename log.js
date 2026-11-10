// 動作ログの閲覧
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SRC = { bg: ['🖥', 'バックグラウンド'], yt: ['▶', 'YouTubeのタブ'], page: ['📄', '拡張機能の画面'] };
  let all = [], level = 'all', cat = '', shown = 300;
  const p2 = n => String(n).padStart(2, '0');
  const time = t => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
  const day = t => { const d = new Date(t); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${'日月火水木金土'[d.getDay()]}）`; };

  function filtered() {
    const q = $('#q').value.trim().toLowerCase();
    return all.filter(x => (level === 'all' || x.l !== 'info') && (!cat || x.c === cat) && (!q || (x.m + x.c).toLowerCase().includes(q)));
  }
  function render() {
    const counts = {};
    all.forEach(x => { counts[x.c] = (counts[x.c] || 0) + 1; });
    $('#cats').innerHTML = `<span class="chip ${cat ? '' : 'on'}" data-c="">すべて<small>${all.length}</small></span>` +
      Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<span class="chip ${cat === c ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}<small>${n}</small></span>`).join('');
    const list = filtered();
    const errs = all.filter(x => x.l === 'error').length, warns = all.filter(x => x.l === 'warn').length;
    $('#sum').textContent = `${all.length}件${errs ? `・エラー ${errs}` : ''}${warns ? `・注意 ${warns}` : ''}`;
    let h = '', lastDay = '';
    for (const x of list.slice(0, shown)) {
      const d = day(x.t);
      if (d !== lastDay) { h += `<div class="day">${d}</div>`; lastDay = d; }
      const s = SRC[x.s] || ['', ''];
      h += `<div class="row ${x.l}"><span class="t">${time(x.t)}</span><span title="${s[1]}">${s[0]}</span><span class="c" title="${esc(x.c)}">${esc(x.c)}</span><span class="m">${esc(x.m)}</span></div>`;
    }
    $('#log').innerHTML = h;
    $('#empty').hidden = list.length > 0;
    $('#more').hidden = list.length <= shown;
  }
  async function load() {
    const { tgLog = [] } = await chrome.storage.local.get('tgLog');
    all = tgLog.slice().reverse();
    render();
  }
  $('#cats').addEventListener('click', e => { const c = e.target.closest('[data-c]'); if (!c) return; cat = c.dataset.c; shown = 300; render(); });
  $('#lv').addEventListener('click', e => {
    const b = e.target.closest('[data-l]'); if (!b) return;
    level = b.dataset.l; $('#lv').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); render();
  });
  let qT; $('#q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(render, 200); });
  $('#more').addEventListener('click', () => { shown += 300; render(); });
  $('#clear').addEventListener('click', async () => { if (confirm('動作ログをすべて消去しますか？')) { await chrome.storage.local.set({ tgLog: [] }); load(); } });
  $('#copy').addEventListener('click', async () => {
    const txt = filtered().map(x => `${new Date(x.t).toLocaleString('ja-JP')}\t${x.s}\t${x.l}\t${x.c}\t${x.m}`).join('\n');
    await navigator.clipboard.writeText(txt);
    $('#copy').textContent = 'コピーしました'; setTimeout(() => { $('#copy').textContent = 'テキストでコピー'; }, 1500);
  });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.tgLog) { all = (ch.tgLog.newValue || []).slice().reverse(); render(); } });
  load();
})();
