// 再生した動画のタグの管理(旧TubeFolioの「ランダムタグ」の管理を、今の作りに合わせたもの)。
//   playedTags: { 小文字のタグ: { t: タグ, n: 見た動画の本数, at: 最後に見た時刻, own: 自分で追加, pin: 表示する, ng: 追加しない } }  ← storage。Drive同期の対象
//   再生画面で30秒以上見た動画のタグが、自動で溜まる(watch.js)。どれを「表示」するかは、ユーザーが決める(★)。
//   表示にしたタグは、再生画面の「🏷 タグ」タブに、チップで出る(panel.js)。
(() => {
  if (window.tfOpenTagMgr) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let tags = {}, q = '', only = false;
  const save = () => chrome.storage.local.set({ playedTags: tags });
  const rowsOf = () => Object.entries(tags).filter(([, e]) => !e.ng).filter(([k, e]) => (!only || e.pin) && (!q || k.includes(q) || String(e.t).toLowerCase().includes(q)))
    .sort((a, b) => (b[1].pin ? 1 : 0) - (a[1].pin ? 1 : 0) || (b[1].own ? 1 : 0) - (a[1].own ? 1 : 0) || (b[1].n || 0) - (a[1].n || 0) || (b[1].at || 0) - (a[1].at || 0));
  function draw() {
    const box = document.getElementById('tf-tgm'); if (!box) return;
    const all = Object.entries(tags), rows = rowsOf(), ngs = all.filter(([, e]) => e.ng), pins = all.filter(([, e]) => e.pin && !e.ng).length;
    const chip = ([k, e]) => `<span class="c${e.pin ? ' pin' : ''}${e.own ? ' own' : ''}" data-k="${esc(k)}"><b>${esc(e.t)}</b>${e.own ? '' : `<small>${e.n || 0}</small>`}<button data-a="pin" title="${e.pin ? '表示をやめる' : '表示する(再生画面の「🏷 タグ」に出す)'}">${e.pin ? '★' : '☆'}</button><button data-a="ng" title="削除して、次から追加しない">🚫</button><button data-a="del" title="削除(また見たら、増えます)">✕</button></span>`;
    box.querySelector('.b').innerHTML = `
      <p class="n">動画を30秒以上見ると、その動画のタグ(投稿者が設定した検索キーワード)が、自動で溜まります。<b>★</b>を付けたタグだけを、再生画面の「🏷 タグ」に表示します。表示するタグは、あなたが選びます。</p>
      <div class="r"><input data-f="add" placeholder="タグを追加(カンマ区切りで複数)"><button data-a="add" class="pri">追加</button></div>
      <div class="r"><input data-f="q" type="search" placeholder="タグで絞り込み" value="${esc(q)}"><label class="o"><input type="checkbox" data-f="only"${only ? ' checked' : ''}> ★表示中だけ(${pins})</label></div>
      <div class="s">タグ ${rows.length}個${rows.length !== all.filter(([, e]) => !e.ng).length ? ' / 全' + all.filter(([, e]) => !e.ng).length + '個' : ''}</div>
      <div class="l">${rows.map(chip).join('') || '<p class="n">まだありません。動画を見ると、溜まっていきます。</p>'}</div>
      <div class="r"><button data-a="pinall">表示中のものを全部やめる</button><button data-a="clear">自動で溜まったタグを全部削除</button></div>
      <div class="s">追加しないタグ ${ngs.length}個</div>
      <p class="n">ここに入れたタグは、動画を見ても自動で増えません。</p>
      <div class="r"><input data-f="ngadd" placeholder="追加しないタグ(カンマ区切りで複数)"><button data-a="ngadd">登録</button></div>
      <div class="l">${ngs.map(([k, e]) => `<span class="c ng" data-k="${esc(k)}"><b>${esc(e.t)}</b><button data-a="back" title="除外をやめる">↩</button></span>`).join('') || '<p class="n">まだありません</p>'}</div>`;
    const qi = box.querySelector('[data-f="q"]'); if (qi && document.activeElement && document.activeElement.dataset && document.activeElement.dataset.f === 'q') { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
  }
  const words = s => String(s || '').split(/[,、，\n]/).map(x => x.trim()).filter(x => x.length >= 1 && x.length <= 40);
  window.tfOpenTagMgr = async function () {
    let box = document.getElementById('tf-tgm'); if (box) { box.remove(); return; }
    tags = (await chrome.storage.local.get('playedTags')).playedTags || {}; q = ''; only = false;
    box = document.createElement('div'); box.id = 'tf-tgm';
    box.innerHTML = '<div class="h">🏷 再生した動画のタグ<button data-a="x" title="閉じる">✕</button></div><div class="b"></div>';
    ['keydown', 'keyup', 'keypress'].forEach(t => box.addEventListener(t, e => e.stopPropagation()));
    box.addEventListener('click', e => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      const k = a.closest('.c') && a.closest('.c').dataset.k, act = a.dataset.a, v = f => (box.querySelector(`[data-f="${f}"]`) || {}).value;
      if (act === 'x') { box.remove(); return; }
      if (act === 'pin' && tags[k]) tags[k].pin = !tags[k].pin;
      else if (act === 'ng' && tags[k]) { tags[k].ng = true; tags[k].pin = false; }
      else if (act === 'del') delete tags[k];
      else if (act === 'back' && tags[k]) { delete tags[k].ng; }
      else if (act === 'add') words(v('add')).forEach(t => { const kk = t.toLowerCase(); tags[kk] = { ...(tags[kk] || { n: 0 }), t, own: true, pin: true, at: Date.now() }; delete tags[kk].ng; });
      else if (act === 'ngadd') words(v('ngadd')).forEach(t => { const kk = t.toLowerCase(); tags[kk] = { ...(tags[kk] || { n: 0 }), t, ng: true, pin: false, at: Date.now() }; });
      else if (act === 'pinall') Object.values(tags).forEach(x => { x.pin = false; });
      else if (act === 'clear') { if (!confirm('自動で溜まったタグを、すべて削除します。(自分で追加したタグと、追加しないタグは、残ります)')) return; Object.keys(tags).forEach(kk => { if (!tags[kk].own && !tags[kk].ng) delete tags[kk]; }); }
      save(); draw();
    });
    box.addEventListener('keydown', e => { if (e.key !== 'Enter' || e.isComposing) return; const f = e.target.dataset && e.target.dataset.f; if (f === 'add' || f === 'ngadd') { e.preventDefault(); box.querySelector(`[data-a="${f}"]`).click(); } });
    box.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.f === 'q') { q = e.target.value.trim().toLowerCase(); draw(); } });
    box.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.f === 'only') { only = e.target.checked; draw(); } });
    document.body.appendChild(box); draw();
  };
  chrome.storage.onChanged.addListener((ch, a) => { if (a === 'local' && ch.playedTags && document.getElementById('tf-tgm') && !document.getElementById('tf-tgm').contains(document.activeElement)) { tags = ch.playedTags.newValue || {}; draw(); } });
})();
