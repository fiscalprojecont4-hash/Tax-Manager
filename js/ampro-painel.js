// Painel AM PRO no dashboard: lê o espelho gravado pela integração (ampro_obrigacoes) via RPC.
// O isolamento por equipe vem do RLS: analista vê só a sua equipe; gestor/admin vê todas.
// Cada pessoa escolhe a métrica de cada bloco (botão direito ou botão ⋯); a escolha fica salva neste navegador.

// Meta de conclusão (%) — valor provisório; o contrato do AM PRO não envia meta.
export const META_CONCLUSAO = 90;
const ATUALIZA_A_CADA_MS = 60_000;
const TROCA_DO_HERO_MS = 9_000;

const fmt = new Intl.NumberFormat('pt-BR');
const $ = (id) => document.getElementById(id);
const n = (v) => fmt.format(v || 0);

export function consolidar(linhas) {
  const t = { total: 0, aplicaveis: 0, concluidas: 0, vencidas: 0, em_risco: 0, impedimentos: 0, ultima_sync: null };
  for (const l of linhas) {
    for (const k of ['total', 'aplicaveis', 'concluidas', 'vencidas', 'em_risco', 'impedimentos']) t[k] += l[k] || 0;
    if (l.ultima_sync && (!t.ultima_sync || l.ultima_sync > t.ultima_sync)) t.ultima_sync = l.ultima_sync;
  }
  t.pct = t.aplicaveis ? Math.round((t.concluidas / t.aplicaveis) * 100) : 0;
  return t;
}

/** Junta as linhas (equipe × membro) por membro. */
export function porMembro(linhas) {
  const m = new Map();
  for (const l of linhas) {
    const x = m.get(l.membro) || { membro: l.membro, aplicaveis: 0, concluidas: 0, no_prazo: 0, fora_prazo: 0, atrasadas: 0 };
    for (const k of ['aplicaveis', 'concluidas', 'no_prazo', 'fora_prazo', 'atrasadas']) x[k] += l[k] || 0;
    m.set(l.membro, x);
  }
  return [...m.values()].filter(x => x.aplicaveis > 0 || x.concluidas > 0);
}

// Métricas que podem ocupar um bloco. Cada uma devolve { valor, sub, rotulo } a partir do estado carregado.
export const METRICAS = {
  sync: {
    nome: 'Sincronização',
    calc: (d) => {
      const u = d.t.ultima_sync;
      if (!u) return { valor: '—', sub: d.equipesTxt, rotulo: 'Sincronização' };
      const dt = new Date(u), o = { timeZone: 'America/Manaus' };
      return { valor: dt.toLocaleTimeString('pt-BR', { ...o, hour: '2-digit', minute: '2-digit' }),
               sub: `${dt.toLocaleDateString('pt-BR', { ...o, day: '2-digit', month: '2-digit' })} (Manaus) · ${d.equipesTxt}`, rotulo: 'Última sincronização' };
    },
  },
  concluidas: { nome: 'Tarefas concluídas', calc: (d) => ({ valor: n(d.t.concluidas), sub: `de ${n(d.t.aplicaveis)} · ${d.t.pct}%`, rotulo: 'Tarefas concluídas' }) },
  risco: { nome: 'Tarefas em risco de atraso', calc: (d) => ({ valor: n(d.t.em_risco), sub: `${n(d.t.vencidas)} vencidas · ${n(d.t.impedimentos)} com impedimento`, rotulo: 'Tarefas em risco de atraso' }) },
  atrasadas: { nome: 'Obrigações em atraso', calc: (d) => ({ valor: n(d.t.vencidas), sub: `de ${n(d.t.aplicaveis)} aplicáveis`, rotulo: 'Obrigações em atraso' }) },
  meta: { nome: 'Meta batida', calc: (d) => ({ valor: d.t.pct >= META_CONCLUSAO ? 'Sim' : 'Não', sub: `${d.t.pct}% de ${META_CONCLUSAO}% (provisória)`, rotulo: 'Meta batida' }) },
  entrega_membro: {
    nome: 'Entrega por membro (no prazo)',
    calc: (d) => {
      // Só contam entregas dentro do prazo; do maior para o menor.
      const l = d.membros.filter(x => x.no_prazo > 0).sort((a, b) => b.no_prazo - a.no_prazo || a.membro.localeCompare(b.membro, 'pt-BR'));
      return { lista: l.map(x => ({ nome: x.membro, n: x.no_prazo })), valor: '—', sub: 'Somente entregas no prazo', rotulo: 'Entrega por membro' };
    },
  },
  top_prazo: {
    nome: 'Quem mais entregou no prazo',
    calc: (d) => {
      const l = d.membros.slice().sort((a, b) => b.no_prazo - a.no_prazo || b.concluidas - a.concluidas);
      if (!l.length || !l[0].no_prazo) return { valor: '—', sub: 'Nenhuma entrega no prazo ainda', rotulo: 'Mais entregas no prazo', texto: true };
      return { valor: l[0].membro, sub: `${n(l[0].no_prazo)} entregas no prazo`, rotulo: 'Mais entregas no prazo', texto: true };
    },
  },
  fora_prazo: {
    nome: 'Entregas fora do prazo',
    calc: (d) => {
      const fora = d.membros.reduce((s, x) => s + x.fora_prazo, 0), no = d.membros.reduce((s, x) => s + x.no_prazo, 0);
      return { valor: n(fora), sub: fora + no ? `${Math.round((fora / (fora + no)) * 100)}% das entregas` : 'Sem entregas medidas', rotulo: 'Entregas fora do prazo' };
    },
  },
};
const PADRAO = { s1: 'concluidas', s4: 'sync', s2: 'risco', s3: 'meta', hero: 'geral' };

