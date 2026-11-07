// TubeFolio2 共通ストア(content / background / options / dashboard で共有)
const TF = (() => {
  const DEF = () => ({
    settings: {
      features: { panel: true, badges: true, history: true, analytics: true },
      driveClientId: '',
      autoSync: true,
      panelOpen: false,
      lastGroup: 'g_default'
    },
    groups: [{ id: 'g_default', name: '未分類', color: '#f5b301' }],
    favorites: {}, // id -> {id,title,channel,thumb,groups:[gid],addedAt}
    history: [],   // {sid,id,title,channel,at,sec,dur,pos}
    updatedAt: 0
  });
  const PALETTE = ['#f5b301', '#ef5350', '#ab47bc', '#5c6bc0', '#29b6f6', '#26a69a', '#9ccc65', '#ff7043'];
  const HISTORY_MAX = 8000;
  let q = Promise.resolve();

  async function get() {
    const raw = await chrome.storage.local.get(['settings', 'groups', 'favorites', 'history', 'updatedAt']);
    const d = DEF();
    const st = raw.settings || {};
    return {
      settings: { ...d.settings, ...st, features: { ...d.settings.features, ...(st.features || {}) } },
      groups: raw.groups && raw.groups.length ? raw.groups : d.groups,
      favorites: raw.favorites || {},
      history: raw.history || [],
      updatedAt: raw.updatedAt || 0
    };
  }

  // fn(state) で state を直接書き換える。keys は保存するキー。
  function mutate(fn, keys, sync) {
    if (sync === undefined) sync = keys.includes('groups') || keys.includes('favorites');
    const run = async () => {
      const s = await get();
      await fn(s);
      const out = {};
      keys.forEach(k => (out[k] = s[k]));
      if (sync) out.updatedAt = Date.now();
      await chrome.storage.local.set(out);
      return s;
    };
    const p = q.then(run);
    q = p.catch(() => {});
    return p;
  }

  // Drive から取り込んだスナップショットを適用(updatedAt はリモートの値を維持)
  function apply(snap) {
    const run = async () => {
      const s = await get();
      s.settings.features = { ...s.settings.features, ...(snap.features || {}) };
      await chrome.storage.local.set({
        settings: s.settings,
        groups: snap.groups && snap.groups.length ? snap.groups : s.groups,
        favorites: snap.favorites || {},
        updatedAt: snap.updatedAt || Date.now()
      });
    };
    const p = q.then(run);
    q = p.catch(() => {});
    return p;
  }

  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const defaultGroup = s => s.groups[0].id;

  const api = {
    get, mutate, apply, PALETTE,

    addFav: (meta, gid) =>
      mutate(s => {
        const g = s.groups.some(x => x.id === gid) ? gid : defaultGroup(s);
        const old = s.favorites[meta.id];
        s.favorites[meta.id] = {
          id: meta.id,
          title: meta.title || (old && old.title) || meta.id,
          channel: meta.channel || (old && old.channel) || '',
          thumb: `https://i.ytimg.com/vi/${meta.id}/mqdefault.jpg`,
          groups: old ? Array.from(new Set([...old.groups, g])) : [g],
          addedAt: old ? old.addedAt : Date.now()
        };
        s.settings.lastGroup = g;
      }, ['favorites', 'settings'], true),

    toggleFavGroup: (meta, gid) =>
      mutate(s => {
        const old = s.favorites[meta.id];
        if (!old) {
          s.favorites[meta.id] = {
            id: meta.id, title: meta.title || meta.id, channel: meta.channel || '',
            thumb: `https://i.ytimg.com/vi/${meta.id}/mqdefault.jpg`, groups: [gid], addedAt: Date.now()
          };
        } else {
          old.groups = old.groups.includes(gid) ? old.groups.filter(x => x !== gid) : [...old.groups, gid];
          if (meta.title && !old.title) old.title = meta.title;
          if (!old.groups.length) delete s.favorites[meta.id];
        }
        s.settings.lastGroup = gid;
      }, ['favorites', 'settings'], true),

    removeFav: id => mutate(s => { delete s.favorites[id]; }, ['favorites']),

    addGroup: (name, color) => {
      const id = uid('g_');
      return mutate(s => {
        s.groups.push({ id, name, color: color || PALETTE[s.groups.length % PALETTE.length] });
      }, ['groups']).then(() => id);
    },
    updateGroup: (id, name, color) =>
      mutate(s => {
        const g = s.groups.find(x => x.id === id);
        if (g) { if (name) g.name = name; if (color) g.color = color; }
      }, ['groups']),
    deleteGroup: id =>
      mutate(s => {
        if (id === defaultGroup(s)) return;
        s.groups = s.groups.filter(g => g.id !== id);
        const def = defaultGroup(s);
        Object.values(s.favorites).forEach(f => {
          f.groups = f.groups.filter(x => x !== id);
          if (!f.groups.length) f.groups = [def];
        });
        if (s.settings.lastGroup === id) s.settings.lastGroup = def;
      }, ['groups', 'favorites', 'settings'], true),

    setFeature: (name, val) =>
      mutate(s => { s.settings.features[name] = !!val; }, ['settings'], true),
    setSetting: (key, val) => mutate(s => { s.settings[key] = val; }, ['settings'], false),

    logSession: sess =>
      mutate(s => {
        const i = s.history.findIndex(h => h.sid === sess.sid);
        if (i >= 0) s.history[i] = sess; else s.history.push(sess);
        if (s.history.length > HISTORY_MAX) s.history = s.history.slice(-HISTORY_MAX);
      }, ['history']),
    deleteHistory: sid => mutate(s => { s.history = s.history.filter(h => h.sid !== sid); }, ['history']),
    clearHistory: () => mutate(s => { s.history = []; }, ['history']),

    fmtDur(sec) {
      sec = Math.round(sec || 0);
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60;
      if (h) return `${h}時間${m}分`;
      if (m) return `${m}分${r}秒`;
      return `${r}秒`;
    },
    esc: t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  };
  return api;
})();
