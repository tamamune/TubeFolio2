// Google Drive 同期(appDataFolder の tubefolio2.json)。background.js から importScripts で読み込む。
// 方式: 全体を1ファイルで保存。最終更新(rev)が新しい方が勝つ。
// Drive に共有するデータ(各PCに登録した TubeFolio2 の設定・登録データ)。YouTube 自身が共有しているもの(視聴履歴・登録チャンネル・再生リスト本体)と、取り直せるキャッシュ・この端末だけの記録(動作ログ・画像のサムネ等)は含めない。
// 対象のキーは store.js の TF.SYNC_KEYS(1か所で管理)。
// 方式(キーごとの統合): キーごとに「最後に変えた時刻」(syncMeta.k)を持ち、Drive と比べて、キーごとに新しい方を採る。
//   以前は「全体で新しい方が勝つ」だったので、別のPCで少し操作しただけで、もう一方のPCで登録した内容が丸ごと古い内容に戻ることがあった。
//   視聴履歴(hist)・ランダムタグ(playedTags)・再生リストの登録日(plSeen)は、中身どうしを合わせる(どちらのPCの分も残す)。
//   この端末で初めて同期するときは、Drive にデータがあれば、Drive の内容を取り込む(空の端末が Drive を上書きしないように)。
const SYNC_KEYS = TF.SYNC_KEYS;
// 同期しないキャッシュ(取り直せる): trendsCache4 / trendsCache24(急上昇ワード)・t1_<日付>(急上昇動画)。trends-bg.js が作る
const SYNC_FILE = 'tubefolio2.json';
const DRIVE = 'https://www.googleapis.com';

const setStatus = (state, msg) => { try { if (typeof bgLog === 'function' && (state === 'error' || state === 'ok')) bgLog('Drive同期', msg || (state === 'ok' ? '完了' : '失敗'), state === 'error' ? 'error' : 'info'); } catch (e) { /* 無視 */ } return chrome.storage.local.set({ syncStatus: { state, msg: msg || '', at: Date.now() } }); };

