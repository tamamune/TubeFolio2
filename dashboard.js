(() => {
  const $ = s => document.querySelector(s);
  const esc = TF.esc, fmt = TF.fmtDur;
  let S = null, tab = 'history', shown = 300;

  const DAY = 86400000;
  function inRange() {
    const d = +$('#range').value;
    const since = d ? Date.now() - d * DAY : 0;
    return S.history.filter(h => h.at >= since);
  }
  const link = id => `https://www.youtube.com/watch?v=${id}`;

  function applyFeatureTabs() {
    const f = S.settings.features;
    document.querySelector('[data-tab=history]').hidden = !f.history;
    document.querySelector('[data-tab=analytics]').hidden = !f.analytics;
    if (tab === 'history' && !f.history && f.analytics) tab = 'analytics';
    if (tab === 'analytics' && !f.analytics && f.history) tab = 'history';
    document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    $('#history').hidden = tab !== 'history' || !f.history;
    $('#analytics').hidden = tab !== 'analytics' || !f.analytics;
  }

  /* ----- 履歴 ----- */
  function renderHistory() {
    const q = $('#hq').value.trim().toLowerCase();
    const rows = inRange()
      .filter(h => !q || ((h.title || '') + ' ' + (h.channel || '')).toLowerCase().includes(q))
      .sort((a, b) => b.at - a.at);
    if (!rows.length) { $('#hlist').innerHTML = '<div class="sub">履歴がありません。YouTubeで動画を5秒以上視聴すると記録されます。</div>'; return; }
    let html = '', last = '';
    rows.slice(0, shown).forEach(h => {
      const d = new Date(h.at);
      const day = d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
      if (day !== last) { html += `<div class="day">${day}</div>`; last = day; }
      const pct = h.dur ? Math.min(100, Math.round((h.pos / h.dur) * 100)) : 0;
      html += `<div class="hi">
        <span class="star" title="${S.favorites[h.id] ? 'お気に入り' : ''}">${S.favorites[h.id] ? '★' : ''}</span>
        <a href="${link(h.id)}" target="_blank"><img loading="lazy" src="https://i.ytimg.com/vi/${esc(h.id)}/mqdefault.jpg"></a>
        <div class="m"><a class="t" href="${link(h.id)}" target="_blank">${esc(h.title || h.id)}</a>
          <div class="sub">${esc(h.channel)} ・ ${d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} ・ 視聴 ${fmt(h.sec)}${h.dur ? ' / ' + fmt(h.dur) : ''}</div>
          <div class="prog"><i style="width:${pct}%"></i></div></div>
        <button class="btn" data-del="${h.sid}" title="この履歴を削除">✕</button></div>`;
    });
    if (rows.length > shown) html += `<div style="text-align:center;margin-top:12px"><button class="btn" id="more">さらに表示 (${rows.length - shown}件)</button></div>`;
    $('#hlist').innerHTML = html;
  }

  /* ----- 分析 ----- */
  function bars(el, items) {
    const max = Math.max(1, ...items.map(i => i.v));
    el.innerHTML = items.map(i => `<div class="c" title="${esc(i.t)}"><div class="b" style="height:${(i.v / max) * 100}%"></div><div class="l">${esc(i.l)}</div></div>`).join('');
  }
  function hbars(el, items, fmtV) {
    if (!items.length) { el.innerHTML = '<div class="sub">データなし</div>'; return; }
    const max = Math.max(1, ...items.map(i => i.v));
    el.innerHTML = items.map(i => `<div class="hbar"><span class="n" title="${esc(i.n)}">${esc(i.n)}</span><span class="t"><i style="width:${(i.v / max) * 100}%"></i></span><span class="v">${fmtV(i.v)}</span></div>`).join('');
  }
  const agg = (rows, keyFn, nameFn) => {
    const m = new Map();
    rows.forEach(h => {
      const k = keyFn(h); if (!k) return;
      const o = m.get(k) || { n: nameFn(h), v: 0 };
      o.v += h.sec; if (nameFn(h)) o.n = nameFn(h); m.set(k, o);
    });
    return [...m.values()].sort((a, b) => b.v - a.v).slice(0, 10);
  };

  function renderAnalytics() {
    const rows = inRange();
    const total = rows.reduce((a, h) => a + h.sec, 0);
    const vids = new Set(rows.map(h => h.id));
    const chans = new Set(rows.map(h => h.channel).filter(Boolean));
    const days = new Set(rows.map(h => new Date(h.at).toDateString())).size || 1;
    const favWatched = [...vids].filter(id => S.favorites[id]).length;
    const favRate = vids.size ? Math.round((favWatched / vids.size) * 100) : 0;
    const kp = [
      [fmt(total), '総視聴時間'], [rows.length, '視聴回数'], [vids.size, '視聴した動画数'], [chans.size, 'チャンネル数'],
      [fmt(total / days), '視聴した日の平均/日'], [favRate + '%', 'お気に入り動画の視聴率']
    ];
    $('#kpis').innerHTML = kp.map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join('');

    const rangeDays = +$('#range').value || 30;
    const nDays = Math.min(rangeDays, 60);
    const dayMap = new Map();
    rows.forEach(h => { const k = new Date(h.at).toDateString(); dayMap.set(k, (dayMap.get(k) || 0) + h.sec); });
    const dayItems = [];
    for (let i = nDays - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * DAY);
      const v = (dayMap.get(d.toDateString()) || 0) / 60;
      dayItems.push({ v, l: nDays <= 31 || i % 5 === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : '', t: `${d.getMonth() + 1}/${d.getDate()}: ${Math.round(v)}分` });
    }
    bars($('#byDay'), dayItems);

    const hr = Array(24).fill(0), wk = Array(7).fill(0);
    rows.forEach(h => { const d = new Date(h.at); hr[d.getHours()] += h.sec; wk[d.getDay()] += h.sec; });
    bars($('#byHour'), hr.map((v, i) => ({ v: v / 60, l: i % 3 === 0 ? i : '', t: `${i}時台: ${Math.round(v / 60)}分` })));
    const wn = ['日', '月', '火', '水', '木', '金', '土'];
    bars($('#byWeek'), wk.map((v, i) => ({ v: v / 60, l: wn[i], t: `${wn[i]}曜: ${Math.round(v / 60)}分` })));

    hbars($('#topCh'), agg(rows, h => h.channel, h => h.channel), fmt);
    hbars($('#topVid'), agg(rows, h => h.id, h => h.title || h.id), fmt);

    const favs = Object.values(S.favorites);
    hbars($('#byGroup'), S.groups.map(g => ({ n: g.name, v: favs.filter(f => f.groups.includes(g.id)).length })).filter(i => i.v), v => v + '本');
  }

  function render() {
    applyFeatureTabs();
    if (tab === 'history') renderHistory(); else renderAnalytics();
  }
  async function init() { S = await TF.get(); render(); }

  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
  $('#openOpts').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#range').addEventListener('change', render);
  $('#hq').addEventListener('input', () => { shown = 300; render(); });
  $('#hlist').addEventListener('click', e => {
    if (e.target.id === 'more') { shown += 300; render(); }
    const d = e.target.dataset.del; if (d) TF.deleteHistory(d);
  });
  $('#clear').addEventListener('click', () => { if (confirm('視聴履歴をすべて削除します。元に戻せません。よろしいですか?')) TF.clearHistory(); });
  $('#export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S.history, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `tubefolio2-history-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  });
  chrome.storage.onChanged.addListener(init);
  init();
})();
