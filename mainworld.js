// YouTubeのページ側（MAIN world）で動く小さな橋渡し
//   拡張機能の側（playerx.js）から document の 'tg-cmd' イベントで頼まれたことを、
//   YouTubeのプレイヤーの機能（字幕の切り替えなど）で行い、'tg-res' イベントで返す
(() => {
  if (window.__tgMain) return;
  window.__tgMain = true;
  const player = () => document.querySelector('#movie_player');
  // 字幕データのURL（再生を許可する印 pot 付き）。プレイヤーが取りに行ったものを覚えておく
  const ttUrls = [];
  const note = u => { try { if (String(u).includes('/api/timedtext')) { ttUrls.push(String(u)); if (ttUrls.length > 20) ttUrls.shift(); } } catch { /* なし */ } };
  const xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u, ...a) { note(u); return xo.call(this, m, u, ...a); };
  const fo = window.fetch;
  window.fetch = function (input, ...a) { note(typeof input === 'string' ? input : input?.url); return fo.call(this, input, ...a); };

  const ops = {
    // 字幕の一覧と、話している言語（自動字幕の言語）
    tracks() {
      const p = player();
      if (!p?.getOption) return null;
      // ※ ここで loadModule('captions') を呼ぶと字幕が表示されてしまうので呼ばない
      const pr = p.getPlayerResponse?.() || {};
      const r = pr.captions?.playerCaptionsTracklistRenderer || {};
      const tracks = (r.captionTracks || []).map(t => ({ lc: t.languageCode, kind: t.kind || '', vss: t.vssId }));
      const asr = tracks.find(t => t.kind === 'asr');
      const vd = pr.videoDetails || {};
      let cur = null; try { cur = p.getOption('captions', 'track') || null; } catch { /* 字幕の部品がまだ */ }
      // 音声トラック（多言語音声・自動吹き替えの動画）：今流れている音声の言語と、元の音声の言語
      let audio = '', audioOrig = '';
      try {
        const at = p.getAudioTrack?.();
        const id = at?.id || at?.Ja?.id || JSON.stringify(at || '').match(/"id":"([a-zA-Z-]+)\.\d+"/)?.[1] || '';
        audio = String(id).split('.')[0] || '';
      } catch { /* なし */ }
      try {
        const fm = (pr.streamingData?.adaptiveFormats || []).filter(f => f.audioTrack);
        audioOrig = String((fm.find(f => /original/i.test(f.audioTrack.displayName || '')) || fm.find(f => f.audioTrack.audioIsDefault))?.audioTrack.id || '').split('.')[0];
        if (!audio) audio = String(fm.find(f => f.audioTrack.audioIsDefault)?.audioTrack.id || '').split('.')[0];
      } catch { /* なし */ }
      return { v: vd.videoId || '', tracks, spoken: asr?.lc || '', cur, title: vd.title || '', desc: String(vd.shortDescription || '').slice(0, 300), audio, audioOrig };
    },
    // lang の字幕を出す（無ければ話している言語から自動翻訳）。lang=null でオフ
    show({ lang }) {
      const p = player();
      if (!p?.setOption) return false;
      if (!lang) { try { p.setOption('captions', 'track', {}); p.unloadModule?.('captions'); } catch { /* なし */ } return true; }
      try { p.loadModule?.('captions'); } catch { /* なし */ }
      const tl = p.getOption('captions', 'tracklist', { includeAsr: true }) || [];
      if (!tl.length) return false;
      const exact = tl.find(t => t.languageCode === lang && t.kind !== 'asr') || tl.find(t => t.languageCode === lang);
      if (exact) { p.setOption('captions', 'track', exact); return 'exact'; }
      const src = tl.find(t => t.kind === 'asr') || tl.find(t => t.is_translateable) || tl[0];
      p.setOption('captions', 'track', { ...src, translationLanguage: { languageCode: lang, languageName: lang === 'ja' ? '日本語' : lang } });
      return 'translated';
    },
    // 正確な投稿日時・再生数・タグ（投稿者が設定した検索キーワード）
    meta() {
      let pr = player()?.getPlayerResponse?.() || {};
      // プレイヤーがまだ情報を持っていないとき(読み込み直後・スマホのブラウザなど)は、ページに埋め込まれた情報(今の動画のものに限る)を使う
      const cur = new URLSearchParams(location.search).get('v'), ini = window.ytInitialPlayerResponse;
      if ((!pr.videoDetails || !pr.videoDetails.videoId || (pr.videoDetails.videoId === cur && !pr.videoDetails.keywords && ini?.videoDetails?.keywords)) && ini?.videoDetails?.videoId === cur) pr = ini;
      const vd = pr.videoDetails || {}, mf = pr.microformat?.playerMicroformatRenderer || {};
      return { v: vd.videoId || '', kw: vd.keywords || [], desc: vd.shortDescription || '', views: +vd.viewCount || 0, publish: mf.publishDate || mf.uploadDate || '', liveStart: mf.liveBroadcastDetails?.startTimestamp || '', live: !!vd.isLive, category: mf.category || '' };
    },
    // チャンネルへ YouTube の中で移動（右側だけ切り替わる）
    nav({ url, id }) {
      const app = document.querySelector('ytd-app');
      if (!app) return false;
      const endpoint = {
        commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_CHANNEL', rootVe: 3611, apiUrl: '/youtubei/v1/browse' } },
        browseEndpoint: { browseId: id, canonicalBaseUrl: url }
      };
      app.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint } }));
      return true;
    },
    // 画質の上限（tiny＝144p。'auto' で元に戻す）
    quality({ q }) {
      const p = player();
      if (!p?.setPlaybackQualityRange) return null;
      p.setPlaybackQualityRange(q, q);
      return p.getPlaybackQuality?.() || q;
    },
    // 最後に取りに行った字幕データのURL（この動画のもの）
    ttUrl({ v }) {
      for (let i = ttUrls.length - 1; i >= 0; i--) { try { if (new URL(ttUrls[i], location.href).searchParams.get('v') === v) return new URL(ttUrls[i], location.href).href; } catch { /* なし */ } }
      const pe = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/api/timedtext') && n.includes('v=' + v));
      return pe[pe.length - 1] || null;
    }
  };
  document.addEventListener('tg-cmd', e => {
    let d; try { d = JSON.parse(e.detail); } catch { return; }
    let result = null, error = null;
    try { result = ops[d.op]?.(d.args || {}); } catch (err) { error = String(err?.message || err); }
    document.dispatchEvent(new CustomEvent('tg-res', { detail: JSON.stringify({ id: d.id, result, error }) }));
  });
})();
