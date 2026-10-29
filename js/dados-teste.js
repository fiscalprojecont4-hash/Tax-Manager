// Armazenamento local dos módulos que ainda não estão no banco.
//
// As telas leem e gravam por aqui (localStorage). Para Validações, Conhecimento, Projetos, Calendário e
// Categorias, js/dados-equipe.js liga esta camada ao banco: lê da equipe ao abrir a página e envia cada
// gravação. Sem sessão ou sem rede, a tela segue só no navegador. Não há dados de exemplo.

const PREFIXO = 'tm.';
const memoria = {};   // reserva quando o navegador bloqueia o localStorage

// Versão 2 = fim dos dados de exemplo. Na primeira abertura depois da atualização, apaga do navegador
// os exemplos antigos (e só eles: categorias e a competência escolhida são mantidas).
const VERSAO_DADOS = '2';
try {
  if (localStorage.getItem(PREFIXO + '__versao') !== VERSAO_DADOS) {
    ['validacoes', 'arquivos', 'empresas', 'mapeamento', 'relatorios', 'tarefas', 'projetos', 'eventos']
      .forEach(c => localStorage.removeItem(PREFIXO + c));
    localStorage.setItem(PREFIXO + '__versao', VERSAO_DADOS);
  }
} catch { /* storage bloqueado: não há o que apagar */ }

function lerBruto(chave) {
  try {
    const v = localStorage.getItem(PREFIXO + chave);
    if (v !== null) return v;
  } catch { /* storage bloqueado: usa a memória */ }
  return chave in memoria ? memoria[chave] : null;
}

// Grava só no navegador (usado também por quem acabou de ler do banco).
export function gravarLocal(chave, valor) {
  const texto = JSON.stringify(valor);
  memoria[chave] = texto;
  try { localStorage.setItem(PREFIXO + chave, texto); } catch { /* segue só na memória */ }
}

// Ponte para o banco (js/dados-equipe.js): toda gravação das telas também é enviada à equipe.
let ponte = null;
export function definirPonte(fn) { ponte = fn; }

export function gravar(chave, valor) {
  gravarLocal(chave, valor);
  if (ponte) { try { ponte(chave, valor); } catch (e) { console.error(e); } }
}

/** Valor guardado no navegador (ou undefined). */
export function lerLocal(chave) {
  const bruto = lerBruto(chave);
  if (bruto === null) return undefined;
  try { return JSON.parse(bruto); } catch { return undefined; }
}
export function removerLocal(chave) {
  delete memoria[chave];
  try { localStorage.removeItem(PREFIXO + chave); } catch { /* ignora */ }
}

// Lê a chave; se ainda não existe, cria vazia (fabrica) e grava.
export function carregar(chave, fabrica) {
  const bruto = lerBruto(chave);
  if (bruto !== null) {
    try { return JSON.parse(bruto); } catch { /* corrompido: refaz abaixo */ }
  }
  const valor = fabrica();
  gravar(chave, valor);
  return valor;
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

export const EMPRESAS_PADRAO = [];
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

function arquivosExemplo() { return []; }

// ---------- mapeamento fiscal (Conhecimento) ----------

export function mapeamento() { return carregar('mapeamento', mapeamentoExemplo); }
export function salvarMapeamento(lista) { gravar('mapeamento', lista); }

function mapeamentoExemplo() { return []; }

// ---------- exemplo das validações da competência em andamento ----------

export function validacoesExemplo() { return []; }



// ---------- tarefas, calendário e projetos (exemplos compartilhados com o relatório diário) ----------

export function tarefasExemplo() { return []; }

// Eventos do calendário: { 'AAAA-MM-DD': [{ title, type: 'oficial'|'tarefa', time? }] }
export function eventosExemplo() { return {}; }

export function projetosExemplo() { return []; }


// ---------- Calendário oficial (vem do banco; aqui só o cache local) ----------
// js/obrigacoes-db.js busca as obrigações APROVADAS no Supabase e guarda o resultado aqui,
// para telas síncronas (relatórios diários) e para abrir o calendário sem esperar a rede.
/** { 'AAAA-MM-DD': [{ title, type:'oficial', descricao, fonte }] } */
export function eventosOficiais() { return carregar('oficiais', () => ({ eventos: {} })).eventos || {}; }
export function salvarEventosOficiais(eventos) { gravar('oficiais', { eventos, atualizado: new Date().toISOString() }); }
