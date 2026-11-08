const $ = s => document.querySelector(s), gs = $('#gs');
$('#gsT').onclick = () => { gs.classList.toggle('mini'); $('#gsT').textContent = gs.classList.contains('mini') ? '›' : '‹'; };
$('#gsP').onclick = () => { $('#gsP').classList.toggle('open'); $('#gsS').classList.toggle('shut'); };
$('#gsP').classList.add('open');
$('#gsN').onclick = e => e.currentTarget.classList.toggle('on');
document.querySelectorAll('.gs-it').forEach(a => a.addEventListener('click', () => {
  if (a.id === 'gsP') return;
  document.querySelectorAll('.gs-it.act').forEach(x => x.classList.remove('act'));
  a.classList.add('act');
}));