const estado = { dados: null, escolhas: { ...PADRAO }, supabase: null, chave: 'tm.ap.escolhas', ligado: false, heroVista: 0, timer: null };

function lerEscolhas() {
  try {
    const o = JSON.parse(localStorage.getItem(estado.chave) || '{}');
    for (const k of Object.keys(PADRAO)) if (k === 'hero' ? (o[k] === 'geral' || METRICAS[o[k]]) : METRICAS[o[k]]) estado.escolhas[k] = o[k];
  } catch { /* storage bloqueado ou corrompido: segue com o padrão */ }
}
function salvarEscolhas() { try { localStorage.setItem(estado.chave, JSON.stringify(estado.escolhas)); } catch { /* ignora */ } }

function cicloRotulo(c) { const [a, m] = c.split('-'); return `${m}/${a}`; }
function quando(iso) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Manaus', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function html(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function pintarBloco(el, m) {
  let ol = el.querySelector('.ap-lista');
  if (!ol) { ol = document.createElement('ol'); ol.className = 'ap-lista'; el.querySelector('.ap-value').after(ol); }
  ol.hidden = !m.lista;
  el.querySelector('.ap-value').hidden = !!m.lista;
  ol.innerHTML = m.lista ? (m.lista.length
    ? m.lista.map((x, i) => `<li><span class="ap-lista-pos">${i + 1}</span><span class="ap-lista-nome" title="${html(x.nome)}">${html(x.nome)}</span><b>${n(x.n)}</b></li>`).join('')
    : '<li class="ap-lista-vazio">Nenhuma entrega no prazo ainda</li>') : '';
  el.querySelector('.ap-value').textContent = m.valor;
  el.querySelector('.ap-value').classList.toggle('ap-value-txt', !!m.texto);
  el.querySelector('.ap-sub').textContent = m.sub;
  el.querySelector('.ap-label').textContent = m.rotulo;
}

