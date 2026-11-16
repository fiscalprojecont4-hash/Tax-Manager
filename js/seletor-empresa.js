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

export function criarSeletorEmpresa(raiz, { empresas, semEmpresa = 'Interno', placeholder = 'Selecionar empresa…', onChange, compacto = false, vazioSub = 'Tarefa interna, sem cliente', rotuloVazio } = {}) {
  return criarSeletor(raiz, {
    fonte: () => ((typeof empresas === 'function' ? empresas() : empresas) || []).map(e => ({ nome: e.nome, sub: detalhe(e), extra: String(e.cnpj || '').replace(/\D/g, '') })),
    vazio: semEmpresa, vazioSub, rotuloVazio: rotuloVazio, placeholder, onChange, compacto,
    buscaPlaceholder: 'Buscar por nome ou CNPJ', rotulo: 'empresa', subCadastrado: 'Empresa cadastrada', subForaCadastro: 'Fora do cadastro', nenhum: 'Nenhuma empresa encontrada.',
  });
}

// Seletor de pessoa (delegado, responsável, executor, analista): mesma interface, lista de nomes.
export function criarSeletorPessoa(raiz, { pessoas, semPessoa = '', placeholder = 'Selecionar pessoa…', onChange, compacto = false, vazioSub = 'Sem atribuição', permitirNovo = false } = {}) {
  return criarSeletor(raiz, {
    permitirNovo,
    fonte: () => ((typeof pessoas === 'function' ? pessoas() : pessoas) || []).map(p => typeof p === 'string' ? { nome: p, sub: '' } : { nome: p.nome, sub: p.sub || '' }),
    vazio: semPessoa, vazioSub, placeholder, onChange, compacto, rotuloVazio: 'Nenhum',
    buscaPlaceholder: 'Buscar por nome', rotulo: 'pessoa', subCadastrado: 'Membro da equipe', subForaCadastro: 'Fora da lista de membros', nenhum: 'Nenhuma pessoa encontrada.',
  });
}

