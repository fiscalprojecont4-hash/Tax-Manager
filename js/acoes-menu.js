// Menu "Ações": guarda os botões de importar/exportar/PDF/agenda atrás de um
// único botão, como o "Totais por status". Os botões continuam com os mesmos
// ids; só mudam de lugar, então a lógica de cada página não muda.

export function iniciarMenusAcoes() {
  const menus = [...document.querySelectorAll('.acoes-menu')];
  const fechar = (exceto) => menus.forEach(m => {
    if (m === exceto) return;
    m.classList.remove('open');
    m.querySelector('.acoes-trigger').setAttribute('aria-expanded', 'false');
  });
  menus.forEach(m => {
    const gatilho = m.querySelector('.acoes-trigger');
    gatilho.addEventListener('click', (e) => {
      e.stopPropagation();
      const abrir = !m.classList.contains('open');
      fechar(m);
      m.classList.toggle('open', abrir);
      gatilho.setAttribute('aria-expanded', String(abrir));
    });
    // escolher uma opção fecha o menu; o clique segue para o botão normalmente
    m.querySelector('.acoes-pop').addEventListener('click', (e) => { if (e.target.closest('.acoes-item')) setTimeout(() => fechar(), 0); });
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.acoes-menu')) fechar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
}