function pintarProgresso(lista) {
  const ul = $('apProgresso');
  if (!lista.length) { ul.innerHTML = '<li class="ap-prog-vazio">Sem obrigações neste ciclo.</li>'; return; }
  ul.innerHTML = lista.slice(0, 6).map((o) => {
    const pct = o.aplicaveis ? Math.round((o.concluidas / o.aplicaveis) * 100) : 0;
    return `<li><div class="ap-prog-topo"><span class="ap-prog-nome" title="${html(o.obrigacao)}">${html(o.obrigacao)}</span>
      <span class="ap-prog-num">${n(o.concluidas)}/${n(o.aplicaveis)} · ${pct}%${o.atrasadas ? ` · <b>${n(o.atrasadas)} em atraso</b>` : ''}</span></div>
      <div class="ap-barra" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${html(o.obrigacao)}"><span style="width:${pct}%"></span></div></li>`;
  }).join('');
  $('apProgMais').textContent = lista.length > 6 ? `+ ${lista.length - 6} ${lista.length - 6 === 1 ? 'obrigação' : 'obrigações'}` : '';
}

function pintar() {
  const d = estado.dados;
  if (!d) return;
  document.querySelectorAll('.ap-slot').forEach((el) => pintarBloco(el, METRICAS[estado.escolhas[el.dataset.slot]].calc(d)));
  const geral = estado.escolhas.hero === 'geral';
  $('apIntro').hidden = !geral;
  $('apHeroMetrica').hidden = geral;
  if (!geral) pintarBloco($('apHeroMetrica'), METRICAS[estado.escolhas.hero].calc(d));
  pintarProgresso(d.obrigacoes);
}

function vazio(msg, tag) {
  estado.dados = null;
  $('apTag').textContent = tag;
  $('apDot')?.classList.remove('ap-on');
  document.querySelectorAll('.ap-slot').forEach((el) => pintarBloco(el, { valor: '—', sub: estado.escolhas[el.dataset.slot] === 'sync' ? msg : '', rotulo: METRICAS[estado.escolhas[el.dataset.slot]].nome }));
  $('apProgresso').innerHTML = `<li class="ap-prog-vazio">${html(msg)}</li>`;
  $('apProgMais').textContent = '';
}

async function atualizar() {
  const supabase = estado.supabase;
  try {
    const sel = $('apCiclo');
    const { data: ciclos, error: e1 } = await supabase.rpc('ampro_ciclos');
    if (e1) throw e1;
    if (!ciclos?.length) { vazio('Nenhum dado recebido do AM PRO ainda.', 'AM PRO · aguardando primeira sincronização'); return; }
    const anterior = sel.value;
    const lista = ciclos.map(c => c.ciclo);
    if (lista.join() !== [...sel.options].map(o => o.value).join()) {
      sel.innerHTML = '';
      for (const c of lista) sel.add(new Option(cicloRotulo(c), c));
    }
    sel.value = lista.includes(anterior) ? anterior : lista[0];
    const ciclo = sel.value;
    const [r, m, o] = await Promise.all([
      supabase.rpc('ampro_resumo', { p_ciclo: ciclo }),
      supabase.rpc('ampro_por_membro', { p_ciclo: ciclo }),
      supabase.rpc('ampro_por_obrigacao', { p_ciclo: ciclo }),
    ]);
    if (r.error) throw r.error;
    if (!r.data?.length) { vazio('Sem dados para este ciclo.', 'AM PRO · sem dados no ciclo'); return; }
    estado.dados = { t: consolidar(r.data), membros: m.error ? [] : porMembro(m.data || []), obrigacoes: o.error ? [] : (o.data || []),
      equipesTxt: r.data.map((l) => `${l.equipe_nome}: ${l.concluidas}/${l.aplicaveis}`).join(' · ') };
    $('apTag').textContent = 'AM PRO · conectado';
    $('apDot')?.classList.add('ap-on');
    pintar();
  } catch (err) {
    console.error('AM PRO painel:', err);
    if (!estado.dados) vazio('Não foi possível ler os dados do AM PRO.', 'AM PRO · erro de leitura');
  }
}

// ---------- menu de escolha da métrica (botão direito ou botão ⋯) ----------
let menu = null;
let menuAbertoEm = 0;
function fecharMenu() { menu?.remove(); menu = null; }