async function driveToken(interactive) {
  // トークンは拡張機能を更新(再読み込み)しても残るよう storage.local に保存する
  const { driveTok: c, driveHint: hint } = await chrome.storage.local.get(['driveTok', 'driveHint']);
  if (c && c.exp > Date.now() + 60000) return c.v;
  if (!DRIVE_CLIENT_ID) throw new Error('drive-config.js に DRIVE_CLIENT_ID が未設定です');
  const q = {
    client_id: DRIVE_CLIENT_ID, response_type: 'token', redirect_uri: chrome.identity.getRedirectURL(),
    scope: DRIVE + '/auth/drive.appdata ' + DRIVE + '/auth/userinfo.email'
  };
  // 一度ログインしたアカウントを login_hint で指定すると、無言(prompt=none)でトークンを再取得できる
  if (hint) { q.login_hint = hint; q.prompt = 'none'; } else q.prompt = interactive ? 'select_account' : 'none';
  let res;
  try { res = await chrome.identity.launchWebAuthFlow({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams(q), interactive: interactive && !hint }); }
  catch (e) { if (!interactive || !hint) throw e; res = null; }
  let p = res && new URLSearchParams(new URL(res).hash.slice(1));
  if (interactive && hint && (!p || !p.get('access_token'))) { // 無言で取れなければ対話ログイン
    q.prompt = 'select_account'; delete q.login_hint;
    res = await chrome.identity.launchWebAuthFlow({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams(q), interactive: true });
    p = new URLSearchParams(new URL(res).hash.slice(1));
  }
  const v = p && p.get('access_token');
  if (!v) throw new Error((p && p.get('error')) || '認証に失敗しました');
  const set = { driveTok: { v, exp: Date.now() + (+p.get('expires_in') || 3600) * 1000 } };
  try { // ログインしたアカウントを記憶(次回から無言で更新するため)
    const u = await (await fetch(DRIVE + '/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + v } })).json();
    if (u.email) set.driveHint = u.email;
  } catch (e) {}
  await chrome.storage.local.set(set);
  return v;
}
async function dapi(tok, path, opt = {}) {
  const r = await fetch(DRIVE + path, { ...opt, headers: { Authorization: 'Bearer ' + tok, ...(opt.headers || {}) } });
  if (!r.ok) throw new Error('Drive ' + r.status);
  return r;
}
async function findFile(tok) {
  const q = encodeURIComponent(`name='${SYNC_FILE}'`);
  const j = await (await dapi(tok, `/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`)).json();
  return j.files[0] ? j.files[0].id : null;
}
async function upload(tok, id, body) {
  if (id) return dapi(tok, `/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
  const b = '-tf-' + Date.now();
  const mp = `--${b}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name: SYNC_FILE, parents: ['appDataFolder'] })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
  return dapi(tok, '/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: mp });
}

// ---- 中身どうしを合わせるキー ----
const HIST_MAX = 30000; // 視聴履歴の再生の記録の上限(古いものから捨てる)
const MERGE = {
  // 視聴履歴: { v: { 動画ID: [タイトル, チャンネル名, チャンネルのキー, 長さ(秒), ショートか] }, p: [[開始(秒), 動画ID, 見た秒数], …], g: 最後に削除した時刻 }。同じ再生(開始+動画)は、長い方を残す
  hist(a, b) {
    // g = 最後に「削除」をした時刻。新しい削除をした側を元にして、もう一方からは、その削除よりあとの再生だけを足す(消した記録が、同期で戻らないように)
    const ga = (a && a.g) || 0, gb = (b && b.g) || 0, g = Math.max(ga, gb), m = new Map();
    const pa = ((a && a.p) || []).filter(x => ga >= gb || (Array.isArray(x) && x[0] * 1000 > gb)), pb = ((b && b.p) || []).filter(x => gb >= ga || (Array.isArray(x) && x[0] * 1000 > ga));
    for (const x of [...pa, ...pb]) { if (!Array.isArray(x)) continue; const k = x[0] + '|' + x[1], o = m.get(k); if (!o || (x[2] || 0) > (o[2] || 0)) m.set(k, x); }
    const p = [...m.values()].sort((x, y) => x[0] - y[0]).slice(-HIST_MAX), used = new Set(p.map(x => x[1])), v = {};
    for (const src of [(a && a.v) || {}, (b && b.v) || {}]) for (const [id, d] of Object.entries(src)) if (used.has(id) && (!v[id] || (d && d[0] && !v[id][0]))) v[id] = d;
    return g ? { v, p, g } : { v, p };
  },
  // ランダムタグ: タグごとに、あとで変えた方(at が新しい方)を採る
  playedTags(a, b) {
    const out = { ...(a || {}) };
    for (const [k, e] of Object.entries(b || {})) { const o = out[k]; if (!o || (e && (e.at || 0) > (o.at || 0))) out[k] = e; }
    return out;
  },
  // 再生リストの登録日({ リストID: { 動画ID: 年月日の数字(20261108)。0 = 分からない } }): 分かっている方・早い方の日を採る
  plSeen(a, b) {
    const out = {};
    for (const src of [a || {}, b || {}]) for (const [l, o] of Object.entries(src)) { const t = out[l] || (out[l] = {}); for (const [v, d] of Object.entries(o || {})) if (!(v in t) || (d && (!t[v] || d < t[v]))) t[v] = d; }
    return out;
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let syncP = null, applying = false;
const applySet = async set => { applying = true; try { await chrome.storage.local.set(set); } finally { setTimeout(() => { applying = false; }, 500); } };
function syncNow(interactive) {
  return syncP || (syncP = (async () => {
    try {
      await setStatus('syncing');
      const tok = await driveToken(interactive);
      const id = await findFile(tok);
      const local = await chrome.storage.local.get([...SYNC_KEYS, 'syncMeta']);
      const lm = local.syncMeta || {}, lrev = lm.rev || 0, lk = lm.k || {};
      let remote = null;
      if (id) { try { remote = await (await dapi(tok, `/drive/v3/files/${id}?alt=media`)).json(); } catch (e) { if (!/404/.test(e.message)) throw e; } }
      const rrev = remote ? remote.rev || 0 : 0, rk = (remote && remote.keys) || {}, rdata = (remote && remote.data) || {};
      const first = !lm.init && !!remote && (!!lm.k || !lrev); // (以前の形式で同期済みの端末 = rev だけがある端末は、初めてではない) // この端末で初めての同期: Drive の内容を優先する
      const lt = k => (lk[k] !== undefined ? lk[k] : lrev), rt = k => (rk[k] !== undefined ? rk[k] : rrev);
      const set = {}, data = {}, keys = {}; let push = !remote, took = 0;
      for (const k of SYNC_KEYS) {
        const lv = local[k], rv = rdata[k], a = lt(k), b = rt(k);
        if (rv === undefined) { if (lv !== undefined) { data[k] = lv; keys[k] = a || Date.now(); push = true; } continue; }
        if (lv === undefined) { set[k] = data[k] = rv; keys[k] = b; took++; continue; }
        if (MERGE[k]) { // 両方の中身を合わせる
          const mv = MERGE[k](lv, rv); data[k] = mv; keys[k] = Math.max(a, b);
          if (!same(mv, lv)) { set[k] = mv; took++; }
          if (!same(mv, rv)) push = true;
          continue;
        }
        if (first || b > a) { data[k] = rv; keys[k] = b; if (!same(lv, rv)) { set[k] = rv; took++; } }
        else if (a > b) { data[k] = lv; keys[k] = a; if (!same(lv, rv)) push = true; }
        else { data[k] = lv; keys[k] = a; }
      }
      const rev = push ? Date.now() : Math.max(lrev, rrev);
      await applySet({ ...set, syncMeta: { rev, k: keys, init: true } });
      if (push) await upload(tok, id, JSON.stringify({ app: 'TubeFolio2', rev, keys, data }));
      await setStatus('ok', took && push ? '他のPCの内容を取り込み、この端末の変更をDriveに保存しました' : took ? '他のPCの内容を取り込みました' : push ? 'Driveに保存しました' : '最新です');
      return { ok: true };
    } catch (e) {
      const msg = /interaction_required|user interaction|did not approve/i.test(String(e.message || e)) ? "ログインが必要です。「☁ 同期」ボタンを押してください(" + String(e.message || e).slice(0, 60) + ")" : String(e.message || e);
      console.warn("[TubeFolio2 sync]", e);
      await setStatus('error', msg);
      return { error: msg };
    }
  })().finally(() => { syncP = null; }));
}

// 手動: 'up' = この端末の内容でDriveを上書き / 'down' = Driveの内容でこの端末を上書き(新旧は見ない)
async function driveForce(dir) {
  if (syncP) { try { await syncP; } catch (e) {} }
  try {
    await setStatus('syncing');
    const tok = await driveToken(true);
    const id = await findFile(tok);
    if (dir === 'up') {
      const local = await chrome.storage.local.get(SYNC_KEYS), rev = Date.now(), data = {}, keys = {};
      SYNC_KEYS.forEach(k => { if (local[k] !== undefined) { data[k] = local[k]; keys[k] = rev; } });
      await upload(tok, id, JSON.stringify({ app: 'TubeFolio2', rev, keys, data }));
      await chrome.storage.local.set({ syncMeta: { rev, k: keys, init: true } });
      await setStatus('ok', 'Driveへアップロードしました');
    } else {
      if (!id) throw new Error('Driveにまだデータがありません');
      const remote = await (await dapi(tok, `/drive/v3/files/${id}?alt=media`)).json();
      if (!remote || !remote.data) throw new Error('Driveのデータを読み込めませんでした');
      const rev = remote.rev || Date.now(), keys = {}, set = {};
      SYNC_KEYS.forEach(k => { if (remote.data[k] !== undefined) { set[k] = remote.data[k]; keys[k] = (remote.keys || {})[k] || rev; } });
      await applySet({ ...set, syncMeta: { rev, k: keys, init: true } });
      await setStatus('ok', 'Driveからダウンロードしました');
    }
    return { ok: true };
  } catch (e) {
    const msg = String(e.message || e);
    console.warn('[TubeFolio2 sync]', e);
    await setStatus('error', msg);
    return { error: msg };
  }
}

// ローカル変更 → そのキーの時刻を更新 → 少し待ってDriveへ(視聴履歴だけの変更は、再生中に何度も起きるので、1分まとめる)
let pushT = 0, markQ = Promise.resolve(), pushAt = 0;
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || applying || ch.syncMeta) return;
  const hit = SYNC_KEYS.filter(k => k in ch);
  if (!hit.length) return;
  const now = Date.now();
  markQ = markQ.then(async () => {
    const m = (await chrome.storage.local.get('syncMeta')).syncMeta || {}, k = { ...(m.k || {}) };
    let init = m.init; if (!m.k && m.rev) { SYNC_KEYS.forEach(x => { k[x] = m.rev; }); init = true; } // 以前の形式(全体でひとつの時刻)から引き継ぐ(同期済みの端末として扱う)
    hit.forEach(x => { k[x] = now; });
    await chrome.storage.local.set({ syncMeta: { ...m, rev: now, k, ...(init ? { init: true } : {}) } });
  }).catch(() => {});
  const wait = hit.every(k => k === 'hist') ? 60000 : 4000, at = now + wait;
  if (pushT && pushAt && pushAt <= at) return; // もっと早い送信が、すでに予約されている
  clearTimeout(pushT); pushAt = at; pushT = setTimeout(() => { pushT = 0; pushAt = 0; syncNow(false); }, wait);
});
chrome.alarms.create('tf-sync', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'tf-sync') syncNow(false); });
chrome.runtime.onStartup.addListener(() => syncNow(false));
chrome.runtime.onInstalled.addListener(() => syncNow(false));
