// Teste da camada de tarefas com um banco falso em memória.  Rodar: node tests/tarefas-db.test.mjs
import assert from 'node:assert/strict';
import { contextoEquipe, criarSincronizador, sincronizarTarefas, resolverDelegado, SEM_DELEGADO } from '../js/tarefas-db.js';

const U = 'u1', U2 = 'u2', EQ = 'eq1';
const tabelas = {
  membros_equipe: [
    { equipe_id: EQ, usuario_id: U, papel: 'analista', ativo: true, equipes: { nome: 'Alpha' } },
    { equipe_id: EQ, usuario_id: U, papel: 'gestor_fiscal', ativo: true, equipes: { nome: 'Alpha' } },
    { equipe_id: EQ, usuario_id: U2, papel: 'analista', ativo: true, equipes: { nome: 'Alpha' } },
    { equipe_id: EQ, usuario_id: 'w', papel: 'gestor_fiscal', ativo: true, equipes: { nome: 'Alpha' } },
  ],
  perfis: [{ id: U, nome: 'Ana Souza', email: 'ana@x.com' }, { id: U2, nome: null, email: 'bia@x.com' }],
  tarefas: [],
};
const chamadas = [];
function qb(nome) {
  let linhas = tabelas[nome], op = 'select', payload = null;
  const q = {
    select() { return q; }, order() { return q; },
    eq(c, v) { linhas = linhas.filter(r => r[c] === v); return q; },
    in(c, vs) { linhas = linhas.filter(r => vs.includes(r[c])); if (op === 'delete') { apagar(); } return q; },
    range(a, b) { return Promise.resolve({ data: linhas.slice(a, b + 1), error: null }); },
    upsert(rows) { op = 'upsert'; chamadas.push(['upsert', rows.length]);
      for (const r of rows) { const i = tabelas[nome].findIndex(x => x.id === r.id); const novo = { criado_em: '2026-10-29T12:00:00Z', concluida_em: null, ...(i >= 0 ? tabelas[nome][i] : {}), ...r };
        if (i >= 0) tabelas[nome][i] = novo; else tabelas[nome].push(novo); }
      return Promise.resolve({ error: null }); },
    delete() { op = 'delete'; return q; },
    then(res) { return Promise.resolve({ data: linhas, error: null }).then(res); },
  };
  function apagar() { chamadas.push(['delete', linhas.length]); tabelas[nome] = tabelas[nome].filter(r => !linhas.includes(r)); }
  const orig = q.in; q.in = (c, vs) => { const r = orig(c, vs); return op === 'delete' ? Promise.resolve({ error: null }) : r; };
  return q;
}
const supabase = { auth: { getSession: async () => ({ data: { session: { user: { id: U } } } }) }, from: qb };

const ctx = await contextoEquipe(supabase);
assert.equal(ctx.equipeId, EQ);
assert.deepEqual(ctx.membros.map(m => m.nome), ['Ana Souza', 'bia']); // gestora Wendel ('w') não é candidata a delegado
assert.equal(resolverDelegado(ctx, 'ana souza'), 'Ana Souza');
assert.equal(resolverDelegado(ctx, 'Fulano'), SEM_DELEGADO);

let lista = await sincronizarTarefas(supabase, ctx);
const sync = criarSincronizador(supabase, ctx, lista);
lista.push({ id: 'a-1', tarefa: 'Conferir DAS', tipo: 'operacional', prioridade: 'alta', status: 'pendente', requerente: 'Interno',
  delegadoPara: 'Ana Souza', prazo: '2026-11-05', observacoes: '', notificar: '' });
await sync.enviar(lista);
assert.equal(tabelas.tarefas.length, 1);
assert.equal(tabelas.tarefas[0].responsavel_id, U);
assert.equal(tabelas.tarefas[0].equipe_id, EQ);
assert.equal(tabelas.tarefas[0].observacoes, null);

await sync.enviar(lista); // sem mudança: não grava de novo
assert.equal(chamadas.filter(c => c[0] === 'upsert').length, 1);

lista[0].status = 'concluida';
await sync.enviar(lista);
assert.equal(tabelas.tarefas[0].status, 'concluida');

lista = await sync.recarregar();
assert.equal(lista[0].delegadoPara, 'Ana Souza');
assert.equal(lista[0].criadoEm.length, 10);

lista.length = 0;
await sync.enviar(lista);
assert.equal(tabelas.tarefas.length, 0);
console.log('tarefas-db: ok');