function abrirMenu(slot, x, y, origem) {
  fecharMenu();
  const atual = estado.escolhas[slot];
  const opcoes = Object.entries(METRICAS).map(([k, v]) => [k, v.nome]);
  if (slot === 'hero') opcoes.unshift(['geral', 'Visão geral do AM PRO']);
  menu = document.createElement('div');
  menu.className = 'ap-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Escolher o que mostrar neste bloco');
  menu.innerHTML = `<p class="ap-menu-tit">O que mostrar aqui</p>` + opcoes.map(([k, nome]) =>
    `<button type="button" role="menuitemradio" aria-checked="${k === atual}" data-k="${k}">${html(nome)}</button>`).join('') +
    `<button type="button" class="ap-menu-reset" data-k="__padrao">Restaurar padrão</button>`;
  document.body.appendChild(menu);
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - h - 8))}px`;
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    estado.escolhas[slot] = b.dataset.k === '__padrao' ? PADRAO[slot] : b.dataset.k;
    salvarEscolhas(); pintar(); fecharMenu(); origem?.focus();
  });
  menu.addEventListener('keydown', (e) => {
    const itens = [...menu.querySelectorAll('button')], i = itens.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); itens[(i + 1) % itens.length].focus({ preventScroll: true }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); itens[(i - 1 + itens.length) % itens.length].focus({ preventScroll: true }); }
    else if (e.key === 'Escape') { fecharMenu(); origem?.focus(); }
  });
  menuAbertoEm = Date.now();
  (menu.querySelector('[aria-checked="true"]') || menu.querySelector('button')).focus({ preventScroll: true });
}

function instalarMenus() {
  document.querySelectorAll('[data-slot]').forEach((el) => {
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); abrirMenu(el.dataset.slot, e.clientX, e.clientY, el); });
    const b = el.querySelector('.ap-opt');
    b?.addEventListener('click', (e) => { e.stopPropagation(); const r = b.getBoundingClientRect(); abrirMenu(el.dataset.slot, r.left, r.bottom + 4, b); });
  });
  document.addEventListener('click', (e) => { if (menu && !menu.contains(e.target)) fecharMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharMenu(); });
  window.addEventListener('scroll', () => { if (Date.now() - menuAbertoEm > 500) fecharMenu(); }, { passive: true });
}

// ---------- hero: alterna entre a visão escolhida e o "Progresso por obrigação" ----------
function mostrarVista(i) {
  estado.heroVista = i;
  document.querySelectorAll('.ap-view').forEach((v, k) => { v.classList.toggle('is-on', k === i); v.setAttribute('aria-hidden', String(k !== i)); });
  document.querySelectorAll('.ap-dots button').forEach((b, k) => b.setAttribute('aria-current', String(k === i)));
}
function reiniciarGiro() {
  clearInterval(estado.timer);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  estado.timer = setInterval(() => mostrarVista((estado.heroVista + 1) % 2), TROCA_DO_HERO_MS);
}
function instalarHero() {
  const hero = $('apHero');
  document.querySelectorAll('.ap-dots button').forEach((b, k) => b.addEventListener('click', () => { mostrarVista(k); reiniciarGiro(); }));
  hero.addEventListener('mouseenter', () => clearInterval(estado.timer));
  hero.addEventListener('mouseleave', reiniciarGiro);
  hero.addEventListener('focusin', () => clearInterval(estado.timer));
  hero.addEventListener('focusout', reiniciarGiro);
  mostrarVista(0); reiniciarGiro();
}

export async function carregarPainelAmPro(supabase) {
  if (!$('apHero') || estado.ligado) return;
  estado.ligado = true;
  estado.supabase = supabase;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) estado.chave = `tm.ap.escolhas.${session.user.id}`;
  } catch { /* usa a chave genérica */ }
  lerEscolhas();
  instalarMenus();
  instalarHero();
  $('apCiclo').addEventListener('change', atualizar);
  await atualizar();
  setInterval(atualizar, ATUALIZA_A_CADA_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });
}
