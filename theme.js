// テーマ: auto(OS準拠) → light → dark の順に切り替え
(() => {
  const root = document.documentElement;
  const get = () => { try { return localStorage.getItem('tfTheme') || 'auto'; } catch (e) { return 'auto'; } };
  const apply = t => { t === 'auto' ? root.removeAttribute('data-theme') : root.setAttribute('data-theme', t); };
  apply(get());
  const qp = new URLSearchParams(location.search);
  if (qp.get('p') && !/page.html$/.test(location.pathname)) { location.replace('page.html' + location.search); } // ツールバーのページ: web_accessible_resources に頼らず、manager.html から入って、拡張機能の中で page.html へ移る
  if (qp.get('embed') === '1') { root.setAttribute('data-embed', ''); root.setAttribute('data-theme', qp.get('dark') === '1' ? 'dark' : 'light'); const bg = qp.get('bg'); if (bg && /^(rgb|#)/i.test(bg)) root.style.setProperty('--bg', bg); } // YouTube内: YouTubeのテーマと背景色に合わせる
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('theme');
    const icon = { auto: '🖥️', light: '☀️', dark: '🌙' };
    const label = { auto: 'OS設定に合わせる', light: 'ライトモード', dark: 'ダークモード' };
    const draw = () => { const t = get(); b.textContent = icon[t]; b.title = 'テーマ: ' + label[t] + '(クリックで切替)'; };
    b.onclick = () => {
      const n = { auto: 'light', light: 'dark', dark: 'auto' }[get()];
      try { localStorage.setItem('tfTheme', n); } catch (e) {}
      apply(n); draw();
    };
    draw();
  });
})();
