// 元のTubeFolioから移植したスクリプト(yt-api.js / comments.js / playerx.js / xtra.js など)が使う、共通の道具(TG)と、ページの情報(TGPage)の最小版。
// TubeFolio2 のデータ形式(store.js の TF: groups / channels)を、元のTubeFolioの形(folders / channels)に直して渡す。
const TG = {
  esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); },
  // 動作ログ: 2秒ごとにまとめて、バックグラウンドへ送る(保存はバックグラウンドだけ。設定 →「📜 動作ログ」で見られる)
  _logBuf: [], _logT: null,
  log(cat, msg, level = 'info') {
    this._logBuf.push({ t: Date.now(), c: cat, m: String(msg), l: level, s: location.protocol === 'chrome-extension:' ? 'page' : 'yt' });
    if (!this._logT) this._logT = setTimeout(() => { const items = this._logBuf.splice(0); this._logT = null; try { chrome.runtime.sendMessage({ type: 'tg-log', items }).catch(() => {}); } catch (e) { /* 拡張機能の更新直後など */ } }, 2000);
  },
  // チャンネルのキー: '@ハンドル'(小文字) か 'channel/UC…'(元のTubeFolioと同じ形)
  channelKey(href) {
    const h = String(href || ''); let m = h.match(/\/(@[^\/?#]+)/);
    if (m) { try { return decodeURIComponent(m[1]).toLowerCase(); } catch (e) { return m[1].toLowerCase(); } }
    m = h.match(/\/channel\/(UC[\w-]{22})/); return m ? 'channel/' + m[1] : null;
  },
  channelUrl(key) { return /^channel\//.test(key) ? `https://www.youtube.com/${key}` : `https://www.youtube.com/${String(key || '').replace(/^\//, '')}`; },

  // フォルダ名に含まれる言葉ごとの初期キーワード
  KW_DICT: {
    '食': ['グルメ', '飯', 'めし', 'ランチ', 'ディナー', 'ラーメン', '寿司', '焼肉', '大食い', '爆食', '料理', 'レシピ', '食レポ', '食べ', 'うどん', 'カレー', '定食', 'mukbang', 'food', 'cooking'],
    'グルメ': ['グルメ', '飯', 'ランチ', 'ラーメン', '寿司', '焼肉', '食べ', '食レポ', '料理', 'cooking', 'food'],
    '大食': ['大食い', '爆食', 'デカ盛り', '完食', 'mukbang'],
    '食レポ': ['食レポ', 'グルメ', '食べ歩き', '名店', '老舗'],
    'ゲーム': ['ゲーム', '実況', 'プレイ', '攻略', 'switch', 'ps5', 'steam', 'マイクラ', 'マインクラフト', 'ポケモン', 'gaming', 'game'],
    'レトロ': ['レトロ', 'ファミコン', 'スーファミ', 'メガドライブ', '昭和', '平成'],
    'ゲームセンター': ['ゲーセン', 'クレーンゲーム', 'ufoキャッチャー', 'メダルゲーム'],
    '音楽': ['歌', 'mv', 'cover', 'カバー', '歌ってみた', '弾いてみた', 'ピアノ', 'ギター', 'ライブ', 'music', 'official'],
    'アイドル': ['アイドル', 'idol', 'ダンス', 'dance', '推し'],
    'アニメ': ['アニメ', 'anime', '声優', '漫画', 'マンガ', 'まんが', 'pv'],
    '心霊': ['心霊', '怖い', 'ホラー', '怪談', '廃墟', '都市伝説', 'ミステリー', '事故物件', 'オカルト', '呪'],
    '怪談': ['怪談', '怖い話', '実話'],
    '海外': ['海外', '外国人', '反応', '移住', '在住', '留学', 'アメリカ', '韓国', '中国', '台湾'],
    '韓国': ['韓国', 'korea', 'ソウル', '釜山', '한국'],
    '中国': ['中国', 'china', '中国人', '上海', '北京'],
    'アメリカ': ['アメリカ', 'usa', 'america', 'ニューヨーク', 'ハワイ', 'ロサンゼルス'],
    '国内': ['旅行', '観光', '日本', '温泉', '散歩', '街歩き'],
    '沖縄': ['沖縄', '那覇', '石垣', '宮古'],
    '函館': ['函館', '北斗', '五稜郭', '道南'],
    '札幌': ['札幌', 'すすきの', '北海道'],
    'ガジェット': ['ガジェット', 'レビュー', '開封', 'スマホ', 'iphone', 'pixel', 'android', 'pc', '自作', 'キーボード', 'カメラ'],
    'vlog': ['vlog', '日常', 'ルーティン', '暮らし'],
    'キャンプ': ['キャンプ', 'ソロキャン', '車中泊', 'アウトドア', '焚き火', '登山'],
    'お笑い': ['お笑い', '芸人', 'コント', '漫才', 'ドッキリ', '爆笑'],
    'スポーツ': ['スポーツ', 'サッカー', '野球', '陸上', 'バスケ', '格闘', '試合'],
    'ダンス': ['ダンス', 'dance', '踊って'],
    'モデル': ['モデル', 'グラビア', '撮影', 'ファッション']
  },
  defaultKw(name) {
    const n = (name || '').toLowerCase();
    const out = n.split(/[・\/／,、\s]+/).filter(x => x.length >= 2);
    for (const [k, v] of Object.entries(TG.KW_DICT)) if (n.includes(k.toLowerCase())) out.push(...v);
    return [...new Set(out.map(x => x.toLowerCase()))];
  },
  // フォルダの振り分け補助キーワード（未設定ならフォルダ名から自動。「-言葉」は除外語）
  folderKw(f) { const src = f.kw?.length ? f.kw : TG.defaultKw(f.name); return { inc: src.filter(x => !/^[-－ー]/.test(x.trim())).map(x => x.trim()).filter(Boolean), exc: src.filter(x => /^[-－ー]/.test(x.trim())).map(x => x.trim().slice(1)).filter(Boolean) }; },
  dayKey(t = Date.now()) {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  // チャンネルキー → 直接入っているフォルダ
  folderMap(channels, folders) {
    const m = new Map();
    for (const f of folders) {
      for (const k of f.keys) {
        const add = key => { if (!m.has(key)) m.set(key, []); m.get(key).push(f); };
        add(k);
        const id = channels[k] && channels[k].id;
        if (id) add('channel/' + id);
      }
    }
    return m;
  },
  // TubeFolio2 のデータ(groups / channels)を、元のTubeFolioの形(folders / channels)にして返す
  async load() {
    const S = await TF.get(), { meta = {} } = await chrome.storage.local.get('meta');
    const nk = k => (/^UC[\w-]{22}$/.test(k) ? 'channel/' + k : k), channels = {}, byG = new Map();
    Object.entries(S.channels || {}).forEach(([k, c]) => {
      const key = nk(k); channels[key] = { ...c, name: c.name, id: /^UC/.test(k) ? k : (meta[k] && meta[k].id) || undefined };
      (c.groups || []).forEach(g => { if (!byG.has(g)) byG.set(g, []); byG.get(g).push(key); });
    });
    const folders = (S.groups || []).map(g => ({ id: g.id, name: g.name, parent: g.parent || null, kw: g.kw, icon: g.icon, color: g.color, keys: byG.get(g.id) || [] }));
    return { channels, folders, settings: S.settings || {} };
  }
};

// いま開いているページのチャンネル(再生画面・ショート・チャンネルページ)。元のTubeFolioの TGPage の最小版
globalThis.TGPage = (() => {
  let cache = null;
  const reload = () => TG.load().then(d => { cache = d; }).catch(() => {});
  reload(); chrome.storage.onChanged.addListener(ch => { if (ch.groups || ch.channels || ch.meta) reload(); });
  const owner = () => {
    if (location.pathname === '/watch') {
      const a = document.querySelector('ytd-watch-metadata ytd-video-owner-renderer a[href], #owner ytd-channel-name a[href]');
      const key = a && TG.channelKey(a.getAttribute('href'));
      const name = (document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a') || {}).textContent;
      return key ? { key, name: (name || '').trim() || key, id: (key.match(/^channel\/(UC[\w-]{22})$/) || [])[1] || null } : null;
    }
    return null;
  };
  return {
    currentChannel: owner,
    state: () => cache,
    // 今のチャンネルを、フォルダに入れる(TubeFolio2 の channels[key].groups に追加)
    addToFolder: async fid => {
      const ch = owner(); if (!ch) return null;
      const key = (ch.key.match(/^channel\/(UC[\w-]{22})$/) || [])[1] || ch.key;
      await TF.mutate(s => { const c = s.channels[key] || (s.channels[key] = { key, name: ch.name, added: Date.now(), groups: [] }); if (!(c.groups || (c.groups = [])).includes(fid)) c.groups.push(fid); });
      return true;
    }
  };
})();
// ---- 元のTubeFolioの shared.js から移した、通知・フォルダ・時刻・効果音の道具(extras.js / chapters.js が使う) ----
Object.assign(TG, {
  NOTIFY_DEF: {
    folders: {}, kw: 'LIVE, 生配信, 配信中, 速報', kwLevel: 'high', kwAll: false,
    live: { on: true, scope: 'all', upcoming: false, level: 'high' },
    show: 'both', interval: 15
  },
  async notifyRules() {
    const { notifyRules, notifyFolders = [] } = await chrome.storage.local.get(['notifyRules', 'notifyFolders']);
    const D = TG.NOTIFY_DEF;
    if (!notifyRules) { // 旧版の🔔（通知するフォルダ）を引き継ぐ
      const folders = {};
      notifyFolders.forEach(id => { folders[id] = { mode: 'now', level: 'normal' }; });
      return { ...structuredClone(D), folders };
    }
    return { ...structuredClone(D), ...notifyRules, live: { ...D.live, ...(notifyRules.live || {}) }, folders: notifyRules.folders || {} };
  },
  ruleFor(rules, folders, id) {
    const byId = new Map(folders.map(f => [f.id, f]));
    let f = byId.get(id), g = 0;
    while (f && g++ < 50) {
      const r = rules.folders[f.id];
      if (r && r.mode) return { level: 'normal', from: '19:00', to: '23:00', ...r, from_: f.id };
      f = byId.get(f.parent);
    }
    return { mode: 'off', level: 'normal' };
  },
  inWindow(from, to, t = new Date()) {
    const m = s => { const [h, mi] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (mi || 0); };
    const a = m(from), b = m(to), x = t.getHours() * 60 + t.getMinutes();
    return a <= b ? x >= a && x < b : x >= a || x < b; // 22:00〜6:00 のような日またぎも可
  },
  nextWindowStart(from, t = Date.now()) {
    const [h, mi] = String(from || '19:00').split(':').map(Number);
    const d = new Date(t); d.setHours(h || 0, mi || 0, 0, 0);
    if (d.getTime() <= t) d.setDate(d.getDate() + 1);
    return d.getTime();
  },
  kwList: s => String(s || '').split(/[,、，\n]/).map(x => x.trim()).filter(Boolean),
  subtreeIds(folders, id) {
    const s = new Set([id]);
    let added = true;
    while (added) {
      added = false;
      for (const f of folders) {
        if (f.parent && s.has(f.parent) && !s.has(f.id)) { s.add(f.id); added = true; }
      }
    }
    return s;
  },
  matchSet(channels, keys) {
    const s = new Set();
    for (const k of keys) {
      s.add(k);
      const id = channels[k]?.id;
      if (id) s.add('channel/' + id);
    }
    return s;
  },
  parseCount(t) {
    if (!t) return 0;
    const s = String(t).replace(/[,\s]/g, '');
    let m = s.match(/([\d.]+)(万|億|千)?/);
    if (m && /[万億千]/.test(s)) return Math.round(+m[1] * ({ '万': 1e4, '億': 1e8, '千': 1e3 }[m[2]] || 1));
    m = s.match(/([\d.]+)([KMB])?/i);
    return m ? Math.round(+m[1] * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1)) : 0;
  },
  async sfx(name) {
    try {
      const { px = {} } = await chrome.storage.local.get('px');
      if (px.sfx === false || px['sfx_' + name] === false) return;
      const a = new Audio(chrome.runtime.getURL(`sounds/${name}.mp3`));
      a.volume = Math.min(1, Math.max(0.05, (+px.sfxVol || 50) / 100));
      await a.play();
    } catch { /* 再生できなければ鳴らさない */ }
  },
});

// 設定の「就寝時間」(settings.sleepFrom / sleepTo)を、就寝ポップ(playerx.js)が読む sleepWin にそろえる
TF.get().then(S => {
  const a = S.settings.sleepFrom, b = S.settings.sleepTo; if (!a && !b) return;
  chrome.storage.local.get('sleepWin').then(r => {
    const w = r.sleepWin || {};
    if ((a && w.from !== a) || (b && w.to !== b)) chrome.storage.local.set({ sleepWin: { on: true, from: '23:00', to: '07:00', ...w, ...(a ? { from: a } : {}), ...(b ? { to: b } : {}) } });
  });
}).catch(() => {});
