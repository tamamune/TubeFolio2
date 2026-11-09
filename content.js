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
  // コラボ動画(複数チャンネル)のカードは、チャンネルへのリンクが無く、名前だけが「A、B」のように並ぶ。
  // リンクが見つからないときは、チャンネル名の行の文字と、登録済みチャンネルの名前を照らし合わせて判定する
  const normName = t => String(t || '').normalize('NFKC').replace(/[….]+$/, '').trim().toLowerCase();
  const bylineText = card => { const m = card.querySelector('yt-content-metadata-view-model'), row = m && m.querySelector('[class*="metadata-row" i]'), e = row || m || card.querySelector('ytd-channel-name'); return e ? normName((e.innerText || '').split(String.fromCharCode(10))[0]) : ''; };
  let nameIdx = null, nameSig = '';
  const collabKey = card => {
    const t = bylineText(card); if (!t) return null;
    const chans = Object.values(S.channels), sig = chans.length + ':' + chans.reduce((n, c) => n + (c.name ? c.name.length : 0), 0);
    if (!nameIdx || nameSig !== sig) { nameSig = sig; nameIdx = chans.map(c => [normName(TF.clean(c.name)), c.key]).filter(x => x[0].length >= 3).sort((a, b) => b[0].length - a[0].length); }
    const hit = nameIdx.find(x => t.includes(x[0])); return hit ? hit[1] : null;
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
  // マウスを乗せるとYouTubeがサムネを動かす(プレビュー拡大)ので、枠(新A〜D)の位置を測り直して、サムネにそろえる
  function remeasureCard(card) {
    if (!card || !/\btfx-(nest|br|corner|tri)\b/.test(card.className)) return;
    const th = card.querySelector('a[href*="/watch?v="] img, a[href^="/shorts/"] img, ytd-thumbnail img, yt-thumbnail-view-model img') || card.querySelector('img'); if (!th) return;
    const bx = thBox(th), r = bx.rect, c = card.getBoundingClientRect();
    if (r.width > 20) { const st = card.style; st.setProperty('--tf-tt', (r.top - c.top).toFixed(1) + 'px'); st.setProperty('--tf-tl', (r.left - c.left).toFixed(1) + 'px'); st.setProperty('--tf-tr', bx.rad.toFixed(1) + 'px'); st.setProperty('--tf-tw', r.width.toFixed(1) + 'px'); st.setProperty('--tf-th', r.height.toFixed(1) + 'px'); }
  }
  ['mouseover', 'mouseout'].forEach(ev => document.addEventListener(ev, e => {
    const card = e.target.closest && e.target.closest('.tf-sub, .tf-unsub, .tf-mix'); if (!card || Date.now() - (card._tfHv || 0) < 120) return;
    card._tfHv = Date.now(); [0, 120, 300, 600].forEach(ms => setTimeout(() => remeasureCard(card), ms));
  }, true));
  function processShorts() {
    const els = isHome() ? [...document.querySelectorAll(SHORTS_SEL)].filter(e => !(e.parentElement && e.parentElement.closest(SHORTS_SEL))) : [];
    const ts = S.settings.testS || {};
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
      sh.classList.toggle('tfx-nest', ts.nest !== false);
      const th = sh.querySelector('img');
      if (th && !th.classList.contains('tf-thimg')) th.classList.add('tf-thimg');
      if (ts.nest !== false && th) {
        const bx = thBox(th), r = bx.rect, c = sh.getBoundingClientRect();
        if (r.width > 20) { const st = sh.style; st.setProperty('--tf-tt', (r.top - c.top).toFixed(1) + 'px'); st.setProperty('--tf-tl', (r.left - c.left).toFixed(1) + 'px'); st.setProperty('--tf-tr', bx.rad.toFixed(1) + 'px'); st.setProperty('--tf-tw', r.width.toFixed(1) + 'px'); st.setProperty('--tf-th', r.height.toFixed(1) + 'px'); st.setProperty('--tf-bw', r.width >= 330 ? '2.667px' : '2px'); }
      }
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
  const shLbl = b => { const c = b.cloneNode(true); c.querySelectorAll('.tf-lbl').forEach(x => x.remove()); return (b.dataset.tfAria || (b.getAttribute('aria-label') || '')) + c.textContent; }; // 自前ラベルは除いて、YouTube本来の文字で状態を判定する
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
      const items = [...sh.querySelectorAll('ytd-rich-item-renderer')]; // 段(ytd-rich-grid-row)に分かれていても、全件を対象にする
      const btn = shBtn(sh);
      const ytCollapsed = !!btn && SH_MORE.test(shLbl(btn)) && !SH_LESS.test(shLbl(btn));
      // 動画の棚: YouTube側は展開したままにする(折りたたむと追加分が捨てられる)。折りたたまれたら、また展開し直す
      if (M && !short && btn && ytCollapsed && (sh._tfTry || 0) < 3 && !sh._tfAuto && Date.now() - (sh._tfAt || 0) > 800) { // 折りたたまれている棚は、件数が列数と同じでも、1回展開して残りを読み込ませる
        sh._tfTry = (sh._tfTry || 0) + 1;
        sh._tfAt = Date.now(); sh._tfAuto = true; sh.classList.add('tf-nshelf'); btn.click(); setTimeout(() => { sh._tfAuto = false; }, 400);
      }
      if (M && !short && btn) sh.classList.add('tf-nshelf'); // 列数を指定した動画の棚は、下のボタンをこちらで管理する
      const mine = sh.classList.contains('tf-nshelf') && !short && !!M;
      const all = sh.dataset.tfMore === '1';
      const eff = M ? Math.max(1, Math.min(M, items.length)) : '';
      ['--ytd-rich-grid-slim-items-per-row', '--ytd-rich-grid-items-per-row', '--ytd-rich-shelf-items-count', '--tf-eff'].forEach(k => setS(sh, k, eff));
      items.forEach((it, i) => {
        if (it.hasAttribute('hidden') && M && (i < eff || (mine && all))) it.removeAttribute('hidden');
        setS(it, 'display', !M ? '' : i < eff ? 'block' : short ? 'none' : mine ? (all ? 'block' : 'none') : (ytCollapsed ? 'none' : ''));
      });
      if (mine) { // 下のボタン: 列数より多く読み込めたときだけ出し、文字を今の状態に合わせる(同じ文言のボタンが複数あっても、すべてに適用)
        [...sh.querySelectorAll('button')].filter(x => !x.closest('ytd-rich-item-renderer') && (SH_MORE.test(shLbl(x)) || SH_LESS.test(shLbl(x)))).forEach(bt => {
          const c = bt.closest('ytd-button-renderer') || bt.parentElement;
          if (c) { if (items.length > eff) c.style.removeProperty('display'); else c.style.setProperty('display', 'none', 'important'); }
          // 文字は、ボタンの中に自前のラベルを重ねて表示する(YouTube側の文字・矢印は透明にして隠す。DOMの作りに依存しない)
          let lb = bt.querySelector(':scope > .tf-lbl'); if (!lb) { lb = document.createElement('span'); lb.className = 'tf-lbl'; bt.appendChild(lb); bt.classList.add('tf-lblbtn'); }
          const lk = all ? 'less' : 'more'; if (lb.dataset.k !== lk) { lb.dataset.k = lk; lb.innerHTML = '<span>' + (all ? '一部を表示' : 'もっと見る') + '</span><i class="tf-chv"></i>'; } // 矢印は文字ではなくCSSで描く(上下の位置を中央にそろえるため)
        });
        sh.classList.toggle('tf-more-open', all);
      }
    });
  }
  // 左端の診断: ツールバー・チップ・最初のサムネの位置と、その親要素の余白・位置指定をクリップボードにコピーする
  async function copyLayoutDiag() {
    const info = (e, stop) => { const out = []; for (let n = e; n && n !== stop && out.length < 8; n = n.parentElement) { const c = getComputedStyle(n), r = n.getBoundingClientRect(); out.push(`${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''} L${Math.round(r.left)} W${Math.round(r.width)} pad:${c.paddingLeft} mar:${c.marginLeft} pos:${c.position}${c.transform !== 'none' ? ' tf:' + c.transform : ''}${n.style.paddingLeft ? ' inlinePad:' + n.style.paddingLeft : ''}`); } return out; };
    const chips = $('ytd-browse[page-subtype="home"] #chips-wrapper'), chip = chips && $('yt-chip-cloud-chip-renderer', chips), th = $('ytd-browse[page-subtype="home"] ytd-rich-item-renderer img[src*="ytimg"]');
    const rep = { toolbar: $('#tf-hbar') ? info($('#tf-hbar'), $('ytd-browse')) : null, firstChip: chip ? info(chip, $('ytd-browse')) : 'なし', firstThumb: th ? info(th, $('ytd-rich-grid-renderer')) : 'なし', win: innerWidth };
    const txt = JSON.stringify(rep, null, 1);
    try { await navigator.clipboard.writeText(txt); toast('左端の診断をコピーしました。チャットに貼ってください'); } catch (e) { console.log('[TubeFolio2 layout diag]', txt); toast('コピーできませんでした。コンソールに出力しました'); }
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
      const key = cardKey(card) || collabKey(card);
      // カード自体のレイアウトには触れず、グループ登録済みならサムネに枠色だけ付ける(ホバープレビュー保護)
      const gs0 = key && S.channels[key] ? S.channels[key].groups.map(groupOf).filter(Boolean) : [];
      if (gs0.length) { card.setAttribute('data-tf-on', ''); card.style.setProperty('--tf-c', gs0[0].color); }
      else if (card.hasAttribute('data-tf-on')) { card.removeAttribute('data-tf-on'); card.style.removeProperty('--tf-c'); }
      // ホーム: 登録/非登録の見分け(新D)。クラスを付けるだけで、見た目はCSS。設定で動画ごとに入り切り
      const isSubCh = key ? !!S.channels[key] : (!card.querySelector('a[href*="list=RD"]') && bylineText(card) ? false : null); // null = チャンネルを判定できないカード。名前の行があって一致する登録チャンネルが無ければ、非登録とする
      if (isHome()) {
        card.classList.toggle('tf-sub', isSubCh === true); card.classList.toggle('tf-unsub', isSubCh === false);
        card.classList.toggle('tf-mix', isSubCh === null && !!card.querySelector('a[href*="list=RD"]')); // ミックスリスト: チャンネルが決まらないので、灰色の線で示す
        const nestOn = (S.settings.test || {}).nest !== false;
        card.classList.toggle('tfx-nest', nestOn);
        const th = card.querySelector('a[href*="/watch?v="] img, a[href^="/shorts/"] img, ytd-thumbnail img, yt-thumbnail-view-model img');
        if (th && !th.classList.contains('tf-thimg')) th.classList.add('tf-thimg');
        if (nestOn && th) { // サムネの位置をカード基準で測り、目印(疑似要素)をサムネにぴったり重ねる
          const bx = thBox(th), r = bx.rect, c = card.getBoundingClientRect();
          if (r.width > 20) { const st = card.style; st.setProperty('--tf-tt', (r.top - c.top).toFixed(1) + 'px'); st.setProperty('--tf-tl', (r.left - c.left).toFixed(1) + 'px'); st.setProperty('--tf-tr', bx.rad.toFixed(1) + 'px'); st.setProperty('--tf-tw', r.width.toFixed(1) + 'px'); st.setProperty('--tf-th', r.height.toFixed(1) + 'px'); st.setProperty('--tf-bw', r.width >= 330 ? '2.667px' : '2px'); }
        }
      } else if (card.classList.contains('tf-sub') || card.classList.contains('tf-unsub') || card.classList.contains('tf-mix')) card.classList.remove('tf-sub', 'tf-unsub', 'tf-mix', 'tfx-nest');
      // フィルタ(登録フィード)
      let hide = false;
      if (isSubs()) {
        const ag = S.settings.activeGroup;
        const gs = key && S.channels[key] ? S.channels[key].groups.filter(id => groupOf(id)) : [];
        if (ag === 'none') hide = gs.length > 0;
        else if (ag !== 'all') { const sub = TF.subtree(S.groups, ag); hide = !gs.some(id => sub.has(id)); }
        if (!hide && S.settings.hideWatched && watchedPct(card) >= 80) hide = true;
      }
      if (S.settings.hideMix && card.querySelector('a[href*="list=RD"]')) hide = true; // ミックスリスト(自動で作られる再生リスト)を隠す
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
  const GEAR_IMG = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHAAAABwCAYAAADG4PRLAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAFPNSURBVHhe7b0HdFvZde89KU4cPzuJ4zguceLYLy/F8Uvel5eX5KVNHMd2bE/1SKM60syojTQqlNgr2AACBEES7GDvvfcOgr1XEES5Bb2DvZPA/1sXHGkkSJqRRnLi5Pm3FtesEc85F9Bf+5R99t73hRd+zs/5jwQs/OJqwMDnEbP0B7ts9be2I2QvbrDm/3UlYuk7lijZ9w3RSz/QsVXf0bPl31XHyP9Fm6j9tibN/M2xZNkXJkWTn/Ic7+f8FAFL/OkdwdQfuoRLL7sES77OGGm2k6PodXKJWWcMoXdyyJWDKLlrL0qJzWgV1rgEHDwSFj4FcxwNvYCGPtmwps0wmugc84I8xyCZz9UXLpZYg+cqLMdGK4zf6iic/W+ez/05z8BO5ug3DpPGT7iSp5NdKdKhQ/70CgQLQCIBCCiARwEcFRAtx2G0HLtRMqxHy7HMVsLOUcDCVcDIJ6CLI6BOoEAla0Gm6UHkmKAqtEJZ5sBS5TKmKswYLNNsjtRapvrqTVkddfq3m5vtf+r5eX7OE+DKH/zvh9nj7zqzZqqcqeNmpM0A6YtA0jzAn4aTM4nD6AkcRE5iP3wGe2Ez2GHNYTN8AWsRi3BELcLKlsEUswQ9Vw5NrAJUnALKBBWWhCQWkknMpBGYyCQwmk1gKJdAfyEFSZkWA7VWDDavoLvZhqZGk72+ydRa2Wq5UdRq/Jbn5/w59wFR42dcVdM/dBWNFzjzJwzInwFy54CUcTjjh3HIH8Z+zBD22KPYixp3i3cQPo298BnshM9iK3wO65GLWI5cgjV6CWbOIgxcObSxCtB8BZTxSsiFKiwmqzCXqsJ0BoHxLALDOST680j0FpDoLCLRWkygsYxAfRWJunoNGtqtqO22o7TbbC/sNdWWDDlOJtTN/Kbn5/9/FpQMfN5VOvyeq2JiGMXDQOkskD2Kg9R+7AslOIgfwIFgGIc8RsAR7LHHsB81gf2IaeyxZrDrFm8eGxFSrEYtws6WwcxegiFGDl2sAmq+AoRACXmiErIkJaSpKsxkEJgQERjLJjCYQ6Avn0RPAYn2IgItZSQaKgjUVBEor1ahuEaFggYCBR0alA46kD9gQc6YbV40ZglIn7H/ruf3+X8GV0HXF1xVI/7O0gE5yseA0nG4siQ4yBDjILUP+8kDOEgcxEH8EA74wzjgjmCfM4b96HHsR0xijzWNXWbqDJvDFkuKzYglrEUrsMpVwRFHwZGogTVJA2OyFrpULch0LRQZGkhFasxkUpjIJDGcTaA/h4A4n0BnIYG2YgJNZSRqKwhUVRMoqyFQVE8gr1GFnBYVMtqUSO1UQTRsQMa0A/FjRl3sjI3DnbN/zfP7/ZdFKWz91cM6yQVXZd8CakaBkgG4cnqwn9mL/Yw+7KdLcJAygAMhY3lDOIgbxgFvBPsxY9hnT+AgagrOyDkgYhGIJgAODcSoscehscJRwcYjtszxxIohhTSoU0kdlUbqCBGll2fSy7IczdZ8jhbzeXosFJsxV+bARLkVA6V6dBbTaCkmUV9GoKaSQEU1gZJaEoUNJHKbVMhsVSGtXQVhpxKCbiV4vUrwRnSInV9GxJSZDl10+NwYVf665/f9L4Wrc/hFZ5OkG41DQNUgnLkdOMjuwn5WD/YzerGf3od9ZupMGsBBwtAHAo7gMHYMiJsHEpRAAol9zoJrM2zKthU2P7TGWig2hU1GacKmz+uiZT9eipr+O0XszP+isqmvKzN1X1NmKr+mKlP93kjq/J+Pixb+bjRb8eO+9Pk3u1JnA/tzqey+Ik1PR4HK0F5MOXvrrehqsaG5yYDKOgrFdSQKGkjkNBPIaFMhuUOJhE4l+D0qsMVKhPcpENIvR+iUAWEyBwKktkkfmf11z+/9n571itYvutr64l3NfXtoHoSzpBOH+V04zO3BQXYv9kWMeGLsp0qwnyTBXny/WzwkTAKpMiBpEXvxc+atuOmOVd5k2Bpn/kfy4I5vtP6b8Fc9n/W0sFisX67JmPhKZxnx3dYKwr+xlmxoatFq69sNqBfbUdJpQFYridQ2FRI7lYjrUoLbq0RknxJh/UoEDyrgN6iA94gKAYtW+MjMuKWyFl2Xq7/h+az/lBy0dn7X1S6ZRucQUN2Fw5I2HBS24zC/G4d5Yuxniu+Jt5ckwUHCIJA0DSTPYU8wYd9MmKhdT5y+YI4f+OYLL7zwC57j/zQoKJj8/YpmxamKVqqksF1tyJeYkdFvhqCbBLdbgSixAuESBUIGFAhgBBxWwnuEgNeoCjemKdxWr+AqZaMuEObTnmP/p+Kwo8fX1SleQ2sfDktbcFDShsPiDhwWdOIwrxsHOUfWd5AmhjNlAEifBlKmsJ8wPrca2x9s4vb8meeYj2I2WPINInrsrzz//HGIU6R/OJYs+yPPP38UOdWKb6a3KK4Lu8jB+D4N4scsiJRQCGUEHFQgcEgBn2EV7owRuDVO4OqkCpemlLikMuEd2nJ4SmfnnzWZ/nN5dzbb2r7i7BaXoLsfqO/AYWkzDktbcVjchoOCDhzmdeEwpwcHWb04EImB/EkgZxp7qaNjK3F9705yK3/Dc8zHwYhn48zPb8Sqtmw8hTfreOWveLa5n6kU1VvSNL1uXqRX96Uu/B/P3z+OyyLRp/g99E/4Ek03d1gHzowZIcME/IeY6ZOA1xiB98cJXJlS4cK0Cmen5TglpXDKsIrXtPaeHyzp/9hzzJ9J9sTibzv7+kfQNwjUNOOw4gPxSlqxX9COg9xOHGR34yCzF8gdAkpmsJ83vriSOXhJyqr8rOd4H4VS2P/F5dj5cSToscUmsScwwCog6mTxsq94tu3iTv7GtJDIlKeZsJRqgjzHhoVCg1qSK/tLz7YfhUgk+hS3f+lYzAQ9xJk3I3haj9vM1DlO4L0JAhenlDg/pcDpaSWOzSrw6oIKrxtX8ZrGTh2jll/0HO9nCtdg33dcPT169ErgqmmGs6oZh+WtOCxtw0FRO/bzO3CQ1YVDUS9QOInDnOG1nZyhcKOw9YueY30cly9f/tQab6EWiQYsR0phi5DCzlZiP8UGq1ArVXLn/vZu27G42T9SpmjFugwHpIlqTAoJjKWoIC9ZxkSRWtqaOfrU5zhWpfiz0SOKm6GTtD5QYcPVKRIXJxQ4P6nA2SkFTswq8fqCCi8vEvixlMQbtB0n1MuOMwrrKc+xfibAQNe/ugbEVnT3wFnTAGc1Y32tOChtda99B4UdOMjpAHIHgKJJ7GYPdq2Khp54CvPEEjURDoEGG5EyOCKksEXKYGXLYWQrsZFogzlRb1ziLXxnPm7pfysT1Qp9mh0LAhIzQgKTKQRG01UYFqkgrVyGJFdRVXn8+C95PuNJ8O0Z/2PfaWXZ9UUdLixocXZSjpPTchybU+AVKYGXFmm8skDj1RkCJ5ZMOEus7L0lNVzyHOc/FNdA9/dckk4bOjvuiXdQ0YKD8rviteMgrwMoHcFhwcjWdtZgmJT10WvVR2GPmPjeDlu2txslx0q4FI6IRVgjZTBFLsEQLYeGrYBVYAQVR67KBaRdk2yGVEBgLpHEdDKBiRSVW8BBkRIDWRTGSyzoyFq66fmcp+HKmOzSpQW15W3CjGOM9c2r8LKUxEtSGq/M03hthsKxSQKn5g04v2g/uDBtveg5xn8IBwPd33P2dTrQ1Y7D2jo4a5qOps6yFvfUeVjcDldBB1A5hv2iQeVqtuT7nmM8DVJW+29tRM3NgkNiNWwOy+GLsEfKYImUwRi1BH2UHFqOElQMAa1AB0qogyxehYVExvpITCSrMJqmwkiGCgMiFXpEKgwUmtBRSNkasqb+0PN5T8OlCdlfvrOkGTmrceCVRRovSSm8zFjfLIXXpxkBSZwYJXBu2oiLc469S2Pm/1gRD0a6/tk11GNDdwcO6+rhrG2Ck9m4VDLiHe06nYWdQPUYdgv6eyzC2v/uOcbTssKZiEAshfXQOaywpHDcE3DJLaA2egkathIkj4CKT0AuICFNIDEnZKyPxDgzfWYQGMpQQSJSoTuLRHsOgf5qGxqKZIWez3tazg4N/c5bS+qyN3XLeGlJh5fnSLd4b0ySOD5O4fQohTNDBN6ZMOH9mdW968PGc55j/Luw19P2Z87Bbg36OuGsr4OzrhHOWmbj0oLDMka8VqCkyy3eVrGkaCah7pmvYDQxA9/c4i7YDtnyI+tjSWFnLcLKiMgm4OCqoWPLQXOVIGMJKOMILMWTbuubTabca99Mlh6T2Tr0p6vQJyLQnU2gNU+FjlIN2mt12xUlU//X87lPy/Hjx3/ppFzDP6G24zWZDq9PkTg2QeLkGIUzIxTeGqLwtoTGlTErvCaWV7xHbf/iOcZPlY2amt9xSjrGMdANZ30tnPUNR9ZX3YLDihY4S9qAUka8EWyVSOImRaLnEnvi4E5HIVGL9Yh5rITPw/GBgMsRSugjZes0W6ZfTjCA5imhiiUhj6OwGE9iPpHEVDKBxRwLxjPVtoF0lXEoS4teEYGOHBVaC5RoLlGhr2MZjfVkvudzPylnF9UhpxQmHJvX4/g46bY+RrzzAzTekahxQUzhxqgDt4fsWr8ezRM5LZ4ZFov1i87etjIM9cLZUIPDugY465ips+Xe1ImyTqB+GFvlEq5n/08Ks/ats2dJVyyBtch5rEYuwhEhg40lwzbPADJiIXKKM/WH6jhifDnJDhWPgkxAQZpAYTaRgDLHylifWpKu+OvONOkrg7laiLNptOep0FKsQmOZCi0NOjQ2qVcq6uee26H73BTl/5bMipPTOpweIfHW4JH1XeijcbmXxpVOCt4jq/Dtsw36d5FP7MD4xBxKOn0w1ANXU5173TusbXRvXI7Ea4GLsb7GEWxV9GZ59n0WzJFjpw+5SuxELmItUoqVKBnskUvYiFHDyF7SDbI6v8q0G2QNflUdr2m1p69CkUBDKqRA5y1jRqRWDmccHdpffJH1y53Zip6RMuvRJW4pgfoKArXVBNq6l1FUowj3fP6zcH5UFfXOvBVnxzQ4N0DhHUY8MYUr3RTe66RxrZ1C4PAGgrrMKZ59nyv7Qz3/5Bzo3kJH8wfiNeGQEa+qCQdlzXAWtQD1Q9gp76kUs1if9uz/DPzCStRMGbgabITNY5U5OkQuwsYEMSWaQccsRt7feDB78HNEMl1sEDlgyFvDYpZuXJw0+Sf3t2nLWvhJX7kenWVqNJURqKsgUFlFoK7DiuImaorP73iu/su3B1TxF+eXcW5AjXf7KFzuVuO9LhrXOmlcb6Nwu02L4J5lhLTofjqbGtfw8G85Jb1z6O/FYUM9XO5p80PxDouagZpB7JZ2DdmLWp/rxabUR/zlrQip1hWlwnroPFZCF2EPl2GdR8PCVy4vRk7/D88+whvCX50TkumLGdqm7sSRL3n+Pi9P/OnOMnKmr96K+vK7IRQEipo0yG2m9tNrpX/t2edZYHyplyVU5dXpZbwrpnGli8bVDgrX2yncbKHg1UgjsMOO8DaHKbJJ99D3eWYOutsFGOqHs7ERhw1NcNU1fyBgCw5LmoDKXuyVdOkNosYH/qU/D0whYy/thC9iJ0yKtTDpkYCsRezHG2GKU1R7tr8f5r7P88/u0lZBhA60OFBXSbqtr6iaQE4tgcJuC9JaFN6e7Z+VG639X7zaR89eH1/+YOqkcbOVwu1mGt6NWvjUaRDRtYnwGmN9ZSU+kWfokey3tPy9s6N1D81NR2ue+7zHiMe4y1qAqi4c1vQdmnOafiq30SthMxGIprARsoC10EWssI42MJtxGtAxs+96tn9Saorm/ra1TrNdX6tFaSWJvGoCmXUq5PVakNAoq/ds/zy43i7961sDxrWb/RbcaKPh1ULjTpMaPvUa+NRoEFCtQ2TjCsKL1W959v1EKIXCXz1sbu1BVxecNbVwVjfAWdUIZ1WTWzzGWY22MWxX98Z79n1e2EOnmhBNYyN4Aauhi1hmybDOIWDlyJelrNFPHK9ZWSn9bFWFcrau3oSCChLZtQTSG5XI6NEjsU2p4NSOfcGzz/PgTpv8TsDwMrw6tB9Ynxq+tTT8qtTwL9eAVedAeLFByRLJf9uz71Oz3dR0Hp3dcNU2HPk5KxtwWNGIA8ZVVtYCJkRip7Z34nmve3ehb4l/cyNibpEJYFoPXcBqmAwO5ugQo4Yucn5cKVQ+U1hFWZkit77ZhrxKEpm1BNKalEjpUiNJTG3Gdcz/b8/2zwMWq/JX/NvphqCBVdxupHGnjoZvNQ2/CjUCyjUIKtEipnYdEbn0A5uzp8ZWX/+5/dZOKTp64Kw6srzDiqajC9riFqC0HYeVPTu24vbvePZ9XhAhff9zm6PYAU+PrcglrEQsuQXc5eqhi1h45kN3RZXiZnWzBTk1FEQNBFKbVRB2UUgc1IPdOnfMs/3zwqt05s98m9TLvq0m3Kmh4VtBw79cjaBSDUKLtIgqtyG6wGBlpUg/uX92s7nDF5IhOOub3W4y95pX1oTDkma4CpldpwTrBa3Jnv2eJ0uswa8ux8gyNjkK5TaXBGIN2IymsMszwhgtZ3m2f1pyimdfKq5TI7eRQnqjCsJWAnGdBBLHrOD0Kv092z9PfKqVAYEdy/Cu1sKvXI2A0iPrYxVpEVGog6ByA+x0Mt2z3xNhb2399d3mDgLdfUc+zppWOCuYy1nmvNcElHVgr6hVr8+t+z3Pvj8NDKzJ39ZHzr3iiF7KtkXKLRCuQsNZes+z3dOSXTj07fw6ciOnVYuUZhUEbSrEdBEQTFkRPUD81NZ1Blal9LO+1fRcUKMDvqVqBJZqEFysRXihFlEFWvCK7eCKdKshvPGn9wyt17RdQVc/0NgGZ20rnFWt7gtaxlHtKmkFavuxWdjs49nPE4Oo8bfX8sR/68joPO1I6oreS5YIt+L7SrcFA5VbcUMVmzEDlVvs4cLt6LF4e/hA6Dp39Ngqd+KvDXGTj13AFaz5b2pjZaFL/Jl/9vzd05JRI/tKQYuOzunUQ9isQmybCtFM4O60FRGDquy77Vhi8S+f6Z7+1mnJ4qune2ZC3hkgBJd6VXkX2hVVV9tUlTeaVSU+zXSiX+0iN7hCeolVIf+XqOLFrz/4tIfxK5GdDK23uAIrdQgp1SCsmLE+LaLyteDkGCEs2gSHr+B59vtIGC/KdkXLONrEcFZ/cNarYCywHYdlbUB9P/arxEp5SeMj/5KZa6MtUceVLVFP+Z6oV3WQM7iJ3GEgewLImAZSp4DkGUA4CwjmgLgFIE4GxMmB2EXscxc2tiJnVBth03XbrEUfbcD4/5m8/Hwc4p4Iha2/ntOqmczpNSG+VQVupwqR3QpET5kRPETW3G13rm/h3AWZzfrWtB5vz1hxYdqB98YdeH/EhpuDdvj02xEgdiC0y4HwNivC6/T7EZVaXWgB2RaRr/YJTJz/8weffARzwA8tJ4c4TSsIK9GAVaxFZIEWUbk6sLMMEOStgBNHGH2uNX/Zs+9jMWZV/NtBdasT7tuFJhyUH92uH5a3w1neATSPYqNKfNuz30p263f3c7tz97O7Tcjth1s00QCQ2gcIe+GKF+MwVowDbh8OYvpxwO7HQfQQDqJGcBA5hv3ICRxGzAIRC0C4HIiigEg1tkIWd9bC5vrWImReukd4XZ4FFqvys+lNylGR2ITYdhXY3SqE9yoQPmWA/6Cy626782PUzQuqTZwa1+Fsvxpv96rxbjeFS+0UrrWRuNlEwauegrf7OKBBYKUeoRUWRFYug13qQFSOfo2Toa6LSV56439fvvzAP8aIEvlxTq0FEaX6e9YXla0DO0OPmAwjEtLsCA+eef/+Ph/JSn5tIZrFcJUzEWXMzwcXtKVtQF0/9qr6aCKt5nfutjeXtP3f/ZLemoO8rgMUDwLZPXCldsCZ3AGnsBOu+C64BD04jOvFIU+MwxjJBwIO4CB6GAdRoziIGMNe+AT2WJPYDZ3CTtA0tgPnsBW0gL1QORCpATgabHKUtmW+Ks/IX/ynBz/1J+Nd3+zPJTbIxtIkRrf1RXWrENqrRNiMCYFjZMfddhcn9W+emzbh9JAab/epcbFXjcuMO6ydwvstJG41kPCqo+BdRcG3jIZfiRqB+TSCc2mEZqsRlWtCXMEK+JlGCDP0PYmJsu8BcAcq3xYM/1pUmXYqtnYFEfkaROboEJWpBztdD26qHkmidXAiZAMfFzLpZoqf/fXt4iYzarvhZC5mS1vhLG7BYWELnEXtQP0o1oq7ou+2r6ys/KWNst5htDBpYR1wprXiMLUdzpROOJO74BR2wRnfDScjXmwvnDESODn9cLIHcPiB9e1HjGE/fBy7jHhhU9gNncFu8Ay2g+ewGbSAjWApNkJk2AiVYTeaBOJNWIkld22xZIWSLXumUD1GwPjGpbHkfiM4XSqE9ygR1KdA8JwJgRPqewJeGlG/cX5cjzP9NN7ppXGxi8Z7HTSut5C40UjiVh0Jr2oK3hU0/EppBBTTCC5QIzSPBiubRoRIDXaaGrHpBmQX7SFFpLHEpS7c2wBG5xE3eVWriMjRIzJTj2jG+tL04CXrkZhihyBGsxt8Q/J39z744zDl17yDejFQ3gZnyYfiHRa0AkXd2M3v2DDmtD7g/dgplRSgahROURucaR1H4iUx4nXDlcCI1wNnbC8Q0wdwhwAmWYU/CcTOAtw5IHoWrogZHIRNYy9kyi3eTvAstkLm3eJthsiwGbqE9bAlrLBkcITLsBJNYCfOAnOseo/mq4pn+bPfvv8zPSnXWCmfjW8nRoUDJkR1KxEqVsJfokTAnBneY0TnvXaj9KkL40ac7aPxbo8aV3q0uN6jx51uE/w6zfBrNcGnVgffcg38GesrpBGSRyMsV42ITDWiMjSISdeCn6ZFes4qktPVc7cFFb92d3yWcPRrrGy1OSrPhsgMPdiMeCl68JP0ECSaIEpeBy94/p7hPJbV4uZqtAy6rY8R0C1efiucuW1A2QC2c9obPPus5La/i7JhuDI7cZjWCVdK95GACd1AfC+QPAIkTwD8EWxH9x3scQb1B7wJ2UHspOyAO6PaDB9d3wmbBCJkQJQKiFTBxZJjN4QRT4rNUEZAGdZDZVgJk8HOksESvgR9pBxGLoWVZCt0KXozJdL6FbGeziPkL+r6jYQezZRgyAhWrxJBEhV8BpTwXTDj1hjZcrfdJbH89s2lXVwdX8YVsRaXWpX77zeTVt9O41JQu2kxsF6j8ytX7YdU6RFZ60BUpR1heRqEZ9GIFmkQk6EHL12PuFQdMvM2kZKie+juLzyDyuMVriMqTQdOqg68JB0ESQYkJpqRmbKBONbi5O1jgnuiP8RiSvHX14uaLKjrhdNtgW04LGyDM68NyGkHiiSwpzU95DymU2v/9CBHvIzMPjhTuuBK7nZPna7EPhwm9h/uJPRNbPB7+ds8yQkzq/Nvl3zrv7rCEv8m87PGGfsCHdj+J/bggX9dD5q4uBoyLlwPmxnajZI7EMPk/ulwEE5gM2QJqyGLbgFtrCWYIo5CCLUcBQieErpkI8zZy1CI9IPDqU8+rfLqp74a20NpOAM6hPQq4devhBeTbSSz4sYEmXe33aW2uYtX+2jJ1U4y6mqb/Pilqtm/uZI38gcBzfOfZ9XN/GZQ0cRX/PJn/jqigng9rJBghReQvdH5mp1o925SA26GFrEpOgiSTUhOtbniY+WvPvhJXnghJGHxNU62xcVJNyEmRYfYJD3ik4wQJpiQnrgMYTS9F3G9/+89+91DlVp2wlXZDVR0usVzFrfDWdgBZ34HUCTGfna31RzfzGQJPQBTq2U7rbsD2SNwJTJrHvPTAyQN4SBpZMMY0/FUPkUmZtQeOfWn6zHSyxvRS3VbEXI7onU4iKTdUyhjfaZIBfRsBTRMABOfgEJAYCmBhka0DJnIuDmWqgqvfILYU1b50LejuxSbEf1qBPYp4T2gwPVhJW7JzLg6obxnJZcbGz/DeuGFX3yw9+OJjpd8JSaf1vGLreBkasFJ1yImSYvEtGXEJ+gINnv6oWj0QPbIlzgZOlqQswJeigGCJCMSEo0QCoxIi7ciJ24VnNvjgZ797qHPqElGwwCcjI+zqB2HjHiFnXDmd7rjOrfze5o9+9xlI118G3ljQGIXXPxuOPk9cMVJgLRpbMT3P3TkeBqMrOlv2UPnglYilxZ3eFpsxWphilZCx1GAjlW5BXSHD8bTmIunsJBigCx3GaO52taugo/OQopsnf9RdB+TbUTBT6LArUEF3htV4JrMhEtjS8Ge7Z8UVtb8WX6p2cnJ0YOToQUnRYeYRB1SRZsQJGgemj7vEpepL0op3AI/2Yh4oRGJCQYkxRmQxrcgP2Eb8X7Spkem2bGOs35lPa9liPGwuHP4ipg0sA44CzrhyjsScK1I4uvZ7y7a9Irf3UsXG5E2eLRp4ffCGdsDCCeww+0flz7JFvhjGL7d/lv66IVrlljlwnqiCbZ4PUieCko+gaU4CgvxNGaENCaSKYymayAtX8d4hVnZUSp/bNgep5e8xh0zI0hCuNe+68MKXBxX4cKCBuf6Zt70bP8kMIFfkVlkd2zpqnv9YwTkMtNnigUJScbNmBjFX3j2uUuCSPtucs4qBClGJAiNEMYbkRxnQhrfjLy4dcT7L+qu/Sjv4UP9fEzON1dzmlZQ0YvDwna3cMzPISNeYS/2C8X7urTWewkjnljYLX+/n9hHuZKG3EcGJ18MJ08McPqxzx50GkNbfujZ55Myxun6giGe8NPE03prqh2EQAspn8JcohpTKWqMp6kxnKmGJEeN8cpl9FdaNlvLNJc9x2GI7FKmcCZt8B9Q4faQEldHlbgwrca5GXL3/MDkY7/vRxGRsfCd6DzDflSWEdHM1JmqAzeZEdCM+ATjGo+jPOPZ5y58/vS3EtJNa8J0O4SJRiQJTEjhW5DGtSCL60BykBJRl7r+1bPfC8r4kpd389uBkh73lOnM68BhbicOc7qAshHsFQ7IpYKK3/LsNx/T/Pmt9P6ow5ShFcT1wxXTDWdMDw45vTjkiOGM6gMEM9jk9DOhDw+b/jMwy5d/QxGvyiaEetDpVswxwbupaoxmqDGYrYY4V4POXDV6ymxoq7S6KkqosPs/A4sl/uXgdmlf+IQJ3gMq3BxS4cqYChelerw9S6rPtIqfOmuJGT86l6gQlG0gMkOLyFQN2Eka9/TJE+gQL7AgNcHiEgkNBUl8+UNp2CyW+LNJGabp9Kx1CONNSOKbkcqzIJ1jRjbHhrxIK2LfH77h2e8FfVKFL8ol7rOeM48RjilA0InDrG6gbBLbOb3M8eEBAbYzev7pIHN4FHkzQPKQ+6zniumBi90DZ1QvXJFiOMPFQPQIXLxJWNl9/3h//+fFfDLxujzLIFcXr2FapMWwiIYkm0Z3jhptuWrUF9CoKzOiqWkFhaUKASMc08+revybwb0qU8CIBjcHlHhvWIV3mOlTacL5icW+45WVTx2XEpE+8/cxhWZw8uyISFMjMlkDdoIG3AQd+PF6JAj0SE2woih9B7mJDjKTo33IGgVJdLEoaxtCgQlJsSakxpiQzjYjm21FSfQ6+NfGRJ59XtAllGejagiuwi73tHmY3eUWzynqAQrHsZHedS9W0pZd/7mdbEmEUzS0jfQxIF585Glh1j1eL5wcMVyRfXCF9wGRwwBnCrvs0QF9ZN//9+BTnx8DIunvzxcYy2SlDozlmdCdSaMjh0Zzvhp1hWpUlGjQ1LGJ0hpKzGLBvZsMaZv9Sdiw1uU9SODaoAIXR5R4a1yJdwkzzs/I+Z7PeBI4WdI/jMpU13CyzOBmrSA6Se+2Pr5Qh8REPYTxeiTxDUiJMSOXv4HC2FUUxBpEaXzinmsyNo7ySUvdgJBvQQrPhDSOCRmMgFFWlLI3EH9jWvziiy9+GKzFxPIbE6t7UD7onj7vTp2HmT2AqA/IHoQtpfNekM1W9gAPpQtA6gBcjHuM1wsXtxdOrhhObh9cHAnAHQYS5pj1z7YZLg6c9S58rnGWDCJW42dahR8e3JnvMVRAew/m6g8GCm1oyaHRUKhGdYkaFVU61HWuoqiBujf9RPQRKZGzVngNMtanxDujSpyZInBWqsa5SdmzBGj9QlSS4hQ3w7iQnLcJociB+CQ9hIyAcUYk80xI5ZiRHmVCHtuO+kQgP8rQePw4y73Ri40lXhfGmZHMtyGVa0Ya24zMKAtywq0oi95Aym2Z7PJLog9vgupusX5zNa1x1i1gbpd76nRn0jJp0Fn92EvrPVhO6fqHu+3XE7r9IZoA4nrh+kA8V0wfnGwJnNESuGIGcRA3urkbN5zriOn8n/ce9BxZTCP/kco29VP59onRDNkDKWstosXX+krMBnHVMmqL1ais0KCqyYKiWs1KSuGwO0SBlVL52VCxShYyacQtZu0bUeHcmBKnF7U4MasyHuvufuYyWuzEkS/FpRCcpAyTOSHJjMR4A5LjjEjnm5HJNSGbbUJOuBmVnAPkhOoLX3jhyLnNZs//eXyMZjON7zgSOtqMrEgrcllWlEeuI9ObNLHe6frwPD4Vlf31jcxWPVM1yZnTjcOsHrd4zoxet/VtJnUvK2Kq73Wwc1u/tsfvMUEwCCe3By5eH1z3LI+pqjS45uD2/uDeA54jY5yxL8gTSD6RYtjRZ62AzlnFdIZ+bzBd7Xd/u+ZCxd90VBsUXa1rqKzSoK5rHfn1dPnd3we1zP0waEhzeGeYxvvDKlwYV+HslApnKQtOTC/V3j/Ws8KKGf9mXLxWlp6yglSBCSK+Gdk8M3I5ZhRHL6M4wn6YHay4d7sSGDjypcQYjT4zbg2p0SZkRJmRHWFBHsuC0vBVZN4h96LPdH64Q5aycr61mdG2gsJ+OJl1zy2eGM40xgJHsJ3aR8njSh64vF2L6+AidRJgLNAtYD9c7H64ogbh5Ezvr4b2Bd3f/nmgiF/8V7VAPW1NXQaRaHAf2ieFFKYzTJguWEF/kS6dz/9wqi7NH/uz1mbzQkv3FkpbLciuk79293d+3TJR4LQV1wZVuDSixPkJFU7PkThDGHFybO65pkCz2fI3ExPtK0kCG1JjTRDxzMiJsSAv2ox6wQGKo/TNlcc/3DCxLk9+Jp1vnckRbCEtyozMSAuyWVbkhVpQylpGnrcGEac7PjyWjYeKXlxLa3Eirw/OzG64MsVHAqaI3bfoB+kjU9r7POcMqqi639tJ6DcgacJtea5oCZwREjhD+4DQURyGTh4sB/Sev7/PJ4b1wi9q4lTBFqF+055kgyKWwkIchdkE5tCuxlAqjYFsPSbrNtBTa+qqLVi4V6i1rEz2R1UdDiK3Qa0QDGvd38GvRvy1QInKcGdMi0tDCpwfVeD0hAInl7R4c15lfWtg8vcfeP4zEBO7+GpCkm0tMWEV8TFGJDMbkmgTsiMtKGavooK7upUVIX/Av8k4AjL4tva8+F239WVFWJAbZkFBqAVlocso8bNA8M7whXsdFtlF393O6ATyJHBm9sApEsOZzgjIbGCmsZcy3Ct+RIi6Q9B7BcJpIGoQLhYjXj+cwQNwBg4AIVPYj5jdWGWPPVO1ooloyVfMcXTFWrINJoEeKj4FGeMyS6AxJaQxmqpGfwaNvjwDhus20Nvo2Kgonn7gmRml83+VWSV76e7/h/UueYfNmHF9SIl3R+Q4O6bAcaY4AWXBsbmlovv7PgvxqcqXUzLtyylpa0jgf7B5YZuQHmlGFsuCypg95ISoBZ79GFI4hpp8wS5ETNtwM/LCLCgMsaIsZBmV/stIvTj7YUCXTlD9nT1mw5LT/6F4qWI4kyRA1gx20obrHhj9A44fr/yljajeOvBm4QwZgCtkCK7gIbiChuEMGgUipXBxZLvrkRP+jBV59v84ZOzxb1t51Ph2ggNaLgWCR0IuoLEopDGbrMZEihrD6RqMF9khKTYftBUbCsqzP/pekCUWfzZ0iJ4NmDXjCjN1jipxclyBN+ZI/GSRdr3eP/Vvnn0+CbwU8t3ETNtGStY6EhOMSBaYkMozI4NtQUaECaUxO8gNNc6yLrQ/5BxhSI8xVRbF7SEz0uze6OSHWlEUbEN54ApqAtaQ8/7Sh54lc1zD9w6y+tw7TkY8F1P6KlkCp7AfEM1iO3HosXkCSlbr17bDB5WImoMzaBDO4GE4g0dwGDyBg+AJgDUPcJTYYc2XLvmL/8Cz/+NQsqdftHNJ9SbfDE20CmQMCSWfhCyBxnyyGlNpakzlGLFQtYHBEtNcewF5z8I+Cu8O2Um/CSOujVB4d1SFM+MqHJtU4g3ChNdnFYP/1vpskd6+vMGvstN16bEZdsSnriAunrlNMCE1zoQMnhlZbDNKeOsoZi9viILl93b2nmTG2HKL4w6QGWFGLsuCghArioNsqAhYRl3AOrKvyq/da6yNq/vBYZYEyOyHM00MV0qf2/pcCf1Axiy2BY8XkMES3P53h1GTy4iew2HwMA6DR93i7QdPYjeQ+WEClUhshi4qbFHzZ5jQcs8x7kfHn//xWrzWusE3QhOlAM0hoOKRWIojMZ9AYTpJjcV8B6aKzc6xClNiZcrYw87dR3CrbuY3vQepeW/lBi7O6HB+wYBTizq8oTTiGG3G65PSh7wiTwrznWJytac5OVZpbO4mYlKs4AkMEMQZkcQ3IY1nQgbXhMLYFVTGb7ryoumPjGnNjrFmFPMP3NNnbpgZhcFWlATZUBmwjHr/deTeL6BJ0PydA5HEHUHmTJXAldQPV2I/nPHMdRAj4PBHCshgj+w/dsid2UO0FAdB49gPOhJvJ2Aam/4zWA+YwV64CpscFSxceR/NnT0pZj0cKqeLkf14OZZc3+TroWMroeaSIHkU5HwKUgHjsNZAkbOG6VyzeriQOn5/3/Kahb+obXdb4iN9riE9c3/sJVlquiiRTr89qpSfm1OTJ6Vqy0nK7HhzSdP9vY6nT+oUCIZ/LaJQ/Qan0CjmFa2Am7+B6GQTeIlGxMUb7q19zGE8J2YFFQlbKOIZPnaHnsVxZJfG7iM7jJk+zSgOtqI8wIYqvxU0+K+j8H3Fh1Oomlf33b1UMZA+BFeyBC5hv9v6XIIBIG0ee8LxR66BnixH9b+1Hz2/AZYce36T2PGfwUbALNYC57AStABr6Lw7nmWLq8ZesglLvMmCF1ise2sjxZr7pxUutbzB1UEXoYSWQ4LmUVAKKCwmUFhM1kGZs4LxDG0nU3Hw/mfX1FFXuvq3LFUdOiYU8JEC3uV8Xt6n3+oa+8L5MfrLp4Ym/+RY3/D/fH1o6J4r60m4KZr8/YAS7fXQEsNIVJkd3PINRGVZwE41gpdsRFyiCQkCI4SxJqSwTciKWUVBzAay2foQz7EeRWa0qbKUt4ucUCvyGesLtKPC344av2U0+a4i7/L8hxYsZZX+y1ZSz5GAH1ifK74frrgBd93O3YTx/icNrLUEiP/tIHSOAovAlt8cVgPnsByyAHuYFBaWFEbWAlZjSJhiFTal4MN6ZnPRkr+0cVX6La4B+ggFNFEqqDkkVLEUlhIoKNONIAuXMZGpTUu5ryheSc78N6vL6aoG5jUBkl0UtuhHbghb3evYZdHkp5jidHfbPguXRZOf8a1R/eXtUsUl7wptuXeZ1hhcvQJW5TpC880Iy9IjMsMAbrIRfKER8cxN+gdus9y4DWRzHPsZETovz3EfR0a4vraMu4+8ECuKgqwoDbChws+GOt9lNHg7ILowceVeYxO/6dt7Kf1rSBuFkxHvA+tzxg4ACTPYjxubnb3vgPxxqL27v7UdttADjhbb4UrYQhdgYS3AxGL+K4cthjyUc2ZP3G2/ECX5PVu8an4vwQxDpALaaCUotgoqLomlWArKZCNUeTZMZJMPpFs1liy93FylVzU1rKCgUoPcRiNS6wiTIH/Y7Qbzrxz4/fC+pa7wKX2Jz4iSfWtEfvWSZObH744t/dXJkfk/PyuZ/caZ1tGvvVon+b0TdZLfO1Mj/trZjtlvvNO+8BfnaqV//U6t9NR7HeoQr05Twa1Get670bDm2+pAQPMa/Cut8CvUIzBPj7AsHSIy9IhOM4CXZHJHkSUyGxeBA0Wp+8jkmbXJYaoHpvuPgjkH5kZaO8pj9tzWVxxoRZm/BZW+VjT5rKL2pglpbw19uGkzRXV8Yy+x34S0Mbd4zNrnjBuAkzcIxE1hkz2gG/N5xC3wRzDpX/kbdvZs7CpXubPH17uL8RhDpViP0UMVPie8247JZTfwllr3hVYY2AroYpTQxKhAMpsWZvpM0EOZZsZI8oPhDW3lqh/01lu2O+rtKCyjkF1FI71Bi8QG0iVoPApq8i7s+G+hozQRRe/CZ9GG61IL3p3V4swcvX1ynl49IVXrTsyqyZOTGurMmIY6P6ol3x7W6s5LNGtv92h3LvUaca1/GTf71uDVuYxbTRZ41ejhXaaFX7EOQXl6hOYYwMrUIZKJJEsxgJ9gRGI8E0W2hZykdWQn2iviY+YfiiP6KFisyc/kRVhny6K3URBsQwljfb5W1PjY0Oy9hpprusOUUwMf7mDHAgq+sC8cWEDa5NHUKeiHM3YITiaGkzeB7ajhdTWr+xNlwhri5P9g5SnabdFKHAgcUEfLxie5k/fqoWjC5nk7sUaYIpXuTYuGqwLFI93eFqVQB0JkwYRQ/lCaV2MFdaKz0YaqCjUKqtTIrFUjpVGDDIkdSZ3k9bvt/EfpCh+pHRdGSJyfoHF6WoPj81r8ZFGL15cMOCYz4eS8BadnLDg7ZcH5UTPO9Rvwdq8B73ZqcaFZjUsNalyt0+JGlRZ3yrTwLdEioEiPkFwjWFkGhIv0iErVgys0ISllDRnJGxAJlydEfO3JBz/1k8G+2f2lrBC9vjRiE0VBdpT521HtY0f9bTvafTbQ8L7Jmvv2fSkGjJdlS9ArYQKQmHXPxWec1EM4ZA8D7HEcciZcq9FDn9g5zXqR9ctE+NwpirPYuRgzdc9pqwwaf9kaQTht4RS0EUpo2CrQMQSUfAoqoR663GVMpCkiHhztiIKC+b+qKNNslNcYkVergaiRRnIrDdHoCvgdyoK77d7vk/nfktrwzhiNt8YpnJgi8Po0iVdmSLwyReL1CRLHR0mcGKJwsl+Ns700znXReKdDgwutalxuUuNqvcYtnle5Ft6lWvgX6xBcYEBoNiOeATEiCxKzN5CUsYn4eL0sga+7yfMd/NyDn/jJSfJX/EVOiHGzNHTtaPPiZ0eNtx0Nt+3o8dlBw/sGOf/1jgc3XSvcriLmyOAWj8c4pIdwGD0MRI8BvAWsRo8+MqbkkyKNHfuymadUrHEN0IYroI5SgWQTUHEJKOJomPLWIROpcz373aWkZP7zxWWkqqLJhux6GulNFBLbKAiHbOBL1POsD1K+r3TN/PO1Ce3+u1ManGEKzs0QeH2WxGszpLuG2RtjFI4PUzjRT+O0WI23utV4u1ONd9s0uNSsxtUGNa7XanCzUuO2Pp9iHQIKDQjLN4NdtApB8RbisqwuQYppIi5Rc4vFerrd7KPIDFEfKw5fQWnwMsr87Kj0taPW245GLwf6fHZRc4V4OE9iM24wGKlzADN1xgzCGT0MZxTjDhsDYuVYDxt6pM/uk0LHyoTbyTZo2cyGRQmCo4KSQ0LOJaFLW4Y0RSMWJ3z0O4qKq4jGys5lZDTSSGqmEdtGgy3WI1Ki3QltPaqH7d81+RvXxknlZaUNp2YovDFLuWt3MuK9Pk7hGCPeII1TfTTO9NA47xaPxqUWNa40anG9XgevWj28a8wIqnEgrHoNEeVrCMvWH0Zn6aQxmbpUbhr9Q8Ht4cdHTD8l2cFqn6qobZQFfWB9vnY03LGj+ZYD/T57qLqsvBdwfI91/tAxxE+47/MY62MEdDECRowBHDm2wsY7cd+Z7VlYjJj4G2MsuW2OVYOMUUIZq4IilsASjwSdZMFiklYz+oiAH08K6ojQkm4HkppoxLVS4LRTCOsmETFhQ0gfea/Oy/vTJO8qacNbciNOqmw4wfzI7TgttePMjAXnJ614d8yGi8NWXBlw4H3JCm72LuN25yqYXad/gwUBFfrdkAojEZhHtgdlKENZ6fQ/s54yjP9JyQnSFddE7aIswIZKPztqfe1ovGNHm5cD/Xd2UHdF/XBirZHd/a29mKFNZtPiZB+J54oYgyt8DIhcxH74PC3zkjxUTPyTQEQvNqwKzCDZSih5R0G5TFXBpWQdFOlm52i89ImKC6RXLfyzqEXjFLbpwG2lENlJIqSHAmvGjsABVQ+zHWfavTu49Lm3JZM/ODWjfOfNaVXgmxPKlBOTdP7pUU31yS6p5Gy7tP+tVpnkXMP8wMUmRceVVm3h+w1Uzo0qKsanSv2+b7H8hG/2/F95ZUw85vvjF1is4T/8JA57T5i1szDMNFcTsY3yACuqfW2oZ6zvth1dXivoum5FzSXFjz37vTB5ufEz+7yJacTNwRU1DFfEqFs8J2scYM3iIGzeZQ4c+q5nv6dlMXruh1oe5WQO6XKOCot8AlIBUxKSBlWwjslM9cMRV48hrWTg88mtallKnxWcDgrh3RSCJTQCxg3wm9Bt3ulbfNIgqruem4/04NwP4/vkZi38KS+Tfo+XamhLSl+2xPAf8Rf7lCT4jP2volDTVlXIGir9bajzsaPxth1tt+wY8NpCx1WdteCtgUffV+7zxrMhkMEZwQg4BhdrDIehE3CGTLmzZTdD5p+pKoTo8uSnlrjyLqvQCnkMAWksgXk+gdk4AvIMC6ZEGrot/nH/yh9NQrMqPW14GdFdNMLENAL6aXgN0bgjc+DawKN3sM9CoGD8xag8fWJsobk/Nke/mli4hqTsLWRkHiIxQd/HYomfqchfZjD5fnX4Osr9HKj2taPe+8j6Om7aMX5nH703LF3HX3hMgfbNqJF3wJMCkeNwho/D+YF4zsBpIJzGZvBcL5PI4tnvSZnmTb9IxWsOCIEG0jgK8wISs/FMLWsaizlW9KconjqUIaFD/sM4iR4RfRoE9tG400/hxiCJa3MmXBpVKM60jj7XdSo4Zf5MXMU24sq2wcu2g5tqRqzQiIQEK0TJqxDyySea/h9HYYihsiF8FxU+VtR629B4x4rW21Z037JhyucAvVcNUZ597rEWOf7Hh+zpFUTNwMk6Eu8wcAqHATNAsAJ7oUurppCxT1xZdp63WGBMtmOBzwhHYTrxKKZFlmPHaCY10PoJqi75Ztd/LqqXnoscs8JHQsJrkMT7wyQuTNC4smTCxdHFD0MPngNMWnSESF3KL9xEVLIB3EQz4hjvi8CIvJRdpHP1PcxFt2e/JyH99szvFgeb9HXBG6jxsaDB24qW21Z0elkhubWM0durh8PXzQ+H1d8FL7zwC/ucuXbEKOAMnoQraBqHgTM4CJiHM0AGROpgDZ2949nvSRiKmvq6NE5lUSbqMRNHYCqBxHgShYk0NabzzJCIlG949nlSgrsWQ8Kn7W7xrg+TeG+UwrsTJC4Rdrw7qx47VvH8tvgMrHjZX8ZkmDdiUx3gJ5qRkGBy37hnxjmQxbXup0apPz4V+hHk+ilP14Suo9rXgVofC5puW9DmZUXXLQvG72xh+KZVNui79NEOgsNo6XXmrdCuwCm4AhgB57AfsIh9RsBwHdaCl/rvj6B6Uqb48+8QKUa35U0mkBgTUhhJpjCbZ0N/FjVR+AwFVu90zf6R3xC1cntSj6ujJC5NkHh7msIZqQbnFBacnpQ/sSP5SeEKtUWp2XuITzS7EzBTYk3u/IUSwR6yojSxnu2fhJJgfW1L2B6q71hQf8eCFi8rOm5Z0XvDDKnvAaburCZ49nmIXdbkn7jCpcsIlsLpP4uDgAXsBS5iN3ARh8EEtlnUvpE199QVIqb5qmIyzYGJBAJjiSSGkykMMWERRQ50Ziqf+JrlcfgOqfL8l1ZxeZzGO1M0zs7QeHOexpuUHcenidEXxc+2ufCEn0D/c1Kq7SBZaEMy34gUnhHpbBOKeVvIizTM8c8+3T/ILJ/5P68ING/UB66g3vvI+tpvWdB1w4KBm3ZMe606R26av+fZ7yGYw/phmKwOERoc+s1j358RT4btYBm2guUAzwpLhCzHs99HURtQ+4XJOBUpTTFhlBEvicRAKoXhHAPEuWpHc47iqbz1j8K7d/Fv7sybt67MGXFuisaJWRqvz9F4eV6NEyorTo7InnqD9FEwhWSFQuMgk7uexDMijWtCJtuCfPYy8iPMhyKW6qmm0aIAmtcavotaXysa71jQ6mVG502z2/qm72xh8qZtZvKy4TOe/R7JYYjqTYRRcPkvYi9Ahp2gJWwHL2EjVIG9KC1W2NSyLnLxiQvu9MXP/eNootI5mazBcDKJ/lQSvWkkRovt6MqjGj3bf1JujFOl76lWcXKKcZnReGWWwkuM+0xuwplpjfrKsOKZw+XvJ45HBmUlbyCNZ0FGjAXZbIs7/asqZhtFrCe/vE3xGftyVbBR0xK8gQYfC1pvW9Bxy4yeG2b0Xzdj0WcP07fsj0+t9sR+Y/TXD0OIJYSqsRMgxXaQHFshCqyHKrEapoKLb4eJrXxi3+hgsuLGXJYFwyk0+tMoiDModGVSGCy2oy598WG30CfkysDCX5yfUW8cl+rx6iyJV+YovML4PadJvK1awzsjxFPNHB8Hjy17MSPetpvJd7itLyfSjPxwC+o4+8gL1t67Efk4SgNV3m0RW6j3taDJx4z222Z03zKh74YJE7dWMOO1sjzvZX66WWo3hAxEpBm7ATJsBsuxEcKIp4QjTInNaD3sHLV1IWrwiV6l05ciS5rPs38onohEd64GXYX6/aqMxWf27tzP6bHFhJO040g85rU3MxSOT9I4NaXHhUmz81K37BPd0T0KHmvqq6k8vS6Hv46sKDNyIswoZJlRF72D4jDTuOhy48dOecIb/V+sCDKqWkM20ehtRssdMzq9zBDfNGPwhhkKnwPMe61mevb7WDYC5790GKrWu8I0WA+Wu61vJUwJW5gS5jAVdvkO5h1F927WHwdzbupNlbXNFNiOxMsg0Z5JorPAgOY8tbn6Oax/93Ose/h3T83T2mMqC16bIfDGFIU3x9U4OazG2xNWXOrXGC83PvgKgk8Mi/WLydHq3nz+FrKY+M0IM4pYZtRGbqMizE4y5zrPLp6U+NJBbaE7aPA2o9nbhPY7JvR4mdF/w4zJW8tY8FrfWfK2PVWVj3s4w7UxYNuxEazAWuiR9VkZAVkE7FE6GGLUa9Jo6f/y7Hc/FYLhX5NkkqPjeRZ0iyi0Z5FoZl44VWRBZZZyQXjjKADpWWDl5X36WnH1vdKOZ2fk759VO/CTWTWOTVB4c1SNk4NqnBHTuDzqwHtd1ND5PPFHXlU9KRkxhsIiwc4H06cZRWEWVIetozLYvlLgp7iXo/EoMq+PfqPKz2hu8V9Fo7cRrXeM6LxtQt8tEwZvmKDyO8Ti7dUqz35PzBZr6av7YWqtM1yP5RAVbCwVzOEqGMMJ6CJUWBXYoeASTY/1zTFXI+z+L/ZkULKBXCPaRQRasik05lHoqLSjolAxkJJS+dmUFPGXs/Jn/jq/SvVmTh3hldmqFSbWLTzxwf7cyELShSn51PFKsTta7bxY/OlTM0TXaWIFb4zSODFE47SExls9FN7pVOPW4Cq82rWVTHih51iPgpuq+rvYNEM8N14TEBtLnOZEqP4vy2/0a0w+e26sKb08YRd5ERYUsMwoDjGjJmgFtcGOndIgzUe+mLnYh8hpD91BvbcJzXeM6LhtRI+XCf03jZj2ckB2Z3N9yXv1k1nfXXZZ+jtgL8MRooLFLSABfSQJTSQBDYeGQWjCXIL0bc9+dynkD/1Ol4iW9+Wa0CwiUZ9NoS6fRn2ZDjUV9HJ1rXaqqIzS55Sr9vMbjSjosKF83AlhIyH2HOtRvDdBep+XGfG2fh3np5T3cgRP9oz92alJ2nJy2oITEgpneym83UXhYgeN99rU8Otbg3+Lrpgl+vh1ipeqzcgqB4TpG0hItCM+RneQwtWbswXmqTyeWVvAsSOPZUZhiBmlgWbUBC6jLtDuKvPXPbYgbVGQ4scNIfaDRj87Gr0NaGPEu2WE5KYJg9eNIHz3IL21/MnKLd8P6T/5G9ss/ex+tBXmMOWR9TECRpOgYkgYky0g0/S6Ls7YIwvqZLG7v9QhIuW9uWY0ZlKozSVRnU+hoohCZaUWtU1WlNWbkVenh6hWg5Q6NVI7TEhoUpnjysYfW86ZOYfdGlfwrsqNOLOowwmFEacVesfZ6YV7NVjOimUn3xozOs8M6HCum8K7nRSutKnxfrMatxq1COveQFiDqfKOSPzIwrUMly+LPhWVSI8lZGwiVmCGgKkawXcgK24NhfFbKOCuIDfchIJQE4qDzCgPsKDOfwX1/o7DSn/DI3MfMrwkX6mLMMk7I7fQ4GNCqzczdRohvmXEwA0j5m6tQXZrzUTeXH70tdHTss7SvrYTbQETfKQPV0EbRUDNoUDGUlDEUTBmr2IhjWhmctQ9+4pYjb/dnEFIO/PNqM1mxCNRWUSjrIRCcRmFggoauVU0smvVSK+nIaynEN+qRWK3wRXbpHhknvrNhu4v3ZrXFF5X2XBuQYMTTIzLPIVjWgeTZdR3rOLDXMa3u1Wx702u4d0eHS61q3G1TY0bTRrcqtPgTrUeYS2bCC4zDvvnPLr4Dos//a3oeM0aX+iAgG+CkG9EWqwZohgLsiItyGWmznAzSkLNKA8yo8rfiia/VdT72jbLbz96zOoIdUEvdw+NQRa0+pnR6W1Gr5cJAzeNGL1uBuV9ANn1lWeqbvUQa9H64gP+qnvt07hD3kl3rt6SgMKSUAN1wQqmRaqHDpuVLOmv1KXLh9uLzKjKIVBVSKGilEZpGY3C8g/Eq6GRWadGWqMawiYK/BYawqFlcJrlbM/xvIYUP74xQ89eVVhxZprCiWkCb8zTeHWexo8XaPyEtOKNSYXgbomQ2xXDv3a9l264M7GBK+0aXGtW42a9Bl7VWtxmosyKtQitWkdYkUXPyqaZQn4PXJdFxSlOxTP1zRIt7pplKXwj0nkWZLnPfRYURFhQzDKjPNSMyiALanytaPHbQMMdq6Xk5sPOjqIQ1cVW9hpaQuxo9jejw9eMHm8z+r1MGLphgOrOLhS3NgYmL+Njp/anwhhFfX2Da1Gv8c1QxxDuhBMln4ZMQGMhgcJSmgnzIsNOX+L8jzz7VmYs1LWVWVGVT6C8iERpCYWiMhr5lTSyqiik19JIa1AjuVGNRHdwEoXEEQf4Eu29co+B/cpvBUxpM72mtc6riyacHSdwapLAsRkCr86ReGmewo/nSBzXreHkDLl4rOLDvDvvmqHfud2jFfsMrOH9Bi1u1KjhVaHGnRINvIu08M/TgVXkALvYAW6eqT4iWXXvLZ68RIIvytmBMIGpGmE6cplxLMiJsrg3LkXhFpSGWtziVftbUedjRXvANhq9rdK4yw9OzZm35/62NsjmaA1eQ5OfGe1+ZnT7mCG5Y8LQLQPmb69AdXtji7y++lxfvHWP1VjT8dV4m0sfq3HnLMjjaEgFTLYshalEEvMiC8azNLrWdOkDQcA1xcrYwfY9NNXaUF1jQWWtFRWNNpS3OVDauYrsVgsS62jEN9Lgt1DgdpCIHTSCI6a1Ic2zPwkaIuJ9x7RWJkD3vSkN3hkncHaSxJvTBH4yS+CVWcIt3hvqZZxc1BEn+2f/5v7nM9yomP7i7WaN2KdzDTerNLhdRsO7WA2/Qq07wjo4R4/wHBNiizbAzbJuxmXoC3hx0leESbphkWgDSXEmpHItSI+2uHP2CqNWUM3dRS1nG/WRO2hmbYM5jHeGbGMsGqj11gzef2sjujn5+5UBZmlr0Dbq75jR6m1xT51ibzMGb5swfssEjf8+iNvrDwUxP1fs8da4jbRNKGMpyNy36hSmEyj33d5QComZfAeG8rUz4ryle8mcVUUz32+pM47U1hiny6uN8yXVxqnCGt1kfr1uOL9ZW5neQM0ktRjAa6HdwUnRHSQiekiw+kiEDKkRPGfDrUkdLo0QeHeMxLlJEqemSRybJfDaLIGX5ym8oV3BsSXD+OsdQ4/N0L2ZNfKl2zXq9qDWdfiU6eFbqEFggR4hOQaEZRsQlqFHBBNhnWFDcu4W4lPMSIhnqgWakRJrdldLyoy2oJC9glyW0VgYYWgqC7eMVoY5JhpDVxeaQm3a1lCHvDd8fabK78PXmvO9h36nIkgnYY4Mdd5mNHmb3Qf27tsmSLyMGL5hAO1/AMJ7oxosPJTK/lyRsqSftSTYe2wpa5iPJTEnoDGZSGGMuR5KpyARkZipXEF/hWakIevD9/bduCH81YqK4V9LSZF+lsmpY97fJ/wgiyi+buHltB6Tk9+pBbuDQkQ3iZBeAgESEn7DNG4Nkbg2SuDSGIm3J0h3gC5jfYx4ry5pcVy3jGOL2uYzEtnHxtPcEI7+ekClJie8fhUh5TYE5uoQwoiXaThKUEk1IibZ5A6TiBfakCiwQMjktseYIYo2IzfaihrBPvIjdUy8zS8wjog8lvjT2b6DnysNJL9U6T/5G6zLonvrVxZr+Lcqw3VdnexdNPhb0ejDWJ8JXbdNEN8yof+GHrI7W8y6p1Te2PoktdmeniWe/o91iQ5KneLAVPyR9Y2kURjMpNCXQ0BcQGKiYQXiGk1v6X0iPg5W6eBX4zspXbzEiOhuEqxeEkF9BHz6CXgNEnh/lMSVMQIXxkm8NUXiJDN1MlMmZcEbSsPhm/NE/P07z4+DiTwILdP6RJbZNjgVW2BlGRHOiJduBCfFCJ7QCH6CCYI401F+H+/osjabsb6oFZREL+/lhFIfWxU4LWDg8/Ucc2tP7D4aQmxoDrSg3feDXedt5sCux6zXCuReWyuK69s/lTpyj0UpXH5RnbHikKWbMZxCYlhEoT+HhDiPQHchgY5iEkMty+ho0A5XV398dg6/S1WbMG5HeA+JEAkJ/34SdwYJ3BgmcHlUhQsTBM5Pkjg9S+GU0oRTGgdOyPWzb05+WPvlaWHlyP+BU2gVxxavIzZvDZxUsztBJTbBCIHAhMRYM1KYSoExFvfGJS+aqSyxjQKWQZ5w66NdcbE+4i+XhRu6Onl7qA+1ookRz9+Cbj+Le93r9zJi6rYDMq8N5+L1tbOe/f9dUGbYTqvyV/em84zozyQhySXRm0+io5B0vxm6vkSFzmYH6ur0c9kF8x/pVortJa4IJmwI7WPEI+A9QMJriMC1EQIXxlQ4P03h3JIJ52gHTss0ujNSKvRYf/9DZYuflvOsvE/HZBpuxGXZ5UnZm0hMW0dcghUJsUYIeWb3xsVdaC7agvwoCxrjD1AWbfzI24GsANUfloYZh5uj9lETaENjoAWt/hZ0+lnQ68vsOo2Y8LaC9D/E4s31j023/qmykG+9uFi2vDdWZEBvLomuAgqthSQailSoLVahgnlDdDOz69Rb8ioff5UTVTf+e1H9lDF41ACvfhI3hmhcG9fgvVkD3lPYcXHJzBzaVadnyIhjHZKPDbt/Wlj82d+JS9b7xAkNC8mJDmQlbyNTsI7MGAeyo2zuQnNFkcuo5Kw4i6KoB2qz3U9mkOoHZeF2VWPkLqoCrKj1M6PZx4wOHzN6fMzo8zZh3McGVeA+FL57z/Vt2Z+Y6RLrxckK28FAqQFt+QSaClWoKyZQXUqivJxAYYUK5a16lHUa9orbyAiRaPKRac9BPfKMaGIffvMO3J634eqk1nVpnDJdmVHXXJogzp+RPF3Q7ychJmb+83zu0rHUOFNhCluvyeE6Dkpjd1ARs4/WOKAgRD8luP3west4oYqitb5V0Svr9RFbqAwwo87v6IK2zduMLm8zem4bMepthzJgH0q/3WcKkn7uDBZbLw1XOvZ7ygyoL5SjtoRAZQXpfjdtYY0K+fUqFLVrUTFkR75Y057RQjxUxTCwW/qtoAlt0a1BRe41iTTg/THlSzcHyOfjD/wEJAbOfyktWvuD1FDKLzNUk1UVs12XGah8KHA3O3Lpjyu4lrrGuF3URjFXSWbUBJjR6GtGK2N9jIC3jRj2tmMpYB9L3js/G5bnSVeJ7pyk1rHcUWdBZYkSZRUESqpIFNYRyGsikN1MIKODQsGIA5kSvTmpS3GTxXqyK52fUX4xm627VBq7rG0SHKIywo7KECtqgqxoCDCjxdeMdm+z21E96rOGed+d/Xnv9YfcjT9T9DSs/EtHg03b1mpHaaUKxTUq5NUTyG4kIGomkNJGIKldhRSmTt6wBRyJuovV8/iq8j+rCINkf5sVYakridlAJWcTpSwrKkKtqAm2oj7QimY/5shw5G2ZDNjFnN/OyqzP5jnPcX4maagy/Vlzq62/tWcNxY00chpUyGwikNaiQlKbCvEdBLgdKrB7KHAn7IgY0u4FSVRFfp0flh35WSWRTXw7I9KYnBPpWC+L2UdRqANFISaUhZhRHWRBXZDFfWRo87Og29eGmVBgLvBANue9/dSxtP+h5NXRv9nYvZJU1WNDcZcJGU0qJLcSSGgnwO8gwOkmENmjQqhYhZAhDcJm7fAdprYCJnQlvmPy7zJvRfMc8z8SUZzmH7LiLdmZXOtycewe8iPWkR9qQ5G7gqD5aN0LNKMh0IIWPxP6AtYwHebCbIizcsZ/54lrxP3MUd5jeae4z2YqGlpBUgeFuHYVeF0E2D0EwhnxJCoE9KvgM0jgzqQW/ksOeM9pD70W1JLrM+T1d4c+/jWmPy2EwukvpiZRJ0TJ5sac5OWdkpR95PPWkRNhQ16YDUVhVpSGmFHBiBdkRl2AGc3+FgyH7mM0eG99KmTfX/zT9m3+e5Antv1Jbr+jWjTsgHDQBHaXCpE9SoT1qRA8QMCfEW+IwK3RI7fZ1RkNrittuErYcFFmMLwl1RQdW6DeenVk5g8edWn8PPFhjX05JpF+PU6oS05Lsy5lpa2gIH0X2YJVZLGtyImyIS/chsIwG0rCrKgIsaAqyIzaABO6gjcwwnJiNGRfPBy0/9O5EvqPJK3f9lbiiH0pYXoF7GEdQvqUCBwg4DtI4PYwieujJN4bI3FxkklOIXF6nsYZpQmntct4jTTih4uU9cdLdMfLU4qY18fkx98YW/qrY60Pv0TqSWGliD/LzlF+KyKDfDk8TRkak25s4Ap1ekGyFemiHaSnrCM1zoZ0rhUijhXZ0VbkRdhQyGLEs6E81OqeOptDVtEf6UR/6IFmIHTfq8N79qnyIv5Twe5XflEwuxrGnbYb2dJVBE1o4T1M4NYwgatjhDuz6J1pEmdnSZyYI/AT5qJWSuL7cjW+TxjwI9qOl2gHXl4y4ScL+rU3Jkjy1CglPj+uyz8/qOFeGqC9L3XIr11pU7x9tVH58vVa+Q9v1Sp+crtSccWvgrgZUkFHRFQaUiLKNC2RBdRiTJHFxsm3Iq5oA/F564hPW4FAaEXC3ZducBk/qBXZUUz4hBUF4TYUh1lRFmpFbdgquqOd6I3YW+1nHaR0BTxl9PR/ZnjTa/8jYsGeETRnWQ5UrOLWnAGXx1V4d5LAuWkCJ2cJdxXdV6QUfiij8D0Zje9JKXx/nsK/zdH40bwery2YcVxqw6nFFZyTruHC3CouT9jx3rAFV/steL/bhJttRtxpM8O/1Y6QlmVENq+D07ABbu06eBVr4BQtIybHCm6G6eiNmUID4hNMRxe4sWZkxDBFWo/CJ5iw+SKWDVUR62jjAC0Ru1s9kQflYpbrI/28/6Xxm3H8mc+inXtDZtNcVTpwQWnFmQX6qCDPHIWXpDS+L6PcPz9gxJyn8dIsjVenNHh9Qos3RjU4PqxxB+6+1afG+V413unW4GKHFu+16XG92YCbDTrcqdXBr1KHgFItQgt1YOUbEJlrAPOCKq7IiNhUA+KSDUhgCtUx+X58E9J5Zog4JmRHmVEQaUcVZwcNMU40Ru5Z26Kcos7o/Z/5Y8+/G+9Pab56UWV7/9ySceC00rh3SruKn9A2/EihOxJvgcQP52j8eJbGy1NqvDahxk9GNTg2osHJIQ3O9mtwTqzB291qXOhQ43IrE8CkwY16DW7XauBTpYV/mRYhxVqwCnSIyDMgKtsATqYBvHTjkXju172Z3C/nYCLPsnl2FPG3UBXnRAV7E9VR21O10buBDazVB2qV/pz7uDyJT51Q6f/uhMYR9Splmfixzr79inENr2lX8KrcjFdmdXh1Uo2fjKlxfESDNwc1OCNhxFPj7R4NLnSqcbmNxrUWDW40auB1V7xyLYJKtAgt0oGVp0dkzpF4zFul+SlGxCeZkCS0IEO4gvzkXZQkO1Es2D4ojtlYrOY5EyrYO98Ts3CvTunPeQJepOlPv2pY/seXSXPQG9rVxteXLNrXFoyuN+VrOLO0gbNzK3hrwobzQya8LdHjYo8Ol5nYz1Y1rjcysZ9a+FTr4FehQ2CJDiFFerAKjYjKN4Ob50B8/hpScrcgyt5DlmgPGUlrECWuWAqEe50FsVtRZfEH3y9iuZ5rlYv/l/mF41LLl9+Qr3z35OLyzTcnDKKTowbxuQnb4jujDtM7EtP+lT4zbkmWcUe8Cr+uVQS1r4PVsoHIhnVE164jpnrDHTrIybMdCvJXbMK8DbkwY20gOXk5T5S67ZOVsvujFL7x66wXj15P93N+yhyvxC8x58Bzg5b/fl6s+9tLHfQPb4itF727He8FdDguBzUvX2M1Ll+LrFu9zK5ZvcIuX70SmWN9iZvr+LvE3LX/wU4kv8Ri4SMr6P+cn/NT5f8HWYXVwyFXL0QAAAAASUVORK5CYII=" width="32" height="32" style="display:block">'; // 設定のアイコン(桜)。上のバーの右端のボタンで使う
  function posView() { const v = $("#tf-view"), pm = $("ytd-page-manager"); if (!v || !pm) return; const l = Math.max(0, Math.round(pm.getBoundingClientRect().left)) + "px"; if (v.style.left !== l) v.style.left = l; const hb = $("#tf-hbar"); if (v.dataset.pg && hb && hb.classList.contains("tf-hfix")) { const t = Math.round(hb.getBoundingClientRect().bottom) + "px"; if (v.style.top !== t) v.style.top = t; } }
  function closeView() { cancelAnimationFrame(closeView._t); const v = $("#tf-view"); if (v) v.remove(); document.documentElement.removeAttribute('data-tf-view'); document.documentElement.removeAttribute('data-tf-pg'); document.documentElement.removeAttribute('data-tf-pgk'); }
  // YouTubeの上のバー(ヘッダー)の実際の背景色。フォルダ画面の背景を、これと同じ色にそろえる
  function pageBg() {
    const solid = c => { const m = c && /\((.+)\)/.exec(c); if (!m) return false; const p = m[1].split(',').map(s => parseFloat(s)); return p.length < 4 || p[3] >= 0.95; };
    for (const s of ['ytd-masthead #background', '#masthead-container', 'ytd-masthead', 'ytd-app', 'body', 'html']) { const e = $(s); const c = e && getComputedStyle(e).backgroundColor; if (solid(c)) return c; }
    return '';
  }
  function openView(file, extra) {
    closeView();
    const pm = $('ytd-page-manager'), r = pm ? pm.getBoundingClientRect() : { left: 240 };
    const v = el('div'); v.id = 'tf-view';
    v.style.left = Math.max(0, r.left) + 'px';
    { const bg = pageBg(); if (bg) v.style.background = bg; }
    v.innerHTML = '<iframe src="' + chrome.runtime.getURL((file === 'page.html' ? 'manager.html' : (file || 'manager.html')) + '?embed=1&dark=' + (document.documentElement.hasAttribute('dark') ? 1 : 0) + '&bg=' + encodeURIComponent(pageBg()) + (extra || '')) + '"></iframe>';
    // 空のページ(ツールバーのボタン)は、ツールバーの下だけを置き換える(ツールバーはそのまま)。フォルダ画面は、これまでどおり全体を置き換える
    if (file === 'page.html') { v.dataset.pg = '1'; document.documentElement.setAttribute('data-tf-pg', ''); } else document.documentElement.setAttribute('data-tf-view', '');
    document.body.appendChild(v);
    cancelAnimationFrame(closeView._t); const loop = () => { posView(); closeView._t = requestAnimationFrame(loop); }; loop(); // 左メニューの開閉(ミニ/フル)に追従
  }
  const THUMBS = [['cols', '動画の列数'], ['scols', 'ショート棚の列数']];
  function applyThumb(nOverride) {
    const g = S.settings.thumb || {}, root = document.documentElement;
    THUMBS.forEach(([k]) => root.toggleAttribute('data-tf-g-' + k, !!g[k]));
    const n = nOverride || g.colsN || 5; root.style.setProperty('--tf-cols', n); root.style.setProperty('--tf-scols', (nOverride ? (g.sN || 6) : (g.sN || 6)));
    root.style.setProperty('--tf-title-lines', 3); root.style.setProperty('--tf-title-fs', (n >= 7 ? 11.5 : n >= 6 ? 12 : n >= 5 ? 13 : 14) + 'px'); root.style.setProperty('--tf-meta-fs', (n >= 6 ? 11 : 12) + 'px');
  }
  // ---------- 列数(動画・ショート棚)。上のバーの ▦ から設定する ----------
  const colNow = (k = 'v') => { const g = S.settings.thumb || {}; return k === 's' ? (g.scols ? (g.sN || 6) : 0) : (g.cols ? (g.colsN || 5) : 0); };
  function setCols(n, k = 'v') {
    TF.mutate(s => {
      const g = { ...(s.settings.thumb || {}) }, v = Math.min(8, Math.max(3, n || 0));
      if (k === 's') { if (n) { g.scols = true; g.sN = v; } else g.scols = false; } else { if (n) { g.cols = true; g.colsN = v; } else g.cols = false; }
      s.settings.thumb = g;
    });
  }
  // ---------- 右下のガラス調サイドバー(ハブ): 普段はロゴだけの丸。マウスを乗せると開き、各項目に乗せるとさらに中身が開く ----------
  const HUB_ITEMS = [['folder', '▤', 'フォルダ'], ['cols', '▦', '列数'], ['sync', '☁', '同期'], ['imp', '⟳', '取り込み'], ['mgr', '❖', '管理'], ['set', '⚙', '設定'], ['test', '🧪', 'テスト']];
  function closeFly() { const f = $('#tf-gsb-fly'); if (f) f.remove(); const b = $('#tf-gsb-root .gs-bulge'); if (b) b.classList.remove('on'); document.querySelectorAll('#tf-gsb-root .gs-it.act').forEach(x => x.classList.remove('act')); }
  // 新着動画の件数(フォルダ内のチャンネルだけ取得。10分ごと/期間やチャンネル構成が変わったとき更新)
  let newCounts = {}, newSig = '', newT = 0, newBusy = false;
  function refreshNew() {
    const days = S.settings.newDays || 3, keys = Object.values(S.channels).filter(c => c.groups.some(id => groupOf(id))).map(c => c.key).sort(), sig = days + ':' + keys.join(',');
    if (newBusy || !keys.length || (sig === newSig && Date.now() - newT < 10 * 60 * 1000)) return;
    newBusy = true; newSig = sig; newT = Date.now();
    chrome.runtime.sendMessage({ type: 'newCounts', keys, days }, r => { newBusy = false; if (r && r.counts) { newCounts = r.counts; renderHBar(); } }); // 開いているフォルダのメニューも描き直す
  }
  function hubFlyHtml(key) {
    if (key === 'folder') {
      refreshNew();
      const rows = TF.flat(S.groups).map(({ g, depth }) => { const sub = TF.subtree(S.groups, g.id); const n = Object.values(S.channels).reduce((a, c) => a + (c.groups.some(id => sub.has(id)) ? (newCounts[c.key] || 0) : 0), 0); return `<button data-a="grp" data-g="${g.id}" class="${S.settings.activeGroup === g.id ? 'act' : ''}" style="padding-left:${12 + depth * 14}px">${TF.iconHtml(g.icon)} ${esc(g.name)}<i>${n}</i></button>`; }).join('');
      return `<div class="fh">フォルダ ・ 新着動画(${S.settings.newDays || 3}日以内)</div><button data-a="grp" data-g="all" class="${S.settings.activeGroup === 'all' ? 'act' : ''}">すべて</button>${rows}<button data-a="view" class="sep">📂 フォルダ設定(管理画面)を開く</button>`;
    }
    if (key === 'cols') {
      const seg = k => `<div class="fseg">${[0, 3, 4, 5, 6, 7, 8].map(n => `<button data-a="col" data-k="${k}" data-n="${n}" class="${colNow(k) === n ? 'act' : ''}">${n || '標準'}</button>`).join('')}</div>`;
      return `<div class="fh">動画の列数</div>${seg('v')}<div class="fh">ショート棚の列数</div>${seg('s')}`;
    }
    if (key === 'sync') return `<div class="fh">Google Drive</div><button data-a="sync">☁ 今すぐ同期</button><div class="fn" id="tf-fly-st">${esc(hubSt)}</div>`;
    if (key === 'imp') return `<div class="fh">登録チャンネル</div><button data-a="imp">⟳ YouTubeから取り込む</button>`;
    if (key === 'mgr') return `<div class="fh">グループ管理</div><button data-a="mgr">❖ 管理画面を開く</button>`;
    if (key === 'set') return `<div class="fh">表示</div><button data-a="hw" class="${S.settings.hideWatched ? 'act' : ''}">視聴済みを隠す ${S.settings.hideWatched ? '✓' : ''}</button><button data-a="hm" class="${S.settings.hideMix ? 'act' : ''}">ミックスリストを隠す ${S.settings.hideMix ? '✓' : ''}</button><button data-a="hbh" class="${S.settings.hbarHome === 'closed' ? 'act' : ''}">ホームではバーを閉じる ${S.settings.hbarHome === 'closed' ? '✓' : ''}</button><button data-a="hc" class="${S.settings.hideCreate === true ? 'act' : ''}">「作成」ボタンを隠す ${S.settings.hideCreate === true ? '✓' : ''}</button><button data-a="more" class="sep">⚙ そのほかの設定</button>`;
    if (key === 'test') return `<div class="fh">テスト機能</div><button data-a="diag">棚の診断をコピー</button>`;
    return '';
  }
  let hubSt = '';
  function hubAct(a, d, anchor) {
    if (a === 'grp') { TF.mutate(s => { s.settings.activeGroup = d.g; }); if (location.pathname !== '/feed/subscriptions') location.href = '/feed/subscriptions'; }
    else if (a === 'view') { closeFly(); chrome.runtime.sendMessage({ type: 'openManager' }); } // フォルダ設定は、拡張機能のページ(管理画面)で
    else if (a === 'col') setCols(+d.n, d.k);
    else if (a === 'sync') { hubSt = '同期中…'; const e = $('#tf-fly-st'); if (e) e.textContent = hubSt; chrome.runtime.sendMessage({ type: 'syncNow', interactive: true }, r => { hubSt = r && r.ok ? '☁ 同期しました' : '⚠ ' + ((r && r.error) || '失敗'); const x = $('#tf-fly-st'); if (x) x.textContent = hubSt; }); }
    else if (a === 'hw') TF.mutate(s => { s.settings.hideWatched = !s.settings.hideWatched; });
    else if (a === 'hm') TF.mutate(s => { s.settings.hideMix = !s.settings.hideMix; });
    else if (a === 'hbh') TF.mutate(s => { s.settings.hbarHome = s.settings.hbarHome === 'closed' ? 'open' : 'closed'; });
    else if (a === 'hc') TF.mutate(s => { s.settings.hideCreate = s.settings.hideCreate !== true; });
    else if (a === 'more') { closeFly(); openSettings(anchor, true); }
    else if (a === 'diag') copyShelfDiag();
  }
  // ---------- 仮の横長ツールバー(ホームの「すべて / ゲーム…」のチップの上) ----------
  // サムネ(カード)の実際の幅に合わせて、タイトルと情報の文字の大きさを変える(列数を増やしてサムネが小さくなったとき、文字が大きすぎてタイトルが出なくなるのを防ぐ)
  function fitFonts() {
    if (!(S.settings.thumb || {}).cols) { document.documentElement.removeAttribute('data-tf-fit'); return; } // 列数を変えていないときは、文字サイズも触らない
    const it = document.querySelector('ytd-browse[page-subtype="home"] ytd-rich-item-renderer, ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer, ytd-browse[page-subtype="subscriptions"] ytd-grid-video-renderer'); if (!it) return;
    const w = it.getBoundingClientRect().width; if (w < 60) return;
    const k = Math.max(.86, Math.min(1, w / 380)), root = document.documentElement; // 380px以上は標準、それより小さいほど文字も少しずつ小さく(下限は86%)
    const t = (14 * k).toFixed(1) + 'px', m = (12 * k).toFixed(1) + 'px';
    if (root.style.getPropertyValue('--tf-title-fs') !== t) root.style.setProperty('--tf-title-fs', t);
    if (root.style.getPropertyValue('--tf-meta-fs') !== m) root.style.setProperty('--tf-meta-fs', m);
    root.setAttribute('data-tf-fit', '');
  }
  // 各ボタン → 空のページ(後で中身を作る)。キーとタイトル
  const HBAR_PAGES = { new: '新着動画', live: 'ライブ・配信', shorts: 'ショート', rec: '検索ツール', later: '後で見る', bm: 'ブックマーク' };
  // ツールバーの置き方(試験用)。ボタン「配置」で順に切り替える
  const HBAR_MODES = [['home', '標準'], ['fixed', '固定バー'], ['bottom', '下バー']];
  const HBAR_ICONS = { new: '🆕', live: '📡', shorts: '⚡', rec: '🔎', later: '🕒', bm: '🔖' };
  // ツール(旧ハブの機能)。上のバーの右側のボタンを押すと、その下にメニューが開く
  function showBarFly(it) {
    const f = el('div'); f.id = 'tf-gsb-fly'; f.className = 'tf-barfly'; document.body.appendChild(f);
    f.addEventListener('click', e => { const bt = e.target.closest('button[data-a]'); if (bt) hubAct(bt.dataset.a, bt.dataset, it); });
    f.dataset.k = it.dataset.k; f._anchor = it; f._h = hubFlyHtml(it.dataset.k); f.innerHTML = f._h;
    f.classList.toggle('tf-wide', it.dataset.k === 'cols'); // 列数は、ボタンを1列に並べるため、横長に開く
    const ir = it.getBoundingClientRect(), fw = f.offsetWidth || 230; f.style.left = Math.max(8, Math.min(ir.right - fw, innerWidth - fw - 8)) + 'px'; f.style.right = 'auto'; f.style.bottom = 'auto'; f.style.top = Math.round(ir.bottom + 8) + 'px'; f.style.maxHeight = Math.max(160, innerHeight - ir.bottom - 16) + 'px';
  }
  // 「新着動画」などのページ(iframe)の中をクリックしたときも、開いているメニューを閉じる(iframeの中のクリックは、こちらのページには届かないため)
  const closeAllMenus = () => { closeFly(); closeSettings(); };
  window.addEventListener('message', e => { if (e.data && e.data.tfClick) closeAllMenus(); });
  window.addEventListener('blur', () => setTimeout(() => { if (document.activeElement && document.activeElement.tagName === 'IFRAME') closeAllMenus(); }, 0)); // iframeへフォーカスが移ったとき
  document.addEventListener('mousedown', e => { if ($('#tf-gsb-fly.tf-barfly') && !e.target.closest('#tf-gsb-fly') && !e.target.closest('#tf-hbar [data-a="hub"]')) closeFly(); }, true);
  function renderHBar() {
    const html = document.documentElement;
    const chips = isHome() ? $('ytd-browse[page-subtype="home"] #chips-wrapper') : null;
    let b = $('#tf-hbar');
    const skip = S.settings.hbar === false || location.pathname.startsWith('/shorts') || location.pathname.startsWith('/watch'); // ショートと再生画面では出さない
    const inView = html.hasAttribute('data-tf-view');
    const mode = 'bottom'; // 下バーだけを使う(他の置き方は外した)
    { const atHome = isHome(); if (atHome !== renderHBar._home) { renderHBar._home = atHome; if (atHome && !skip) { const want = S.settings.hbarHome === 'closed'; if (!!S.settings.hbarMin !== want) TF.mutate(st => { st.settings.hbarMin = want; }); } } } // ホームを開いたときは、設定どおり(開く/閉じる)にそろえる。そのあとの手動の開閉は、次にホームへ来るまで保つ
    const floatMode = !skip && mode === 'bottom'; // 画面の下に固定(その分だけ画面の下に余白をとるので、内容に重ならない)
    const fixed = !skip && !floatMode && (mode === 'fixed' || (!chips && !isHome()) || inView); // ホームでカテゴリ行がまだ無い間は、仮置きせず待つ(左上に出てから動くのを防ぐ) // 「固定バー」、ホーム以外のページ、または空のページ/フォルダ画面を開いている間は、ヘッダーの下に固定
    if (skip || (!chips && !fixed && !floatMode)) { html.removeAttribute('data-tf-hbot'); if (b) b.remove(); html.removeAttribute('data-tf-hbar'); html.removeAttribute('data-tf-hfix'); return; }
    if (!b) {
      b = el('div'); b.id = 'tf-hbar';
      b.innerHTML = `<button data-a="min" id="tfh-min" class="tfh-min" title="小さくたたむ / 開く">▾</button>` + Object.entries(HBAR_PAGES).map(([k, t]) => `<button data-a="pg" data-p="${k}" data-ic="${HBAR_ICONS[k] || ''}" title="${t}">${t}</button>`).join('') + `<span class="tfh-grp">${['cols', 'folder', 'test'].map(k => HUB_ITEMS.find(x => x[0] === k)).filter(Boolean).map(([k, ic, nm]) => `<button data-a="hub" data-k="${k}" data-ic="${ic}" class="tfh-t" title="${nm}">${ic}</button>`).join('')}<button data-a="gear" class="tfh-t tfh-gear" title="TubeFolio2 設定">${GEAR_IMG}</button></span><button data-a="tools" id="tfh-tools" class="tfh-right" title="「すべて / 音楽…」の行を表示 / 非表示">ツール ▴</button>`;
      b.addEventListener('click', e => {
        const x = e.target.closest('button[data-a]'); if (!x) return;
        const a = x.dataset.a;
        if (a === 'min') TF.mutate(s => { s.settings.hbarMin = !s.settings.hbarMin; });
        else if (a === 'pos') { const cur = HBAR_MODES.findIndex(m => m[0] === (S.settings.hbarPos || 'home')), nx = HBAR_MODES[(cur + 1) % HBAR_MODES.length][0]; TF.mutate(s => { s.settings.hbarPos = nx; }); }
        else if (a === 'gear') { closeFly(); $('#tf-set') ? closeSettings() : openSettings(x); }
        else if (a === 'hub') { const f0 = $('#tf-gsb-fly'); const same = f0 && f0.dataset.k === x.dataset.k; closeFly(); if (!same) showBarFly(x); }
        else if (a === 'pg') { document.documentElement.setAttribute('data-tf-pgk', x.dataset.p); openView('page.html', '&p=' + encodeURIComponent(x.dataset.p) + '&t=' + encodeURIComponent(HBAR_PAGES[x.dataset.p] || '')); document.documentElement.setAttribute('data-tf-pgk', x.dataset.p); }
        else if (a === 'tools') TF.mutate(s => { s.settings.hideChips = s.settings.hideChips === false; }); // 初期値は「閉じる」(未設定=閉じている)
      });
    }
    { const bg = pageBg(); if (bg) html.style.setProperty('--tf-pagebg', bg); }
    { const pb = $('#tfh-pos', b), nm = (HBAR_MODES.find(m => m[0] === mode) || HBAR_MODES[0])[1]; if (pb) { const t = '配置:' + nm; if (pb.textContent !== t) pb.textContent = t; pb.title = 'ボタンの置き方を切り替える(今: ' + nm + ')'; } }
    { const f = $('#tf-gsb-fly.tf-barfly'); if (f && f.dataset.k) { const h = hubFlyHtml(f.dataset.k); if (f._h !== h) { const keep = f.scrollTop; f._h = h; f.innerHTML = h; f.scrollTop = keep; } } }
    b.classList.toggle('tf-hfloat', floatMode); if (floatMode) b.dataset.mode = mode; else delete b.dataset.mode;
    if (floatMode) {
      if (b.parentElement !== document.body) document.body.appendChild(b);
      b.classList.remove('tf-hfix'); b.style.paddingLeft = ''; b.style.marginLeft = '';
      const mh = parseFloat(getComputedStyle(html).getPropertyValue('--ytd-masthead-height')) || 56; html.style.setProperty('--tf-mh', mh + 'px');
      html.removeAttribute('data-tf-hfix'); html.removeAttribute('data-tf-hbar'); html.removeAttribute('data-tf-nochips');
      const mn = !!S.settings.hbarMin; b.classList.toggle('tf-min', mn); { const mb = $('#tfh-min', b); if (mb) mb.textContent = mn ? '▴' : '▾'; }
      html.style.setProperty('--tf-hbot-h', (mn ? 0 : 56) + 'px');
      { const sb = document.querySelector('ytd-searchbox #search-form, ytd-searchbox form, ytd-searchbox, #search-form'); const r0 = sb && sb.getBoundingClientRect(); // たたんだつまみは、検索ボックスの真下にくっつける
        if (r0 && r0.width > 50) { html.style.setProperty('--tf-min-x', Math.round(r0.left + r0.width / 2) + 'px'); html.style.setProperty('--tf-min-y', Math.round(r0.bottom) + 'px'); } else { html.style.removeProperty('--tf-min-x'); html.style.removeProperty('--tf-min-y'); } } { const pm = $('ytd-page-manager'); html.style.setProperty('--tf-hbot-l', Math.max(0, Math.round(pm ? pm.getBoundingClientRect().left : 0)) + 'px'); } // 左メニューの右側(メイン画面)だけに出す html.setAttribute('data-tf-hbot', '');
      return;
    }
    html.removeAttribute('data-tf-hbot');
    if (fixed) {
      if (b.parentElement !== document.body) document.body.appendChild(b);
      b.classList.add('tf-hfix'); b.style.paddingLeft = ''; b.style.marginLeft = '';
      const pm = $('ytd-page-manager'), mh = parseFloat(getComputedStyle(html).getPropertyValue('--ytd-masthead-height')) || 56;
      html.style.setProperty('--tf-hfix-l', Math.max(0, Math.round(pm ? pm.getBoundingClientRect().left : 0)) + 'px'); html.style.setProperty('--tf-mh', mh + 'px');
      html.setAttribute('data-tf-hfix', ''); html.removeAttribute('data-tf-hbar'); html.removeAttribute('data-tf-nochips');
      return;
    }
    b.classList.remove('tf-hfix'); html.removeAttribute('data-tf-hfix');
    if (b.parentElement !== chips) chips.insertBefore(b, chips.firstChild); // チップの行の上に(同じ入れ物の中なので、位置のずれが出ない)
    // 左端をそろえる: 最初のサムネの左端に、ツールバーのボタンと「すべて」のチップの左端を合わせる。
    // ツールバーとチップは同じ入れ物(#chips-wrapper)の中なので、その左の余白を1か所で決める(画面の幅や左メニューの開閉が変わっても測り直す)
    { const th0 = document.querySelector('ytd-browse[page-subtype="home"] ytd-rich-item-renderer img[src*="ytimg"], ytd-browse[page-subtype="home"] ytd-rich-item-renderer yt-thumbnail-view-model img');
      const chip = $('yt-chip-cloud-chip-renderer', chips);
      if (th0 && chip) {
        const target = thBox(th0).rect.left, cur = parseFloat(chips.style.paddingLeft) || 0, base = chip.getBoundingClientRect().left - cur, pl = Math.round(target - base);
        if (target > 0 && Math.abs(pl - cur) > 0.5 && pl >= 0 && pl < 200) chips.style.paddingLeft = pl + 'px';
      }
      { const curm = parseFloat(b.style.marginLeft) || 0; if (th0) { const tl = thBox(th0).rect.left, ml = Math.round(tl - (b.getBoundingClientRect().left - curm)); if (Math.abs(ml - curm) > 0.5 && ml > -200 && ml < 200) b.style.marginLeft = ml + 'px'; } } }
    { const cl = $('yt-chip-cloud-renderer', chips); if (cl && cl.style.marginLeft) cl.style.marginLeft = ''; }
    // ツールバーと最初のサムネの間の空きを、実際に測って24pxに詰める(サムネが切れない程度に残す)(YouTube側の余白の作りに依存しない)。スクロール中は測らない
    { const se = document.scrollingElement, contents = document.querySelector('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer #contents');
      const im = contents && contents.querySelector('ytd-rich-item-renderer img[src*="ytimg"]');
      const stt = S.settings.hideChips !== false; if (contents && renderHBar._st !== stt) { renderHBar._st = stt; contents.style.marginTop = ''; } // 「ツール」の開閉のたびに、引き上げ量をリセットして測り直す
      if (im && se && se.scrollTop < 5) {
        const gap = thBox(im).rect.top - 7 - Math.max(b.getBoundingClientRect().bottom, chips.getBoundingClientRect().bottom, ...[...chips.querySelectorAll("yt-chip-cloud-renderer, yt-chip-cloud-chip-renderer")].map(x => x.getBoundingClientRect().bottom)), // チップの行を開いているときは、チップの下端を基準にする
           cur = parseFloat(contents.style.marginTop) || 0, want = Math.round(cur - (gap - 24));
        if (Math.abs(want - cur) > 1 && want > -160 && want < 80) contents.style.marginTop = want + 'px';
      } }
    // ツールバーの位置は固定(CSSのtop)。測って動かすと、状態によって数pxずれるため、動かさない
    if (b.style.top) b.style.top = '';
    html.toggleAttribute('data-tf-nochips', S.settings.hideChips !== false); { const tb = $('#tfh-tools', b); const tt = S.settings.hideChips !== false ? 'ツール ▾' : 'ツール ▴'; if (tb && tb.textContent !== tt) tb.textContent = tt; }
    html.style.setProperty('--tf-glass-h', (S.settings.hideChips === false ? Math.round(chips.getBoundingClientRect().height + 12 + 42) : Math.round(chips.getBoundingClientRect().bottom + 12)) + 'px'); // すりガラスの高さ(ツールバー+チップの行+少し)。「ツール」を開いているときは、さらに42px下げる
    html.setAttribute('data-tf-hbar', ''); { const bg = pageBg(); if (bg) html.style.setProperty('--tf-pagebg', bg); }
  }
  function renderHub() {
    const want = window === window.top && S && S.settings.hub === true; // 右下のハブは、いまは使わない(コードは残す。設定 hub:true で戻せる)
    let r = $('#tf-gsb-root');
    if (!want) { if (r) { closeFly(); r.remove(); } return; }
    if (r) { const f = $('#tf-gsb-fly'); if (f && f.dataset.k) { const h = hubFlyHtml(f.dataset.k); if (f._h !== h) { const keep = f.scrollTop; f._h = h; f.innerHTML = h; f.scrollTop = keep; } } return; }
    r = el('div'); r.id = 'tf-gsb-root';
    r.innerHTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="tf-goo" x="-60%" y="-20%" width="220%" height="140%"><feGaussianBlur in="SourceGraphic" stdDeviation="7" result="b"/><feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"/></filter></svg><aside class="gs mini min"><div class="gs-bg"><i class="gs-rail"></i><i class="gs-bulge"></i></div><div class="gs-head"><div class="gs-logo">▶</div><div class="gs-brand"><b>TubeFolio2</b><small>登録チャンネル管理</small></div></div>
      <nav class="gs-nav">${HUB_ITEMS.map(([k, ic, nm]) => `<a class="gs-it" data-k="${k}" data-tip="${nm}"><span class="i">${ic}</span><em>${nm}</em></a>`).join('')}</nav></aside>`;
    const G = () => $('.gs', r); let tm = 0;
    let pinned = false;
    const open = () => { clearTimeout(tm); G().classList.remove('min'); };
    const shut = () => { clearTimeout(tm); if (pinned) return; tm = setTimeout(() => { closeFly(); G().classList.add('min'); }, 450); };
    const showFly = it => {
      clearTimeout(tm); let f = $('#tf-gsb-fly');
      if (!f) { f = el('div'); f.id = 'tf-gsb-fly'; document.body.appendChild(f); f.addEventListener('mouseenter', () => clearTimeout(tm)); f.addEventListener('mouseleave', shut); f.addEventListener('click', e => { const b = e.target.closest('button[data-a]'); if (b) hubAct(b.dataset.a, b.dataset, f._anchor || it); }); }
      f.dataset.k = it.dataset.k; f._anchor = it; { const h = hubFlyHtml(it.dataset.k); if (f._h !== h) { f._h = h; f.innerHTML = h; } }
      const ir = it.getBoundingClientRect(), gr = G().getBoundingClientRect();
      // 次のバー: 山(バルジ)の高さに合わせて、山のすぐ左に開く
      f.style.maxHeight = Math.max(160, innerHeight - 16) + 'px'; f.style.right = (innerWidth - gr.left + 4) + 'px'; f.style.bottom = 'auto'; f.style.top = '0px';
      const fh = f.offsetHeight; f.style.top = Math.max(8, Math.min(ir.top + ir.height / 2 - fh / 2, innerHeight - fh - 8)) + 'px';
      const bl = $('.gs-bulge', r), bt = ir.top - gr.top + ir.height / 2 - 23, k = Math.max(0, Math.min(1, (bt + 23) / gr.height));
      if (bl) { bl.style.top = bt + 'px'; bl.style.background = `rgb(${Math.round(120 + (134 - 120) * k)},${Math.round(114 + (96 - 114) * k)},${Math.round(108 + (58 - 108) * k)})`; bl.classList.add('on'); }
      r.querySelectorAll('.gs-it.act').forEach(x => x.classList.remove('act')); it.classList.add('act');
    };
    r.addEventListener('mouseenter', open); r.addEventListener('mouseleave', shut);
    // ロゴのクリックでも開く(開いたままにする)。もう一度クリックか、外をクリックで閉じる
    r.addEventListener('click', e => { if (!e.target.closest('.gs-logo') || r._moved) return; pinned = !pinned; if (pinned) open(); else { closeFly(); G().classList.add('min'); } });
    document.addEventListener('mousedown', e => { if (pinned && !r.contains(e.target) && !e.target.closest('#tf-gsb-fly')) { pinned = false; closeFly(); G().classList.add('min'); } }, true);
    r.querySelectorAll('.gs-it').forEach(it => it.addEventListener('mouseenter', () => showFly(it)));
    r.addEventListener('pointerdown', e => { // ドラッグで移動(右下からの距離を覚える)
      if (e.button !== 0 || e.target.closest('.gs-it')) return;
      const b = r.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, r0 = innerWidth - b.right, b0 = innerHeight - b.bottom;
      r.setPointerCapture(e.pointerId); e.preventDefault();
      r._moved = false;
      const mv = ev => { if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 4) r._moved = true; r.style.right = Math.max(0, Math.min(innerWidth - 60, r0 - (ev.clientX - sx))) + 'px'; r.style.bottom = Math.max(0, Math.min(innerHeight - 60, b0 - (ev.clientY - sy))) + 'px'; closeFly(); };
      const up = () => { r.removeEventListener('pointermove', mv); r.removeEventListener('pointerup', up); }; // 位置は覚えない(更新すると右下に戻る)
      r.addEventListener('pointermove', mv); r.addEventListener('pointerup', up);
    });
    document.body.appendChild(r);
  }

  function closeSettings() { const p = $('#tf-set'); if (p) p.remove(); document.removeEventListener('mousedown', outsideSet, true); }
  function outsideSet(e) { const p = $('#tf-set'); if (p && !p.contains(e.target) && !e.target.closest('#tf-gear, .tfh-gear')) closeSettings(); }
  async function openSettings(anchor, center) {
    closeSettings();
    const p = el('div'); p.id = 'tf-set';
    const st = (await chrome.storage.local.get('syncStatus')).syncStatus;
    const stTxt = st ? ({ syncing: '同期中…', ok: '☁ ' + st.msg, error: '⚠ ' + st.msg }[st.state] || '') : '未同期';
    p.innerHTML = `
      <div class="tf-pop-h">TubeFolio2 設定</div>
      <div class="tf-ssub">表示</div>
      <label class="tf-sw tf-srow"><input type="checkbox" id="tfs-hw" ${S.settings.hideWatched ? 'checked' : ''}><span></span>視聴済みを隠す</label>
      <label class="tf-sw tf-srow"><input type="checkbox" id="tfs-hm" ${S.settings.hideMix ? 'checked' : ''}><span></span>ミックスリストを隠す</label>
      <label class="tf-sw tf-srow"><input type="checkbox" id="tfs-hbh" ${S.settings.hbarHome === 'closed' ? 'checked' : ''}><span></span>ホームを開いたとき、上のバーを閉じておく</label>
      <div class="tf-ssub">登録 / 非登録の見分け(サムネの左上の角に枠)</div>
      <label class="tf-sw tf-srow"><input type="checkbox" id="tfs-nv" ${(S.settings.test || {}).nest !== false ? 'checked' : ''}><span></span>動画で表示する</label>
      <label class="tf-sw tf-srow"><input type="checkbox" id="tfs-ns" ${(S.settings.testS || {}).nest !== false ? 'checked' : ''}><span></span>ショートで表示する</label>
      <label class="tf-sw tf-srow"><input type="checkbox" id="tfs-hc" ${S.settings.hideCreate === true ? 'checked' : ''}><span></span>「作成」ボタンを隠す</label>
      <button class="tf-srow tf-sbtn" id="tfs-ai">✨ フォルダのアイコンを名前から自動設定</button>
      <label class="tf-srow tf-ssel"><span>新着とみなす期間(フォルダ横の件数)</span><select id="tfs-nd">${[1, 3, 7, 14].map(n => `<option value="${n}"${(S.settings.newDays || 3) === n ? ' selected' : ''}>${n}日以内</option>`).join('')}</select></label>
      <label class="tf-srow tf-ssel"><span>フォルダ内のチャンネルを押したとき</span><select id="tfs-cc"><option value="pane"${S.settings.chClick !== 'youtube' ? ' selected' : ''}>右のページに表示</option><option value="youtube"${S.settings.chClick === 'youtube' ? ' selected' : ''}>YouTubeでチャンネルを開く</option></select></label>
      <div class="tf-ssub">データ</div>
      <button class="tf-srow tf-sbtn" id="tfs-mgr">⚙ グループ管理を開く</button>
      <button class="tf-srow tf-sbtn" id="tfs-imp">⟳ 登録チャンネルを取り込む</button>
      <button class="tf-srow tf-sbtn" id="tfs-sync">☁ Google Driveと同期</button>
      <div class="tf-ssub">Google Drive(手動)</div>
      <button class="tf-srow tf-sbtn" id="tfs-up">⬆ この端末の内容をDriveへアップロード(Driveを上書き)</button>
      <button class="tf-srow tf-sbtn" id="tfs-down">⬇ Driveの内容をダウンロード(この端末を上書き)</button>
      <div class="tf-ssub">ファイル(JSON)</div>
      <button class="tf-srow tf-sbtn" id="tfs-exp">📤 JSONで書き出す(端末に保存)</button>
      <button class="tf-srow tf-sbtn" id="tfs-impj">📥 JSONから読み込む(この端末を上書き)</button>
      <input type="file" id="tfs-file" accept=".json,application/json" hidden>
      <details class="tf-dev"><summary>開発者向け(テスト・診断)</summary>
      <button class="tf-srow tf-sbtn" id="tfs-t4">${S.settings.hub === true ? '🧪 右下のサイドバーを隠す' : '🧪 右下のサイドバーを表示する'}</button>
      <button class="tf-srow tf-sbtn" id="tfs-diag">🔍 棚の診断をコピー(表示が足りないとき)</button>
      <button class="tf-srow tf-sbtn" id="tfs-ldiag">🔍 左端の診断をコピー(位置がずれるとき)</button>
      </details>
      <div class="tf-ssub" id="tfs-st">${esc(stTxt)}</div>`;
    document.body.appendChild(p);
    const r = anchor.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(r.right - 270, innerWidth - 280)) + 'px'; p.style.top = (r.bottom + 8) + 'px'; p.style.maxHeight = Math.max(160, innerHeight - r.bottom - 20) + 'px'; // 画面に収まらないときはメニューの中をスクロールできるように
    if (center) { // ハブから開いたときは、画面の中央にガラス調で表示する
      p.classList.add('tf-glass'); p.style.maxHeight = Math.max(200, innerHeight - 80) + 'px'; p.style.left = Math.max(8, (innerWidth - p.offsetWidth) / 2) + 'px'; p.style.top = Math.max(8, (innerHeight - p.offsetHeight) / 2) + 'px';
    }
    $('#tfs-hw', p).onchange = e => TF.mutate(s => { s.settings.hideWatched = e.target.checked; });
    $('#tfs-diag', p).onclick = () => { closeSettings(); copyShelfDiag(); };
    $('#tfs-ldiag', p).onclick = () => { closeSettings(); copyLayoutDiag(); };
    $('#tfs-t4', p).onclick = () => { closeSettings(); TF.mutate(s => { s.settings.hub = s.settings.hub !== true; }); };
    $('#tfs-ai', p).onclick = async () => { const n = await TF.autoIcons(); toast(n ? `${n}件のフォルダにアイコンを設定しました` : '設定できるフォルダはありませんでした(⭐のフォルダだけ対象)'); };
    $('#tfs-nd', p).onchange = e => TF.mutate(s => { s.settings.newDays = +e.target.value; });
    $('#tfs-cc', p).onchange = e => TF.mutate(s => { s.settings.chClick = e.target.value; });
    $('#tfs-nv', p).onchange = e => TF.mutate(st => { st.settings.test = { ...(st.settings.test || {}), nest: e.target.checked }; });
    $('#tfs-ns', p).onchange = e => TF.mutate(st => { st.settings.testS = { ...(st.settings.testS || {}), nest: e.target.checked }; });
    $('#tfs-hm', p).onchange = e => TF.mutate(s => { s.settings.hideMix = e.target.checked; });
    $('#tfs-hbh', p).onchange = e => TF.mutate(st => { st.settings.hbarHome = e.target.checked ? 'closed' : 'open'; });
    $('#tfs-hc', p).onchange = e => TF.mutate(s => { s.settings.hideCreate = e.target.checked; });
    // Drive: 手動アップロード / ダウンロード(確認してから上書き)
    const drv = (type, ask, done) => { if (!confirm(ask)) return; const e = $('#tfs-st', p); if (e) e.textContent = '通信中…'; chrome.runtime.sendMessage({ type, interactive: true }, r => { const t = r && r.ok ? '☁ ' + done : '⚠ ' + ((r && r.error) || '失敗'); const x = $('#tfs-st'); if (x) x.textContent = t; toast(t); }); };
    $('#tfs-up', p).onclick = () => drv('driveUp', 'この端末の内容で、Google Driveのデータを上書きします。よろしいですか?', 'アップロードしました');
    $('#tfs-down', p).onclick = () => drv('driveDown', 'Google Driveの内容で、この端末のデータを上書きします。よろしいですか?', 'ダウンロードしました');
    // JSON: 端末への書き出し / 読み込み(フォルダ・チャンネル・設定など、同期の対象すべて)
    $('#tfs-exp', p).onclick = async () => {
      const data = await chrome.storage.local.get(['groups', 'channels', 'settings', 'meta', 'activity']);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'TubeFolio2', version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' }));
      a.download = 'tubefolio2-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('JSONを書き出しました');
    };
    $('#tfs-impj', p).onclick = () => $('#tfs-file', p).click();
    $('#tfs-file', p).onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        const d = JSON.parse(await f.text()), src = d && typeof d.data === 'object' && d.data ? d.data : d; // 書き出したファイル(data付き)と、管理画面のバックアップ(直下)の両方を受け付ける
        if (!Array.isArray(src.groups) || !src.channels || typeof src.channels !== 'object') throw new Error('形式が違います');
        if (!confirm(`このファイルの内容で、この端末のデータを上書きします。
フォルダ ${src.groups.length}件 / チャンネル ${Object.keys(src.channels).length}件
よろしいですか?`)) return;
        const set = {}; ['groups', 'channels', 'settings', 'meta', 'activity'].forEach(k => { if (src[k] !== undefined && src[k] !== null) set[k] = src[k]; });
        await chrome.storage.local.set(set); toast('JSONから読み込みました');
      } catch (err) { toast('読み込めませんでした: ' + (err.message || err)); }
    };
    $('#tfs-mgr', p).onclick = () => { chrome.runtime.sendMessage({ type: 'openManager' }); closeSettings(); };
    $('#tfs-imp', p).onclick = () => { closeSettings(); bgImport(); };
    $('#tfs-sync', p).onclick = () => { $('#tfs-st', p).textContent = '同期中…'; chrome.runtime.sendMessage({ type: 'syncNow', interactive: true }, r => { const e = $('#tfs-st'); if (e) e.textContent = r && r.ok ? '☁ 同期しました' : '⚠ ' + ((r && r.error) || '失敗'); }); };
    setTimeout(() => document.addEventListener('mousedown', outsideSet, true), 0);
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

  // ---------- 更新ループ ----------
  let tmr = 0;
  const refresh = () => { if (!S) return; document.documentElement.toggleAttribute('data-tf-hide-create', S.settings.hideCreate === true); processCards(); processShorts(); alignShelves(); fixShelves(); renderBar(); renderHub(); renderHBar(); applyThumb(); fitFonts(); const p = $('#tf-pop'); if (p && p._draw) p._draw(); };
  const schedule = () => { clearTimeout(tmr); tmr = setTimeout(refresh, 250); };

  async function init() {
    S = await TF.get();
    // メイン画面のいじった設定を、YouTube標準に戻す(1回だけ)。以後の変更は、各設定のスイッチから
    if (S.settings.mainReset !== 1) { await TF.mutate(st => { st.settings.thumb = {}; st.settings.test = {}; st.settings.place = {}; st.settings.hideCreate = false; st.settings.hideChips = false; st.settings.mainReset = 1; }); S = await TF.get(); }
    chrome.storage.onChanged.addListener(async () => { S = await TF.get(); refresh(); });
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('yt-navigate-start', () => { closeView(); });
    window.addEventListener('yt-navigate-finish', () => { schedule(); checkImport(); });
    window.addEventListener('resize', schedule);
    refresh(); checkImport();
    // リロード時: 動画カードが出て整形が済んだら、early.js が隠していた画面を表示する(最大2.2秒待つ)
    const r = document.documentElement;
    if (r.hasAttribute('data-tf-boot')) {
      const t0 = Date.now();
      const tick = () => {
        const age = Date.now() - t0;
        if ((document.querySelector('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer') && age > 700) || age > 2200) {
          refresh(); requestAnimationFrame(() => requestAnimationFrame(() => r.removeAttribute('data-tf-boot')));
        } else setTimeout(tick, 100);
      };
      tick();
    }
  }
  init();
})();
