// Relatórios diários do sino de notificações: um no início do dia (08:00) e
// outro no fim (17:00), cada um com PDF. Eles se somam às notificações
// existentes, que continuam como estão.
//
// No ambiente de teste não há servidor para disparar nos horários: o
// relatório do dia é criado na primeira vez que o sino é aberto depois das
// 08:00 (ou das 17:00), e "Gerar agora" cria um novo a qualquer hora. Cada um
// guarda a foto dos dados daquele momento, e o PDF sai dessa foto. Com o
// banco ligado (Fase 3), uma rotina agendada passa a gerar nos horários certos
// e o PDF fica guardado no Storage.

import { carregar, gravar, hojeIso, somarDias, isoDe, novoId, tarefasExemplo, eventosExemplo, projetosExemplo, validacoesExemplo,
         mapeamento, competenciaVigente, competenciaExtenso } from './dados-teste.js';
import { fmtBR, esc, STATUS_LABEL, PRIORIDADE_LABEL } from './lista-ui.js';
import { gerarPdf } from './relatorio-pdf.js';

export const HORARIOS = { inicio: { hora: 8, rotulo: 'Início do dia', titulo: 'Relatório do início do dia' },
                          fim: { hora: 17, rotulo: 'Fim do dia', titulo: 'Relatório do fim do dia' } };

const p2 = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const EM_ABERTO = (s) => s !== 'concluida' && s !== 'cancelada';
const diasEntre = (de, ate) => Math.round((new Date(ate + 'T00:00:00') - new Date(de + 'T00:00:00')) / 86400000);

function fontes() {
  return {
    tarefas: carregar('tarefas', tarefasExemplo),
    eventos: carregar('eventos', eventosExemplo),
    projetos: carregar('projetos', projetosExemplo),
    validacoes: carregar('validacoes', validacoesExemplo),
    problemas: mapeamento(),
  };
}

const linhaTarefa = (t) => [t.tarefa, t.requerente || '-', t.delegadoPara || '-', PRIORIDADE_LABEL[t.prioridade] || t.prioridade, STATUS_LABEL[t.status] || t.status, fmtBR(t.prazo)];
const COLS_TAREFA = ['Tarefa', 'Requerente', 'Delegado', 'Prioridade', 'Status', 'Prazo'];

// Etapas de projetos que ainda não terminaram.
function etapasAbertas(projetos) {
  return projetos.filter(p => !p.cancelado).flatMap(p => p.etapas.filter(e => EM_ABERTO(e.status)).map(e => ({ projeto: p.titulo, ...e })));
}

