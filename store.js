// 共通ストア(content / manager で共有)。chrome.storage.local に保存。
const TF = (() => {
  const PALETTE = ['#ff5a5f', '#ff9f1c', '#f5c518', '#2ec4b6', '#3a86ff', '#8b5cf6', '#ec4899', '#64748b'];
  const ICONS = ['⭐', '🎮', '🎵', '📚', '🍳', '💻', '🎬', '⚽', '🧠', '🛠️', '🎨', '📰', '😂', '🚗', '🌍', '💼', '🐱', '🔬', '🎙️', '🏋️', '🗾', '🗻', '⛩️', '🏯', '🍣', '🚄'];
  const DEF = () => ({
    groups: [{ id: 'g_default', name: 'お気に入り', icon: '⭐', color: PALETTE[2] }],
    channels: {}, // key -> {key,name,avatar,groups:[gid],addedAt}
    settings: { activeGroup: 'all', hideWatched: false, sort: 'added' }
  });
  let q = Promise.resolve();

  async function get() {
    const raw = await chrome.storage.local.get(['groups', 'channels', 'settings']);
    const d = DEF();
    return {
      groups: raw.groups && raw.groups.length ? raw.groups : d.groups,
      channels: raw.channels || {},
      settings: { ...d.settings, ...(raw.settings || {}) }
    };
  }
  function mutate(fn) {
    const p = q.then(async () => {
      const s = await get();
      await fn(s);
      await chrome.storage.local.set(s);
      return s;
    });
    q = p.catch(() => {});
    return p;
  }
  const uid = () => 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  // href / pathname から チャンネルキー(@handle小文字 or UC...) を得る
  function keyFromHref(href) {
    if (!href) return null;
    let m = href.match(/\/(@[^\/?#]+)/);
    if (m) { try { return decodeURIComponent(m[1]).toLowerCase(); } catch (e) { return m[1].toLowerCase(); } }
    m = href.match(/\/channel\/(UC[\w-]+)/);
    return m ? m[1] : null;
  }

  // ---- 入れ子フォルダ用ヘルパー ----
  function subtree(groups, id) {
    const out = new Set([id]);
    let ch = true;
    while (ch) { ch = false; groups.forEach(g => { if (g.parent && out.has(g.parent) && !out.has(g.id)) { out.add(g.id); ch = true; } }); }
    return out;
  }
  function flat(groups) {
    const ids = new Set(groups.map(g => g.id));
    const out = [];
    const walk = (p, d) => groups.filter(g => p === null ? (!g.parent || !ids.has(g.parent)) : g.parent === p)
      .forEach(g => { out.push({ g, depth: d }); walk(g.id, d + 1); });
    walk(null, 0);
    return out;
  }
  // "名前 名前" のように重複したタイトルを1つにする
  function clean(name) {
    const s = String(name || '').replace(/\s+/g, ' ').trim();
    const h = Math.floor(s.length / 2);
    if (s.length % 2 === 1 && s.slice(0, h) === s.slice(h + 1)) return s.slice(0, h);
    return s;
  }

  return {
    PALETTE, ICONS, get, mutate, uid, keyFromHref, subtree, flat, clean,
    upsertChannels: list => mutate(s => {
      list.forEach(c => {
        const o = s.channels[c.key];
        s.channels[c.key] = { groups: [], addedAt: Date.now(), ...o, key: c.key, name: c.name || (o && o.name) || c.key, avatar: c.avatar || (o && o.avatar) || '' };
      });
    }),
    toggleGroup: (meta, gid) => mutate(s => {
      const c = s.channels[meta.key] || (s.channels[meta.key] = { key: meta.key, name: meta.name || meta.key, avatar: meta.avatar || '', groups: [], addedAt: Date.now() });
      if (meta.name && (!c.name || c.name === c.key)) c.name = meta.name;
      if (meta.avatar && !c.avatar) c.avatar = meta.avatar;
      const i = c.groups.indexOf(gid);
      if (i >= 0) c.groups.splice(i, 1); else c.groups.push(gid);
    }),
    addGroup: (name, icon, color) => mutate(s => { s.groups.push({ id: uid(), name, icon: icon || '📁', color: color || PALETTE[s.groups.length % PALETTE.length] }); }),
    exportJson: async () => JSON.stringify({ app: 'TubeFolio2', ...(await get()) }, null, 2)
  };
})();
