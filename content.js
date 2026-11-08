// TubeFolio2 content script (YouTube)
(() => {
  let S = null; // state
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = t => String(t || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const OUTER = 'ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer, ytd-compact-video-renderer';
  const CARD = OUTER + ', yt-lockup-view-model';
  const isSubs = () => location.pathname === '/feed/subscriptions';
  const isHome = () => location.pathname === '/';
  const isChList = () => location.pathname === '/feed/channels';

  const groupOf = id => S.groups.find(g => g.id === id);
  const cardKey = card => {
    const a = card.querySelector('a[href^="/@"], a[href^="/channel/UC"]');
    return a ? TF.keyFromHref(a.getAttribute('href')) : null;
  };
  const cardMeta = card => {
    const a = card.querySelector('ytd-channel-name a, a[href^="/@"]:not(:empty)');
    const img = card.querySelector('yt-avatar-shape img, #avatar img, img.yt-core-image');
    return { name: a ? a.textContent.trim() : '', avatar: img && /ggpht|yt3/.test(img.src) ? img.src : '' };
  };
  const watchedPct = card => {
    const p = card.querySelector('ytd-thumbnail-overlay-resume-playback-renderer #progress, yt-thumbnail-overlay-progress-bar-view-model [style*="width"], .ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment');
    const m = p && (p.style.width || '').match(/([\d.]+)%/);
    return m ? parseFloat(m[1]) : 0;
  };
  const videoId = card => {
    const a = card.querySelector('a[href*="/watch?v="]');
    const m = a && a.getAttribute('href').match(/[?&]v=([\w-]{11})/);
    return m ? m[1] : null;
  };

  // ---------- カード処理 ----------
  // ショート(棚・カード)。チャンネルが画面に出ないので、動画IDから投稿者をoEmbedで調べて登録済みか判定する
  const SHORTS_SEL = 'ytd-reel-item-renderer, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2';
  const TFX = ['dim', 'badge', 'ring', 'frame', 'tint', 'stripe', 'label', 'gray', 'namecolor', 'bar', 'fchip', 'small', 'watched', 'br', 'corner', 'tri', 'nest'];
  const shortsOwner = new Map(), shortsAsked = new Set(); let shortsBusy = false;
  // サムネの「見えている枠」を測る: 角丸+はみ出し非表示の親があればそれを枠とし、角丸の半径も読む(ショート等でimgが枠より大きい場合の対策)
  function thBox(th) {
    let e = th, best = th;
    for (let i = 0; i < 4 && e && e !== document.body; i++, e = e.parentElement) {
      const cs = getComputedStyle(e), rad = parseFloat(cs.borderTopLeftRadius) || 0;
      if (rad > 0 && (e === th || cs.overflow !== "visible")) { best = e; break; }
    }
    const rad = parseFloat(getComputedStyle(best).borderTopLeftRadius) || 12;
    return { rect: best.getBoundingClientRect(), rad: Math.min(rad, 40) };
  }
  function processShorts() {
    const els = isHome() ? [...document.querySelectorAll(SHORTS_SEL)].filter(e => !(e.parentElement && e.parentElement.closest(SHORTS_SEL))) : [];
    const ts = S.settings.testS || {}, t = S.settings.test || {};
    const need = [];
    els.forEach(sh => {
      const a = sh.matches('a[href^="/shorts/"]') ? sh : sh.querySelector('a[href^="/shorts/"]');
      const m = a && (a.getAttribute('href') || '').match(/\/shorts\/([\w-]{11})/); const id = m && m[1];
      if (!id) return;
      if (!shortsOwner.has(id)) { if (!shortsAsked.has(id)) need.push(id); return; }
      const key = shortsOwner.get(id), sub = key ? !!S.channels[key] : null;
      const gs0 = key && S.channels[key] ? S.channels[key].groups.map(groupOf).filter(Boolean) : [];
      sh.classList.add('tf-short');
      sh.classList.toggle('tf-sub', sub === true); sh.classList.toggle('tf-unsub', sub === false);
      if (gs0.length) { sh.setAttribute('data-tf-on', ''); sh.style.setProperty('--tf-c', gs0[0].color); } else if (sh.hasAttribute('data-tf-on')) { sh.removeAttribute('data-tf-on'); sh.style.removeProperty('--tf-c'); }
      TFX.forEach(k => sh.classList.toggle('tfx-' + k, !!ts[k]));
      const th = sh.querySelector('img');
      if (th && !th.classList.contains('tf-thimg')) th.classList.add('tf-thimg');
      if ((ts.br || ts.corner || ts.tri || ts.nest) && th) {
        const bx = thBox(th), r = bx.rect, c = sh.getBoundingClientRect();
        if (r.width > 20) { const st = sh.style; st.setProperty('--tf-tt', (r.top - c.top).toFixed(1) + 'px'); st.setProperty('--tf-tl', (r.left - c.left).toFixed(1) + 'px'); st.setProperty('--tf-tr', bx.rad.toFixed(1) + 'px'); st.setProperty('--tf-tw', r.width.toFixed(1) + 'px'); st.setProperty('--tf-th', r.height.toFixed(1) + 'px'); st.setProperty('--tf-bw', r.width >= 330 ? '2.667px' : '2px'); }
      }
      // 絞り込みチップ(ショートにも適用)
      let hide = false;
      if (t.chips && t.filter === 'sub' && sub !== true) hide = true;
      if (t.chips && t.filter === 'unsub' && sub === true) hide = true;
      sh.classList.toggle('tf-hide', hide);
    });
    if (need.length && !shortsBusy) {
      shortsBusy = true; const ids = need.slice(0, 40); ids.forEach(i => shortsAsked.add(i));
      chrome.runtime.sendMessage({ type: 'shortsOwners', ids }, r => {
        shortsBusy = false;
        if (r && r.owners) { Object.keys(r.owners).forEach(i => shortsOwner.set(i, r.owners[i] || null)); schedule(); }
      });
    }
  }

  // 棚(ショート・ニュース速報など)の表示数: 列数を増やしても、YouTubeは元の列数ぶんしか表示しない(残りはhiddenのまま)。
  // 列数ぶんまでは隠れている項目を出す(その先の行は「もっと見る」のまま)。
  // 棚(ショート・ニュース速報・トピックなど)を列数どおりに並べる(TubeFolioの方式を移植)
  //  ・届いている本数が列数より少ないときは、棚の「もっと見る」を1回だけ押して追加分を読み込ませる
  //  ・それでも足りないときは、本数に合わせて列を詰める(右が空かないように)
  //  ・動画の棚は列数どおりのgrid、ショートの棚は列数を超える分を隠す
  const SH_MORE = /もっと見る|show more|さらに表示/i, SH_LESS = /一部を表示|show less/i;
  const shLbl = b => (b.getAttribute('aria-label') || '') + b.textContent;
  const shBtn = sh => [...sh.querySelectorAll('button')].find(b => !b.closest('ytd-rich-item-renderer') && (SH_MORE.test(shLbl(b)) || SH_LESS.test(shLbl(b))));
  // 自動展開した棚の「もっと見る/一部を表示」ボタンは、YouTubeに渡さず、こちらで列数ぶん/全件を切り替える(ボタンが作り直されても効くよう、document全体で受ける)
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button'); if (!b) return;
    const sh = b.closest('ytd-rich-shelf-renderer.tf-nshelf'); if (!sh || sh._tfAuto || b.closest('ytd-rich-item-renderer')) return;
    if (!SH_MORE.test(shLbl(b)) && !SH_LESS.test(shLbl(b))) return;
    e.stopImmediatePropagation(); e.preventDefault();
    sh.dataset.tfMore = sh.dataset.tfMore === '1' ? '' : '1'; fixShelves();
  }, true);
  function fixShelves() {
    const g = S.settings.thumb || {};
    const setS = (e, k, v) => { if (v === '' || v == null) { if (e.style.getPropertyValue(k)) e.style.removeProperty(k); } else if (e.style.getPropertyValue(k) !== String(v)) e.style.setProperty(k, v); };
    document.querySelectorAll('ytd-browse[page-subtype="home"] ytd-rich-shelf-renderer').forEach(sh => {
      const short = sh.hasAttribute('is-shorts');
      const M = short ? (g.scols ? (g.sN || 6) : 0) : (g.cols ? (g.colsN || 5) : 0);
      const items = [...sh.querySelectorAll('#contents > ytd-rich-item-renderer')];
      const btn = shBtn(sh);
      const ytCollapsed = !!btn && SH_MORE.test(shLbl(btn)) && !SH_LESS.test(shLbl(btn));
      // 動画の棚: YouTube側は展開したままにする(折りたたむと追加分が捨てられる)。折りたたまれたら、また展開し直す
      if (M && !short && btn && ytCollapsed && items.length < M && !sh._tfAuto && Date.now() - (sh._tfAt || 0) > 800) {
        sh._tfAt = Date.now(); sh._tfAuto = true; sh.classList.add('tf-nshelf'); btn.click(); setTimeout(() => { sh._tfAuto = false; }, 400);
      }
      const mine = sh.classList.contains('tf-nshelf') && !short && !!M;
      const all = sh.dataset.tfMore === '1';
      const eff = M ? Math.max(1, Math.min(M, items.length)) : '';
      ['--ytd-rich-grid-slim-items-per-row', '--ytd-rich-grid-items-per-row', '--ytd-rich-shelf-items-count', '--tf-eff'].forEach(k => setS(sh, k, eff));
      items.forEach((it, i) => {
        if (it.hasAttribute('hidden') && M && (i < eff || (mine && all))) it.removeAttribute('hidden');
        setS(it, 'display', !M ? '' : i < eff ? 'block' : short ? 'none' : mine ? (all ? 'block' : 'none') : (ytCollapsed ? 'none' : ''));
      });
      if (mine && btn) { // 下のボタン: 列数より多く読み込めたときだけ出し、文字と矢印を今の状態に合わせる
        const c = btn.closest('ytd-button-renderer') || btn.parentElement;
        if (c) { if (items.length > eff) c.style.removeProperty('display'); else c.style.setProperty('display', 'none', 'important'); }
        sh.dataset.tfLbl = all ? 'less' : 'more'; // 文字はCSS(::after)で差し替える(YouTube側の再描画で戻されないように)
        const t = all ? '一部を表示' : 'もっと見る'; if (btn.getAttribute('aria-label') && btn.getAttribute('aria-label') !== t) btn.setAttribute('aria-label', t);
        sh.classList.toggle('tf-more-open', all);
      }
    });
  }
  // 棚の診断: 棚ごとの項目数・隠れている数・構造をクリップボードにコピーする(表示が足りない原因調べ用)
  async function copyShelfDiag() {
    const rep = [...document.querySelectorAll('ytd-rich-shelf-renderer, ytd-reel-shelf-renderer')].map(sh => {
      const title = ((sh.querySelector('#title') || {}).textContent || '').trim().slice(0, 30);
      const items = [...sh.querySelectorAll('ytd-rich-item-renderer, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, yt-lockup-view-model')];
      const chain = it => { const c = []; for (let e = it.parentElement; e && e !== sh && c.length < 6; e = e.parentElement) c.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.hasAttribute('hidden') ? '[hidden]' : '')); return c.join('<'); };
      return { tag: sh.tagName.toLowerCase(), attrs: [...sh.attributes].map(a => a.name).filter(a => !a.startsWith('style')).join(','), title,
        perRow: getComputedStyle(sh).getPropertyValue('--ytd-rich-grid-items-per-row').trim(), w: Math.round(sh.getBoundingClientRect().width),
        items: items.length, hidden: items.filter(i => i.hasAttribute('hidden') || getComputedStyle(i).display === 'none' || i.getBoundingClientRect().width < 2).length,
        sample: items.slice(0, 8).map(i => i.tagName.toLowerCase() + ' w' + Math.round(i.getBoundingClientRect().width) + (i.hasAttribute('hidden') ? ' [hidden]' : '') + ' < ' + chain(i)),
        more: !!sh.querySelector('#show-more-button, [aria-label*="もっと見る"]') };
    });
    const txt = JSON.stringify(rep, null, 1);
    try { await navigator.clipboard.writeText(txt); toast('棚の診断をコピーしました。チャットに貼ってください'); } catch (e) { console.log('[TubeFolio2 shelf diag]', txt); toast('コピーできませんでした。コンソールに出力しました'); }
  }

  // 列数を増やしたとき: YouTubeは「3件ごと」に棚(ショート等)を差し込むため、4列以上だと行が3件で切れて空きができる。
  // 棚をCSSのorderで「行の区切りまで」後ろへずらし、行を埋める(DOMは動かさない)。
  function alignShelves() {
    const g = S.settings.thumb || {};
    document.querySelectorAll('ytd-rich-grid-renderer > #contents').forEach(box => {
      const kids = [...box.children];
      if (!g.cols) { kids.forEach(k => { if (k.style.order) k.style.order = ''; }); return; }
      const n = g.colsN || 5, w = box.getBoundingClientRect().width;
      const out = []; let held = [], items = 0;
      kids.forEach(k => {
        if (k.tagName === 'YTD-RICH-ITEM-RENDERER') { out.push(k); items++; if (held.length && items % n === 0) { out.push(...held); held = []; } }
        else { const r = k.getBoundingClientRect(); if (r.width > w * 0.9 && r.height > 30 && items % n !== 0) held.push(k); else out.push(k); }
      });
      out.push(...held);
      out.forEach((k, i) => { const v = String(i); if (k.style.order !== v) k.style.order = v; });
    });
  }

  function processCards() {
    document.querySelectorAll(CARD).forEach(card => {
      if (card.matches('yt-lockup-view-model') && card.closest(OUTER)) return;
      if (card.querySelector(SHORTS_SEL)) return; // ショートを含むカードは processShorts() が扱う
      const key = cardKey(card);
      // カード自体のレイアウトには触れず、グループ登録済みならサムネに枠色だけ付ける(ホバープレビュー保護)
      const gs0 = key && S.channels[key] ? S.channels[key].groups.map(groupOf).filter(Boolean) : [];
      if (gs0.length) { card.setAttribute('data-tf-on', ''); card.style.setProperty('--tf-c', gs0[0].color); }
      else if (card.hasAttribute('data-tf-on')) { card.removeAttribute('data-tf-on'); card.style.removeProperty('--tf-c'); }
      // ホーム: 登録/未登録の見分けテスト(クラスを付けるだけ。見た目はCSS)
      const isSubCh = key ? !!S.channels[key] : null; // null = チャンネルを判定できないカード
      if (isHome()) {
        card.classList.toggle('tf-sub', isSubCh === true); card.classList.toggle('tf-unsub', isSubCh === false);
        const tv = S.settings.test || {}; TFX.forEach(k => card.classList.toggle('tfx-' + k, !!tv[k])); // 動画用のテスト設定を、このカードに反映
        const nm = [...card.querySelectorAll('a[href^="/@"], a[href^="/channel/UC"]')].find(a => !a.querySelector('img, yt-avatar-shape') && a.textContent.trim());
        if (nm && !nm.classList.contains('tf-cn')) nm.classList.add('tf-cn');
        if (nm) { // L: 所属フォルダ名(CSSの::beforeで表示。DOMは増やさない)
          const ft = gs0.length ? TF.iconText(gs0[0].icon) + ' ' + gs0[0].name + (gs0.length > 1 ? ' +' + (gs0.length - 1) : '') : '';
          if (ft) { if (nm.getAttribute('data-tf-f') !== ft) nm.setAttribute('data-tf-f', ft); } else if (nm.hasAttribute('data-tf-f')) nm.removeAttribute('data-tf-f');
        }
        card.classList.toggle('tf-watched', watchedPct(card) >= 80);
        // サムネ画像とチャンネルアイコン画像に目印クラスを付ける(枠/輪は画像自身のoutlineで描くので、親のoverflowで切れない)
        const th = card.querySelector('a[href*="/watch?v="] img, a[href^="/shorts/"] img, ytd-thumbnail img, yt-thumbnail-view-model img');
        if (th && !th.classList.contains('tf-thimg')) th.classList.add('tf-thimg');
        const tt = S.settings.test || {};
        if ((tt.br || tt.corner || tt.tri || tt.nest) && th) { // サムネの位置をカード基準で測り、目印(疑似要素)をサムネにぴったり重ねる
          const bx = thBox(th), r = bx.rect, c = card.getBoundingClientRect();
          if (r.width > 20) { const st = card.style; st.setProperty('--tf-tt', (r.top - c.top).toFixed(1) + 'px'); st.setProperty('--tf-tl', (r.left - c.left).toFixed(1) + 'px'); st.setProperty('--tf-tr', bx.rad.toFixed(1) + 'px'); st.setProperty('--tf-tw', r.width.toFixed(1) + 'px'); st.setProperty('--tf-th', r.height.toFixed(1) + 'px'); st.setProperty('--tf-bw', r.width >= 330 ? '2.667px' : '2px'); }
        }
        card.querySelectorAll('img').forEach(i => { if (!i.classList.contains('tf-avimg') && /yt3\.(ggpht|googleusercontent)\.com/.test(i.src)) i.classList.add('tf-avimg'); });
      } else if (card.classList.contains('tf-sub') || card.classList.contains('tf-unsub')) card.classList.remove('tf-sub', 'tf-unsub');
      // フィルタ(登録フィード)
      let hide = false;
      if (isHome()) {
        const t = S.settings.test || {};
        if (t.chips && t.filter === 'sub' && isSubCh !== true) hide = true;
        if (t.chips && t.filter === 'unsub' && isSubCh === true) hide = true;
      }
      if (isSubs()) {
        const ag = S.settings.activeGroup;
        const gs = key && S.channels[key] ? S.channels[key].groups.filter(id => groupOf(id)) : [];
        if (ag === 'none') hide = gs.length > 0;
        else if (ag !== 'all') { const sub = TF.subtree(S.groups, ag); hide = !gs.some(id => sub.has(id)); }
        if (!hide && S.settings.hideWatched && watchedPct(card) >= 80) hide = true;
      }
      card.classList.toggle('tf-hide', hide);
    });
    document.querySelectorAll('ytd-rich-section-renderer').forEach(s =>
      s.classList.toggle('tf-hide', isSubs() && S.settings.activeGroup !== 'all'));
  }

  // ---------- 登録フィードのバー ----------
  function renderBar() {
    let bar = $('#tf-bar');
    if (!isSubs()) { if (bar) bar.remove(); return; }
    const host = $('ytd-browse[page-subtype="subscriptions"] #primary') || $('ytd-browse[page-subtype="subscriptions"]');
    if (!host) return;
    if (!bar) { bar = el('div'); bar.id = 'tf-bar'; host.prepend(bar); }
    else if (bar.parentElement !== host) host.prepend(bar);
    const ag = S.settings.activeGroup;
    const cnt = gid => { const sub = TF.subtree(S.groups, gid); return Object.values(S.channels).filter(c => c.groups.some(id => sub.has(id))).length; };
    const unfiled = Object.values(S.channels).filter(c => !c.groups.some(id => groupOf(id))).length;
    const chip = (id, label, n, color) =>
      `<button class="tf-chip${ag === id ? ' act' : ''}" data-g="${id}" ${color ? `style="--c:${color}"` : ''}>${label}<span>${n}</span></button>`;
    bar.innerHTML = `
      <div class="tf-chips">
        ${chip('all', '🗂️ すべて', Object.keys(S.channels).length)}
        ${TF.flat(S.groups).map(({ g, depth }) => chip(g.id, `${depth ? '↳ ' : ''}${TF.iconHtml(g.icon)} ${esc(g.name)}`, cnt(g.id), g.color)).join('')}
        ${chip('none', '📥 未分類', unfiled)}
      </div>
      <div class="tf-tools">
        <label class="tf-sw"><input type="checkbox" id="tf-hw" ${S.settings.hideWatched ? 'checked' : ''}><span></span>視聴済みを隠す</label>
        <button class="tf-btn" id="tf-play" title="表示中の動画(最大50件)を連続再生">▶ 一括再生</button>
        <button class="tf-btn" id="tf-imp" title="YouTubeの登録チャンネルを取り込む">⟳ 取り込み</button>
        <button class="tf-btn" id="tf-mgr">⚙ 管理</button>
      </div>`;
    bar.querySelectorAll('.tf-chip').forEach(b => b.onclick = () =>
      TF.mutate(s => { s.settings.activeGroup = b.dataset.g; }));
    $('#tf-hw', bar).onchange = e => TF.mutate(s => { s.settings.hideWatched = e.target.checked; });
    $('#tf-mgr', bar).onclick = () => chrome.runtime.sendMessage({ type: 'openManager' });
    $('#tf-imp', bar).onclick = bgImport;
    $('#tf-play', bar).onclick = () => {
      const ids = [];
      document.querySelectorAll(CARD).forEach(c => {
        if (c.matches('yt-lockup-view-model') && c.closest(OUTER)) return;
        if (c.classList.contains('tf-hide')) return;
        const v = videoId(c); if (v && !ids.includes(v)) ids.push(v);
      });
      if (!ids.length) return toast('再生できる動画がありません');
      location.href = '/watch_videos?video_ids=' + ids.slice(0, 50).join(',');
    };
  }

  function bgImport() {
    toast('取り込み中…(バックグラウンド)', 60000);
    chrome.runtime.sendMessage({ type: 'importSubs' }, r => {
      if (r && !r.error) toast(`✓ ${r.count}件のチャンネルを取り込みました`, 6000);
      else { toast('バックグラウンド取り込みに失敗。ページ経由で再試行します'); setTimeout(() => { location.href = '/feed/channels?tf_import=1'; }, 1500); }
    });
  }

  // ---------- 右上の設定アイコン + 設定パネル ----------
  function renderGear() {
    const host = $('ytd-masthead #end');
    if (!host) return;
    const ex = $('#tf-gear');
    if (ex) { if (host.lastElementChild !== ex) host.appendChild(ex); return; }
    const g = el('button', null, '<img src="data:image/png;base64,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" width="32" height="32" style="display:block">'); g.id = 'tf-gear'; g.title = 'TubeFolio2 設定';
    g.onclick = () => ($('#tf-set') ? closeSettings() : openSettings(g));
    host.appendChild(g);
  }
  function posView() { const v = $("#tf-view"), pm = $("ytd-page-manager"); if (!v || !pm) return; const l = Math.max(0, Math.round(pm.getBoundingClientRect().left)) + "px"; if (v.style.left !== l) v.style.left = l; }
  function closeView() { cancelAnimationFrame(closeView._t); const v = $("#tf-view"); if (v) v.remove(); document.documentElement.removeAttribute('data-tf-view'); renderNav(); renderGuideBtn(); }
  function openView() {
    closeView();
    const pm = $('ytd-page-manager'), r = pm ? pm.getBoundingClientRect() : { left: 240 };
    const v = el('div'); v.id = 'tf-view';
    v.style.left = Math.max(0, r.left) + 'px';
    v.innerHTML = '<button id="tf-view-x" title="閉じる">✕</button><iframe src="' + chrome.runtime.getURL('manager.html?embed=1&dark=' + (document.documentElement.hasAttribute('dark') ? 1 : 0)) + '"></iframe>';
    document.documentElement.setAttribute('data-tf-view', '');
    document.body.appendChild(v);
    cancelAnimationFrame(closeView._t); const loop = () => { posView(); closeView._t = requestAnimationFrame(loop); }; loop(); // 左メニューの開閉(ミニ/フル)に追従
    $('#tf-view-x', v).onclick = closeView;
    renderNav(); renderGuideBtn();
  }
  // ---------- テスト: ホームで登録/未登録を見分ける表示(チェックボックスで個別に入り切り) ----------
  const TESTS = [['nest', '【新D】新Cの枠を、サムネの左上の角だけに描く(余白4 / 角は同心円)'], ['tri', '【新C】3色の枠 フォルダ登録=フォルダ色 / 登録のみ=青 / 未登録=赤'], ['br', '【新A】サムネの外側に2ptの枠(登録=青 / 非登録=赤)'], ['corner', '【新B】サムネの左上に目印(登録=青 / 非登録=赤)'],['dim', '未登録の動画を薄くする'], ['badge', '登録チャンネル名の横に ✓ を付ける'], ['ring', '登録チャンネルのアイコンを輪で囲む'], ['frame', '登録チャンネルのサムネに枠を付ける'], ['chips', '上部に「すべて/登録のみ/未登録のみ」を表示'],
    ['tint', 'F. 登録カードの背景を薄く色付けする'], ['stripe', 'G. 登録カードの左端にラインを付ける'], ['label', 'H. サムネの角に「登録/未登録」ラベルを付ける'], ['gray', 'I. 未登録の動画をモノクロにする'], ['namecolor', 'J. 登録チャンネル名を色付けする'],
    ['bar', 'K. サムネ下端にカラーバーを付ける'], ['fchip', 'L. チャンネル名の横にフォルダ名チップを付ける'], ['small', 'M. 未登録を小さく縮小する'], ['watched', 'O. 視聴済みの動画を薄くする'], ['feed', 'N. 上部にフォルダの新着フィードを表示する']];
  function applyTest() {
    const t = S.settings.test || {};
    ['dim', 'badge', 'ring', 'frame', 'tint', 'stripe', 'label', 'gray', 'namecolor', 'bar', 'fchip', 'small', 'watched', 'br', 'corner', 'tri', 'nest'].forEach(k => document.documentElement.toggleAttribute('data-tf-t-' + k, isHome() && !!t[k]));
  }
  function renderTestBtn() {
    let b = $('#tf-testbtn'); const gear = $('#tf-gear');
    if (!gear) return;
    if (!b) { b = el('button', null, '🧪 テスト'); b.id = 'tf-testbtn'; b.title = '登録/未登録の見分け方を試す'; b.onclick = () => ($('#tf-test') ? closeTest() : openTest(b)); }
    if (b.nextElementSibling !== gear) gear.before(b);
  }
  // ---------- テスト2: サムネが大きすぎるのを小さく(列数・余白・関連動画など) ----------
  const THUMBS = [['cols', '動画の列数を増やす(サムネが小さくなる)'], ['scols', 'ショート棚の列数を変える'], ['title3', 'タイトルが長いとき3行まで表示する'], ['tight', '余白を詰める'], ['list', '1行リスト表示(小さいサムネ+タイトル) ※実験'], ['rel', '再生ページ右の関連動画を縮小する'], ['shelf', 'ショート等の大きな棚を隠す'], ['noprev', 'ホバーの拡大プレビューを止める']];
  function applyThumb(nOverride) {
    const g = S.settings.thumb || {}, root = document.documentElement;
    THUMBS.forEach(([k]) => root.toggleAttribute('data-tf-g-' + k, !!g[k]));
    root.toggleAttribute('data-tf-g-title3', g.title3 !== false); // 初期値はオン
    const n = nOverride || g.colsN || 5; root.style.setProperty('--tf-cols', n); root.style.setProperty('--tf-scols', (nOverride ? (g.sN || 6) : (g.sN || 6)));
    root.style.setProperty('--tf-title-lines', 3); root.style.setProperty('--tf-title-fs', (n >= 7 ? 11.5 : n >= 6 ? 12 : n >= 5 ? 13 : 14) + 'px'); root.style.setProperty('--tf-meta-fs', (n >= 6 ? 11 : 12) + 'px');
  }
  function renderThumbBtn() {
    let b = $('#tf-thbtn'); const t = $('#tf-testbtn');
    if (!t) return;
    if (!b) { b = el('button', null, '🧪 サムネ'); b.id = 'tf-thbtn'; b.title = 'サムネの大きさを調整するテスト'; b.onclick = () => ($('#tf-th') ? closeThumbPanel() : openThumbPanel(b)); }
    if (b.nextElementSibling !== t) t.before(b);
  }
  // ---------- テスト3: 「列数」操作の置き場所(ページ上部/ヘッダー/右下/左メニュー) ----------
  const PLACES = [['top', '① ページ上部(ホーム・登録フィード)に 3 4 5 6 7 のボタン'], ['head', '② ヘッダー右上に － 列数 ＋'], ['float', '③ 画面右下に浮かぶ － 列数 ＋'], ['guide', '④ 左メニュー(フォルダの下)に 列数 － ＋'], ['edgeR', '⑤ 画面の右端に隠れたつまみ(近づけると列数が出る)'], ['edgeT', '⑥ 画面の上端(ヘッダーの下)に隠れたつまみ']];
  const colNow = (k = 'v') => { const g = S.settings.thumb || {}; return k === 's' ? (g.scols ? (g.sN || 6) : 0) : (g.cols ? (g.colsN || 5) : 0); };
  function setCols(n, k = 'v') {
    TF.mutate(s => {
      const g = { ...(s.settings.thumb || {}) }, v = Math.min(8, Math.max(3, n || 0));
      if (k === 's') { if (n) { g.scols = true; g.sN = v; } else g.scols = false; } else { if (n) { g.cols = true; g.colsN = v; } else g.cols = false; }
      s.settings.thumb = g;
    });
  }
  const colSeg = (k = 'v') => { const c = colNow(k); return `<span class="tfc-seg"><button data-ck="${k}" data-cn="0" class="${c ? '' : 'act'}">標準</button>${(k === 's' ? [4, 5, 6, 7, 8] : [3, 4, 5, 6, 7]).map(n => `<button data-ck="${k}" data-cn="${n}" class="${c === n ? 'act' : ''}">${n}</button>`).join('')}</span>`; };
  const colStep = (k = 'v') => { const c = colNow(k); return `<span class="tfc-step"><button data-ck="${k}" data-cd="-1" title="列を減らす(大きく)">－</button><b>${c ? c + '列' : '標準'}</b><button data-ck="${k}" data-cd="1" title="列を増やす(小さく)">＋</button></span>`; };
  const colClick = e => {
    const b = e.target.closest('[data-cn],[data-cd]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const k = b.dataset.ck || 'v';
    if (b.dataset.cn !== undefined) return setCols(+b.dataset.cn, k);
    const c = colNow(k) || (k === 's' ? 5 : 4); setCols(c + +b.dataset.cd, k);
  };
  function putCol(id, host, html, where) { // 目印の要素を作り、内容が変わったときだけ描き直す
    let b = $('#' + id);
    if (!host) { if (b) b.remove(); return; }
    if (!b) { b = el('div'); b.id = id; b.addEventListener('click', colClick); }
    if (where === 'prepend') { if (b.parentElement !== host) host.prepend(b); } else if (where && where.before) { if (b.nextElementSibling !== where.before) where.before.before(b); } else if (where && where.after) { if (where.after.nextElementSibling !== b) where.after.after(b); } else if (b.parentElement !== host) host.appendChild(b);
    if (b._h !== html) { b.innerHTML = html; b._h = html; }
  }
  function renderCols() {
    const p = S.settings.place || {};
    const page = isHome() ? $('ytd-browse[page-subtype="home"] #primary') : isSubs() ? $('ytd-browse[page-subtype="subscriptions"] #primary') : null;
    putCol('tf-colbar', p.top && page ? page : null, `<span class="tfc-l">▦ 動画</span>${colSeg('v')}<span class="tfc-l tfc-l2">ショート</span>${colSeg('s')}`, 'prepend');
    const th = $('#tf-thbtn');
    putCol('tf-colhead', p.head && th ? th.parentElement : null, colStep(), { before: $('#tf-plbtn') || th });
    putCol('tf-colfab', p.float ? document.body : null, `<span class="tfc-l">▦</span>${colStep()}`);
    // D: 隠れたつまみ(ふだんは細い印だけ。マウスを近づけると列数の切り替えが出る)
    const hp = `<div class="tfh-tab">▦</div><div class="tfh-panel"><div class="tfh-row"><span>動画</span>${colSeg('v')}</div><div class="tfh-row"><span>ショート</span>${colSeg('s')}</div></div>`;
    putCol('tf-colhR', p.edgeR ? document.body : null, hp);
    putCol('tf-colhT', p.edgeT ? document.body : null, hp);
    const gb = $('#tf-gbtn');
    putCol('tf-colguide', p.guide && gb ? gb.parentElement : null, `<span class="tfc-gi">▦</span><span class="tfc-gl">列数</span>${colStep()}`, { after: gb });
  }
  function renderPlaceBtn() {
    let b = $('#tf-plbtn'); const t = $('#tf-thbtn');
    if (!t) return;
    if (!b) { b = el('button', null, '🧪 配置'); b.id = 'tf-plbtn'; b.title = '「列数」ボタンの置き場所テスト'; b.onclick = () => ($('#tf-pl') ? closePlacePanel() : openPlacePanel(b)); }
    if (b.nextElementSibling !== t) t.before(b);
  }
  // ---------- テスト4: ガラス調の縦長サイドバー(動画「Glassy SideBar V5」の再現) ----------
  function closeGsb() { const p = $('#tf-gsb-root'); if (p) p.remove(); }
  function openGsb() {
    closeGsb();
    const r = el('div'); r.id = 'tf-gsb-root';
    r.innerHTML = `<aside class="gs">
      <div class="gs-head"><div class="gs-logo">▶</div><div class="gs-brand"><b>TubeFolio2</b><small>登録チャンネル管理</small></div><button class="gs-toggle" data-a="t" aria-label="開閉">‹</button></div>
      <label class="gs-search"><span class="i">⌕</span><input placeholder="ページを検索"><kbd>Ctrl K</kbd></label>
      <nav class="gs-nav">
        <div class="gs-sec">メイン</div>
        <a class="gs-it" data-tip="ホーム"><span class="i">▦</span><em>ホーム</em></a>
        <a class="gs-it act" data-tip="アクティビティ"><span class="i">ϟ</span><em>アクティビティ</em><i class="bd">12</i></a>
        <a class="gs-it" data-tip="履歴"><span class="i">▭</span><em>履歴</em></a>
        <a class="gs-it" data-tip="スケジュール"><span class="i">▤</span><em>スケジュール</em><i class="dot"></i></a>
        <div class="gs-sec">ワークスペース</div>
        <a class="gs-it" data-tip="メッセージ"><span class="i">◌</span><em>メッセージ</em><i class="bd r">3</i></a>
        <a class="gs-it open" data-a="p" data-tip="グループ"><span class="i">❖</span><em>グループ</em><span class="chev">⌃</span></a>
        <div class="gs-sub"><div><a><i class="c g"></i>音楽</a><a><i class="c o"></i>勉強</a><a><i class="c p"></i>ゲーム</a></div></div>
        <a class="gs-it" data-tip="分析"><span class="i">ılı</span><em>分析</em></a>
        <a class="gs-it" data-tip="設定"><span class="i">⚙</span><em>設定</em></a>
      </nav>
      <div class="gs-night"><span class="i">☼</span><em>ナイトモード</em><button class="sw" data-a="n" aria-label="ナイトモード"></button></div>
      <div class="gs-user"><span class="av">T<i></i></span><div><b>Tamamune</b><small>tamamune@example.com</small></div><span class="upd">⇅</span></div>
      <button class="gs-x" data-a="x" aria-label="閉じる">×</button>
    </aside>`;
    r.addEventListener('click', e => {
      const g = $('.gs', r), a = e.target.closest('[data-a]'), it = e.target.closest('.gs-it');
      if (a && a.dataset.a === 'x') return closeGsb();
      if (a && a.dataset.a === 't') { g.classList.toggle('mini'); a.textContent = g.classList.contains('mini') ? '›' : '‹'; return; }
      if (a && a.dataset.a === 'n') return a.classList.toggle('on');
      if (a && a.dataset.a === 'p') { a.classList.toggle('open'); $('.gs-sub', r).classList.toggle('shut'); return; }
      if (it) { r.querySelectorAll('.gs-it.act').forEach(x => x.classList.remove('act')); it.classList.add('act'); }
    });
    // ドラッグで移動(ボタン・入力欄・項目以外の部分をつかむ)。位置は覚えておく
    try { const pos = JSON.parse(localStorage.getItem('tfGsbPos') || 'null'); if (pos) { r.style.left = pos.x + 'px'; r.style.top = pos.y + 'px'; } } catch (e) { /* 無視 */ }
    // アイコンだけ/通常の切り替え: 右上の丸いボタン、または空いた所をダブルクリック。状態は覚えておく
    // 大きさ: 通常 / アイコンの列(‹ ボタン) / ロゴだけの丸(空いた所をダブルクリック。丸をクリックで戻る)。状態は覚えておく
    const G = () => $('.gs', r);
    const save = () => { try { localStorage.setItem('tfGsbMode', G().classList.contains('min') ? 'min' : G().classList.contains('mini') ? 'mini' : 'full'); } catch (e) { /* 無視 */ } };
    const setMini = on => { G().classList.toggle('mini', on); $('.gs-toggle', r).textContent = on ? '›' : '‹'; save(); };
    const setMin = on => { G().classList.toggle('min', on); save(); };
    try { const m = localStorage.getItem('tfGsbMode'); if (m === 'mini') setMini(true); else if (m === 'min') setMin(true); } catch (e) { /* 無視 */ }
    $('.gs-toggle', r).addEventListener('click', e => { e.stopImmediatePropagation(); setMini(!G().classList.contains('mini')); }, true);
    r.addEventListener('dblclick', e => { if (!e.target.closest('button, input, a, .sw') && !G().classList.contains('min')) setMin(true); });
    r.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button, input, a, .sw')) return;
      const b = r.getBoundingClientRect(), dx = e.clientX - b.left, dy = e.clientY - b.top;
      r.setPointerCapture(e.pointerId); r.classList.add('drag'); e.preventDefault();
      let moved = false;
      const mv = ev => { if (Math.abs(ev.clientX - dx - b.left) + Math.abs(ev.clientY - dy - b.top) > 4) moved = true; r.style.left = Math.max(0, Math.min(innerWidth - 60, ev.clientX - dx)) + 'px'; r.style.top = Math.max(0, Math.min(innerHeight - 60, ev.clientY - dy)) + 'px'; };
      const up = () => {
        r.removeEventListener('pointermove', mv); r.removeEventListener('pointerup', up); r.classList.remove('drag'); if (!moved && G().classList.contains('min')) setMin(false);
        try { localStorage.setItem('tfGsbPos', JSON.stringify({ x: parseInt(r.style.left, 10), y: parseInt(r.style.top, 10) })); } catch (e) { /* 無視 */ }
      };
      r.addEventListener('pointermove', mv); r.addEventListener('pointerup', up);
    });
    document.body.appendChild(r);
  }
  function closePlacePanel() { const p = $('#tf-pl'); if (p) p.remove(); document.removeEventListener('mousedown', outsidePl, true); }
  function outsidePl(e) { const p = $('#tf-pl'); if (p && !p.contains(e.target) && !e.target.closest('#tf-plbtn')) closePlacePanel(); }
  function openPlacePanel(anchor) {
    closePlacePanel();
    const p = el('div'); p.id = 'tf-pl';
    const pl = S.settings.place || {};
    p.innerHTML = `<div class="tf-pop-h">🧪 列数ボタンの置き場所テスト</div>` +
      PLACES.map(([k, label]) => `<label class="tf-sw tf-srow"><input type="checkbox" data-k="${k}" ${pl[k] ? 'checked' : ''}><span></span>${label}</label>`).join('') +
      `<div class="tf-ssub">チェックした場所に「列数」の操作が出ます。押すと列数がすぐ変わります。</div>`;
    document.body.appendChild(p);
    const r = anchor.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(r.right - 340, innerWidth - 350)) + 'px'; p.style.top = (r.bottom + 8) + 'px';
    p.querySelectorAll('input[type=checkbox]').forEach(i => i.onchange = () =>
      TF.mutate(s => { s.settings.place = { ...(s.settings.place || {}), [i.dataset.k]: i.checked }; }));
    setTimeout(() => document.addEventListener('mousedown', outsidePl, true), 0);
  }

  function closeThumbPanel() { const p = $('#tf-th'); if (p) p.remove(); document.removeEventListener('mousedown', outsideTh, true); }
  function outsideTh(e) { const p = $('#tf-th'); if (p && !p.contains(e.target) && !e.target.closest('#tf-thbtn')) closeThumbPanel(); }
  function openThumbPanel(anchor) {
    closeThumbPanel();
    const p = el('div'); p.id = 'tf-th';
    const g = S.settings.thumb || {};
    p.innerHTML = `<div class="tf-pop-h">🧪 サムネの大きさテスト</div>` +
      THUMBS.map(([k, label]) => `<label class="tf-sw tf-srow"><input type="checkbox" data-k="${k}" ${(k === 'title3' ? g[k] !== false : g[k]) ? 'checked' : ''}><span></span>${label}</label>` + (k === 'cols' ? `<div class="tf-srow tf-rng"><input type="range" id="tfth-n" min="3" max="8" step="1" value="${g.colsN || 5}"><b id="tfth-v">${g.colsN || 5}列</b></div>` : '') + (k === 'scols' ? `<div class="tf-srow tf-rng"><input type="range" id="tfth-s" min="3" max="8" step="1" value="${g.sN || 6}"><b id="tfth-sv">${g.sN || 6}列</b></div>` : '')).join('') +
      `<div class="tf-ssub">ホーム・登録フィード・チャンネルページに効きます(再生ページは「関連動画」)</div>`;
    document.body.appendChild(p);
    const r = anchor.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(r.right - 320, innerWidth - 330)) + 'px'; p.style.top = (r.bottom + 8) + 'px';
    p.querySelectorAll('input[type=checkbox]').forEach(i => i.onchange = () =>
      TF.mutate(s => { s.settings.thumb = { ...(s.settings.thumb || {}), [i.dataset.k]: i.checked }; }));
    const rg = $('#tfth-n', p);
    rg.oninput = () => { $('#tfth-v', p).textContent = rg.value + '列'; applyThumb(+rg.value); };
    rg.onchange = () => TF.mutate(s => { s.settings.thumb = { ...(s.settings.thumb || {}), colsN: +rg.value, cols: true }; }).then(() => { const c = p.querySelector('input[data-k=cols]'); if (c) c.checked = true; });
    const rs = $('#tfth-s', p);
    rs.oninput = () => { $('#tfth-sv', p).textContent = rs.value + '列'; document.documentElement.style.setProperty('--tf-scols', rs.value); };
    rs.onchange = () => TF.mutate(s => { s.settings.thumb = { ...(s.settings.thumb || {}), sN: +rs.value, scols: true }; }).then(() => { const c = p.querySelector('input[data-k=scols]'); if (c) c.checked = true; });
    setTimeout(() => document.addEventListener('mousedown', outsideTh, true), 0);
  }

  function closeTest() { const p = $('#tf-test'); if (p) p.remove(); document.removeEventListener('mousedown', outsideTest, true); }
  function outsideTest(e) { const p = $('#tf-test'); if (p && !p.contains(e.target) && !e.target.closest('#tf-testbtn')) closeTest(); }
  function openTest(anchor) {
    closeTest();
    const p = el('div'); p.id = 'tf-test';
    const t = S.settings.test || {}, ts = S.settings.testS || {};
    const cnt = () => {
      const q = (c, sh) => [...document.querySelectorAll(c)].filter(e => e.classList.contains('tf-short') === sh).length;
      return isHome() ? `ホーム上 動画: 登録 ${q('.tf-sub', false)} / 未登録 ${q('.tf-unsub', false)} ・ ショート: 登録 ${q('.tf-sub', true)} / 未登録 ${q('.tf-unsub', true)}` : 'ホーム画面で効果が出ます';
    };
    p.innerHTML = `<div class="tf-pop-h">🧪 登録/未登録の見分けテスト</div>` +
      `<div class="tft-r tft-h"><span></span><b>動画</b><b>ショート</b></div>` + TESTS.map(([k, label]) => { const gl = k === 'chips' || k === 'feed'; return `<div class="tft-r"><span>${label}</span><input type="checkbox" data-k="${k}" data-s="v" ${t[k] ? 'checked' : ''}>${gl ? '<i></i>' : `<input type="checkbox" data-k="${k}" data-s="s" ${ts[k] ? 'checked' : ''}>`}</div>`; }).join('') +
      `<div class="tf-ssub" id="tft-n">${cnt()}</div>`;
    document.body.appendChild(p);
    const r = anchor.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(r.right - 400, innerWidth - 410)) + 'px'; p.style.top = (r.bottom + 8) + 'px';
    p.querySelectorAll('input[type=checkbox]').forEach(i => i.onchange = () =>
      TF.mutate(s => { const f = i.dataset.s === 's' ? 'testS' : 'test'; s.settings[f] = { ...(s.settings[f] || {}), [i.dataset.k]: i.checked }; }).then(() => { const n = $('#tft-n'); if (n) n.textContent = cnt(); }));
    setTimeout(() => document.addEventListener('mousedown', outsideTest, true), 0);
  }
  // N: フォルダの新着フィード(ホーム上部・横スクロール)
  let feedItems = [], feedSig = '', feedT = 0, feedBusy = false;
  const agoJa = iso => { const m = (Date.now() - Date.parse(iso)) / 60000; return m < 60 ? Math.max(1, Math.round(m)) + '分前' : m < 1440 ? Math.round(m / 60) + '時間前' : Math.round(m / 1440) + '日前'; };
  function refreshFeed() {
    const days = S.settings.newDays || 3;
    const keys = Object.values(S.channels).filter(c => c.groups.some(id => groupOf(id))).map(c => c.key).sort();
    const sig = days + ':' + keys.join(',');
    if (feedBusy || !keys.length || (sig === feedSig && Date.now() - feedT < 10 * 60 * 1000)) return;
    feedBusy = true; feedSig = sig; feedT = Date.now();
    chrome.runtime.sendMessage({ type: 'folderFeed', keys, days }, r => { feedBusy = false; if (r && r.items) { feedItems = r.items; renderFeed(); } });
  }
  function renderFeed() {
    let box = $('#tf-feed');
    const t = S.settings.test || {};
    if (!isHome() || !t.feed) { if (box) box.remove(); return; }
    const host = $('ytd-browse[page-subtype="home"] #primary') || $('ytd-browse[page-subtype="home"]');
    if (!host) return;
    refreshFeed();
    if (!box) { box = el('div'); box.id = 'tf-feed'; }
    const tb = $('#tf-tbar');
    if (tb && tb.parentElement === host) { if (tb.nextElementSibling !== box) tb.after(box); } else if (box.parentElement !== host || host.firstElementChild !== box) host.prepend(box);
    const days = S.settings.newDays || 3;
    const html = `<div class="tff-h">📂 フォルダの新着(${days}日以内 ${feedItems.length}件)</div><div class="tff-row">` +
      (feedItems.length ? feedItems.map(v => `<a class="tff-c" href="/watch?v=${esc(v.id)}" data-v="${esc(v.id)}" title="${esc(v.title)}"><img loading="lazy" src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg"><b>${esc(v.title)}</b><small>${esc(v.ch)} ・ ${agoJa(v.published)}</small></a>`).join('') : '<span class="tff-n">読み込み中、または新着なし</span>') + '</div>';
    if (box._h !== html) {
      box.innerHTML = html; box._h = html;
      box.querySelectorAll('.tff-c').forEach(a => a.onclick = e => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
        e.preventDefault(); goingYt = false;
        window.postMessage({ tfGo: { type: 'watch', id: a.dataset.v, url: '/watch?v=' + a.dataset.v } }, '*'); // ページ全体は更新せず動画を開く
      });
    }
  }

  // ホーム上部の絞り込みチップ(テスト用)
  function renderTBar() {
    let bar = $('#tf-tbar');
    const t = S.settings.test || {};
    if (!isHome() || !t.chips) { if (bar) bar.remove(); return; }
    const host = $('ytd-browse[page-subtype="home"] #primary') || $('ytd-browse[page-subtype="home"]');
    if (!host) return;
    if (!bar) { bar = el('div'); bar.id = 'tf-tbar'; }
    if (bar.parentElement !== host) host.prepend(bar);
    const f = t.filter || 'all';
    const html = [['all', 'すべて'], ['sub', '登録のみ'], ['unsub', '未登録のみ']].map(([v, l]) => `<button class="tf-chip${f === v ? ' act' : ''}" data-f="${v}">${l}</button>`).join('');
    if (bar._h !== html) {
      bar.innerHTML = html; bar._h = html;
      bar.querySelectorAll('button').forEach(b => b.onclick = () => TF.mutate(s => { s.settings.test = { ...(s.settings.test || {}), filter: b.dataset.f }; }));
    }
  }

  function closeSettings() { const p = $('#tf-set'); if (p) p.remove(); document.removeEventListener('mousedown', outsideSet, true); }
  function outsideSet(e) { const p = $('#tf-set'); if (p && !p.contains(e.target) && !e.target.closest('#tf-gear')) closeSettings(); }
  async function openSettings(anchor) {
    closeSettings();
    const p = el('div'); p.id = 'tf-set';
    const st = (await chrome.storage.local.get('syncStatus')).syncStatus;
    const stTxt = st ? ({ syncing: '同期中…', ok: '☁ ' + st.msg, error: '⚠ ' + st.msg }[st.state] || '') : '未同期';
    p.innerHTML = `
      <div class="tf-pop-h">TubeFolio2 設定</div>
      <label class="tf-sw tf-srow"><input type="checkbox" id="tfs-hw" ${S.settings.hideWatched ? 'checked' : ''}><span></span>視聴済みを隠す</label>
      <label class="tf-sw tf-srow"><input type="checkbox" id="tfs-hc" ${S.settings.hideCreate !== false ? 'checked' : ''}><span></span>「作成」ボタンを隠す</label>
      <button class="tf-srow tf-sbtn" id="tfs-ai">✨ フォルダのアイコンを名前から自動設定</button>
      <div class="tf-ssub">テスト機能(ふだんは出さず、ここから開きます)</div>
      <button class="tf-srow tf-sbtn" id="tfs-t1">🧪 登録/未登録の見分けテスト</button>
      <button class="tf-srow tf-sbtn" id="tfs-t2">🧪 サムネの大きさテスト</button>
      <button class="tf-srow tf-sbtn" id="tfs-t3">🧪 列数ボタンの置き場所テスト</button>
      <button class="tf-srow tf-sbtn" id="tfs-t4">🧪 縦長サイドバーのテスト</button>
      <button class="tf-srow tf-sbtn" id="tfs-diag">🔍 棚の診断をコピー(表示が足りないとき)</button>
      <label class="tf-srow tf-ssel"><span>新着とみなす期間(フォルダ横の件数)</span><select id="tfs-nd">${[1, 3, 7, 14].map(n => `<option value="${n}"${(S.settings.newDays || 3) === n ? ' selected' : ''}>${n}日以内</option>`).join('')}</select></label>
      <label class="tf-srow tf-ssel"><span>フォルダ内のチャンネルを押したとき</span><select id="tfs-cc"><option value="pane"${S.settings.chClick !== 'youtube' ? ' selected' : ''}>右のページに表示</option><option value="youtube"${S.settings.chClick === 'youtube' ? ' selected' : ''}>YouTubeでチャンネルを開く</option></select></label>
      <button class="tf-srow tf-sbtn" id="tfs-view">📂 フォルダ設定をここに表示(仮)</button>
      <button class="tf-srow tf-sbtn" id="tfs-mgr">⚙ グループ管理を開く</button>
      <button class="tf-srow tf-sbtn" id="tfs-imp">⟳ 登録チャンネルを取り込む</button>
      <button class="tf-srow tf-sbtn" id="tfs-sync">☁ Google Driveと同期</button>
      <div class="tf-ssub" id="tfs-st">${esc(stTxt)}</div>`;
    document.body.appendChild(p);
    const r = anchor.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(r.right - 270, innerWidth - 280)) + 'px'; p.style.top = (r.bottom + 8) + 'px';
    $('#tfs-hw', p).onchange = e => TF.mutate(s => { s.settings.hideWatched = e.target.checked; });
    // テスト機能のパネルは、ヘッダーに常時ボタンを出さず、⚙のメニューから開く
    [['#tfs-t1', '#tf-test', openTest, closeTest], ['#tfs-t2', '#tf-th', openThumbPanel, closeThumbPanel], ['#tfs-t3', '#tf-pl', openPlacePanel, closePlacePanel]].forEach(([btn, pid, open, close]) => {
      $(btn, p).onclick = () => { closeSettings(); const g = $('#tf-gear'); if (!g) return; $(pid) ? close() : open(g); };
    });
    $('#tfs-diag', p).onclick = () => { closeSettings(); copyShelfDiag(); };
    $('#tfs-t4', p).onclick = () => { closeSettings(); $('#tf-gsb-root') ? closeGsb() : openGsb(); };
    $('#tfs-ai', p).onclick = async () => { const n = await TF.autoIcons(); toast(n ? `${n}件のフォルダにアイコンを設定しました` : '設定できるフォルダはありませんでした(⭐のフォルダだけ対象)'); };
    $('#tfs-nd', p).onchange = e => TF.mutate(s => { s.settings.newDays = +e.target.value; });
    $('#tfs-cc', p).onchange = e => TF.mutate(s => { s.settings.chClick = e.target.value; });
    $('#tfs-hc', p).onchange = e => TF.mutate(s => { s.settings.hideCreate = e.target.checked; });
    $('#tfs-view', p).onclick = () => { closeSettings(); openView(); };
    $('#tfs-mgr', p).onclick = () => { chrome.runtime.sendMessage({ type: 'openManager' }); closeSettings(); };
    $('#tfs-imp', p).onclick = () => { closeSettings(); bgImport(); };
    $('#tfs-sync', p).onclick = () => { $('#tfs-st', p).textContent = '同期中…'; chrome.runtime.sendMessage({ type: 'syncNow', interactive: true }, r => { const e = $('#tfs-st'); if (e) e.textContent = r && r.ok ? '☁ 同期しました' : '⚠ ' + ((r && r.error) || '失敗'); }); };
    setTimeout(() => document.addEventListener('mousedown', outsideSet, true), 0);
  }

  // ---------- 左メニュー(登録チャンネルの上)にフォルダ階層を表示 ----------
  let navView = 'all'; const navOpen = new Set();
  let dragP = null, lastList = 'all', goingYt = false;
  // 新着動画の件数(フォルダ内のチャンネルだけ取得。10分ごと/期間やチャンネル構成が変わったとき更新)
  let newCounts = {}, newSig = '', newT = 0, newBusy = false;
  function refreshNew(chans) {
    const days = S.settings.newDays || 3;
    const keys = chans.filter(c => c.groups.some(id => groupOf(id))).map(c => c.key).sort();
    const sig = days + ':' + keys.join(',');
    if (newBusy || !keys.length || (sig === newSig && Date.now() - newT < 10 * 60 * 1000)) return;
    newBusy = true; newSig = sig; newT = Date.now();
    chrome.runtime.sendMessage({ type: 'newCounts', keys, days }, r => {
      newBusy = false;
      if (r && r.counts) { newCounts = r.counts; if ($('#tf-nav')) renderNav(); }
    });
  }
  // YouTube自身のチャンネルページを、左のフォルダ一覧を残したまま右側(メイン領域)に開く
  async function openChannelPage(key) {
    let id = key.startsWith('UC') ? key : (S.channels[key] && S.channels[key].id);
    if (!id) {
      const r = await new Promise(res => chrome.runtime.sendMessage({ type: 'avatar', key }, res));
      id = r && r.id;
    }
    const url = key.startsWith('@') ? '/' + key : '/channel/' + key;
    if (!id) { location.href = url; return; } // IDが分からないときだけ通常の移動
    navView = 'ch:' + key; goingYt = true;
    const v = $('#tf-view'); if (v) v.classList.add('tf-away'); // 管理画面は隠し、YouTubeのページを見せる
    renderNav();
    window.postMessage({ tfGo: { url, id } }, '*');
    setTimeout(() => { goingYt = false; }, 3000);
  }
  // 「フォルダ」ボタン: 閉じていれば開く。チャンネル表示中ならフォルダ一覧へ戻る
  function showList() {
    if (!$('#tf-view')) return openView();
    // フォルダ一覧を表示中にもう一度押したら閉じる(チャンネル表示中は一覧へ戻るだけ)
    if (!navView.startsWith('ch:') && !$('#tf-view').classList.contains('tf-away')) return closeView();
    $('#tf-view').classList.remove('tf-away');
    if (navView.startsWith('ch:')) { navView = lastList; chrome.storage.local.set({ tfView: navView }); }
    renderNav(); renderGuideBtn();
  }
  // フォルダを target の前/後ろへ移動(同じ親の並びに入れる)
  function moveGroup(id, targetId, where) {
    if (TF.subtree(S.groups, id).has(targetId)) return toast('自分の中には移動できません');
    TF.mutate(s => {
      const g = s.groups.find(x => x.id === id), t = s.groups.find(x => x.id === targetId); if (!g || !t) return;
      s.groups.splice(s.groups.indexOf(g), 1);
      g.parent = t.parent || null;
      const i = s.groups.indexOf(t);
      s.groups.splice(where === 'before' ? i : i + 1, 0, g);
    });
  }
  function renderNav() {
    let box = $('#tf-nav');
    if (!$('#tf-view')) { if (box) box.remove(); return; }
    const secs = [...document.querySelectorAll('ytd-guide-renderer #sections > ytd-guide-section-renderer')];
    const target = secs.find(s => s.querySelector('a[href="/feed/channels"]')) || secs[1];
    if (!target) return;
    if (!box) { box = el('div'); box.id = 'tf-nav'; }
    if (box.nextElementSibling !== target) target.before(box);
    const ids = new Set(S.groups.map(g => g.id));
    const chans = Object.values(S.channels);
    const cnt = gid => { const sub = TF.subtree(S.groups, gid); return chans.filter(c => c.groups.some(id => sub.has(id))).length; };
    const nameOf = c => TF.clean(c.name) || c.key;
    // フォルダ(サブフォルダ含む)内のチャンネルの新着動画の合計件数
    const nwN = gid => { const sub = TF.subtree(S.groups, gid); return chans.reduce((a, c) => a + (c.groups.some(id => sub.has(id)) ? (newCounts[c.key] || 0) : 0), 0); };
    refreshNew(chans);
    const chHref = k => k.startsWith('@') ? '/' + k : '/channel/' + k;
    const row = (id, ic, nm, n, d, kids, color, tools) => `<div class="tfn-r${navView === id ? ' act' : ''}" data-g="${id}"${tools ? ' draggable="true"' : ''} style="padding-left:${8 + d * 16}px"><span class="tfn-c" data-c="${kids ? id : ''}">${kids ? (!navOpen.has(id) ? '▸' : '▾') : ''}</span><span class="tfn-i"${color ? ` style="color:${color}"` : ''}>${TF.iconHtml(ic)}</span><span class="tfn-n">${esc(nm)}</span>${tools && nwN(id) ? `<span class="tfn-new" title="${S.settings.newDays || 3}日以内の新着動画 ${nwN(id)}件">${nwN(id)}</span>` : ''}${tools ? '<span class="tfn-t"><b data-up="' + id + '" title="上へ">▲</b><b data-dn="' + id + '" title="下へ">▼</b><b data-add="' + id + '" title="サブフォルダを追加">＋</b><b data-ed="' + id + '" title="編集">✎</b></span>' : ''}<span class="tfn-k">${n}</span></div>`;
    const chRow = (c, d, gid) => `<a class="tfn-ch${navView === 'ch:' + c.key ? ' act' : ''}" href="${esc(chHref(c.key))}" data-k="${esc(c.key)}" data-from="${gid}" draggable="true" style="padding-left:${30 + d * 16}px" title="${esc(nameOf(c))}"><span class="tfn-av"${c.avatar ? ` style="background-image:url('${esc(c.avatar)}')"` : ''}>${c.avatar ? '' : esc((nameOf(c) || '?')[0])}</span><span class="tfn-n">${esc(nameOf(c))}</span></a>`;
    const walk = (p, d) => S.groups.filter(g => p === null ? (!g.parent || !ids.has(g.parent)) : g.parent === p).map(g => {
      const subs = S.groups.some(x => x.parent === g.id);
      const direct = chans.filter(c => c.groups.includes(g.id)).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ja'));
      const open = !!navOpen.has(g.id);
      return row(g.id, g.icon, g.name, cnt(g.id), d, subs || direct.length > 0, g.color, true) +
        (open ? walk(g.id, d + 1) + direct.map(c => chRow(c, d + 1, g.id)).join('') : '');
    }).join('');
    const unf = chans.filter(c => !c.groups.some(id => groupOf(id))).length;
    const html = row('all', '🗂️', 'すべて', chans.length, 0, false) + walk(null, 0) + row('none', '📥', '未分類', unf, 0, false);
    if (box._h !== html) { box.innerHTML = html; box._h = html; }
    box.onclick = e => {
      const mv = e.target.closest('[data-up],[data-dn]');
      if (mv) {
        const gid = mv.dataset.up || mv.dataset.dn, me = groupOf(gid);
        const np = x => (x.parent && ids.has(x.parent) ? x.parent : null);
        const sibs = S.groups.filter(x => np(x) === np(me));
        const i = sibs.findIndex(x => x.id === gid), t = sibs[i + (mv.dataset.up ? -1 : 1)];
        if (t) moveGroup(gid, t.id, mv.dataset.up ? 'before' : 'after');
        return;
      }
      const ad = e.target.closest('[data-add]'); if (ad) { navOpen.add(ad.dataset.add); return openFolderDlg(null, ad.dataset.add); }
      const ed = e.target.closest('[data-ed]'); if (ed) return openFolderDlg(ed.dataset.ed, null);
      const chl = e.target.closest('.tfn-ch');
      if (chl) { // ページ全体は更新せず、右のページだけでそのチャンネルを表示する
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
        if (S.settings.chClick === 'youtube') { // 設定: YouTubeのチャンネルページを開く(全体更新はせず、メイン領域だけ切り替える)
          e.preventDefault(); openChannelPage(chl.dataset.k); return;
        }
        const av = $('#tf-view'); if (av) av.classList.remove('tf-away');
        e.preventDefault(); navView = 'ch:' + chl.dataset.k; chrome.storage.local.set({ tfView: navView }); return renderNav();
      }
      const c = e.target.closest('.tfn-c');
      if (c && c.dataset.c) { !navOpen.has(c.dataset.c) ? navOpen.add(c.dataset.c) : navOpen.delete(c.dataset.c); return renderNav(); }
      const r = e.target.closest('.tfn-r'); if (!r) return;
      navView = lastList = r.dataset.g; chrome.storage.local.set({ tfView: navView });
      if (!$('#tf-view')) openView(); else { $('#tf-view').classList.remove('tf-away'); renderNav(); }
    };
    if (!box._dnd) { // ドラッグ&ドロップ(右のチャンネルカード/左のチャンネル・フォルダ → フォルダ)
      box._dnd = true;
      const rowOf = e => e.target.closest && e.target.closest('.tfn-r');
      const zoneOf = (e, r) => { const b = r.getBoundingClientRect(), y = (e.clientY - b.top) / b.height; return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'in'; };
      const clearZ = () => box.querySelectorAll('.tfn-r').forEach(x => x.classList.remove('drop', 'drop-before', 'drop-after'));
      box.addEventListener('dragend', () => { dragP = null; clearZ(); });
      box.addEventListener('dragstart', e => {
        const ch = e.target.closest('.tfn-ch'), r = e.target.closest('.tfn-r');
        const p = ch ? { t: 'ch', keys: [ch.dataset.k], from: ch.dataset.from } : r && r.draggable ? { t: 'g', id: r.dataset.g } : null;
        dragP = p;
        if (!p) return e.preventDefault();
        e.dataTransfer.setData('text/plain', JSON.stringify(p)); e.dataTransfer.effectAllowed = 'move';
      });
      box.addEventListener('dragover', e => {
        const r = rowOf(e); if (!r) return;
        e.preventDefault(); clearZ();
        const z = dragP && dragP.t === 'g' && groupOf(r.dataset.g) ? zoneOf(e, r) : 'in';
        r.classList.add(z === 'before' ? 'drop-before' : z === 'after' ? 'drop-after' : 'drop');
      });
      box.addEventListener('dragleave', e => { const r = rowOf(e); if (r && !r.contains(e.relatedTarget)) r.classList.remove('drop', 'drop-before', 'drop-after'); });
      box.addEventListener('drop', e => {
        const r = rowOf(e); if (!r) return;
        e.preventDefault(); e.stopPropagation();
        const zone = zoneOf(e, r); clearZ();
        let p; try { p = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (x) { return; }
        const id = r.dataset.g;
        if (p.t === 'g' && groupOf(id) && zone !== 'in') { if (id !== p.id) moveGroup(p.id, id, zone); return; }
        if (p.t === 'ch' && groupOf(id)) {
          TF.mutate(s => p.keys.forEach(k => {
            const c = s.channels[k]; if (!c) return;
            if (p.from && p.from !== id) c.groups = c.groups.filter(x => x !== p.from);
            if (!c.groups.includes(id)) c.groups.push(id);
          })).then(() => { navOpen.add(id); toast(`${p.keys.length}件を「${groupOf(id).name}」${p.from ? 'へ移動' : 'に追加'}しました`); });
        } else if (p.t === 'g') {
          const target = id === 'all' ? null : groupOf(id) ? id : undefined;
          if (target === undefined || target === p.id) return;
          if (target && TF.subtree(S.groups, p.id).has(target)) return toast('自分の中には移動できません');
          TF.mutate(s => { s.groups.find(g => g.id === p.id).parent = target; }); if (target) navOpen.add(target);
        }
      });
    }
  }

  // ---------- 左メニューの「ショート」の下に「フォルダ」ボタン(+ フォルダ追加) ----------
  const FOLDER_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>';
  function renderGuideBtn() {
    let b = $('#tf-gbtn');
    // 「ショート」のエントリは href が無いことがあるため、title/表示文字でも判定する
    const isShorts = e => { const a = e.querySelector('a'); return (a && /^\/shorts/.test(a.getAttribute('href') || '')) || /^(ショート|Shorts)$/.test((a && a.getAttribute('title')) || e.textContent.trim()); };
    const entry = [...document.querySelectorAll('ytd-guide-renderer ytd-guide-entry-renderer')].find(isShorts);
    if (entry) {
      if (!b) {
        b = el('div'); b.id = 'tf-gbtn';
        b.innerHTML = `<div class="tfg-main" title="フォルダ設定を開く">${FOLDER_SVG}<span>フォルダ</span></div><b class="tfg-add" title="フォルダを追加">＋</b>`;
        b.onclick = e => { if (e.target.closest('.tfg-add')) return openFolderDlg(null, null); showList(); };
      }
      if (entry.nextElementSibling !== b) entry.after(b);
      b.classList.toggle('act', !!$('#tf-view'));
    }
    let m = $('#tf-mbtn');
    const me = [...document.querySelectorAll('ytd-mini-guide-renderer ytd-mini-guide-entry-renderer')].find(isShorts);
    if (me) {
      if (!m) { m = el('div'); m.id = 'tf-mbtn'; m.title = 'フォルダ設定を開く'; m.innerHTML = FOLDER_SVG + '<span>フォルダ</span>'; m.onclick = showList; }
      if (me.nextElementSibling !== m) me.after(m);
      m.classList.toggle('act', !!$('#tf-view'));
    }
  }

  // ツール表示中に、ドロップ先以外へ落としてもページ遷移(リンクが開く)しないようにする
  ['dragover', 'drop'].forEach(t => document.addEventListener(t, e => { if ($('#tf-view') && !(e.target.closest && e.target.closest('#tf-nav'))) e.preventDefault(); }));

  // ---------- フォルダの追加・編集(入れ子・アイコン・色・削除) ----------
  function closeFolderDlg() { const d = $('#tf-fd'); if (d) d.remove(); }
  function openFolderDlg(id, parent) {
    closeFolderDlg();
    const g = id ? groupOf(id) : null;
    const st = { icon: g ? g.icon : TF.ICONS[0], color: g ? g.color : TF.PALETTE[S.groups.length % TF.PALETTE.length] };
    const bad = g ? TF.subtree(S.groups, g.id) : new Set();
    const cur = g ? (g.parent || '') : (parent || '');
    const d = el('div'); d.id = 'tf-fd';
    d.innerHTML = `<div class="tf-fd-b"><h3>${g ? 'フォルダを編集' : 'フォルダを追加'}</h3>
      <label>名前<input id="tffd-name" maxlength="30" value="${esc(g ? g.name : '')}"></label>
      <label>親フォルダ<select id="tffd-par"><option value="">（なし：最上位）</option>${TF.flat(S.groups).filter(x => !bad.has(x.g.id)).map(({ g: x, depth }) => `<option value="${x.id}"${cur === x.id ? ' selected' : ''}>${'　'.repeat(depth)}${esc(TF.iconText(x.icon))} ${esc(x.name)}</option>`).join('')}</select></label>
      <label>アイコン</label><div class="tf-fd-ic" id="tffd-ic"></div>
      <div class="tf-fd-img"><input id="tffd-url" placeholder="外部画像のURL (https://…)" value="${esc(g && TF.isImgIcon(g.icon) && !/^data:/i.test(g.icon) ? g.icon : '')}"><button type="button" id="tffd-file">画像ファイル</button><input type="file" id="tffd-f" accept="image/*" hidden><span id="tffd-prev"></span></div>
      <label>色</label><div class="tf-fd-co" id="tffd-co"></div>
      <div class="tf-fd-act">${g && S.groups.length > 1 ? '<button id="tffd-del" class="danger">削除</button>' : ''}<span></span><button id="tffd-cancel">キャンセル</button><button id="tffd-ok" class="pri">保存</button></div></div>`;
    document.body.appendChild(d);
    const pick = () => {
      $('#tffd-ic', d).innerHTML = TF.ICONS.map(i => `<button data-i="${i}" class="${st.icon === i ? 'act' : ''}">${i}</button>`).join('') +
        '<div class="tf-fd-sep">アニメ風</div>' + TF.ANIME.map(a => `<button data-i="${a.uri}" title="${a.name}" class="${st.icon === a.uri ? 'act' : ''}">${TF.iconHtml(a.uri)}</button>`).join('');
      $('#tffd-co', d).innerHTML = TF.PALETTE.map(c => `<button data-c="${c}" class="${st.color === c ? 'act' : ''}" style="background:${c}"></button>`).join('');
      $('#tffd-prev', d).innerHTML = TF.isImgIcon(st.icon) ? TF.iconHtml(st.icon) : '';
    };
    pick();
    const urlIn = $('#tffd-url', d);
    ['keydown', 'keyup', 'keypress'].forEach(t => urlIn.addEventListener(t, e => e.stopPropagation()));
    urlIn.oninput = () => { const v = urlIn.value.trim(); if (/^https?:\/\//i.test(v)) { st.icon = v; pick(); } };
    $('#tffd-file', d).onclick = () => $('#tffd-f', d).click();
    $('#tffd-f', d).onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { st.icon = await TF.fileToIcon(f); urlIn.value = ''; pick(); } catch (x) { toast('画像を読み込めませんでした'); }
    };
    d.addEventListener('mousedown', e => { if (e.target === d) closeFolderDlg(); });
    $('#tffd-ic', d).onclick = e => { const b = e.target.closest('button'); if (b) { st.icon = b.dataset.i; const u = $('#tffd-url', d); if (u) u.value = ''; pick(); } };
    $('#tffd-co', d).onclick = e => { const b = e.target.closest('button'); if (b) { st.color = b.dataset.c; pick(); } };
    const nm = $('#tffd-name', d);
    ['keydown', 'keyup', 'keypress'].forEach(t => nm.addEventListener(t, e => { e.stopPropagation(); if (t === 'keydown' && e.key === 'Enter') $('#tffd-ok', d).click(); if (t === 'keydown' && e.key === 'Escape') closeFolderDlg(); }));
    $('#tffd-cancel', d).onclick = closeFolderDlg;
    $('#tffd-ok', d).onclick = () => {
      const name = nm.value.trim(); if (!name) return nm.focus();
      const par = $('#tffd-par', d).value || null;
      if (!g && st.icon === TF.ICONS[0]) st.icon = TF.suggestIcon(name) || st.icon; // 新規フォルダ: 名前に合うアイコンを自動で付ける
      TF.mutate(s => {
        if (g) Object.assign(s.groups.find(x => x.id === g.id), { name, icon: st.icon, color: st.color, parent: par });
        else s.groups.push({ id: TF.uid(), name, icon: st.icon, color: st.color, parent: par });
      });
      if (par) navOpen.add(par);
      closeFolderDlg();
    };
    const del = $('#tffd-del', d);
    if (del) del.onclick = () => {
      if (!confirm('このフォルダを削除しますか?(中のサブフォルダは1つ上へ移動し、チャンネル自体は削除されません)')) return;
      TF.mutate(s => {
        const x = s.groups.find(y => y.id === g.id);
        s.groups.forEach(y => { if (y.parent === g.id) y.parent = x.parent || null; });
        s.groups = s.groups.filter(y => y.id !== g.id);
        Object.values(s.channels).forEach(c => { c.groups = c.groups.filter(y => y !== g.id); });
        if (s.settings.activeGroup === g.id) s.settings.activeGroup = 'all';
      });
      if (navView === g.id) { navView = 'all'; chrome.storage.local.set({ tfView: 'all' }); }
      closeFolderDlg();
    };
    nm.focus();
  }

  // ---------- グループ選択ポップオーバー ----------
  function openPicker(anchor, meta) {
    closePicker();
    const pop = el('div'); pop.id = 'tf-pop';
    const draw = () => {
      const cur = (S.channels[meta.key] || { groups: [] }).groups;
      pop.innerHTML = `<div class="tf-pop-h">${esc(meta.name || meta.key)}</div>` +
        TF.flat(S.groups).map(({ g, depth }) => `<label class="tf-row" style="padding-left:${8 + depth * 16}px"><input type="checkbox" data-g="${g.id}" ${cur.includes(g.id) ? 'checked' : ''}>
          <b style="background:${g.color}">${TF.iconHtml(g.icon)}</b><span>${esc(g.name)}</span></label>`).join('') +
        `<div class="tf-new"><input placeholder="新しいグループ名" maxlength="30"><button>追加</button></div>`;
      pop.querySelectorAll('input[type=checkbox]').forEach(i => i.onchange = () => TF.toggleGroup(meta, i.dataset.g));
      const inp = $('.tf-new input', pop);
      const add = async () => { if (inp.value.trim()) { await TF.addGroup(inp.value.trim()); } };
      $('.tf-new button', pop).onclick = add;
      inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') add(); };
      inp.onkeyup = inp.onkeypress = e => e.stopPropagation();
    };
    pop._draw = draw; pop._meta = meta;
    draw();
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(r.left, innerWidth - 260) + 'px';
    pop.style.top = Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 10) + 'px';
    setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  }
  function outside(e) { const p = $('#tf-pop'); if (p && !p.contains(e.target)) closePicker(); }
  function closePicker() { const p = $('#tf-pop'); if (p) p.remove(); document.removeEventListener('mousedown', outside, true); }

  // ---------- チャンネル/動画ページのFAB ----------
  function renderFab() {
    let fab = $('#tf-fab');
    let meta = null;
    if (/^\/(@|channel\/UC)/.test(location.pathname)) {
      const key = TF.keyFromHref(location.pathname);
      const n = $('ytd-channel-name yt-formatted-string, #channel-name yt-formatted-string, yt-dynamic-text-view-model h1');
      const img = $('yt-decorated-avatar-view-model img, #avatar img');
      if (key) meta = { key, name: n ? n.textContent.trim() : '', avatar: img ? img.src : '' };
    } else if (location.pathname === '/watch') {
      const a = $('ytd-video-owner-renderer a[href^="/@"], #owner a[href^="/@"], #owner a[href^="/channel/UC"]');
      const key = a && TF.keyFromHref(a.getAttribute('href'));
      const img = $('#owner img');
      if (key) meta = { key, name: a.textContent.trim() || ($('#owner ytd-channel-name a') || {}).textContent || '', avatar: img ? img.src : '' };
    }
    if (!meta) { if (fab) fab.remove(); return; }
    if (!fab) { fab = el('button'); fab.id = 'tf-fab'; document.body.appendChild(fab); fab.onclick = () => openPicker(fab, fab._meta); }
    fab._meta = meta;
    const gs = (S.channels[meta.key] ? S.channels[meta.key].groups : []).map(groupOf).filter(Boolean);
    fab.innerHTML = gs.length ? gs.map(g => TF.iconHtml(g.icon)).join('') + ' <span>グループ編集</span>' : '＋ <span>グループに追加</span>';
    fab.classList.toggle('on', gs.length > 0);
  }

  // ---------- 登録チャンネル取り込み ----------
  function toast(msg, ms = 3500) {
    let t = $('#tf-toast'); if (!t) { t = el('div'); t.id = 'tf-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
  }
  let importing = false;
  async function importChannels() {
    if (importing) return; importing = true;
    let last = -1, same = 0;
    while (same < 4) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(r => setTimeout(r, 900));
      const n = document.querySelectorAll('ytd-channel-renderer').length;
      toast(`取り込み中… ${n}件`, 8000);
      same = n === last ? same + 1 : 0; last = n;
    }
    const list = [];
    document.querySelectorAll('ytd-channel-renderer').forEach(r => {
      const a = r.querySelector('a#main-link, #info a, a[href^="/@"], a[href^="/channel/UC"]');
      const key = a && TF.keyFromHref(a.getAttribute('href'));
      if (!key) return;
      const name = TF.clean(((r.querySelector('#text, #channel-title') || {}).textContent || ''));
      const img = r.querySelector('img');
      list.push({ key, name, avatar: img && /^https:\/\/(yt3|lh3)\.|ggpht/.test(img.src) ? img.src : '' });
    });
    await TF.upsertChannels(list);
    window.scrollTo(0, 0);
    importing = false;
    toast(`✓ ${list.length}件のチャンネルを取り込みました`, 6000);
    if (location.search.includes('tf_import')) setTimeout(() => { location.href = '/feed/subscriptions'; }, 1500);
  }
  function checkImport() {
    if (isChList() && location.search.includes('tf_import') && !importing) setTimeout(importChannels, 1200);
  }

  // ---------- ホバー時に出る単一のフローティングボタン(カードに要素を追加しない) ----------
  let hb = null, hbCard = null;
  function hoverBtn() {
    if (hb) return hb;
    hb = el('button', 'tf-pick'); hb.title = 'グループに追加'; hb.style.display = 'none';
    hb.addEventListener('mouseleave', e => { if (!hbCard || !hbCard.contains(e.relatedTarget)) hideHb(); });
    hb.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (hbCard) { const k = cardKey(hbCard); if (k) openPicker(hb, { key: k, ...cardMeta(hbCard) }); } });
    document.body.appendChild(hb);
    return hb;
  }
  function hideHb() { if (hb) hb.style.display = 'none'; hbCard = null; }
  function paintHb(card, key) {
    const b = hoverBtn();
    const gs = (S.channels[key] ? S.channels[key].groups : []).map(groupOf).filter(Boolean);
    b.innerHTML = gs.length ? gs.slice(0, 4).map(g => `<i style="background:${g.color}"></i>`).join('') : '＋';
    b.classList.toggle('on', gs.length > 0);
    const t = card.querySelector('ytd-thumbnail, yt-thumbnail-view-model, a#thumbnail') || card;
    const r = t.getBoundingClientRect();
    b.style.left = (r.left + 8) + 'px'; b.style.top = (r.top + 8) + 'px'; b.style.display = 'flex';
  }
  document.addEventListener('mouseover', e => {
    if (!e.target.closest) return;
    if (e.target.closest('#tf-pop, .tf-pick')) return;
    let card = e.target.closest(OUTER);
    if (!card) { const l = e.target.closest('yt-lockup-view-model'); if (l) card = l; }
    if (!card) return hideHb();
    if (card === hbCard) return;
    const key = cardKey(card);
    if (!key) return hideHb();
    hbCard = card; paintHb(card, key);
  }, true);
  window.addEventListener('scroll', hideHb, { passive: true });

  // ---------- 更新ループ ----------
  let tmr = 0;
  const refresh = () => { if (!S) return; document.documentElement.toggleAttribute('data-tf-hide-create', S.settings.hideCreate !== false); renderNav(); renderGuideBtn(); processCards(); processShorts(); alignShelves(); fixShelves(); renderBar(); renderFab(); renderGear(); renderTestBtn(); renderThumbBtn(); renderPlaceBtn(); renderCols(); applyThumb(); applyTest(); renderTBar(); renderFeed(); const p = $('#tf-pop'); if (p && p._draw) p._draw(); };
  const schedule = () => { clearTimeout(tmr); tmr = setTimeout(refresh, 250); };

  async function init() {
    S = await TF.get();
    chrome.storage.onChanged.addListener(async ch => { if (ch.tfView) navView = ch.tfView.newValue || 'all'; S = await TF.get(); refresh(); });
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('yt-navigate-start', () => { if (goingYt) return; closeView(); });
    window.addEventListener('yt-navigate-finish', () => { schedule(); checkImport(); });
    window.addEventListener('resize', schedule);
    chrome.storage.local.get('tfView').then(r => { if (r.tfView) navView = r.tfView; });
    refresh(); checkImport();
  }
  init();
})();