function montarInicio(f, hoje) {
  const limite = somarDias(hoje, 7);
  const abertas = f.tarefas.filter(t => EM_ABERTO(t.status));
  const venceHoje = abertas.filter(t => t.prazo === hoje);
  const atrasadas = abertas.filter(t => t.prazo < hoje).sort((a, b) => a.prazo.localeCompare(b.prazo));
  const proximas = abertas.filter(t => t.prazo > hoje && t.prazo <= limite).sort((a, b) => a.prazo.localeCompare(b.prazo));
  const agenda = (f.eventos[hoje] || []).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const etapas = etapasAbertas(f.projetos).filter(e => e.prazo <= limite).sort((a, b) => a.prazo.localeCompare(b.prazo));
  const vals = f.validacoes.filter(v => EM_ABERTO(v.status));
  const probs = f.problemas.filter(m => EM_ABERTO(m.status) && m.prazo && m.prazo <= limite).sort((a, b) => a.prazo.localeCompare(b.prazo));

  return {
    resumo: [
      { label: 'Eventos hoje', valor: agenda.length }, { label: 'Vencem hoje', valor: venceHoje.length }, { label: 'Atrasadas', valor: atrasadas.length },
      { label: 'Próximos 7 dias', valor: proximas.length }, { label: 'Etapas de projetos', valor: etapas.length },
      { label: 'Validações em aberto', valor: vals.length }, { label: 'Problemas no radar', valor: probs.length },
    ],
    secoes: [
      { titulo: 'Agenda de hoje (reuniões e obrigações)', colunas: ['Horário', 'Evento', 'Tipo'],
        linhas: agenda.map(e => [e.time || 'Dia inteiro', e.title, e.type === 'oficial' ? 'Oficial / fiscal' : 'Tarefa']), vazio: 'Nenhum evento no calendário hoje.',
        estilosColunas: { 0: { cellWidth: 26 }, 2: { cellWidth: 36 } } },
      { titulo: 'Tarefas que vencem hoje', colunas: COLS_TAREFA, linhas: venceHoje.map(linhaTarefa), vazio: 'Nenhuma tarefa vence hoje.' },
      { titulo: 'Tarefas atrasadas', colunas: COLS_TAREFA, linhas: atrasadas.map(linhaTarefa), vazio: 'Nenhuma tarefa atrasada.' },
      { titulo: 'Tarefas dos próximos 7 dias', colunas: COLS_TAREFA, linhas: proximas.map(linhaTarefa), vazio: 'Nada vence nos próximos 7 dias.' },
      { titulo: 'Metas: etapas de projetos até 7 dias', colunas: ['Projeto', 'Etapa', 'Responsável', 'Prazo', 'Situação'],
        linhas: etapas.map(e => [e.projeto, e.nome, e.responsavel || '-', fmtBR(e.prazo), e.prazo < hoje ? `Atrasada (${diasEntre(e.prazo, hoje)} d)` : (e.prazo === hoje ? 'Vence hoje' : 'No prazo')]),
        vazio: 'Nenhuma etapa vence ou está atrasada.' },
      { titulo: `Validações em aberto (${competenciaExtenso(competenciaVigente())})`, colunas: ['Empresa', 'Atividade', 'Analista', 'Status'],
        linhas: vals.sort((a, b) => a.nome.localeCompare(b.nome)).map(v => [v.nome, v.atividade, v.analista || '-', STATUS_LABEL[v.status]]), vazio: 'Nenhuma validação em aberto.' },
      { titulo: 'Mapeamento fiscal: prazos vencidos ou nos próximos 7 dias', colunas: ['Empresa', 'Problema', 'Complexidade', 'Prazo', 'Responsável'],
        linhas: probs.map(m => [m.empresa, m.problema, PRIORIDADE_LABEL[m.complexidade], fmtBR(m.prazo) + (m.prazo < hoje ? ' (vencido)' : ''), m.responsavel || '-']),
        vazio: 'Nenhum problema com prazo próximo.' },
    ],
  };
}

