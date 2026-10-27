// Bloco de indicadores do Tax Manager no dashboard. Os números são CALCULADOS dos dados guardados
// (nada fixo no código): Calendário vem do banco; Tarefas, Validações, Projetos e Conhecimento ainda
// vêm dos dados guardados neste navegador, até esses módulos serem ligados ao banco.
// Como no painel do AM PRO, cada pessoa escolhe a métrica de cada bloco (botão direito ou ⋯).

import { carregar, tarefasExemplo, validacoesExemplo, projetosExemplo, mapeamento, arquivos, hojeIso, somarDias } from './dados-teste.js';
import { listarObrigacoes } from './obrigacoes-db.js';

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('pt-BR');
const n = (v) => fmt.format(v || 0);
const html = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NAV = ' · dado deste navegador';
const ABERTAS = (s) => s !== 'concluida' && s !== 'cancelada';
const dias = (de, ate) => Math.round((new Date(ate + 'T00:00:00') - new Date(de + 'T00:00:00')) / 86400000);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export const METRICAS = {
  tarefas: { nome: 'Tarefas em aberto', fonte: 'nav', tag: 'Tarefas', calc: (d) => {
    const ab = d.tarefas.filter(t => ABERTAS(t.status)), at = ab.filter(t => t.prazo && t.prazo < d.hoje).length;
    return { valor: n(ab.length), desc: `Tarefas em aberto, ${n(at)} já atrasadas.` }; } },
  tarefas_atrasadas: { nome: 'Tarefas atrasadas', fonte: 'nav', tag: 'Tarefas', calc: (d) => {
    const at = d.tarefas.filter(t => ABERTAS(t.status) && t.prazo && t.prazo < d.hoje).length;
    return { valor: n(at), desc: 'Tarefas abertas com o prazo vencido.' }; } },
  cumprimento: { nome: 'Cumprimento no prazo', fonte: 'nav', tag: 'Tarefas', calc: (d) => {
    const c = d.tarefas.filter(t => t.status === 'concluida' && t.concluidaEm && t.prazo);
    const ok = c.filter(t => t.concluidaEm <= t.prazo).length;
    return c.length ? { valor: `${pct(ok, c.length)}%`, desc: `${n(ok)} de ${n(c.length)} tarefas concluídas dentro do prazo.` } : { valor: '—', desc: 'Nenhuma tarefa concluída ainda.' }; } },
  validacoes: { nome: 'Validações em aberto', fonte: 'nav', tag: 'Validações', calc: (d) => {
    const ab = d.validacoes.filter(v => ABERTAS(v.status));
    return { valor: n(ab.length), desc: `Validações em aberto em ${n(new Set(ab.map(v => norm(v.nome))).size)} empresas.` }; } },
  tempo_medio: { nome: 'Tempo médio de validação', fonte: 'nav', tag: 'Validações', calc: (d) => {
    const c = d.validacoes.filter(v => v.status === 'concluida' && v.criadoEm && v.concluidaEm);
    if (!c.length) return { valor: '—', desc: 'Nenhuma validação concluída ainda.' };
    const m = c.reduce((s, v) => s + Math.max(0, dias(v.criadoEm, v.concluidaEm)), 0) / c.length;
    return { valor: `${m.toFixed(1).replace('.', ',')} dias`, desc: `Da abertura à conclusão, em ${n(c.length)} validações.` }; } },
  achados_repetidos: { nome: 'Achados repetidos', fonte: 'nav', tag: 'Conhecimento', calc: (d) => {
    const cont = new Map();
    const add = (c) => { const k = norm(c); if (k) cont.set(k, (cont.get(k) || 0) + 1); };
    d.validacoes.forEach(v => (v.pontos || []).forEach(p => add(p.categoria)));
    d.mapeamento.forEach(m => add(m.problema));
    const rep = [...cont.values()].filter(x => x >= 2).length;
    return { valor: n(rep), desc: 'Categorias de problema que aparecem mais de uma vez.' }; } },
  calendario: { nome: 'Obrigações nos próximos 7 dias', fonte: 'banco', tag: 'Calendário', calc: (d) =>
    d.calendario7d == null ? { valor: '—', desc: 'Calendário oficial indisponível no momento.' }
      : { valor: n(d.calendario7d), desc: 'Obrigações fiscais aprovadas vencendo nos próximos 7 dias.' } },
  projetos: { nome: 'Progresso dos projetos', fonte: 'nav', tag: 'Projetos', calc: (d) => {
    const et = d.projetos.flatMap(p => p.etapas || []).filter(e => e.status !== 'cancelada'), ok = et.filter(e => e.status === 'concluida').length;
    return { valor: `${pct(ok, et.length)}%`, desc: `${n(ok)} de ${n(et.length)} etapas concluídas nos projetos.` }; } },
  conhecimento: { nome: 'Mapeamento fiscal em aberto', fonte: 'nav', tag: 'Conhecimento', calc: (d) => {
    const ab = d.mapeamento.filter(m => ABERTAS(m.status)).length;
    return { valor: n(ab), desc: `Situações em aberto no Mapeamento fiscal; ${n(d.arquivos.length)} arquivos no histórico.` }; } },
};
const RODIZIO = ['tarefas', 'validacoes', 'calendario', 'projetos', 'conhecimento'];
const PADRAO = { hero: 'rodizio', c1: 'cumprimento', c2: 'achados_repetidos', c3: 'tempo_medio' };
const estado = { escolhas: { ...PADRAO }, chave: 'tm.tm.escolhas', dados: null, i: 0 };

