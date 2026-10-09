// Dados e armazenamento do AMBIENTE DE TESTE.
//
// Enquanto o banco (Supabase/PostgreSQL) não está ligado, as páginas guardam
// o que o usuário faz no próprio navegador (localStorage) para que Validações,
// Conhecimento e Administração enxerguem os mesmos registros. Quando o banco
// entrar, este módulo é o único ponto a trocar. Todos os nomes de empresas,
// pessoas e fatos abaixo são fictícios.

const PREFIXO = 'tm.';
const memoria = {};   // reserva quando o navegador bloqueia o localStorage

function lerBruto(chave) {
  try {
    const v = localStorage.getItem(PREFIXO + chave);
    if (v !== null) return v;
  } catch { /* storage bloqueado: usa a memória */ }
  return chave in memoria ? memoria[chave] : null;
}

export function gravar(chave, valor) {
  const texto = JSON.stringify(valor);
  memoria[chave] = texto;
  try { localStorage.setItem(PREFIXO + chave, texto); } catch { /* segue só na memória */ }
}

// Lê a chave; se ainda não existe, cria com os exemplos (fabrica) e grava.
export function carregar(chave, fabrica) {
  const bruto = lerBruto(chave);
  if (bruto !== null) {
    try { return JSON.parse(bruto); } catch { /* corrompido: refaz abaixo */ }
  }
  const valor = fabrica();
  gravar(chave, valor);
  return valor;
}

const CHAVES = ['validacoes', 'arquivos', 'competencia', 'categorias', 'empresas', 'mapeamento', 'relatorios', 'tarefas'];
export function restaurarExemplos() {
  CHAVES.forEach(c => {
    delete memoria[c];
    try { localStorage.removeItem(PREFIXO + c); } catch { /* ignora */ }
  });
}

// ---------- datas ----------