function montarFim(f, hoje) {
  const abertas = f.tarefas.filter(t => EM_ABERTO(t.status));
  const concluidos = [
    ...f.tarefas.filter(t => t.concluidaEm === hoje).map(t => ['Tarefas', t.tarefa, t.delegadoPara || '-']),
    ...f.validacoes.filter(v => v.concluidaEm === hoje).map(v => ['Validações', `${v.nome} — ${v.atividade}`, v.analista || '-']),
    ...f.problemas.filter(m => m.concluidoEm === hoje).map(m => ['Mapeamento fiscal', `${m.empresa} — ${m.problema}`, m.responsavel || '-']),
  ];
  const criados = [
    ...f.tarefas.filter(t => t.criadoEm === hoje).map(t => ['Tarefas', t.tarefa, t.requerente || '-']),
    ...f.validacoes.filter(v => v.criadoEm === hoje).map(v => ['Validações', `${v.nome} — ${v.atividade}`, v.analista || '-']),
    ...f.problemas.filter(m => m.criadoEm === hoje).map(m => ['Mapeamento fiscal', `${m.empresa} — ${m.problema}`, m.responsavel || '-']),
  ];
  const pendentes = abertas.filter(t => t.prazo >= hoje).sort((a, b) => a.prazo.localeCompare(b.prazo));
  const vencidos = [
    ...abertas.filter(t => t.prazo < hoje).map(t => ['Tarefas', t.tarefa, t.delegadoPara || '-', fmtBR(t.prazo), diasEntre(t.prazo, hoje)]),
    ...etapasAbertas(f.projetos).filter(e => e.prazo < hoje).map(e => ['Projetos', `${e.projeto} — ${e.nome}`, e.responsavel || '-', fmtBR(e.prazo), diasEntre(e.prazo, hoje)]),
    ...f.problemas.filter(m => EM_ABERTO(m.status) && m.prazo && m.prazo < hoje).map(m => ['Mapeamento fiscal', `${m.empresa} — ${m.problema}`, m.responsavel || '-', fmtBR(m.prazo), diasEntre(m.prazo, hoje)]),
  ].sort((a, b) => b[4] - a[4]).map(l => [l[0], l[1], l[2], l[3], `${l[4]} ${l[4] === 1 ? 'dia' : 'dias'}`]);
  const valsAbertas = f.validacoes.filter(v => EM_ABERTO(v.status));

  return {
    resumo: [
      { label: 'Concluídos hoje', valor: concluidos.length }, { label: 'Criados hoje', valor: criados.length },
      { label: 'Tarefas pendentes', valor: pendentes.length }, { label: 'Vencidos (prazo perdido)', valor: vencidos.length },
      { label: 'Validações em aberto', valor: valsAbertas.length },
    ],
    secoes: [
      { titulo: 'O que foi concluído hoje', colunas: ['Módulo', 'Item', 'Responsável'], linhas: concluidos, vazio: 'Nada foi concluído hoje.', estilosColunas: { 0: { cellWidth: 38 }, 2: { cellWidth: 40 } } },
      { titulo: 'O que foi criado hoje', colunas: ['Módulo', 'Item', 'Origem'], linhas: criados, vazio: 'Nada foi criado hoje.', estilosColunas: { 0: { cellWidth: 38 }, 2: { cellWidth: 40 } } },
      { titulo: 'Tarefas que continuam pendentes', colunas: COLS_TAREFA, linhas: pendentes.map(linhaTarefa), vazio: 'Nenhuma tarefa pendente.' },
      { titulo: 'Vencido: prazo perdido', colunas: ['Módulo', 'Item', 'Responsável', 'Prazo', 'Atraso'], linhas: vencidos, vazio: 'Nenhum prazo perdido.',
        estilosColunas: { 0: { cellWidth: 36 }, 3: { cellWidth: 24 }, 4: { cellWidth: 22 } } },
      { titulo: `Validações em aberto (${competenciaExtenso(competenciaVigente())})`, colunas: ['Empresa', 'Atividade', 'Analista', 'Status'],
        linhas: valsAbertas.sort((a, b) => a.nome.localeCompare(b.nome)).map(v => [v.nome, v.atividade, v.analista || '-', STATUS_LABEL[v.status]]), vazio: 'Nenhuma validação em aberto.' },
    ],
  };
}

export function montarRelatorio(tipo, origem = 'manual', agora = new Date()) {
  const hoje = isoDe(agora);
  const corpo = tipo === 'inicio' ? montarInicio(fontes(), hoje) : montarFim(fontes(), hoje);
  return { id: novoId('r'), tipo, data: hoje, geradoEm: agora.toISOString(), origem, titulo: HORARIOS[tipo].titulo, ...corpo };
}

export const relatorios = () => carregar('relatorios', () => []);

export function registrarRelatorio(rel) {
  const lista = [rel, ...relatorios()].slice(0, 60);
  gravar('relatorios', lista);
  return rel;
}

// Garante o relatório do dia para cada horário já alcançado.
export function gerarPendentes(agora = new Date()) {
  const hoje = isoDe(agora);
  const minutos = agora.getHours() * 60 + agora.getMinutes();
  Object.entries(HORARIOS).forEach(([tipo, h]) => {
    if (minutos >= h.hora * 60 && !relatorios().some(r => r.data === hoje && r.tipo === tipo)) registrarRelatorio(montarRelatorio(tipo, 'agendado', agora));
  });
}

export async function baixarPdfRelatorio(rel, geradoPor = '') {
  const gerado = new Date(rel.geradoEm);
  await gerarPdf({
    titulo: rel.titulo,
    subtitulo: `${fmtBR(rel.data)} — gerado às ${hhmm(gerado)}${rel.origem === 'agendado' ? ` (relatório das ${p2(HORARIOS[rel.tipo].hora)}h)` : ' (gerado manualmente)'}`,
    arquivo: `relatorio-${rel.tipo === 'inicio' ? 'inicio' : 'fim'}-do-dia-${rel.data}`,
    orientacao: 'landscape',
    geradoPor,
    resumo: rel.resumo,
    tabelas: rel.secoes.map(s => ({ titulo: s.titulo, colunas: s.colunas, linhas: s.linhas.map(l => l.map(String)), estilosColunas: s.estilosColunas, vazio: s.vazio })),
  });
}

