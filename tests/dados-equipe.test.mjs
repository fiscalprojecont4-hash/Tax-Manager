// Teste da ponte com o banco (banco falso em memória).  Rodar: node tests/dados-equipe.test.mjs
import assert from 'node:assert/strict';

const eventos = [];
globalThis.window = { dispatchEvent: (e) => eventos.push(e.detail.chave) };
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o.detail; } };
globalThis.document = { hidden: false, addEventListener() {}, getElementById: () => null };
globalThis.addEventListener = () => {};

const { ligarDadosEquipe } = await import('../js/dados-equipe.js');
const { gravar, carregar } = await import('../js/dados-teste.js');

const U = 'u1', EQ = 'eq1';
const db = {
  membros_equipe: [{ equipe_id: EQ, usuario_id: U, papel: 'analista', ativo: true, equipes: { nome: 'Alpha' } }],
  perfis: [{ id: U, nome: 'Ana', email: 'ana@x.com' }],
  dados_equipe: [{ equipe_id: EQ, colecao: 'projetos', id: 'p1', dados: { id: 'p1', nome: 'Do banco' }, criado_em: 1 }],
};
const log = [];
function qb(nome) {
  let linhas = db[nome], op = 'select';
  const q = {
    select() { return q; }, order() { return q; },
    eq(c, v) { linhas = linhas.filter(r => r[c] === v); return q; },
    in(c, vs) { linhas = linhas.filter(r => vs.includes(r[c])); return op === 'delete' ? apagar() : q; },
    range(a, b) { return Promise.resolve({ data: linhas.slice(a, b + 1), error: null }); },
    upsert(rows) { log.push(['upsert', rows.map(r => r.colecao + ':' + r.id)]);
      for (const r of rows) { const i = db[nome].findIndex(x => x.equipe_id === r.equipe_id && x.colecao === r.colecao && x.id === r.id);
        if (i >= 0) db[nome][i] = { ...db[nome][i], ...r }; else db[nome].push({ criado_em: 2, ...r }); }
      return Promise.resolve({ error: null }); },
    delete() { op = 'delete'; return q; },
    then(res) { return Promise.resolve({ data: linhas, error: null }).then(res); },
  };
  function apagar() { log.push(['delete', linhas.map(r => r.id)]); db[nome] = db[nome].filter(r => !linhas.includes(r)); return Promise.resolve({ error: null }); }
  return q;
}
const supabase = { auth: { getSession: async () => ({ data: { session: { user: { id: U } } } }) }, from: qb };
const espera = (ms = 700) => new Promise(r => setTimeout(r, ms));

// o navegador tinha dados antigos de validações (primeira vez: devem subir) e categorias padrão (não)
gravar('validacoes', [{ id: 'v0', nome: 'Empresa A' }]);
const ctx = await ligarDadosEquipe(supabase);
assert.equal(ctx.equipeId, EQ);
assert.deepEqual(carregar('projetos', () => []), [{ id: 'p1', nome: 'Do banco' }]); // leitura vem do banco
assert.ok(db.dados_equipe.some(r => r.colecao === 'validacoes' && r.id === 'v0')); // migração inicial
assert.equal(db.dados_equipe.filter(r => r.colecao === 'categorias').length, 0);

// novo registro, edição e exclusão
const v = carregar('validacoes', () => []);
v.push({ id: 'v1', nome: 'Empresa B' }); v[0].nome = 'Empresa A2';
gravar('validacoes', v); await espera();
assert.equal(db.dados_equipe.find(r => r.id === 'v0').dados.nome, 'Empresa A2');
assert.ok(db.dados_equipe.some(r => r.id === 'v1'));
const antes = log.length;
gravar('validacoes', v); await espera(); // nada mudou: nada enviado
assert.equal(log.length, antes);
gravar('validacoes', v.filter(x => x.id !== 'v1')); await espera();
assert.ok(!db.dados_equipe.some(r => r.id === 'v1'));

// documento único (categorias) e arquivos (nunca apaga)
gravar('categorias', ['A', 'B']); await espera();
assert.deepEqual(db.dados_equipe.find(r => r.colecao === 'categorias').dados, ['A', 'B']);
gravar('arquivos', [{ id: 'a1', empresa: 'X' }]); await espera();
gravar('arquivos', []); await espera();
assert.ok(db.dados_equipe.some(r => r.colecao === 'arquivos' && r.id === 'a1'));

// mudança de colega entra na leitura periódica? (verificada indiretamente: recarregar após falha)
console.log('dados-equipe: ok');
process.exit(0);