function lerEscolhas() {
  try {
    const o = JSON.parse(localStorage.getItem(estado.chave) || '{}');
    for (const k of Object.keys(PADRAO)) if (METRICAS[o[k]] || (k === 'hero' && o[k] === 'rodizio')) estado.escolhas[k] = o[k];
  } catch { /* storage bloqueado ou corrompido */ }
}
const salvar = () => { try { localStorage.setItem(estado.chave, JSON.stringify(estado.escolhas)); } catch { /* ignora */ } };

function lerDados(calendario7d) {
  return { hoje: hojeIso(), calendario7d, tarefas: carregar('tarefas', tarefasExemplo), validacoes: carregar('validacoes', validacoesExemplo),
    projetos: carregar('projetos', projetosExemplo), mapeamento: mapeamento(), arquivos: arquivos() };
}

async function obrigacoesEm7Dias() {
  try {
    const hoje = hojeIso(), fim = somarDias(hoje, 7), meses = new Set([hoje.slice(0, 7), fim.slice(0, 7)]);
    let total = 0;
    for (const ym of meses) total += (await listarObrigacoes({ status: 'aprovado', ym })).filter(o => o.vencimento >= hoje && o.vencimento <= fim).length;
    return total;
  } catch (e) { console.error('Calendário no painel:', e); return null; }
}

const fonteTxt = (m) => (m.fonte === 'nav' ? NAV : ' · banco de dados');

function pintarHero(chave) {
  const d = estado.dados, k = chave === 'rodizio' ? RODIZIO[estado.i % RODIZIO.length] : chave, m = METRICAS[k], r = m.calc(d);
  $('statTag').textContent = m.tag; $('statValue').textContent = r.valor; $('statDesc').textContent = r.desc + fonteTxt(m);
  const s = $('statSlide'); s.classList.remove('bento-slide'); void s.offsetWidth; s.classList.add('bento-slide');
  [...$('statDots').children].forEach((dot, i) => dot.classList.toggle('active', chave === 'rodizio' && i === estado.i % RODIZIO.length));
}
function pintarCard(el, chave) {
  const m = METRICAS[chave], r = m.calc(estado.dados);
  el.querySelector('.bento-card-value').textContent = r.valor;
  el.querySelector('.bento-card-label').textContent = m.nome;
  let sub = el.querySelector('.tm-sub');
  if (!sub) {
    sub = document.createElement('p'); sub.className = 'tm-sub';
    const v = el.querySelector('.bento-card-value'), l = el.querySelector('.bento-card-label');
    ((v.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING) ? l : v).after(sub);
  }
  sub.textContent = r.desc + fonteTxt(m);
}
function pintarNota() {
  const usaNav = Object.entries(estado.escolhas).some(([s, k]) => (k === 'rodizio' ? RODIZIO.some(x => METRICAS[x].fonte === 'nav') : METRICAS[k].fonte === 'nav'));
  const nota = $('dataNote'); if (nota) nota.hidden = !usaNav;
}
function pintarTudo() {
  if (!estado.dados) return;
  pintarHero(estado.escolhas.hero);
  document.querySelectorAll('[data-tm]').forEach((el) => { if (el.dataset.tm !== 'hero') pintarCard(el, estado.escolhas[el.dataset.tm]); });
  pintarNota();
}

