// 視聴履歴ダッシュボード(試作・上のバーの「🧪 履歴」。page.html?p=histd)。page.js から histDash() で呼ばれる。
//   データは、視聴履歴(histpage.js と同じ storage の hist)。読み取り専用(削除・書き出しは、従来の「視聴履歴」ページで)
//   構成: あいさつ / 合計・グラデーションの大きなカード・カレンダー / 小さな数字のカード・曜日×時間帯のヒートマップ / 最近見た動画・よく見たチャンネル
function histDash() {
  const DAY = 86400, WD = '日月火水木金土';
  const hm = sec => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60); return h ? `${h}時間${m ? m + '分' : ''}` : sec < 60 ? `${sec}秒` : `${m}分`; };
  const dkey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const day0 = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  let H = { v: {}, p: [] }, days = 30, calM = day0(new Date()); calM.setDate(1);
  try { days = +localStorage.getItem('tfHdDays') || 30; } catch (e) { /* なし */ }
  main.innerHTML = '<div id="hd"></div>';
  const box = $('#hd');

  const inRange = () => { const cut = Math.floor(day0(new Date()).getTime() / 1000) - (days - 1) * DAY; return H.p.filter(x => x[0] >= cut); };
  const sum = a => a.reduce((s, x) => s + (x[2] || 0), 0);

  function draw() {
    const P = inRange(), total = sum(P), now = new Date(), t0 = Math.floor(day0(now).getTime() / 1000);
    const byDay = new Map(); H.p.forEach(x => { const k = dkey(new Date(x[0] * 1000)); byDay.set(k, (byDay.get(k) || 0) + (x[2] || 0)); });
    // 今週(直近7日)と、その前の7日
    const wk = H.p.filter(x => x[0] >= t0 - 6 * DAY), pw = H.p.filter(x => x[0] >= t0 - 13 * DAY && x[0] < t0 - 6 * DAY);
    const wkS = sum(wk), pwS = sum(pw), diff = pwS ? Math.round((wkS - pwS) / pwS * 100) : null;
    const today = sum(H.p.filter(x => x[0] >= t0));
    // 連続視聴日数(今日まだ見ていなければ、昨日から数える)
    let streak = 0; { const d = new Date(now); if (!byDay.get(dkey(d))) d.setDate(d.getDate() - 1); while (byDay.get(dkey(d))) { streak++; d.setDate(d.getDate() - 1); } }
    const vids = new Set(P.map(x => x[1])), shortSec = P.reduce((s, x) => s + ((H.v[x[1]] || [])[4] ? x[2] : 0), 0);
    // 直近14日の小さな棒
    const spark = []; for (let i = 13; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); spark.push(byDay.get(dkey(d)) || 0); }
    const smax = Math.max(60, ...spark);
    // 曜日 × 時間帯(6区分)のヒートマップ
    const BL = [['0-4', 0, 4], ['4-8', 4, 8], ['8-12', 8, 12], ['12-16', 12, 16], ['16-20', 16, 20], ['20-24', 20, 24]];
    const hv = Array.from({ length: 7 }, () => new Array(6).fill(0));
    P.forEach(x => { const d = new Date(x[0] * 1000), b = Math.min(5, Math.floor(d.getHours() / 4)); hv[d.getDay()][b] += x[2] || 0; });
    const hmax = Math.max(1, ...hv.flat()), lv = v => (v <= 0 ? 0 : Math.min(4, 1 + Math.floor(v / hmax * 3.999)));
    const LVN = ['なし', '少なめ', 'ふつう', '多め', 'いちばん多い'];
    // チャンネル(上位5)
    const chs = new Map(); P.forEach(x => { const m = H.v[x[1]] || [], nm = m[1] || '(チャンネル不明)', c = chs.get(nm) || { name: nm, val: 0, n: 0 }; c.val += x[2] || 0; c.n++; chs.set(nm, c); });
    const top = [...chs.values()].sort((a, b) => b.val - a.val).slice(0, 5), tmax = Math.max(1, ...top.map(c => c.val));
    const topCh = (() => { const m = new Map(); wk.forEach(x => { const n = (H.v[x[1]] || [])[1]; if (n) m.set(n, (m.get(n) || 0) + x[2]); }); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]; })();
    // 最近見た動画(重複なし)
    const seen = new Set(), recent = []; for (let i = H.p.length - 1; i >= 0 && recent.length < 6; i--) { const x = H.p[i]; if (seen.has(x[1])) continue; seen.add(x[1]); recent.push(x); }
    // カレンダー
    const y = calM.getFullYear(), mo = calM.getMonth(), first = new Date(y, mo, 1), last = new Date(y, mo + 1, 0);
    const mvals = []; for (let d = 1; d <= last.getDate(); d++) mvals.push(byDay.get(dkey(new Date(y, mo, d))) || 0);
    const cmax = Math.max(1, ...mvals), cl = v => (v <= 0 ? 0 : Math.min(4, 1 + Math.floor(v / cmax * 3.999)));
    let cal = ''; for (let i = 0; i < first.getDay(); i++) cal += '<i class="e"></i>';
    for (let d = 1; d <= last.getDate(); d++) { const v = mvals[d - 1], isT = y === now.getFullYear() && mo === now.getMonth() && d === now.getDate(); cal += `<b class="l${cl(v)}${isT ? ' today' : ''}" title="${mo + 1}月${d}日 ・ ${v ? hm(v) : '見ていない'}">${d}</b>`; }
    const monthS = mvals.reduce((a, b) => a + b, 0);
    const empty = !H.p.length;
    const periodLabel = days === 365 ? '1年' : days + '日';
    box.innerHTML = `
      <div class="hd-top"><div><h1>こんにちは。今日は何を見る?</h1><p>今日 <b>${hm(today)}</b> ・ 連続 <b>${streak}日</b> ・ 記録 ${H.p.length}回</p></div>
        <span class="hd-seg">${[[7, '7日'], [30, '30日'], [90, '90日'], [365, '1年']].map(([n, l]) => `<button data-d="${n}" class="${days === n ? 'on' : ''}">${l}</button>`).join('')}</span></div>
      ${empty ? '<p class="hd-empty">まだ視聴履歴がありません。動画を5秒以上再生すると、ここに記録されます。<br>画面を試すには、「視聴履歴」の「🗂 履歴の管理」から「テストデータを作成」を使ってください。</p>' : ''}
      <div class="hd-grid">
        <section class="hd-card hd-a"><h2>⏱ 合計の視聴時間</h2><div class="hd-big">${hm(total)}</div><small>直近${periodLabel}</small>
          <div class="hd-spark" title="直近14日">${spark.map((v, i) => `<i style="height:${Math.max(6, Math.round(v / smax * 100))}%" class="${i === 13 ? 'now' : ''}" title="${v ? hm(v) : '—'}"></i>`).join('')}</div></section>
        <section class="hd-card hd-hero"><div class="hd-blob"></div><div class="hd-hero-t"><small>この7日間</small><b>${hm(wkS)}</b>
          <span>${diff === null ? '先週の記録はありません' : `先週より ${diff >= 0 ? '+' : ''}${diff}%`}${topCh ? ` ・ いちばん見たのは「${esc(topCh[0])}」` : ''}</span></div></section>
        <section class="hd-card hd-cal"><div class="hd-calh"><button data-m="-1" title="前の月">‹</button><b>${y}年${mo + 1}月</b><button data-m="1" title="次の月">›</button></div>
          <div class="hd-wd">${[...WD].map(c => `<span>${c}</span>`).join('')}</div><div class="hd-days">${cal}</div><small class="hd-cs">この月 ${hm(monthS)}</small></section>
        <section class="hd-card hd-s"><h2>🎬 見た動画</h2><div class="hd-n">${vids.size}<small>本</small></div><span>再生 ${P.length}回</span></section>
        <section class="hd-card hd-s"><h2>📅 1日の平均</h2><div class="hd-n">${hm(total / Math.max(1, days))}</div><span>見た日 ${new Set(P.map(x => dkey(new Date(x[0] * 1000)))).size}日</span></section>
        <section class="hd-card hd-s"><h2>🩳 ショート</h2><div class="hd-n">${total ? Math.round(shortSec / total * 100) : 0}<small>%</small></div><span>${hm(shortSec)}</span></section>
        <section class="hd-card hd-heat"><h2>🔥 いつ見ているか(曜日 × 時間帯)</h2>
          <div class="hd-hm"><span></span>${BL.map(b => `<small>${b[1]}時</small>`).join('')}${[...WD].map((c, wd) => `<span class="r">${c}</span>${hv[wd].map((v, b) => `<i class="l${lv(v)}" title="${c}曜 ${BL[b][1]}〜${BL[b][2]}時 ・ ${v ? hm(v) : 'なし'}"></i>`).join('')}`).join('')}</div>
          <div class="hd-leg">${LVN.map((n, i) => `<span><i class="l${i}"></i>${n}</span>`).join('')}</div></section>
      </div>
      <div class="hd-two">
        <section class="hd-card"><h2>🕘 最近見た動画</h2>${recent.length ? recent.map(x => { const m = H.v[x[1]] || [], test = /^TFTEST/.test(x[1]), d = new Date(x[0] * 1000);
          return `<a class="hd-rv" ${test ? '' : `href="https://www.youtube.com/${m[4] ? 'shorts/' : 'watch?v='}${esc(x[1])}" target="_top"`}>${test ? '<span class="th"></span>' : `<img loading="lazy" src="https://i.ytimg.com/vi/${esc(x[1])}/mqdefault.jpg" alt="">`}<span class="tx"><b>${esc(m[0] || x[1])}</b><small>${esc(m[1] || '')} ・ ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</small></span></a>`; }).join('') : '<p class="hd-none">まだありません</p>'}</section>
        <section class="hd-card"><h2>📺 よく見たチャンネル</h2>${top.length ? top.map(c => `<div class="hd-ch" title="${esc(c.name)} ・ ${hm(c.val)} ・ ${c.n}回"><span>${esc(c.name)}</span><i><u style="width:${Math.max(4, Math.round(c.val / tmax * 100))}%"></u></i><small>${hm(c.val)}</small></div>`).join('') : '<p class="hd-none">まだありません</p>'}</section>
      </div>`;
  }
  box.addEventListener('click', e => {
    const d = e.target.closest('[data-d]'); if (d) { days = +d.dataset.d; try { localStorage.setItem('tfHdDays', String(days)); } catch (x) { /* なし */ } draw(); return; }
    const m = e.target.closest('[data-m]'); if (m) { calM = new Date(calM.getFullYear(), calM.getMonth() + (+m.dataset.m), 1); draw(); }
  });
  const reload = () => chrome.storage.local.get('hist').then(r => { const h = r.hist || {}; H = { v: h.v || {}, p: (Array.isArray(h.p) ? h.p : []).filter(x => Array.isArray(x) && x[1]).sort((a, b) => a[0] - b[0]) }; draw(); });
  chrome.storage.onChanged.addListener((ch, a) => { if (a === 'local' && ch.hist) reload(); });
  reload();
}