const p2 = (n) => String(n).padStart(2, '0');
export function isoDe(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
export function hojeIso() { return isoDe(new Date()); }
export function somarDias(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return isoDe(d);
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// '2026-09' -> 'setembro/2026'
export function competenciaExtenso(c) {
  const [a, m] = c.split('-');
  return `${MESES[Number(m) - 1]}/${a}`;
}
// '2026-09' -> '09/2026'
export function competenciaCurta(c) {
  const [a, m] = c.split('-');
  return `${m}/${a}`;
}
export function proximaCompetencia(c) {
  const [a, m] = c.split('-').map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${p2(m + 1)}`;
}

export function competenciaVigente() {
  return carregar('competencia', () => hojeIso().slice(0, 7));
}
export function definirCompetencia(c) { gravar('competencia', c); }

// ---------- identificadores ----------

export function novoId(prefixo) {
  return `${prefixo}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- cadastros (Administração) ----------

export const CATEGORIAS_PADRAO = ['Crédito indevido', 'NCM / CST', 'ICMS', 'ICMS-ST', 'PIS / COFINS', 'Simples Nacional',
  'Notas fiscais', 'Obrigações acessórias', 'Cadastro', 'Outros'];

export function categorias() { return carregar('categorias', () => CATEGORIAS_PADRAO.slice()); }
export function salvarCategorias(lista) { gravar('categorias', lista); }
// Acrescenta se ainda não existir (sem diferenciar maiúsculas/acentos). Devolve o nome oficial.
export function adicionarCategoria(nome) {
  const limpo = String(nome || '').trim().replace(/\s+/g, ' ');
  if (!limpo) return '';
  const lista = categorias();
  const chave = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const existente = lista.find(c => chave(c) === chave(limpo));
  if (existente) return existente;
  lista.push(limpo);
  salvarCategorias(lista);
  return limpo;
}

export const EMPRESAS_PADRAO = [
  { nome: 'Empresa Alfa', responsavel: 'Wendel', executor: 'Analista A' },
  { nome: 'Empresa Beta', responsavel: 'Wendel', executor: 'Analista B' },
  { nome: 'Empresa Gama', responsavel: 'Analista A', executor: 'Analista A' },
  { nome: 'Empresa Delta', responsavel: 'Analista A', executor: 'Equipe Fiscal' },
  { nome: 'Empresa Épsilon', responsavel: 'Analista B', executor: 'Analista B' },
  { nome: 'Rembraz', responsavel: 'Wendel', executor: 'Wendel' },
  { nome: 'Disbral', responsavel: 'Wendel', executor: 'Equipe Fiscal' },
  { nome: 'Tecnoradio', responsavel: 'Wendel', executor: 'Wendel' },
  { nome: 'Lusitano', responsavel: 'Wendel', executor: 'Equipe Fiscal' },
  { nome: 'Nortec', responsavel: 'Analista B', executor: 'Equipe Fiscal' },
];
export function empresas() { return carregar('empresas', () => EMPRESAS_PADRAO.map(e => ({ ...e }))); }
export function salvarEmpresas(lista) { gravar('empresas', lista); }
export function empresaPorNome(nome) {
  const k = String(nome || '').trim().toLowerCase();
  return empresas().find(e => e.nome.toLowerCase() === k) || null;
}

// ---------- validações ----------

export const CHECKLIST_PADRAO = [
  'Notas fiscais do período conferidas',
  'Apuração de ICMS revisada',
  'Guias de recolhimento conferidas',
  'Obrigações acessórias enviadas (SPED, DCTF...)',
  'Pendências do mês anterior resolvidas',
];
export function novoChecklist(feitos = []) {
  return CHECKLIST_PADRAO.map((label, i) => ({ id: `c${i}`, label, done: feitos.includes(i) }));
}
export function novoPonto(o = {}) {
  return { id: novoId('p'), categoria: 'Outros', titulo: '', identificado: '', motivo: '', orientacao: '', ...o };
}

// ---------- arquivo mensal das validações (Conhecimento) ----------
// Um registro por empresa e competência. Depois de criado, não é alterado:
// uma nova validação sobre o mesmo assunto entra como retificadora, ligada ao
// item original, e o original continua como foi encerrado.

export function arquivos() { return carregar('arquivos', arquivosExemplo); }
export function salvarArquivos(lista) { gravar('arquivos', lista); }

export function resumoArquivo(arq) {
  const n = (s) => arq.itens.filter(i => i.status === s).length;
  return {
    total: arq.itens.length, concluida: n('concluida'), pendente: n('pendente'), andamento: n('andamento'),
    impedimento: n('impedimento'), cancelada: n('cancelada'),
    pontos: arq.itens.reduce((t, i) => t + (i.pontos || []).length, 0),
  };
}

// Transforma as validações da competência em um arquivo por empresa.
export function montarArquivos(validacoes, competencia, encerradoEm, encerradoPor) {
  const porEmpresa = new Map();
  validacoes.forEach(v => {
    const k = v.nome.trim().toLowerCase();
    if (!porEmpresa.has(k)) porEmpresa.set(k, { empresa: v.nome.trim(), itens: [] });
    porEmpresa.get(k).itens.push({
      id: v.id, atividade: v.atividade, analista: v.analista || '', status: v.status,
      justificativa: v.justificativa || '', criadoEm: v.criadoEm || v.atualizadoEm, concluidaEm: v.concluidaEm || '',
      atualizadoEm: v.atualizadoEm, checklistFeitos: v.checklist.filter(c => c.done).length, checklistTotal: v.checklist.length,
      pontos: v.pontos.map(p => ({ ...p })), retificadora: v.retificadora ? { ...v.retificadora } : null,
    });
  });
  return [...porEmpresa.values()]
    .sort((a, b) => a.empresa.localeCompare(b.empresa))
    .map(g => ({ id: novoId('a'), competencia, empresa: g.empresa, encerradoEm, encerradoPor: encerradoPor || '', itens: g.itens }));
}

function arquivosExemplo() {
  const it = (id, atividade, analista, status, justificativa, criadoEm, concluidaEm, pontos = [], retificadora = null) => ({
    id, atividade, analista, status, justificativa, criadoEm, concluidaEm, atualizadoEm: concluidaEm || criadoEm,
    checklistFeitos: status === 'concluida' ? 5 : 2, checklistTotal: 5, pontos, retificadora,
  });
  const pt = (categoria, titulo, identificado, motivo, orientacao) => ({ id: novoId('p'), categoria, titulo, identificado, motivo, orientacao });
  const arq = (empresa, itens) => ({ id: novoId('a'), competencia: '2026-09', empresa, encerradoEm: '2026-10-01', encerradoPor: '', itens });
  return [
    arq('Empresa Alfa', [
      it('ex-a1', 'EFD CONTRIBUIÇÕES', 'Analista A', 'impedimento',
        'Arquivo do SPED do período anterior não foi enviado pela empresa até o fechamento do mês.', '2026-09-02', '', [
          pt('Obrigações acessórias', 'SPED Fiscal anterior não localizado', 'SPED Fiscal do período anterior não localizado.',
            'Sem a escrituração anterior não há como conferir o saldo; a omissão gera multa.', 'Solicitar o reenvio do arquivo à empresa e transmitir antes de validar o período atual.'),
        ]),
      it('ex-a2', 'DCTF', 'Wendel', 'concluida', '', '2026-09-03', '2026-09-18'),
    ]),
    arq('Rembraz', [
      it('ex-r1', 'EFD ICMS/IPI', 'Wendel', 'pendente', 'Aguardando os XMLs de entrada de agosto, solicitados à empresa em 12/09.', '2026-09-05', '', [
        pt('Notas fiscais', 'XMLs de entrada ausentes', 'Faltam os XMLs de entrada de agosto.', 'Sem os XMLs não é possível conferir o crédito de ICMS.', 'Cobrar o envio e conferir os créditos antes da transmissão.'),
      ]),
    ]),
    arq('Lusitano', [
      it('ex-l1', 'Apuração de ICMS', 'Equipe Fiscal', 'cancelada', 'Validação cancelada: a empresa suspendeu a apuração do mês a pedido da diretoria.', '2026-09-04', ''),
      it('ex-l2', 'EFD ICMS/IPI', 'Equipe Fiscal', 'concluida', '', '2026-09-04', '2026-09-22', [
        pt('ICMS', 'Guia recolhida com atraso', 'Guia de ICMS recolhida com um dia de atraso.', 'Recolhimento fora do prazo gera multa e juros.', 'Atualizar o valor devido e criar lembrete de vencimento.'),
      ]),
    ]),
    arq('Tecnoradio', [
      it('ex-t1', 'EFD ICMS/IPI', 'Wendel', 'concluida', '', '2026-09-03', '2026-09-24'),
    ]),
  ];
}

// ---------- mapeamento fiscal (Conhecimento) ----------

export function mapeamento() { return carregar('mapeamento', mapeamentoExemplo); }
export function salvarMapeamento(lista) { gravar('mapeamento', lista); }

function mapeamentoExemplo() {
  const h = hojeIso();
  const reg = (empresa, problema, complexidade, prazo, responsavel, executor, status, contexto, criadoOffset, concluidoOffset) => ({
    id: novoId('m'), empresa, problema, complexidade, prazo, responsavel, executor, status, contexto,
    criadoEm: somarDias(h, criadoOffset), atualizadoEm: somarDias(h, concluidoOffset ?? criadoOffset),
    concluidoEm: status === 'concluida' ? somarDias(h, concluidoOffset ?? criadoOffset) : '',
  });
  return [
    reg('Empresa Alfa', 'Crédito indevido', 'normal', '2026-12-31', 'Wendel', 'Analista A', 'pendente',
      'Aconteceu um crédito indevido na empresa em relação à escrituração de entrada, onde ocorreu crédito sobre o frete destinado ao uso e consumo. É preciso estornar o crédito, retificar a EFD dos meses afetados e orientar a empresa sobre o enquadramento do frete.', -20),
    reg('Empresa Gama', 'Crédito indevido', 'alta', somarDias(h, 12), 'Analista A', 'Analista A', 'andamento',
      'Crédito de ICMS sobre material de embalagem classificado como insumo. Levantar os períodos, calcular o estorno e alinhar com a empresa a forma de regularização.', -35),
    reg('Rembraz', 'Obrigações acessórias', 'alta', somarDias(h, -5), 'Wendel', 'Wendel', 'impedimento',
      'EFD de agosto transmitida sem o bloco de inventário. A empresa ainda não enviou o levantamento de estoque, o que impede a retificação.', -40),
    reg('Disbral', 'NCM / CST', 'critica', somarDias(h, 6), 'Wendel', 'Equipe Fiscal', 'pendente',
      'Produtos sujeitos a ST escriturados como tributados normalmente em vários meses. Revisar o cadastro de NCM e CEST e calcular o impacto.', -10),
    reg('Lusitano', 'ICMS', 'normal', somarDias(h, -12), 'Wendel', 'Equipe Fiscal', 'concluida',
      'Guia de ICMS recolhida com atraso. Multa calculada e paga; lembrete de vencimento criado.', -30, -9),
    reg('Nortec', 'Cadastro', 'baixa', '', 'Analista B', 'Equipe Fiscal', 'cancelada',
      'Atualização de inscrição estadual cancelada: a empresa decidiu manter o cadastro atual.', -25, -20),
    reg('Tecnoradio', 'Notas fiscais', 'baixa', somarDias(h, 30), 'Wendel', 'Wendel', 'pendente',
      'Padronizar a conferência dos CFOPs de devolução nas notas de entrada para reduzir divergências recorrentes.', -3),
  ];
}

// ---------- exemplo das validações da competência em andamento ----------

export function validacoesExemplo() {
  const competencia = competenciaVigente();
  const today = hojeIso();
  const addDays = somarDias;
  const makeChecklist = novoChecklist;
  const ponto = novoPonto;
  const nextId = novoId;
  function validacao(nome, atividade, analista, status, feitos, atualizadoOffset, pontos = [], justificativa = '') {
    const atualizadoEm = addDays(today, atualizadoOffset);
    return { id: nextId('v'), nome, atividade, analista, status, checklist: makeChecklist(feitos), atualizadoEm, pontos,
             competencia, criadoEm: addDays(today, Math.min(atualizadoOffset, 0) - 3), justificativa,
             concluidaEm: status === 'concluida' ? atualizadoEm : '', retificadora: null };
  }
  return [
    validacao('Empresa Gama', 'EFD CONTRIBUIÇÕES', 'Analista A', 'impedimento', [0], 0, [], 'Empresa não enviou os arquivos de entrada do mês.'),
    validacao('Empresa Delta', 'EFD CONTRIBUIÇÕES', 'Analista A', 'impedimento', [], -17),
    validacao('Rembraz', 'EFD ICMS/IPI', 'Wendel', 'pendente', [], -6),
    validacao('Disbral', 'EFD CONTRIBUIÇÕES', 'Equipe Fiscal', 'andamento', [0], -4, [
      ponto({ categoria: 'Notas fiscais', titulo: 'CFOP divergente na NF 4521', identificado: 'Nota fiscal nº 4521 com CFOP divergente da operação declarada.', motivo: 'CFOP incorreto distorce a apuração de ICMS e pode gerar autuação.', orientacao: 'Corrigir o CFOP (nota complementar ou carta de correção) e reapurar o período.' }),
      ponto({ categoria: 'NCM / CST', titulo: 'Classificação de produtos ST x tributados', identificado: 'Produtos sujeitos a ST escriturados como tributados normalmente.', motivo: 'Gera recolhimento indevido ou a menor de ICMS.', orientacao: 'Revisar o cadastro de NCM e o CEST dos itens e retificar a EFD.' }),
    ]),
    validacao('Tecnoradio', 'EFD ICMS/IPI', 'Wendel', 'andamento', [0, 1, 2], -2),
    validacao('Lusitano', 'Apuração de ICMS', 'Equipe Fiscal', 'pendente', [0, 1], -1, [
      ponto({ categoria: 'ICMS', titulo: 'Guia de setembro recolhida com atraso', identificado: 'Guia de ICMS de setembro recolhida com um dia de atraso.', motivo: 'Recolhimento fora do prazo gera multa e juros.', orientacao: 'Verificar a multa, atualizar o valor devido e criar lembrete de vencimento.' }),
    ]),
    validacao('Empresa Alfa', 'EFD CONTRIBUIÇÕES', 'Analista A', 'impedimento', [0, 2], -3, [
      ponto({ categoria: 'Obrigações acessórias', titulo: 'SPED Fiscal anterior não localizado', identificado: 'SPED Fiscal do período anterior não localizado.', motivo: 'Sem a escrituração anterior não há como conferir o saldo; omissão gera multa.', orientacao: 'Solicitar o reenvio do arquivo à empresa e transmitir antes de validar o período atual.' }),
    ], 'Aguardando a empresa reenviar o SPED Fiscal do período anterior.'),
    validacao('Empresa Beta', 'DCTF', 'Wendel', 'concluida', [0, 1, 2, 3, 4], -8),
    validacao('Nortec', 'EFD ICMS/IPI', 'Equipe Fiscal', 'concluida', [0, 1, 2, 3, 4], -10),
    validacao('Empresa Épsilon', 'EFD REINF', 'Analista B', 'cancelada', [], -12, [], 'Empresa sem movimento no período; obrigação dispensada.'),
  ];
}



// ---------- tarefas, calendário e projetos (exemplos compartilhados com o relatório diário) ----------

export function tarefasExemplo() {
  const today = hojeIso();
  const mk = (tarefa, tipo, requerente, delegadoPara, prazoOffset, prioridade, status, criadoOffset, concluidaOffset) => ({
    id: novoId('t'), tarefa, tipo, requerente, delegadoPara, prazo: somarDias(today, prazoOffset), prioridade, status,
    criadoEm: somarDias(today, criadoOffset), observacoes: '', notificar: '',
    concluidaEm: status === 'concluida' ? somarDias(today, concluidaOffset ?? prazoOffset) : '',
  });
  return [
    mk('Validar notas fiscais — Empresa Alfa', 'operacional', 'Empresa Alfa', 'Wendel', -2, 'critica', 'pendente', -9),
    mk('Conferir guias de ICMS recolhidas', 'operacional', 'Rembraz', 'Wendel', -1, 'alta', 'pendente', -8),
    mk('Calcular invoice da Tecnoradio (mensal)', 'processual', 'Tecnoradio', 'Wendel', -9, 'alta', 'impedimento', -12),
    mk('Enviar DCTF do mês', 'operacional', 'Disbral', 'Equipe Fiscal', 0, 'alta', 'pendente', -6),
    mk('Reunião de alinhamento com Wendel', 'processual', 'Interno', 'Wendel', 0, 'normal', 'andamento', -3),
    mk('Revisão de checklist — Empresa Beta', 'operacional', 'Empresa Beta', 'Equipe Fiscal', 2, 'normal', 'pendente', -2),
    mk('Apuração mensal de ICMS/AM', 'operacional', 'Tecnoradio', 'Wendel', 4, 'normal', 'pendente', -2),
    mk('Levantar empresas sem procuração ou certificado digital', 'estrategico', 'Interno', 'Sem delegado', 5, 'alta', 'pendente', -1),
    mk('Planejamento semanal da equipe', 'processual', 'Interno', 'Wendel', 6, 'baixa', 'pendente', -1),
    mk('Aguardar retorno da SEFAZ sobre o processo de restituição', 'processual', 'Rembraz', 'Analista A', 8, 'critica', 'impedimento', -4),
    mk('Organizar pasta de documentação — Lusitano', 'operacional', 'Lusitano', 'Equipe Fiscal', 10, 'baixa', 'pendente', 0),
    mk('Simulação de regime tributário 2027 — Tecnoradio', 'estrategico', 'Tecnoradio', 'Sem delegado', 14, 'normal', 'andamento', 0),
    mk('Fechamento parcial do mês anterior', 'operacional', 'Interno', 'Wendel', -5, 'normal', 'concluida', -12, -1),
    mk('Protocolar DAS — Simples Nacional', 'operacional', 'Rembraz', 'Wendel', -3, 'alta', 'concluida', -11, 0),
    mk('Reemitir guia de INSS (cliente desistiu do parcelamento)', 'processual', 'Disbral', 'Analista B', -6, 'normal', 'cancelada', -10),
  ];
}

// Eventos do calendário: { 'AAAA-MM-DD': [{ title, type: 'oficial'|'tarefa', time? }] }
export function eventosExemplo() {
  const hoje = new Date();
  const y = hoje.getFullYear();
  const m = hoje.getMonth();
  const ev = {};
  const add = (dia, e) => {
    const k = `${y}-${p2(m + 1)}-${p2(dia)}`;
    (ev[k] = ev[k] || []).push(e);
  };
  // Hoje: reunião e obrigação, para que os relatórios do dia tenham o que mostrar em qualquer data.
  const d0 = hoje.getDate();
  add(d0, { title: 'Reunião de alinhamento com Wendel', type: 'tarefa', time: '14:30' });
  add(d0, { title: 'DCTF — vencimento', type: 'oficial', time: '23:59' });
  add(5, { title: 'Nossa Senhora de Aparecida', type: 'oficial' });
  add(15, { title: 'Dia do Professor', type: 'oficial' });
  add(28, { title: 'Dia do Servidor Público', type: 'oficial' });
  add(10, { title: 'DCTF — vencimento', type: 'oficial', time: '23:59' });
  add(20, { title: 'ICMS/AM — apuração mensal', type: 'oficial', time: '18:00' });
  add(22, { title: 'DAS — Simples Nacional', type: 'oficial', time: '23:59' });
  add(8, { title: 'Validar notas — Empresa Alfa', type: 'tarefa', time: '09:00' });
  add(12, { title: 'Revisão checklist — Empresa Beta', type: 'tarefa', time: '10:00' });
  add(20, { title: 'Conferência de guias recolhidas', type: 'tarefa', time: '11:00' });
  add(25, { title: 'Fechamento parcial do mês', type: 'tarefa', time: '16:00' });
  return ev;
}

export function projetosExemplo() {
  const today = hojeIso();
  const etapa = (nome, responsavel, prazoOffset, status) => ({ id: novoId('et'), nome, responsavel, prazo: somarDias(today, prazoOffset), status });
  const hist = (offset, texto) => ({ id: novoId('h'), data: somarDias(today, offset), texto });
  return [
    {
      id: novoId('p'), titulo: 'Regularização cadastral — Rembraz', cliente: 'Rembraz', responsavel: 'Wendel', prazo: somarDias(today, 12),
      historico: [hist(-10, 'Projeto iniciado a pedido do cliente após notificação da SEFAZ-AM.'), hist(-4, 'Levantamento de pendências cadastrais concluído.')],
      etapas: [
        etapa('Levantamento de pendências cadastrais', 'Wendel', -5, 'concluida'),
        etapa('Protocolo de atualização na Receita Federal', 'Equipe Fiscal', -1, 'concluida'),
        etapa('Atualização de inscrição estadual (SEFAZ-AM)', 'Wendel', 3, 'andamento'),
        etapa('Conferência final e envio ao cliente', 'Wendel', 12, 'pendente'),
      ],
    },
    {
      id: novoId('p'), titulo: 'Planejamento tributário 2027', cliente: 'Tecnoradio', responsavel: 'Wendel', prazo: somarDias(today, 30),
      historico: [hist(-2, 'Reunião inicial com o cliente para alinhar objetivos do planejamento.')],
      etapas: [
        etapa('Levantamento do regime tributário atual', 'Wendel', -2, 'concluida'),
        etapa('Simulação comparativa de regimes', 'Equipe Fiscal', 7, 'andamento'),
        etapa('Apresentação de recomendações ao cliente', 'Wendel', 20, 'pendente'),
        etapa('Implementação das mudanças aprovadas', 'Equipe Fiscal', 30, 'pendente'),
      ],
    },
    {
      id: novoId('p'), titulo: 'Migração para Tax Manager — dados-base', cliente: '', responsavel: 'Wendel', prazo: somarDias(today, -1),
      historico: [hist(-15, 'Mapeamento do protótipo atual concluído (ver docs/fase-0).')],
      etapas: [
        etapa('Mapear módulos e regras de negócio do protótipo', 'Wendel', -15, 'concluida'),
        etapa('Definir perfil fiscal estruturado da empresa', 'Wendel', -1, 'andamento'),
        etapa('Confirmar escopo de dados a migrar com Wendel', 'Wendel', 0, 'pendente'),
      ],
    },
    {
      id: novoId('p'), titulo: 'Due diligence fiscal — abertura de filial', cliente: 'Disbral', responsavel: 'Equipe Fiscal', prazo: somarDias(today, -20),
      historico: [],
      etapas: [
        etapa('Levantamento de obrigações no novo município', 'Equipe Fiscal', -25, 'concluida'),
        etapa('Parecer de viabilidade tributária', 'Wendel', -20, 'concluida'),
        etapa('Entrega do relatório final ao cliente', 'Equipe Fiscal', -20, 'concluida'),
      ],
    },
  ];
}