// ---------- menu (botão direito ou ⋯) ----------
let menu = null, abertoEm = 0;
const fechar = () => { menu?.remove(); menu = null; };
function abrir(slot, x, y, origem) {
  fechar();
  const ops = Object.entries(METRICAS).map(([k, v]) => [k, v.nome]);
  if (slot === 'hero') ops.unshift(['rodizio', 'Rodízio entre os módulos']);
  menu = document.createElement('div'); menu.className = 'ap-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Escolher o que mostrar neste bloco');
  menu.innerHTML = '<p class="ap-menu-tit">O que mostrar aqui</p>' + ops.map(([k, nome]) =>
    `<button type="button" role="menuitemradio" aria-checked="${k === estado.escolhas[slot]}" data-k="${k}">${html(nome)}</button>`).join('') +
    '<button type="button" class="ap-menu-reset" data-k="__padrao">Restaurar padrão</button>';
  document.body.appendChild(menu);
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`; menu.style.top = `${Math.max(8, Math.min(y, innerHeight - h - 8))}px`;
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    estado.escolhas[slot] = b.dataset.k === '__padrao' ? PADRAO[slot] : b.dataset.k; salvar(); pintarTudo(); fechar(); origem?.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const it = [...menu.querySelectorAll('button')], i = it.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); it[(i + 1) % it.length].focus({ preventScroll: true }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); it[(i - 1 + it.length) % it.length].focus({ preventScroll: true }); }
    else if (e.key === 'Escape') { fechar(); origem?.focus(); }
  });
  abertoEm = Date.now();
  (menu.querySelector('[aria-checked="true"]') || menu.querySelector('button')).focus({ preventScroll: true });
}

export async function iniciarPainelTm(supabase) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) estado.chave = `tm.tm.escolhas.${session.user.id}`;
  } catch { /* chave genérica */ }
  lerEscolhas();
  const dots = $('statDots'); dots.innerHTML = '';
  RODIZIO.forEach(() => dots.appendChild(document.createElement('span')));
  document.querySelectorAll('[data-tm]').forEach((el) => {
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); abrir(el.dataset.tm, e.clientX, e.clientY, el); });
    const b = el.querySelector('.tm-opt');
    b?.addEventListener('click', (e) => { e.stopPropagation(); const r = b.getBoundingClientRect(); abrir(el.dataset.tm, r.left, r.bottom + 4, b); });
  });
  document.addEventListener('click', (e) => { if (menu && !menu.contains(e.target)) fechar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
  addEventListener('scroll', () => { if (Date.now() - abertoEm > 500) fechar(); }, { passive: true });
  estado.dados = lerDados(null);
  pintarTudo();
  obrigacoesEm7Dias().then((c) => { estado.dados = lerDados(c); pintarTudo(); });
  setInterval(() => {
    if (estado.escolhas.hero !== 'rodizio' || document.hidden) return;
    estado.i = (estado.i + 1) % RODIZIO.length; estado.dados = lerDados(estado.dados.calendario7d); pintarHero('rodizio');
  }, 5000);
}
