// YouTubeのページ側(MAINワールド)の橋渡し(再生画面用)。
// watch.js から document の 'tf-cmd' イベントで頼まれたことを、YouTubeのプレイヤーの機能で行い、'tf-res' で返す。
(() => {
  if (window.__tfWatchMain) return;
  window.__tfWatchMain = true;
  const player = () => document.querySelector('#movie_player');
  const ops = {
    // 字幕の一覧・話している言語・今の音声トラック・概要欄(チャプター用)
    info() {
      const p = player();
      if (!p || !p.getPlayerResponse) return null;
      const pr = p.getPlayerResponse() || {};
      const r = (pr.captions || {}).playerCaptionsTracklistRenderer || {};
      const tracks = (r.captionTracks || []).map(t => ({ lc: t.languageCode, kind: t.kind || '' }));
      const asr = tracks.find(t => t.kind === 'asr');
      const vd = pr.videoDetails || {};
      let audio = '', audioOrig = '';
      try {
        const at = p.getAudioTrack && p.getAudioTrack();
        const id = (at && (at.id || (at.Ja && at.Ja.id))) || (JSON.stringify(at || '').match(/"id":"([a-zA-Z-]+)\.\d+"/) || [])[1] || '';
        audio = String(id).split('.')[0] || '';
      } catch (e) { /* なし */ }
      try {
        const fm = ((pr.streamingData || {}).adaptiveFormats || []).filter(f => f.audioTrack);
        const o = fm.find(f => /original/i.test(f.audioTrack.displayName || '')) || fm.find(f => f.audioTrack.audioIsDefault);
        audioOrig = String((o && o.audioTrack.id) || '').split('.')[0];
        if (!audio) audio = audioOrig;
      } catch (e) { /* なし */ }
      let cur = null; try { const t = p.getOption && p.getOption('captions', 'track'); if (t && t.languageCode) cur = { lc: t.languageCode, tl: (t.translationLanguage && t.translationLanguage.languageCode) || '' }; } catch (e) { /* 字幕の部品が、まだ */ }
      const mf = ((pr.microformat || {}).playerMicroformatRenderer) || {};
      return { cur, v: vd.videoId || '', kw: vd.keywords || [], category: mf.category || '', tracks, spoken: asr ? asr.lc : '', audio, audioOrig, desc: vd.shortDescription || '', title: vd.title || '' };
    },
    // lang の字幕を出す(無ければ、話している言語から自動翻訳)。lang=null でオフ
    show({ lang }) {
      const p = player();
      if (!p || !p.setOption) return false;
      if (!lang) { try { p.setOption('captions', 'track', {}); p.unloadModule && p.unloadModule('captions'); } catch (e) { /* なし */ } return true; }
      try { p.loadModule && p.loadModule('captions'); } catch (e) { /* なし */ }
      const tl = p.getOption('captions', 'tracklist', { includeAsr: true }) || [];
      if (!tl.length) return false;
      const exact = tl.find(t => t.languageCode === lang && t.kind !== 'asr') || tl.find(t => t.languageCode === lang);
      if (exact) { p.setOption('captions', 'track', exact); return 'exact'; }
      const src = tl.find(t => t.kind === 'asr') || tl.find(t => t.is_translateable) || tl[0];
      p.setOption('captions', 'track', Object.assign({}, src, { translationLanguage: { languageCode: lang, languageName: lang === 'ja' ? '日本語' : lang } }));
      return 'translated';
    }
  };
  document.addEventListener('tf-cmd', e => {
    let d; try { d = JSON.parse(e.detail); } catch (err) { return; }
    let result = null;
    try { result = ops[d.op] ? ops[d.op](d.args || {}) : null; } catch (err) { result = null; }
    document.dispatchEvent(new CustomEvent('tf-res', { detail: JSON.stringify({ id: d.id, result }) }));
  });
})();
