// Tarefas no banco (tabela public.tarefas).
// Cada analista trabalha na sua equipe: a equipe vem de membros_equipe e a RLS do banco
// garante que ninguém lê ou grava tarefas de outra equipe.
// A tela usa o formato "tarefa/delegadoPara/notificar"; aqui ele é convertido de/para o banco.
// Uma cópia vai para o armazenamento local só para Painel e Relatórios lerem o mesmo formato.

import { gravar, isoDe } from './dados-teste.js';

export const SEM_DELEGADO = 'Sem delegado';
const COLUNAS = 'id,titulo,tipo,prioridade,status,requerente,responsavel_id,prazo,observacoes,notificar_email,concluida_em,criado_em';
const TAM = 1000;

/** Equipe do usuário logado e os analistas dessa equipe (candidatos a delegado). null se não pertence a nenhuma. */
export async function contextoEquipe(supabase) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const eu = session.user.id;
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
  let membros = [];
  if (ids.length) {
    const { data: perfis, error: e3 } = await supabase.from('perfis').select('id,nome,email').in('id', ids);
    if (e3) throw e3;
    membros = (perfis || []).map(p => ({ id: p.id, email: p.email, nome: (p.nome || '').trim() || p.email.split('@')[0] }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  return { usuarioId: eu, equipeId, equipeNome: alvo.equipes?.nome || '', membros };
}

const normaliza = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Nome canônico do membro da equipe para o texto digitado, ou SEM_DELEGADO se não houver correspondência. */
export function resolverDelegado(ctx, texto) {
  const n = normaliza(texto);
  if (!n || n === normaliza(SEM_DELEGADO)) return SEM_DELEGADO;
  const m = ctx.membros.find(x => normaliza(x.nome) === n || normaliza(x.email) === n)
    || ctx.membros.find(x => normaliza(x.nome).startsWith(n) && ctx.membros.filter(y => normaliza(y.nome).startsWith(n)).length === 1);
  return m ? m.nome : SEM_DELEGADO;
}

const dia = (ts) => (ts ? isoDe(new Date(ts)) : '');

function paraTela(r, ctx) {
  const resp = ctx.membros.find(m => m.id === r.responsavel_id);
  return {
    id: r.id, tarefa: r.titulo, tipo: r.tipo, prioridade: r.prioridade, status: r.status,
    requerente: r.requerente || 'Interno', delegadoPara: resp ? resp.nome : SEM_DELEGADO,
    prazo: r.prazo || '', observacoes: r.observacoes || '', notificar: r.notificar_email || '',
    criadoEm: dia(r.criado_em), concluidaEm: dia(r.concluida_em),
  };
}

function paraBanco(t, ctx) {
  const m = ctx.membros.find(x => x.nome === t.delegadoPara);
  return {
    id: t.id, equipe_id: ctx.equipeId, titulo: t.tarefa, tipo: t.tipo, prioridade: t.prioridade, status: t.status,
    requerente: t.requerente || 'Interno', responsavel_id: m ? m.id : null, prazo: t.prazo || null,
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
