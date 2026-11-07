importScripts('store.js');

const FILE = 'tubefolio2-settings.json';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

/* ---------- 画面を開く ---------- */
const openDashboard = () => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
chrome.action.onClicked.addListener(openDashboard);

/* ---------- Google 認証 ---------- */
async function getToken(interactive) {
  const { driveToken } = await chrome.storage.local.get('driveToken');
  if (driveToken && driveToken.exp > Date.now() + 60000) return driveToken.token;
  const s = await TF.get();
  const cid = s.settings.driveClientId;
  if (!cid) throw new Error('クライアントIDが未設定です');
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: cid, response_type: 'token', scope: SCOPE,
    redirect_uri: chrome.identity.getRedirectURL()
  });
  const res = await chrome.identity.launchWebAuthFlow({ url, interactive });
  if (!res) throw new Error('認証がキャンセルされました');
  const p = new URLSearchParams(new URL(res).hash.slice(1));
  const token = p.get('access_token');
  if (!token) throw new Error(p.get('error') || 'トークンを取得できませんでした');
  await chrome.storage.local.set({ driveToken: { token, exp: Date.now() + (+p.get('expires_in') || 3600) * 1000 } });
  return token;
}

async function gapi(t, url, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { Authorization: 'Bearer ' + t, ...(opt.headers || {}) } });
  if (r.status === 401) await chrome.storage.local.remove('driveToken');
  if (!r.ok) throw new Error(`Drive API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}

async function findFile(t) {
  const q = encodeURIComponent(`name='${FILE}'`);
  const r = await gapi(t, `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`);
  return (await r.json()).files[0] || null;
}
const readRemote = async (t, id) => (await gapi(t, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).json();

async function writeRemote(t, id, obj) {
  const body = JSON.stringify(obj);
  if (id) {
    await gapi(t, `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body
    });
    return;
  }
  const b = 'tf2boundary';
  const multipart = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: FILE, parents: ['appDataFolder'] }) +
    `\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
  await gapi(t, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body: multipart
  });
}

const snapshot = s => ({
  app: 'TubeFolio2', v: 1, updatedAt: s.updatedAt,
  features: s.settings.features, groups: s.groups, favorites: s.favorites
});

/* ---------- 同期 ---------- */
let busy = Promise.resolve();
function sync(mode, interactive) {
  const run = async () => {
    const t = await getToken(interactive);
    const f = await findFile(t);
    const s = await TF.get();
    if (!f) { await writeRemote(t, null, snapshot(s)); return 'Driveに新規保存しました'; }
    const r = await readRemote(t, f.id);
    const ru = r.updatedAt || 0;
    if (mode === 'pull' || (mode === 'auto' && ru > s.updatedAt)) { await TF.apply(r); return 'Driveの内容を読み込みました'; }
    if (mode === 'push' || (mode === 'auto' && ru < s.updatedAt)) { await writeRemote(t, f.id, snapshot(s)); return 'Driveに保存しました'; }
    return '同期済み(最新です)';
  };
  const p = busy.then(run);
  busy = p.catch(() => {});
  return p.then(
    async msg => { await chrome.storage.local.set({ syncStatus: { at: Date.now(), ok: true, msg } }); return { ok: true, msg }; },
    async e => { await chrome.storage.local.set({ syncStatus: { at: Date.now(), ok: false, msg: e.message } }); return { ok: false, msg: e.message }; }
  );
}

async function autoSync() {
  const s = await TF.get();
  if (s.settings.autoSync && s.settings.driveClientId) await sync('auto', false);
}

/* ---------- メッセージ・アラーム ---------- */
chrome.runtime.onMessage.addListener((m, _s, respond) => {
  if (m.type === 'openDashboard') openDashboard();
  else if (m.type === 'openOptions') chrome.runtime.openOptionsPage();
  else if (m.type === 'drive') { sync(m.op, true).then(respond); return true; }
});

chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.updatedAt) chrome.alarms.create('push', { delayInMinutes: 0.5 });
});
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'push' || a.name === 'periodic') autoSync(); });
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('periodic', { periodInMinutes: 30 }); autoSync(); });
chrome.runtime.onStartup.addListener(autoSync);