function criarSeletor(raiz, { fonte, vazio, vazioSub, placeholder, onChange, compacto, buscaPlaceholder, rotulo, subCadastrado, subForaCadastro, nenhum, rotuloVazio, permitirNovo = false } = {}) {
  const semEmpresa = vazio;
  let valor = semEmpresa;
  let aberto = false, ativo = 0, lista = [], travado = false;
  const ouvintes = [];
  const id = 'se' + Math.random().toString(36).slice(2, 8);
  raiz.classList.add('se'); if (compacto) raiz.classList.add('se-compacto');
  raiz.innerHTML = `
    <button type="button" class="se-card" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-pop"></button>
    <div class="se-pop" id="${id}-pop" hidden>
      <div class="se-busca">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="se-input" placeholder="${esc(buscaPlaceholder)}" autocomplete="off" aria-label="Buscar ${esc(rotulo)}" />
      </div>
      <ul class="se-lista" role="listbox"></ul>
    </div>`;
  const card = raiz.querySelector('.se-card'), pop = raiz.querySelector('.se-pop');
  const input = raiz.querySelector('.se-input'), ul = raiz.querySelector('.se-lista');

  const base = () => fonte();
  const acharEmpresa = (nome) => base().find(e => norm(e.nome) === norm(nome));

  function pintarCard() {
    const interno = !valor || (semEmpresa ? norm(valor) === norm(semEmpresa) : false);
    const e = interno ? null : acharEmpresa(valor);
    if (interno) {
      card.innerHTML = `<span class="se-avatar se-avatar-vazio">${esc(semEmpresa ? iniciais(semEmpresa) : '+')}</span>
        <span class="se-txt"><span class="se-nome${semEmpresa ? '' : ' se-placeholder'}">${esc(semEmpresa || placeholder)}</span>${compacto ? '' : `<span class="se-sub">${esc(semEmpresa ? placeholder : vazioSub)}</span>`}</span><span class="se-acao">Escolher</span>`;
    } else {
      card.innerHTML = `<span class="se-avatar">${esc(iniciais(valor))}</span>
        <span class="se-txt"><span class="se-nome">${esc(valor)}</span>${compacto ? '' : `<span class="se-sub">${esc(e ? e.sub || subCadastrado : subForaCadastro)}</span>`}</span><span class="se-acao">Trocar</span>`;
    }
  }

  function filtrar() {
    const q = norm(input.value), qd = input.value.replace(/\D/g, '');
    const itens = base().filter(e => !q || norm(e.nome).includes(q) || (qd.length >= 3 && String(e.extra || '').includes(qd)));
    const digitado = input.value.trim();
    const novo = permitirNovo && digitado && !base().some(e => norm(e.nome) === norm(digitado)) ? [{ nome: digitado, sub: 'Usar este nome (novo)' }] : [];
    lista = [{ nome: semEmpresa, interno: true }, ...novo, ...itens.slice(0, MAX_ITENS)];
    if (itens.length > MAX_ITENS) lista.push({ aviso: `Mostrando ${MAX_ITENS} de ${itens.length}. Digite mais para refinar.` });
    ativo = Math.max(0, Math.min(ativo, lista.length - 1));
    ul.innerHTML = lista.map((e, i) => e.aviso ? `<li class="se-aviso" aria-disabled="true">${esc(e.aviso)}</li>` : `
      <li role="option" class="se-item${i === ativo ? ' ativo' : ''}${norm(e.nome) === norm(valor) ? ' atual' : ''}" data-i="${i}" aria-selected="${norm(e.nome) === norm(valor)}">
        <span class="se-avatar${e.interno ? ' se-avatar-vazio' : ''}">${esc(e.interno && !semEmpresa ? '–' : iniciais(e.nome))}</span>
        <span class="se-txt"><span class="se-nome">${esc(e.interno && !semEmpresa ? (rotuloVazio || 'Nenhum') : e.nome)}</span>${e.interno ? `<span class="se-sub">${esc(vazioSub)}</span>` : (e.sub ? `<span class="se-sub">${esc(e.sub)}</span>` : '')}</span>
      </li>`).join('') + (!itens.length && !novo.length && q ? `<li class="se-aviso">${esc(nenhum)}</li>` : '');
    ul.querySelector('.ativo')?.scrollIntoView({ block: 'nearest' });
  }

  function escolher(i) {
    const e = lista[i]; if (!e || e.aviso) return;
    valor = e.interno ? semEmpresa : e.nome;
    pintarCard(); fechar(); card.focus();
    onChange?.(valor);
    ouvintes.forEach(fn => fn(valor));
  }
  function abrir() {
    if (aberto || travado) return;
    aberto = true; document.body.appendChild(pop); pop.hidden = false;   // no <body>: painéis laterais usam transform e prenderiam o position:fixed card.setAttribute('aria-expanded', 'true');
    input.value = ''; ativo = Math.max(0, lista.findIndex(e => norm(e.nome) === norm(valor)));
    posicionar(); filtrar(); input.focus();
  }
  function posicionar() {
    const r = card.getBoundingClientRect(), larg = Math.max(r.width, 280), abaixo = window.innerHeight - r.bottom;
    pop.style.position = 'fixed'; pop.style.width = larg + 'px';
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - larg - 8)) + 'px';
    if (abaixo < 300 && r.top > abaixo) { pop.style.top = 'auto'; pop.style.bottom = (window.innerHeight - r.top + 4) + 'px'; }
    else { pop.style.bottom = 'auto'; pop.style.top = (r.bottom + 4) + 'px'; }
  }
  function fechar() { aberto = false; pop.hidden = true; if (pop.parentNode !== raiz) raiz.appendChild(pop); card.setAttribute('aria-expanded', 'false'); }

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
  document.addEventListener('click', (ev) => { if (aberto && !raiz.contains(ev.target) && !pop.contains(ev.target)) fechar(); });
  window.addEventListener('resize', () => { if (aberto) posicionar(); });
  window.addEventListener('scroll', (ev) => { if (aberto && !pop.contains(ev.target)) posicionar(); }, true);

  pintarCard();
  return {
    valor: () => valor || semEmpresa,
    abrir,
    ouvir: (fn) => ouvintes.push(fn),
    travar(v) { travado = !!v; raiz.classList.toggle('se-travado', travado); card.disabled = travado; if (travado) fechar(); },
    definir(v) { valor = (v && String(v).trim()) || semEmpresa; pintarCard(); },
    recarregar() { pintarCard(); if (aberto) filtrar(); },
    fechar,
  };
}

/** Faz o seletor se comportar como um <input> (value, readOnly, focus, addEventListener) para reaproveitar o código existente. */
export function comoCampo(sel) {
  return {
    get value() { return sel.valor(); },
    set value(v) { sel.definir(v); },
    set readOnly(v) { sel.travar(v); },
    get readOnly() { return false; },
    focus: () => setTimeout(() => sel.abrir(), 0),   // depois do clique que abriu o painel, senão o clique fora fecha
    addEventListener(tipo, fn) { if (tipo === 'input' || tipo === 'change') sel.ouvir(() => fn({ target: this })); },
  };
}