// ---------------------------------------------------------------------------
// Bloco "Relatórios do dia" dentro do painel do sino.
// ---------------------------------------------------------------------------

export function instalarRelatoriosNoSino() {
  const painel = document.getElementById('notifPanel');
  const lista = document.getElementById('notifList');
  const sino = document.getElementById('notifBell');
  if (!painel || !lista || !sino || document.getElementById('notifReports')) return;

  const bloco = document.createElement('div');
  bloco.className = 'notif-reports';
  bloco.id = 'notifReports';
  painel.insertBefore(bloco, lista);
  let mensagem = '';

  const emailAtual = () => { const el = document.getElementById('userEmail'); return el && el.textContent !== '…' ? el.textContent : ''; };

  function cartao(tipo, hoje, agora) {
    const h = HORARIOS[tipo];
    const doDia = relatorios().filter(r => r.data === hoje && r.tipo === tipo)[0];
    const alcancou = agora.getHours() * 60 + agora.getMinutes() >= h.hora * 60;
    const estado = doDia
      ? `Gerado hoje às ${hhmm(new Date(doDia.geradoEm))}${doDia.origem === 'manual' ? ' (manual)' : ''}`
      : (alcancou ? 'Gerando…' : `Será gerado às ${p2(h.hora)}:00`);
    const chips = doDia ? `<div class="nr-chips">${doDia.resumo.map(r => `<span><strong>${esc(r.valor)}</strong> ${esc(r.label)}</span>`).join('')}</div>` : '';
    return `<div class="nr-card">
      <div class="nr-head"><strong>${esc(h.rotulo)}</strong><span class="nr-hora">${p2(h.hora)}:00</span></div>
      <p class="nr-estado">${esc(estado)}</p>${chips}
      <div class="nr-acoes">
        ${doDia ? `<button type="button" class="nr-btn" data-pdf="${esc(doDia.id)}">Baixar PDF</button>` : ''}
        <button type="button" class="nr-btn nr-btn-sec" data-gerar="${tipo}">Gerar agora</button>
      </div></div>`;
  }

  function desenhar() {
    const agora = new Date();
    gerarPendentes(agora);
    const hoje = isoDe(agora);
    const todos = relatorios();
    const ultimosDeHoje = new Set(['inicio', 'fim'].map(t => (todos.find(r => r.data === hoje && r.tipo === t) || {}).id).filter(Boolean));
    const anteriores = todos.filter(r => !ultimosDeHoje.has(r.id)).slice(0, 12);
    bloco.innerHTML = `
      <h5>Relatórios do dia</h5>
      ${cartao('inicio', hoje, agora)}${cartao('fim', hoje, agora)}
      ${mensagem ? `<p class="nr-msg" role="status">${esc(mensagem)}</p>` : ''}
      ${anteriores.length ? `<details class="nr-hist"><summary>Relatórios anteriores (${anteriores.length})</summary>
        ${anteriores.map(r => `<div class="nr-linha"><span>${esc(HORARIOS[r.tipo].rotulo)} · ${esc(fmtBR(r.data))} ${esc(hhmm(new Date(r.geradoEm)))}</span>
          <button type="button" class="nr-btn nr-btn-sec" data-pdf="${esc(r.id)}">Baixar PDF</button></div>`).join('')}</details>` : ''}`;
  }

  bloco.addEventListener('click', async (e) => {
    e.stopPropagation();   // o sino fecha ao clicar fora; aqui o conteúdo é redesenhado e o alvo some do DOM
    const pdf = e.target.closest('[data-pdf]');
    const gerar = e.target.closest('[data-gerar]');
    if (pdf) {
      const rel = relatorios().find(r => r.id === pdf.dataset.pdf);
      if (!rel) return;
      try { await baixarPdfRelatorio(rel, emailAtual()); mensagem = 'PDF gerado.'; } catch { mensagem = 'Não foi possível gerar o PDF. Tente novamente.'; }
      desenhar();
    }
    if (gerar) {
      registrarRelatorio(montarRelatorio(gerar.dataset.gerar, 'manual'));
      mensagem = 'Relatório gerado com os dados de agora.';
      desenhar();
    }
  });

  sino.addEventListener('click', () => { mensagem = ''; setTimeout(desenhar, 0); });
  desenhar();
}
