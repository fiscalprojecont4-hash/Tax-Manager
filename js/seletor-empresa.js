// Seletor de empresa: cartão com a empresa escolhida + lista pesquisável (nome ou CNPJ).
// Substitui o <input list=...> nativo, que não combina com o restante da plataforma.
// Uso: const s = criarSeletorEmpresa(elemento, { empresas: () => [...], semEmpresa: 'Interno', onChange });
//      s.valor() / s.definir('Nome') / s.recarregar()
import { esc, norm } from './lista-ui.js';

const MAX_ITENS = 60;
const iniciais = (nome) => {
  const p = String(nome || '').replace(/^[\d.\-\/\s]+/, '').trim().split(/\s+/).filter(w => w.length > 1 || /\p{L}/u.test(w));
  return ((p[0]?.[0] || '?') + (p[1]?.[0] || '')).toUpperCase();
};
const formatarCnpj = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : String(v || '');
};
const detalhe = (e) => [formatarCnpj(e.cnpj), e.regime].filter(Boolean).join(' · ');

export function criarSeletorEmpresa(raiz, { empresas, semEmpresa = 'Interno', placeholder = 'Selecionar empresa…', onChange } = {}) {
  let valor = semEmpresa;
  let aberto = false, ativo = 0, lista = [];
  const id = 'se' + Math.random().toString(36).slice(2, 8);
  raiz.classList.add('se');
  raiz.innerHTML = `
    <button type="button" class="se-card" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-pop"></button>
    <div class="se-pop" id="${id}-pop" hidden>
      <div class="se-busca">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="se-input" placeholder="Buscar por nome ou CNPJ" autocomplete="off" aria-label="Buscar empresa" />
      </div>
      <ul class="se-lista" role="listbox"></ul>
    </div>`;
  const card = raiz.querySelector('.se-card'), pop = raiz.querySelector('.se-pop');
  const input = raiz.querySelector('.se-input'), ul = raiz.querySelector('.se-lista');

  const base = () => (typeof empresas === 'function' ? empresas() : empresas) || [];
  const acharEmpresa = (nome) => base().find(e => norm(e.nome) === norm(nome));

  function pintarCard() {
    const interno = !valor || norm(valor) === norm(semEmpresa);
    const e = interno ? null : acharEmpresa(valor);
    if (interno) {
      card.innerHTML = `<span class="se-avatar se-avatar-vazio">${esc(iniciais(semEmpresa))}</span>
        <span class="se-txt"><span class="se-nome">${esc(semEmpresa)}</span><span class="se-sub">${esc(placeholder)}</span></span><span class="se-acao">Escolher</span>`;
    } else {
      card.innerHTML = `<span class="se-avatar">${esc(iniciais(valor))}</span>
        <span class="se-txt"><span class="se-nome">${esc(valor)}</span><span class="se-sub">${esc(e ? detalhe(e) || 'Empresa cadastrada' : 'Fora do cadastro')}</span></span><span class="se-acao">Trocar</span>`;
    }
  }

  function filtrar() {
    const q = norm(input.value), qd = input.value.replace(/\D/g, '');
    const itens = base().filter(e => !q || norm(e.nome).includes(q) || (qd.length >= 3 && String(e.cnpj || '').replace(/\D/g, '').includes(qd)));
    lista = [{ nome: semEmpresa, interno: true }, ...itens.slice(0, MAX_ITENS)];
    if (itens.length > MAX_ITENS) lista.push({ aviso: `Mostrando ${MAX_ITENS} de ${itens.length}. Digite mais para refinar.` });
    ativo = Math.max(0, Math.min(ativo, lista.length - 1));
    ul.innerHTML = lista.map((e, i) => e.aviso ? `<li class="se-aviso" aria-disabled="true">${esc(e.aviso)}</li>` : `
      <li role="option" class="se-item${i === ativo ? ' ativo' : ''}${norm(e.nome) === norm(valor) ? ' atual' : ''}" data-i="${i}" aria-selected="${norm(e.nome) === norm(valor)}">
        <span class="se-avatar${e.interno ? ' se-avatar-vazio' : ''}">${esc(iniciais(e.nome))}</span>
        <span class="se-txt"><span class="se-nome">${esc(e.nome)}</span>${e.interno ? '<span class="se-sub">Tarefa interna, sem cliente</span>' : (detalhe(e) ? `<span class="se-sub">${esc(detalhe(e))}</span>` : '')}</span>
      </li>`).join('') + (!itens.length && q ? '<li class="se-aviso">Nenhuma empresa encontrada.</li>' : '');
    ul.querySelector('.ativo')?.scrollIntoView({ block: 'nearest' });
  }

  function escolher(i) {
    const e = lista[i]; if (!e || e.aviso) return;
    valor = e.interno ? semEmpresa : e.nome;
    pintarCard(); fechar(); card.focus();
    onChange?.(valor);
  }
  function abrir() {
    if (aberto) return;
    aberto = true; pop.hidden = false; card.setAttribute('aria-expanded', 'true');
    input.value = ''; ativo = Math.max(0, lista.findIndex(e => norm(e.nome) === norm(valor)));
    filtrar(); input.focus();
  }
  function fechar() { aberto = false; pop.hidden = true; card.setAttribute('aria-expanded', 'false'); }

  card.addEventListener('click', () => (aberto ? fechar() : abrir()));
  input.addEventListener('input', () => { ativo = 1; filtrar(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); ativo = Math.min(ativo + 1, lista.length - 1); filtrar(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); ativo = Math.max(ativo - 1, 0); filtrar(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); escolher(ativo); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); fechar(); card.focus(); }
    else if (ev.key === 'Tab') fechar();
  });
  ul.addEventListener('mousedown', (ev) => ev.preventDefault());
  ul.addEventListener('click', (ev) => { const li = ev.target.closest('.se-item'); if (li) escolher(Number(li.dataset.i)); });
  ul.addEventListener('mousemove', (ev) => { const li = ev.target.closest('.se-item'); if (li && Number(li.dataset.i) !== ativo) { ul.querySelector('.ativo')?.classList.remove('ativo'); ativo = Number(li.dataset.i); li.classList.add('ativo'); } });
  document.addEventListener('click', (ev) => { if (aberto && !raiz.contains(ev.target)) fechar(); });

  pintarCard();
  return {
    valor: () => valor || semEmpresa,
    definir(v) { valor = (v && String(v).trim()) || semEmpresa; pintarCard(); },
    recarregar() { pintarCard(); if (aberto) filtrar(); },
    fechar,
  };
}
