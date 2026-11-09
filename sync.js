// Google Drive 同期(appDataFolder の tubefolio2.json)。background.js から importScripts で読み込む。
// 方式: 全体を1ファイルで保存。最終更新(rev)が新しい方が勝つ。
const SYNC_KEYS = ['groups', 'channels', 'settings', 'meta', 'activity'];
const SYNC_FILE = 'tubefolio2.json';
const DRIVE = 'https://www.googleapis.com';

const setStatus = (state, msg) => chrome.storage.local.set({ syncStatus: { state, msg: msg || '', at: Date.now() } });

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

let syncP = null, applying = false;
function syncNow(interactive) {
  return syncP || (syncP = (async () => {
    try {
      await setStatus('syncing');
      const tok = await driveToken(interactive);
      const id = await findFile(tok);
      const local = await chrome.storage.local.get([...SYNC_KEYS, 'syncMeta']);
      const lrev = (local.syncMeta || {}).rev || 0;
      let remote = null;
      if (id) { try { remote = await (await dapi(tok, `/drive/v3/files/${id}?alt=media`)).json(); } catch (e) { if (!/404/.test(e.message)) throw e; } }
      const rrev = remote ? remote.rev || 0 : 0;
      if (remote && rrev > lrev) {
        applying = true;
        const set = { syncMeta: { rev: rrev } };
        SYNC_KEYS.forEach(k => { if (remote.data && remote.data[k] !== undefined) set[k] = remote.data[k]; });
        await chrome.storage.local.set(set);
        setTimeout(() => { applying = false; }, 500);
        await setStatus('ok', '他のPCの内容を取り込みました');
      } else if (!remote || lrev > rrev) {
        const rev = lrev || Date.now();
        const data = {}; SYNC_KEYS.forEach(k => { if (local[k] !== undefined) data[k] = local[k]; });
        await upload(tok, id, JSON.stringify({ app: 'TubeFolio2', rev, data }));
        if (!lrev) await chrome.storage.local.set({ syncMeta: { rev } });
        await setStatus('ok', 'Driveに保存しました');
      } else await setStatus('ok', '最新です');
      return { ok: true };
    } catch (e) {
      const msg = /interaction_required|user interaction|did not approve/i.test(String(e.message || e)) ? "ログインが必要です。「☁ 同期」ボタンを押してください(" + String(e.message || e).slice(0, 60) + ")" : String(e.message || e);
      console.warn("[TubeFolio2 sync]", e);
      await setStatus('error', msg);
      return { error: msg };
    }
  })().finally(() => { syncP = null; }));
}

// 手動: 'up' = この端末の内容でDriveを上書き / 'down' = Driveの内容でこの端末を上書き(rev の新旧は見ない)
async function driveForce(dir) {
  if (syncP) { try { await syncP; } catch (e) {} }
  try {
    await setStatus('syncing');
    const tok = await driveToken(true);
    const id = await findFile(tok);
    if (dir === 'up') {
      const local = await chrome.storage.local.get(SYNC_KEYS), rev = Date.now(), data = {};
      SYNC_KEYS.forEach(k => { if (local[k] !== undefined) data[k] = local[k]; });
      await upload(tok, id, JSON.stringify({ app: 'TubeFolio2', rev, data }));
      await chrome.storage.local.set({ syncMeta: { rev } });
      await setStatus('ok', 'Driveへアップロードしました');
    } else {
      if (!id) throw new Error('Driveにまだデータがありません');
      const remote = await (await dapi(tok, `/drive/v3/files/${id}?alt=media`)).json();
      if (!remote || !remote.data) throw new Error('Driveのデータを読み込めませんでした');
      applying = true;
      const set = { syncMeta: { rev: remote.rev || Date.now() } };
      SYNC_KEYS.forEach(k => { if (remote.data[k] !== undefined) set[k] = remote.data[k]; });
      await chrome.storage.local.set(set);
      setTimeout(() => { applying = false; }, 500);
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

// ローカル変更 → rev更新 → 少し待ってDriveへ
let pushT = 0;
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || applying || ch.syncMeta) return;
  if (!SYNC_KEYS.some(k => k in ch)) return;
  chrome.storage.local.set({ syncMeta: { rev: Date.now() } });
  clearTimeout(pushT); pushT = setTimeout(() => syncNow(false), 4000);
});
chrome.alarms.create('tf-sync', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'tf-sync') syncNow(false); });
chrome.runtime.onStartup.addListener(() => syncNow(false));
chrome.runtime.onInstalled.addListener(() => syncNow(false));
