document.addEventListener('DOMContentLoaded', () => {
  const statements = [...document.querySelectorAll('.statement')];
  if (statements.length < 2) return;

  let index = 0;
  window.setInterval(() => {
    statements[index].classList.remove('is-visible');
    index = (index + 1) % statements.length;
    statements[index].classList.add('is-visible');
  }, 3200);
});
