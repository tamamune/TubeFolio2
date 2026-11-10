// 再生画面の「🕒 後で見る」ボタン(右下)と、連続再生の表示(キュー・次に見る動画)。
// 元のTubeFolioの content.js にあった、再生画面向けの部分の最小版。中身は extras.js(TGX)が行う。
(() => {
  if (window.__tfLaterGlue) return; window.__tfLaterGlue = true;
  const isWatch = () => location.pathname === '/watch';
  const vid = () => (isWatch() ? new URLSearchParams(location.search).get('v') : null);
  const txt = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  let laterSet = new Set(), fab = null, shownV = null, shownOn = null;
  const refresh = () => TGX.getLater().then(list => { laterSet = new Set((list || []).map(x => x.v)); paint(true); }).catch(() => {});
  function paint(force) {
    if (!fab) return;
    const v = vid(), on = laterSet.has(v);
    if (!force && v === shownV && on === shownOn) return;
    shownV = v; shownOn = on; fab.dataset.v = v || ''; fab.classList.toggle('on', on);
    fab.textContent = on ? '✓ 後で見る' : '🕒 後で見る';
    fab.title = on ? 'TubeFolioの「後で見る」から外す' : 'TubeFolioの「後で見る」に追加';
  }
  function info() {
    const v = vid(), ch = (globalThis.TGPage && TGPage.currentChannel()) || null, st = globalThis.TGPage && TGPage.state();
    const t = txt(document.querySelector('ytd-watch-metadata h1, #title h1')) || document.title.replace(/ - YouTube$/, '');
    return { v, t, th: `https://i.ytimg.com/vi/${v}/mqdefault.jpg`, ch: { key: (ch && ch.key) || '', name: (ch && ch.name) || '', unsub: !(ch && st && st.channels && st.channels[ch.key]) } };
  }
  function ensure() {
    if (!isWatch()) { if (fab) { fab.remove(); fab = null; shownV = null; } return; }
    if (!fab || !fab.isConnected) {
      fab = document.createElement('button'); fab.id = 'tg-lfab'; fab.className = 'tg-lbtn'; shownV = null;
      ['mouseover', 'mouseenter', 'mousemove', 'pointerover', 'pointerenter', 'pointermove'].forEach(t => fab.addEventListener(t, e => e.stopPropagation()));
      fab.addEventListener('click', async e => {
        e.preventDefault(); e.stopPropagation(); if (fab.dataset.busy || !vid()) return; fab.dataset.busy = '1';
        try { const added = await TGX.toggleLater(info()); laterSet[added ? 'add' : 'delete'](vid()); paint(true); } finally { delete fab.dataset.busy; }
      });
      document.body.appendChild(fab);
    }
    paint(false);
  }
  setInterval(ensure, 800);
  refresh(); try { TGX.syncQueue(); } catch (e) { /* 無視 */ }
  chrome.storage.onChanged.addListener(ch => { if (ch.queue) { try { TGX.syncQueue(); } catch (e) { /* 無視 */ } } if (ch.later) refresh(); });
})();
