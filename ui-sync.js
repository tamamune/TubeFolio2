// 拡張機能のページ(page.html / manager.html / log.html)の、見た目の設定(localStorage に入れている分)を、Drive同期の対象にする。
//   対象: テーマ(tfTheme)、一覧の日付の折りたたみ・並び(tfPageFold_… / tfPageSort_…)、検索ページの前回の選び方(tfRecScope / tfRecKind / tfRecQ)、
//         視聴履歴のページのタブ・期間(tfHistTab / tfHistDays)、管理画面の開いたフォルダ・タブ(tfOpen / tfMgrTab / tfStats)、設定の開いていたタブ(tfSetTab / tfSetSub / tfSetOSub)
//   YouTube のページ(content script)でも読み込む(設定のタブの分)。
//   仕組み: localStorage への書き込みを見て、storage の ui にも保存する(ui は SYNC_KEYS に入っていて、Driveで共有される)。
//   起動時と、ほかのPCの変更を受け取ったときは、ui の値を localStorage に反映する(読む側のコードは、これまでどおり localStorage を読むだけ)。
//   反映したあと、'tfUiApplied' のイベントを出す(テーマなど、すぐ見た目を変える必要があるものが、受け取って使う)。
(() => {
  if (window.__tfUiSync) return; window.__tfUiSync = true;
  const OK = k => /^(tfTheme|tfPageFold_.+|tfPageSort_.+|tfRecScope|tfRecKind|tfRecQ|tfHistTab|tfHistDays|tfOpen|tfMgrTab|tfStats|tfSetTab|tfSetSub|tfSetOSub|tfRec2Kind)$/.test(String(k));
  let ls, set0, rm0;
  try { ls = window.localStorage; set0 = Storage.prototype.setItem; rm0 = Storage.prototype.removeItem; } catch (e) { return; }
  let ui = {}, ready = false, t = 0;
  const save = () => { clearTimeout(t); t = setTimeout(() => { try { chrome.storage.local.set({ ui }); } catch (e) { /* 無視 */ } }, 400); };
  Storage.prototype.setItem = function (k, v) { set0.call(this, k, v); if (this === ls && OK(k)) { ui[k] = String(v); if (ready) save(); } };
  Storage.prototype.removeItem = function (k) { rm0.call(this, k); if (this === ls && OK(k)) { delete ui[k]; if (ready) save(); } };
  const apply = next => { // ui の内容を localStorage に反映する(違うものだけ)
    let changed = false;
    Object.entries(next || {}).forEach(([k, v]) => { if (OK(k) && ls.getItem(k) !== v) { set0.call(ls, k, v); changed = true; } });
    Object.keys(ls).filter(OK).forEach(k => { if (!(k in (next || {}))) { /* この端末だけにあるものは、残して、あとで ui へ送る */ } });
    return changed;
  };
  chrome.storage.local.get('ui').then(r => {
    ui = { ...(r.ui || {}) };
    const changed = apply(ui);
    let pushed = false; // この端末だけにあった値を ui に足す(初めて同期するとき)
    Object.keys(ls).filter(OK).forEach(k => { if (!(k in ui)) { ui[k] = ls.getItem(k); pushed = true; } });
    ready = true; if (pushed) save();
    if (changed) window.dispatchEvent(new Event('tfUiApplied'));
  }).catch(() => { ready = true; });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local' || !ch.ui) return;
    const next = ch.ui.newValue || {}; ui = { ...next };
    if (apply(next)) window.dispatchEvent(new Event('tfUiApplied'));
  });
})();
