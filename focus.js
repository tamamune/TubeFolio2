// 集中モード(曜日・時間帯で、選んだフォルダの動画を見えなくする)。元のTubeFolioの shared.js / content.js から移した部分。
//   保存先: focus = { on, slots:[{ days:[0-6], from, to }], type:'lock'|'allow', lock:[フォルダID], allow:[フォルダID], hideHome, blockWatch, unlockMin, unlockUntil, tempUntil, tempAllow }
//     lock＝選んだフォルダを見えなくする ／ allow＝選んだフォルダだけ見られる。(Drive同期の対象: sync.js の SYNC_KEYS)
//   ・どの画面でも使える判定(window.TFF)
//   ・YouTubeの画面: ホーム・検索・関連の動画をぼかして押せなくする／見えないチャンネルの動画を開いたらロック画面
//   ・拡張機能のページ(新着・検索・視聴など): 動画のカードをぼかして押せなくする
(() => {
  if (window.TFF) return;
  const DEF = { on: false, slots: [{ days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' }], type: 'lock', lock: [], allow: [], hideHome: true, blockWatch: true, unlockMin: 15, unlockUntil: 0 };
  const cfg = async () => { const { focus } = await chrome.storage.local.get('focus'); return { ...structuredClone(DEF), ...(focus || {}) }; };
  const eff = (F, t = Date.now()) => ((F && F.tempUntil) || 0) > t ? { ...F, type: 'allow', allow: F.tempAllow || [] } : F;
  // いま集中モードか。戻り値 { active, until(終わる時刻), slot, unlocked(一時解除中), temp }
  const state = (F, t = Date.now()) => {
    if (((F && F.tempUntil) || 0) > t) { const unlocked = (F.unlockUntil || 0) > t; return { active: !unlocked, unlocked, until: F.tempUntil, temp: true }; }
    if (!F || !F.on) return { active: false };
    const d = new Date(t);
    for (const s of F.slots || []) {
      const [fh, fm] = String(s.from || '0:0').split(':').map(Number), [th, tm] = String(s.to || '0:0').split(':').map(Number);
      const a = (fh || 0) * 60 + (fm || 0), b = (th || 0) * 60 + (tm || 0), x = d.getHours() * 60 + d.getMinutes();
      const inToday = a <= b ? x >= a && x < b : x >= a, inYesterday = a > b && x < b; // 日をまたぐ時間帯は、始まった日の曜日で判定
      const day = inYesterday ? (d.getDay() + 6) % 7 : d.getDay();
      if ((inToday || inYesterday) && (s.days || []).includes(day)) {
        const end = new Date(t); end.setHours(th || 0, tm || 0, 0, 0); if (end.getTime() <= t) end.setDate(end.getDate() + 1);
        const unlocked = (F.unlockUntil || 0) > t;
        return { active: !unlocked, unlocked, until: end.getTime(), slot: s };
      }
    }
    return { active: false };
  };
  const rootOf = (groups, id) => { const by = new Map(groups.map(g => [g.id, g])); let g = by.get(id), n = 0; while (g && g.parent && by.has(g.parent) && n++ < 50) g = by.get(g.parent); return g; };
  const gLocked = (F, groups, id) => { // フォルダが見えない状態か(トップのフォルダで判定)
    F = eff(F); const root = (rootOf(groups, id) || {}).id || id;
    if (id === '__unsorted') return F.type === 'allow' && !(F.allow || []).includes('__unsorted');
    return F.type === 'allow' ? !(F.allow || []).includes(root) : (F.lock || []).includes(root);
  };
  // チャンネルが見えない状態か(ids＝そのチャンネルが入っているフォルダのID。null＝登録していない・不明)
  const chLocked = (F, groups, ids) => {
    F = eff(F);
    if (F.type === 'allow') return !((ids && ids.length) ? ids.some(id => !gLocked(F, groups, id)) : ((F.allow || []).includes('__unsorted') && ids !== null));
    return !!(ids && ids.length) && ids.some(id => gLocked(F, groups, id));
  };
  window.TFF = { DEF, cfg, state, eff, rootOf, gLocked, chLocked };

  // ---------- 共通: いまの設定とチャンネル → フォルダの対応 ----------
  let F = { ...DEF }, S = null, ST = { active: false };
  const nrm = t => String(t || '').normalize('NFKC').trim().toLowerCase();
  const byName = new Map(), byKey = new Map();
  const load = async () => {
    F = await cfg(); ST = state(F);
    try { S = await TF.get(); } catch (e) { S = null; }
    byName.clear(); byKey.clear();
    if (S) Object.values(S.channels || {}).forEach(c => { const g = c.groups || []; const n = nrm(TF.clean ? TF.clean(c.name) : c.name); if (n) byName.set(n, g); if (c.key) byKey.set(c.key, g); if (c.id) byKey.set('channel/' + c.id, g); });
    ST = state(F); sweep();
  };
  const lockedBy = (key, name) => { // ids が分かれば(登録済み)その配列、不明なら null
    const ids = (key && byKey.get(key)) || (name && byName.get(nrm(name))) || null;
    return chLocked(F, (S && S.groups) || [], ids);
  };
  const isExt = location.protocol === 'chrome-extension:';
  const keyOf = href => { const h = String(href || ''); let m = h.match(/\/(@[^\/?#]+)/); if (m) { try { return decodeURIComponent(m[1]).toLowerCase(); } catch (e) { return m[1].toLowerCase(); } } m = h.match(/\/channel\/(UC[\w-]{22})/); return m ? 'channel/' + m[1] : null; };

  // ---------- 一時解除(10秒待ってから) ----------
  async function askUnlock() {
    if (document.getElementById('tg-unlock')) return;
    const d = document.createElement('div'); d.id = 'tg-unlock'; const min = F.unlockMin || 15;
    d.innerHTML = `<div class="tg-ul-box"><div class="tg-ul-t">🔒 集中モードを ${min} 分だけ解除しますか？</div><p>本当に今見る必要がありますか？ 10秒待つと解除できます。</p>
      <div class="tg-ul-btns"><button class="tg-ul-no">やめる(集中を続ける)</button><button class="tg-ul-yes" disabled>10</button></div></div>`;
    document.body.appendChild(d);
    const yes = d.querySelector('.tg-ul-yes'); let n = 10;
    const t = setInterval(() => { n--; yes.textContent = n > 0 ? String(n) : `${min}分だけ解除`; if (n <= 0) { clearInterval(t); yes.disabled = false; } }, 1000);
    d.querySelector('.tg-ul-no').onclick = () => { clearInterval(t); d.remove(); };
    yes.onclick = async () => { d.remove(); const c = await cfg(); c.unlockUntil = Date.now() + min * 60e3; await chrome.storage.local.set({ focus: c, prefsAt: Date.now() }); };
  }
  document.addEventListener('click', e => { const u = e.target.closest && e.target.closest('[data-tg-unlock]'); if (u) { e.preventDefault(); e.stopPropagation(); askUnlock(); } }, true);

  // ---------- YouTubeの画面 ----------
  const ITEM = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model, ytd-reel-item-renderer, ytd-playlist-video-renderer';
  function sweepYt() {
    document.documentElement.classList.toggle('tg-focus-on', ST.active);
    const lockOn = ST.active && F.hideHome;
    if (!lockOn) { document.querySelectorAll('[data-tglock]').forEach(it => { if (it.matches(ITEM)) delete it.dataset.tglock; }); watchLock(); return; } // オフのときは、印を外すだけ(再生画面の関連動画まで、毎回全部見回らない)
    document.querySelectorAll(ITEM).forEach(it => {
      if (it.parentElement && it.parentElement.closest(ITEM)) return; // 入れ子は外側だけ
      let lk = false;
      if (lockOn) {
        const a = it.querySelector('a[href^="/@"], a[href*="youtube.com/@"], a[href^="/channel/UC"]');
        if (a) lk = lockedBy(keyOf(a.getAttribute('href')), '');
      }
      if (lk) { if (it.dataset.tglock !== '1') it.dataset.tglock = '1'; } else if (it.dataset.tglock) delete it.dataset.tglock;
    });
    watchLock();
  }
  const curVid = () => location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : /^\/shorts\//.test(location.pathname) ? location.pathname.split('/')[2] : null;
  function watchLock() { // 見えないチャンネルの動画を開いたらロック画面
    let ov = document.getElementById('tg-watchlock'); const id = curVid();
    let lock = false, why = '';
    if (id && ST.active && F.blockWatch) {
      const a = document.querySelector('ytd-watch-metadata ytd-channel-name a, ytd-video-owner-renderer a[href^="/@"], #owner a[href^="/@"], #upload-info a[href^="/@"], ytd-reel-video-renderer[is-active] a[href^="/@"]');
      if (a) {
        const key = keyOf(a.getAttribute('href')), ids = byKey.get(key) || byName.get(nrm(a.textContent)) || null;
        lock = chLocked(F, (S && S.groups) || [], ids);
        why = ids && ids.length ? ids.map(i => ((S.groups.find(g => g.id === i)) || {}).name).filter(Boolean).join('・') : ids ? '未分類' : '登録していないチャンネル';
      }
    }
    if (!lock) { if (ov) ov.remove(); return; }
    document.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) { /* なし */ } });
    if (ov && ov.dataset.v === id) return;
    if (ov) ov.remove();
    ov = document.createElement('div'); ov.id = 'tg-watchlock'; ov.dataset.v = id;
    const until = ST.until ? new Date(ST.until).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '';
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    ov.innerHTML = `<div class="tg-ul-box"><div class="tg-lock-ic">🔒</div><div class="tg-ul-t">集中モード中です</div><p>「${esc(why)}」の動画は ${until ? until + ' まで' : '今は'} 見られません。</p>
      <div class="tg-ul-btns"><button class="tg-ul-no" data-back="1">前のページに戻る</button><button data-tg-unlock="1">少しだけ解除する…</button></div></div>`;
    ov.querySelector('[data-back]').onclick = () => (history.length > 1 ? history.back() : location.assign('/'));
    document.body.appendChild(ov);
  }
  document.addEventListener('play', e => { if (document.getElementById('tg-watchlock') && e.target.tagName === 'VIDEO') e.target.pause(); }, true);

  // ---------- 拡張機能のページ(新着・検索・視聴など) ----------
  function sweepExt() {
    const lockOn = ST.active;
    document.querySelectorAll('.card[data-ch]').forEach(cd => {
      const lk = lockOn && lockedBy(cd.dataset.chid ? 'channel/' + cd.dataset.chid : null, cd.dataset.ch);
      if (lk) { if (cd.dataset.tglock !== '1') cd.dataset.tglock = '1'; } else if (cd.dataset.tglock) delete cd.dataset.tglock;
    });
  }
  function sweep() { try { isExt ? sweepExt() : sweepYt(); } catch (e) { /* なし */ } }
  let t0 = 0; const later = () => { if (window.tfQuiet && window.tfQuiet()) return; clearTimeout(t0); t0 = setTimeout(sweep, 300); }; // 再生画面を開いた直後は、DOM変更のたびに動かない(1.5秒ごとの見回りに任せる)
  new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('yt-navigate-finish', later);
  setInterval(() => { if (!document.hidden && !(window.tfQuiet && window.tfQuiet())) { const s = state(F); if (s.active !== ST.active) { ST = s; } sweep(); } }, 1500);
  chrome.storage.onChanged.addListener((ch, a) => { if (a === 'local' && (ch.focus || ch.channels || ch.groups)) load(); });
  load();
})();
