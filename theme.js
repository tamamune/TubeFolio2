// テーマ: auto(OS準拠) → light → dark の順に切り替え
(() => {
  const root = document.documentElement;
  const get = () => { try { return localStorage.getItem('tfTheme') || 'auto'; } catch (e) { return 'auto'; } };
  const apply = t => { t === 'auto' ? root.removeAttribute('data-theme') : root.setAttribute('data-theme', t); };
  apply(get());
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
