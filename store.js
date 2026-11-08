// 共通ストア(content / manager で共有)。chrome.storage.local に保存。
const TF = (() => {
  const PALETTE = ['#ff5a5f', '#ff9f1c', '#f5c518', '#2ec4b6', '#3a86ff', '#8b5cf6', '#ec4899', '#64748b'];
  const ICONS = ['⭐', '🎮', '🎵', '📚', '🍳', '💻', '🎬', '⚽', '🧠', '🛠️', '🎨', '📰', '😂', '🚗', '🌍', '💼', '🐱', '🔬', '🎙️', '🏋️', '🗾', '🗻', '⛩️', '🏯', '🍣', '🚄',
    '🍥', '⚔️', '🔮', '✨', '💫', '🎴', '🏮', '🐉', '🦊', '👘', '🎐', '🍡', '🍙', '🎎', '💥', '🌟', '🌙', '🔥', '🤖', '👾', '🚀', '🧙', '🌏', '🍔', '🍜', '👻', '🐠', '🌱', '🎯', '🎭', '🎌', '📺', '✈️', '🖥️', '🕹️', '🎤', '🎧', '📷', '💄', '🧸', '🔴', '🏝️', '🐶', '⚾', '🧪', '🌸'];
  // アニメ風アイコン(オリジナルのSVG。data URIとして保存するので、そのまま画像アイコンとして使える)
  const animeFace = (hair, eye, ears) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>${ears ? `<path d='M12 24 L14 4 L28 16Z M52 24 L50 4 L36 16Z' fill='${hair}'/><path d='M16 20 L16 10 L23 15Z M48 20 L48 10 L41 15Z' fill='#ffb3c1'/>` : ''}<path d='M10 34 C8 46 12 54 16 57 L19 34Z M54 34 C56 46 52 54 48 57 L45 34Z' fill='${hair}'/><circle cx='32' cy='35' r='21' fill='#ffe6d3'/><path d='M10 35 C9 12 55 12 54 35 C49 25 41 21 32 21 C23 21 15 25 10 35Z' fill='${hair}'/><path d='M32 21 C31 28 27 31 22 33 C28 31 31 27 32 21Z' fill='${hair}'/><ellipse cx='24' cy='38' rx='4.6' ry='6.2' fill='${eye}'/><ellipse cx='40' cy='38' rx='4.6' ry='6.2' fill='${eye}'/><circle cx='25.8' cy='35.3' r='2' fill='#fff'/><circle cx='41.8' cy='35.3' r='2' fill='#fff'/><circle cx='22.6' cy='40.8' r='1' fill='#fff'/><circle cx='38.6' cy='40.8' r='1' fill='#fff'/><ellipse cx='17.5' cy='45' rx='3.6' ry='2' fill='#ff8fa3' opacity='.55'/><ellipse cx='46.5' cy='45' rx='3.6' ry='2' fill='#ff8fa3' opacity='.55'/><path d='M29 47 Q32 50 35 47' stroke='#c0504d' fill='none' stroke-width='1.6' stroke-linecap='round'/></svg>`;
  const ANIME = [
    ['ピンク髪', animeFace('#ff8fc7', '#4f7cff')], ['青髪', animeFace('#4aa3ff', '#d94a5a')], ['金髪', animeFace('#ffd54a', '#2fae6a')], ['黒髪', animeFace('#2b2b3a', '#8a5a3a')],
    ['紫髪', animeFace('#9b6bff', '#ffc233')], ['銀髪', animeFace('#cfd6e6', '#35c4d8')], ['猫耳(ピンク)', animeFace('#ff8fc7', '#4f7cff', true)], ['猫耳(黒)', animeFace('#2b2b3a', '#d94a5a', true)],
    ['きらめき', `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><path d='M32 6 L38 26 L58 32 L38 38 L32 58 L26 38 L6 32 L26 26Z' fill='#ffd54a' stroke='#ff9f1c' stroke-width='2' stroke-linejoin='round'/><circle cx='51' cy='13' r='4' fill='#fff2a8'/><circle cx='12' cy='50' r='3' fill='#fff2a8'/></svg>`],
    ['魔法のステッキ', `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><path d='M12 52 L38 26' stroke='#a56bd6' stroke-width='6' stroke-linecap='round'/><path d='M44 6 l3.5 8 8 3.5 -8 3.5 -3.5 8 -3.5 -8 -8 -3.5 8 -3.5z' fill='#ffd54a' stroke='#ff9f1c' stroke-width='1.6' stroke-linejoin='round'/><circle cx='54' cy='40' r='3' fill='#ff8fc7'/></svg>`],
    ['刀', `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><path d='M50 6 L58 14 L28 46 L20 38Z' fill='#e3e9f1' stroke='#7f8ea0' stroke-width='2' stroke-linejoin='round'/><path d='M14 36 L30 52' stroke='#e0a030' stroke-width='5' stroke-linecap='round'/><path d='M22 44 L10 56' stroke='#7a4b2a' stroke-width='6' stroke-linecap='round'/></svg>`],
    ['桜', `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><g fill='#ffb7d0' stroke='#ff7fa8' stroke-width='1.5' stroke-linejoin='round'><path id='p' d='M32 30 C22 22 24 8 32 8 L32 14 L35 8 C42 8 42 22 32 30Z'/><path d='M32 30 C22 22 24 8 32 8 L32 14 L35 8 C42 8 42 22 32 30Z' transform='rotate(72 32 32)'/><path d='M32 30 C22 22 24 8 32 8 L32 14 L35 8 C42 8 42 22 32 30Z' transform='rotate(144 32 32)'/><path d='M32 30 C22 22 24 8 32 8 L32 14 L35 8 C42 8 42 22 32 30Z' transform='rotate(216 32 32)'/><path d='M32 30 C22 22 24 8 32 8 L32 14 L35 8 C42 8 42 22 32 30Z' transform='rotate(288 32 32)'/></g><circle cx='32' cy='32' r='3.5' fill='#ffd54a'/></svg>`]
  ].map(([name, svg]) => ({ name, uri: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) }));
  // フォルダ名からアイコンを推測(上から順に最初に一致したもの)
  const ICON_RULES = [
    [/大食い|早食い|デカ盛/, '🍔'], [/ラーメン|麺/, '🍜'], [/料理|グルメ|レシピ|クッキング|飯テロ|食べ/, '🍳'], [/寿司|和食|食/, '🍣'],
    [/ゲーム実況|実況/, '🎮'], [/steam|スチーム|PCゲーム/i, '🖥️'], [/ゲーム|game|ゲーミング/i, '🎮'], [/レトロ/, '🕹️'],
    [/アニメ|anime|漫画|マンガ/i, ANIME[0].uri], [/怪談|ホラー|心霊|オカルト|都市伝説|怖/, '👻'], [/映画|シネマ|ドラマ/, '🎬'],
    [/アクアリウム|熱帯魚|水槽|海水魚|メダカ|魚/, '🐠'], [/ガーデニング|園芸|植物|家庭菜園|盆栽/, '🌱'],
    [/hobby|ホビー|趣味/i, '🎯'], [/エンタメ|バラエティ|お笑い|芸人|コント/, '🎭'], [/v\s*tuber|ブイチューバー|バーチャル/i, '🎤'],
    [/音楽|music|歌|ライブ映像|カバー|バンド/i, '🎵'], [/ニュース|news|時事|報道/i, '📰'], [/野球/, '⚾'], [/スポーツ|sports|サッカー|格闘/i, '⚽'],
    [/筋トレ|フィットネス|ダイエット|ヨガ/, '🏋️'], [/旅行|旅|観光|トラベル/, '✈️'], [/国内|日本/, '🗾'], [/海外|世界|外国/, '🌏'],
    [/車|バイク|自動車|ドライブ/, '🚗'], [/猫|ねこ|ネコ/, '🐱'], [/犬|いぬ|イヌ/, '🐶'], [/ペット|動物/, '🐶'],
    [/科学|science|実験|宇宙/i, '🔬'], [/勉強|学習|教育|講座|解説|雑学/, '📚'], [/tech|テック|プログラ|IT|PC|ガジェット|パソコン/i, '💻'],
    [/DIY|工作|工芸|クラフト|手芸|電子工作/i, '🛠️'], [/美容|ファッション|コスメ|メイク/, '💄'], [/経済|投資|ビジネス|お金|副業/, '💼'],
    [/歴史|城|神社|寺/, '🏯'], [/子供|キッズ|知育|幼児/, '🧸'], [/雑談|トーク|ラジオ|ポッドキャスト/, '🎙️'], [/vlog|日常|ルーティン/i, '📷'],
    [/アート|イラスト|絵|デザイン/, '🎨'], [/コメディ|面白|ネタ|笑/, '😂'], [/ライブ|生放送|配信/, '🔴']
  ];
  const suggestIcon = name => { const n = String(name || ''); const r = ICON_RULES.find(([re]) => re.test(n)); return r ? r[1] : null; };
  const DEF = () => ({
    groups: [{ id: 'g_default', name: 'お気に入り', icon: '⭐', color: PALETTE[2] }],
    channels: {}, // key -> {key,name,avatar,groups:[gid],addedAt}
    settings: { activeGroup: 'all', hideWatched: false, hideCreate: true, chClick: 'pane', newDays: 3, sort: 'added' }
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
    PALETTE, ICONS, ANIME, get, mutate, uid, keyFromHref, subtree, flat, clean, suggestIcon,
    // 既定アイコン(⭐)のままのフォルダに、名前に合うアイコンを設定する。変更件数を返す
    autoIcons: async () => { let n = 0; await mutate(s => { s.groups.forEach(g => { if (!g.icon || g.icon === '⭐') { const i = suggestIcon(g.name); if (i) { g.icon = i; n++; } } }); }); return n; },
    // フォルダのアイコン: 絵文字、または外部画像(https://… / アップロードした data:image)
    isImgIcon: i => /^(https?:\/\/|data:image\/)/i.test(String(i || '')),
    iconHtml: i => /^(https?:\/\/|data:image\/)/i.test(String(i || ''))
      ? `<img class="tf-ico" src="${String(i).replace(/"/g, '&quot;')}" alt="" referrerpolicy="no-referrer">`
      : String(i || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    iconText: i => (/^(https?:\/\/|data:image\/)/i.test(String(i || '')) ? '🖼️' : String(i || '')),
    // 画像ファイル → 小さな正方形(96px)の data URL(Drive同期に載せても軽い)
    fileToIcon: file => new Promise((ok, ng) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const n = 96, c = document.createElement('canvas'); c.width = c.height = n;
        const s = Math.min(im.width, im.height), x = c.getContext('2d');
        x.drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, n, n);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/webp', 0.85));
      };
      im.onerror = () => { URL.revokeObjectURL(url); ng(new Error('画像を読み込めません')); };
      im.src = url;
    }),
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
