// Peças de interface compartilhadas pelas listagens (Tarefas, Validações):
// status, filtro com multisseleção, menu de troca rápida de status e utilitários.

export const STATUS_ORDER = ['pendente', 'andamento', 'impedimento', 'concluida', 'cancelada'];
export const STATUS_LABEL = {
  pendente: 'Pendente',
  andamento: 'Em andamento',
  impedimento: 'Impedimento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};
export const STATUS_BADGE = {
  pendente: 'badge-neutral',
  andamento: 'badge-accent',
  impedimento: 'badge-danger',
  concluida: 'badge-success',
  cancelada: 'badge-muted',
};
const STATUS_COR = {
  pendente: '#8a94a6',
  andamento: '#1d4ed8',
  impedimento: '#c2410c',
  concluida: '#15803d',
  cancelada: '#6b7686',
};
// Concluída e Cancelada ficam ocultas até que o filtro de Status peça por elas.
export const STATUS_OCULTOS = ['concluida', 'cancelada'];

export function statusVisivel(status, statusFiltrados) {
  if (statusFiltrados.length) return statusFiltrados.includes(status);
  return !STATUS_OCULTOS.includes(status);
}

// Todo texto digitado pelo usuário passa por esc() antes de ir para innerHTML.
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function norm(v) {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function fmtBR(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function downloadFile(nome, texto, mime) {
  const blob = new Blob([texto], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvCell(v) {
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; // evita fórmula ao abrir no Excel
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const CHEVRON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

// ---------------------------------------------------------------------------
// Filtro com multisseleção. Nenhuma opção marcada = sem filtro.
// ---------------------------------------------------------------------------
const abertos = new Set();

function fecharTodosMs() {
  abertos.forEach(fn => fn());
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.ms') && !e.target.closest('.ms-panel')) fecharTodosMs();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharTodosMs(); });
window.addEventListener('resize', fecharTodosMs);

export function createMultiSelect(host, { rotuloTodos, rotuloCurto, options = [], onChange }) {
  let opts = options.slice();
  let selecionados = new Set();
  let panel = null;

  host.classList.add('ms');
  host.innerHTML = `<button type="button" class="ms-btn" aria-haspopup="true" aria-expanded="false"><span class="ms-label"></span>${CHEVRON}</button>`;
  const btn = host.querySelector('.ms-btn');
  const label = host.querySelector('.ms-label');

  function atualizarRotulo() {
    const n = selecionados.size;
    host.classList.toggle('has-value', n > 0);
    if (n === 0) label.textContent = rotuloTodos;
    else if (n === 1) {
      const o = opts.find(x => x.value === [...selecionados][0]);
      label.textContent = `${rotuloCurto}: ${o ? o.label : [...selecionados][0]}`;
    } else label.textContent = `${rotuloCurto}: ${n} selecionados`;
  }

  function fechar() {
    if (!panel) return;
    panel.remove();
    panel = null;
    btn.setAttribute('aria-expanded', 'false');
    abertos.delete(fechar);
  }

  function montarPanel() {
    panel.innerHTML = '';
    const tools = document.createElement('div');
    tools.className = 'ms-tools';
    tools.innerHTML = '<button type="button" data-a="todos">Selecionar todos</button><button type="button" data-a="limpar">Limpar</button>';
    panel.appendChild(tools);
    if (!opts.length) {
      const vazio = document.createElement('div');
      vazio.className = 'ms-empty';
      vazio.textContent = 'Sem opções.';
      panel.appendChild(vazio);
    }
    opts.forEach(o => {
      const lab = document.createElement('label');
      lab.className = 'ms-opt';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selecionados.has(o.value);
      cb.dataset.v = o.value;
      const sp = document.createElement('span');
      sp.textContent = o.label;
      lab.append(cb, sp);
      panel.appendChild(lab);
    });
  }

  function abrir() {
    fecharTodosMs();
    panel = document.createElement('div');
    panel.className = 'ms-panel';
    panel.addEventListener('click', (e) => {
      const acao = e.target.closest('[data-a]');
      if (acao) {
        selecionados = acao.dataset.a === 'todos' ? new Set(opts.map(o => o.value)) : new Set();
        montarPanel();
        atualizarRotulo();
        onChange && onChange([...selecionados]);
      }
    });
    panel.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"]');
      if (!cb) return;
      if (cb.checked) selecionados.add(cb.dataset.v); else selecionados.delete(cb.dataset.v);
      atualizarRotulo();
      onChange && onChange([...selecionados]);
    });
    montarPanel();
    document.body.appendChild(panel);
    const r = btn.getBoundingClientRect();
    const largura = Math.max(panel.offsetWidth, 210);
    panel.style.top = `${r.bottom + 6}px`;
    panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - largura - 8))}px`;
    btn.setAttribute('aria-expanded', 'true');
    abertos.add(fechar);
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (panel) fechar(); else abrir();
  });

  atualizarRotulo();

  return {
    values: () => [...selecionados],
    // Reaplica as opções mantendo só as seleções que ainda existem.
    setOptions(novas) {
      opts = novas.slice();
      selecionados = new Set([...selecionados].filter(v => opts.some(o => o.value === v)));
      atualizarRotulo();
      if (panel) montarPanel();
    },
    set(valores) {
      selecionados = new Set(valores);
      atualizarRotulo();
      if (panel) montarPanel();
    },
    clear() { selecionados = new Set(); atualizarRotulo(); if (panel) montarPanel(); },
  };
}

// ---------------------------------------------------------------------------
// Menu de troca rápida de status (clique no selo de status da linha).
// ---------------------------------------------------------------------------
let menuAberto = null;

export function fecharStatusMenu() {
  if (menuAberto) { menuAberto.remove(); menuAberto = null; }
}
document.addEventListener('click', (e) => { if (!e.target.closest('.status-menu') && !e.target.closest('.status-pill')) fecharStatusMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharStatusMenu(); });
window.addEventListener('scroll', fecharStatusMenu, true);
window.addEventListener('resize', fecharStatusMenu);

export function abrirStatusMenu(ancora, atual, aoEscolher) {
  fecharStatusMenu();
  const menu = document.createElement('div');
  menu.className = 'status-menu';
  menu.setAttribute('role', 'menu');
  STATUS_ORDER.forEach(s => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', String(s === atual));
    b.innerHTML = '<span class="sdot"></span><span></span>';
    b.querySelector('.sdot').style.setProperty('--sdot', STATUS_COR[s]);
    b.lastChild.textContent = STATUS_LABEL[s];
    b.addEventListener('click', () => { fecharStatusMenu(); if (s !== atual) aoEscolher(s); });
    menu.appendChild(b);
  });
  document.body.appendChild(menu);
  const r = ancora.getBoundingClientRect();
  const alturaMenu = menu.offsetHeight;
  const top = r.bottom + 6 + alturaMenu > window.innerHeight ? Math.max(8, r.top - alturaMenu - 6) : r.bottom + 6;
  menu.style.top = `${top}px`;
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  menuAberto = menu;
  const ativo = menu.querySelector('[aria-checked="true"]') || menu.firstChild;
  ativo.focus();
}

export function statusPillHtml(status) {
  return `<button type="button" class="status-pill ${STATUS_BADGE[status]}" data-act="status" aria-haspopup="menu" title="Alterar status">${esc(STATUS_LABEL[status])}${CHEVRON}</button>`;
}
