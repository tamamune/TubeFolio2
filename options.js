(() => {
  const $ = s => document.querySelector(s);
  $('#redir').textContent = chrome.identity.getRedirectURL();

  async function load() {
    const S = await TF.get();
    document.querySelectorAll('[data-f]').forEach(c => (c.checked = !!S.settings.features[c.dataset.f]));
    if (document.activeElement !== $('#cid')) $('#cid').value = S.settings.driveClientId || '';
    $('#auto').checked = !!S.settings.autoSync;
    const { syncStatus } = await chrome.storage.local.get('syncStatus');
    if (syncStatus) {
      $('#status').className = 'status ' + (syncStatus.ok ? 'ok' : 'ng');
      $('#status').textContent = `${new Date(syncStatus.at).toLocaleString('ja-JP')} — ${syncStatus.msg}`;
    }
  }

  document.querySelectorAll('[data-f]').forEach(c => c.addEventListener('change', () => TF.setFeature(c.dataset.f, c.checked)));
  $('#saveCid').addEventListener('click', async () => { await TF.setSetting('driveClientId', $('#cid').value.trim()); $('#status').textContent = 'クライアントIDを保存しました'; });
  $('#auto').addEventListener('change', e => TF.setSetting('autoSync', e.target.checked));

  async function drive(op) {
    await TF.setSetting('driveClientId', $('#cid').value.trim());
    $('#status').className = 'status';
    $('#status').textContent = '処理中…';
    const r = await chrome.runtime.sendMessage({ type: 'drive', op });
    $('#status').className = 'status ' + (r && r.ok ? 'ok' : 'ng');
    $('#status').textContent = r ? r.msg : '応答がありません';
  }
  $('#connect').addEventListener('click', () => drive('auto'));
  $('#push').addEventListener('click', () => confirm('Driveの内容をこの端末の内容で上書きします。よろしいですか?') && drive('push'));
  $('#pull').addEventListener('click', () => confirm('この端末のグループ・お気に入りをDriveの内容で上書きします。よろしいですか?') && drive('pull'));

  $('#exp').addEventListener('click', async () => {
    const S = await TF.get();
    const blob = new Blob([JSON.stringify({ app: 'TubeFolio2', v: 1, groups: S.groups, favorites: S.favorites, history: S.history, features: S.settings.features }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `tubefolio2-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  });
  $('#imp').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== 'TubeFolio2') throw new Error('TubeFolio2のバックアップではありません');
      if (!confirm('現在のデータを読み込んだ内容で置き換えます。よろしいですか?')) return;
      await TF.mutate(s => {
        if (d.groups && d.groups.length) s.groups = d.groups;
        if (d.favorites) s.favorites = d.favorites;
        if (d.history) s.history = d.history;
        if (d.features) s.settings.features = { ...s.settings.features, ...d.features };
      }, ['groups', 'favorites', 'history', 'settings'], true);
      alert('読み込みました');
    } catch (err) { alert('読み込み失敗: ' + err.message); }
    e.target.value = '';
  });

  chrome.storage.onChanged.addListener(load);
  load();
})();
