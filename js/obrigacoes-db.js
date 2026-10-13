// Calendário oficial no banco (tabela public.obrigacoes_oficiais).
// Leitura: qualquer usuário logado vê as APROVADAS; o gestor fiscal vê também rascunhos e rejeitadas (RLS).
// Escrita: só o gestor fiscal, e só nas colunas status/aprovado_por/aprovado_em (GRANT de coluna).
// Quem grava os rascunhos é a rotina diária (scripts/ingestao-*.mjs).

import { supabase } from './supabase-client.js';
import { salvarEventosOficiais } from './dados-teste.js';

const COLUNAS = 'id,titulo,orgao,esfera,uf,vencimento,descricao,fonte_url,versao,status,substitui_id';
const TAM = 1000; // limite de linhas por consulta do PostgREST

async function paginar(montar) {
  const out = [];
  for (let de = 0; ; de += TAM) {
    const { data, error } = await montar().range(de, de + TAM - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < TAM) break;
  }
  return out;
}

const p2 = (n) => String(n).padStart(2, '0');
export function intervaloDoMes(ym) { // 'AAAA-MM' -> [primeiro dia, primeiro dia do mês seguinte)
  const [a, m] = ym.split('-').map(Number);
  const prox = m === 12 ? `${a + 1}-01-01` : `${a}-${p2(m + 1)}-01`;
  return [`${a}-${p2(m)}-01`, prox];
}

/** Lista para a tela de revisão. status '' = todos; ym 'AAAA-MM' = só esse mês ('' = todos os meses). */
export async function listarObrigacoes({ status = '', ym = '' } = {}) {
  return paginar(() => {
    let q = supabase.from('obrigacoes_oficiais').select(COLUNAS).order('vencimento').order('titulo');
    if (status) q = q.eq('status', status);
    if (ym) { const [de, ate] = intervaloDoMes(ym); q = q.gte('vencimento', de).lt('vencimento', ate); }
    return q;
  });
}

/** Contagem por situação (para os números da tela). */
export async function contarPorStatus(ym = '') {
  const out = {};
  for (const st of ['rascunho', 'aprovado', 'rejeitado']) {
    let q = supabase.from('obrigacoes_oficiais').select('id', { count: 'exact', head: true }).eq('status', st);
    if (ym) { const [de, ate] = intervaloDoMes(ym); q = q.gte('vencimento', de).lt('vencimento', ate); }
    const { count, error } = await q;
    if (error) throw error;
    out[st] = count ?? 0;
  }
  return out;
}

/**
 * Muda a situação de várias obrigações. Retorna quantas foram realmente alteradas
 * (a RLS não dá erro quando o usuário não tem permissão: simplesmente não altera nada).
 * Aprovar uma nova versão marca a anterior como 'substituido'.
 */
export async function mudarStatus(lista, status) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada. Entre de novo.');
  const campos = status === 'aprovado'
    ? { status, aprovado_por: session.user.id, aprovado_em: new Date().toISOString() }
    : { status, aprovado_por: null, aprovado_em: null };
  const ids = lista.map(o => o.id);
  let alteradas = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('obrigacoes_oficiais').update(campos).in('id', ids.slice(i, i + 100)).select('id');
    if (error) throw error;
    alteradas += data.length;
  }
  if (status === 'aprovado') {
    const antigas = [...new Set(lista.map(o => o.substitui_id).filter(Boolean))];
    for (let i = 0; i < antigas.length; i += 100) {
      const { error } = await supabase.from('obrigacoes_oficiais').update({ status: 'substituido' })
        .in('id', antigas.slice(i, i + 100)).eq('status', 'aprovado');
      if (error) throw error;
    }
  }
  await atualizarOficiais().catch(() => {});
  return alteradas;
}

/** Busca as aprovadas (ano anterior em diante) e guarda no cache local usado pelo Calendário e pelos relatórios. */
export async function atualizarOficiais() {
  const desde = `${new Date().getFullYear() - 1}-01-01`;
  const linhas = await paginar(() => supabase.from('obrigacoes_oficiais')
    .select('titulo,orgao,vencimento,descricao,fonte_url').eq('status', 'aprovado').gte('vencimento', desde).order('vencimento'));
  const eventos = {};
  linhas.forEach(o => {
    (eventos[o.vencimento] = eventos[o.vencimento] || []).push({ title: `${o.orgao} — ${o.titulo}`, type: 'oficial', descricao: o.descricao, fonte: o.fonte_url });
  });
  salvarEventosOficiais(eventos);
  return eventos;
}
