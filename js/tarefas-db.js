// Tarefas no banco (tabela public.tarefas).
// Cada analista trabalha na sua equipe: a equipe vem de membros_equipe e a RLS do banco
// garante que ninguém lê ou grava tarefas de outra equipe.
// A tela usa o formato "tarefa/delegadoPara/notificar"; aqui ele é convertido de/para o banco.
// Uma cópia vai para o armazenamento local só para Painel e Relatórios lerem o mesmo formato.

import { gravar, isoDe } from './dados-teste.js';
import { unirMembros, acharMembro } from './membros.js';

export const SEM_DELEGADO = 'Sem delegado';
const COLUNAS = 'id,titulo,tipo,prioridade,status,requerente,responsavel_id,delegado_nome,prazo,observacoes,notificar_email,concluida_em,criado_em';
const TAM = 1000;

let memo = null; // { usuarioId, ctx } — a equipe não muda durante a sessão

/**
 * Equipe do usuário logado e as pessoas dela. `membros` = quem aparece em "Delegado para" e "Membro em validação":
 * os usuários da equipe no AM PRO + os analistas com login no Tax Manager (id/email só para estes).
 * null se o usuário não pertence a nenhuma equipe.
 */
export async function contextoEquipe(supabase) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const eu = session.user.id;
  if (memo && memo.usuarioId === eu) return memo.ctx;
  const { data: meus, error } = await supabase.from('membros_equipe')
    .select('equipe_id,papel,equipes(nome)').eq('usuario_id', eu).eq('ativo', true);
  if (error) throw error;
  if (!meus?.length) return null;
  const alvo = meus.find(m => m.papel === 'analista') || meus[0];
  const equipeId = alvo.equipe_id;
  const { data: colegas, error: e2 } = await supabase.from('membros_equipe')
    .select('usuario_id').eq('equipe_id', equipeId).eq('papel', 'analista').eq('ativo', true);
  if (e2) throw e2;
  const ids = [...new Set((colegas || []).map(c => c.usuario_id))];
  let analistas = [];
  if (ids.length) {
    const { data: perfis, error: e3 } = await supabase.from('perfis').select('id,nome,email').in('id', ids);
    if (e3) throw e3;
    analistas = (perfis || []).map(p => ({ id: p.id, email: p.email, nome: (p.nome || '').trim() || p.email.split('@')[0] }));
  }
  // pessoas do AM PRO nesta equipe (se a função ainda não existir no banco, segue só com os analistas)
  let doAmPro = [];
  try {
    const { data, error: e4 } = await supabase.rpc('ampro_membros');
    if (e4) throw e4;
    doAmPro = (data || []).filter(l => l.equipe_id === equipeId).map(l => ({ nome: l.nome, usuario: l.usuario || '' }));
  } catch (e) { console.warn('Membros do AM PRO indisponíveis:', e?.message || e); }
  const ctx = { usuarioId: eu, equipeId, equipeNome: alvo.equipes?.nome || '', analistas, membros: unirMembros([...doAmPro, ...analistas]) };
  memo = { usuarioId: eu, ctx };
  return ctx;
}

/** Nome canônico da pessoa da equipe para o texto digitado, ou SEM_DELEGADO se não houver correspondência. */
export function resolverDelegado(ctx, texto) {
  return acharMembro(ctx.membros, texto)?.nome || SEM_DELEGADO;
}

const dia = (ts) => (ts ? isoDe(new Date(ts)) : '');

function paraTela(r, ctx) {
  const resp = ctx.analistas.find(m => m.id === r.responsavel_id);
  const nome = (r.delegado_nome || '').trim() || (resp ? resp.nome : '');
  return {
    id: r.id, tarefa: r.titulo, tipo: r.tipo, prioridade: r.prioridade, status: r.status,
    requerente: r.requerente || 'Interno', delegadoPara: nome ? (acharMembro(ctx.membros, nome)?.nome || nome) : SEM_DELEGADO,
    prazo: r.prazo || '', observacoes: r.observacoes || '', notificar: r.notificar_email || '',
    criadoEm: dia(r.criado_em), concluidaEm: dia(r.concluida_em),
  };
}

function paraBanco(t, ctx) {
  const m = t.delegadoPara && t.delegadoPara !== SEM_DELEGADO ? ctx.membros.find(x => x.nome === t.delegadoPara) : null;
  return {
    id: t.id, equipe_id: ctx.equipeId, titulo: t.tarefa, tipo: t.tipo, prioridade: t.prioridade, status: t.status,
    requerente: t.requerente || 'Interno', responsavel_id: m?.id ?? null, delegado_nome: m ? m.nome : null, prazo: t.prazo || null,
    observacoes: t.observacoes || null, notificar_email: t.notificar || null,
  };
}

async function lerTodas(supabase, ctx) {
  const out = [];
  for (let de = 0; ; de += TAM) {
    const { data, error } = await supabase.from('tarefas').select(COLUNAS).eq('equipe_id', ctx.equipeId)
      .order('criado_em').range(de, de + TAM - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < TAM) break;
  }
  return out.map(r => paraTela(r, ctx));
}

/** Lê as tarefas da equipe e atualiza a cópia local usada por Painel e Relatórios. */
export async function sincronizarTarefas(supabase, ctx) {
  const lista = await lerTodas(supabase, ctx);
  gravar('tarefas', lista);
  return lista;
}

/**
 * Mantém as tarefas da tela e o banco iguais. A tela só altera a lista em memória; chamar
 * enviar(lista) compara com o último estado conhecido do banco e grava só o que mudou.
 */
export function criarSincronizador(supabase, ctx, inicial) {
  let base = new Map(inicial.map(t => [t.id, JSON.stringify(paraBanco(t, ctx))]));
  let fila = Promise.resolve();

  async function executar(lista) {
    const atuais = new Map(lista.map(t => [t.id, paraBanco(t, ctx)]));
    const gravar_ = [...atuais].filter(([id, linha]) => base.get(id) !== JSON.stringify(linha)).map(([, l]) => l);
    const apagar = [...base.keys()].filter(id => !atuais.has(id));
    for (let i = 0; i < gravar_.length; i += 200) {
      const { error } = await supabase.from('tarefas').upsert(gravar_.slice(i, i + 200), { onConflict: 'id' });
      if (error) throw error;
    }
    for (let i = 0; i < apagar.length; i += 200) {
      const { error } = await supabase.from('tarefas').delete().in('id', apagar.slice(i, i + 200));
      if (error) throw error;
    }
    base = new Map([...atuais].map(([id, l]) => [id, JSON.stringify(l)]));
  }

  return {
    enviar(lista) {
      const foto = lista.map(t => ({ ...t }));
      fila = fila.catch(() => {}).then(() => executar(foto));
      return fila;
    },
    async recarregar() {
      await fila.catch(() => {});
      const lista = await sincronizarTarefas(supabase, ctx);
      base = new Map(lista.map(t => [t.id, JSON.stringify(paraBanco(t, ctx))]));
      return lista;
    },
  };
}
