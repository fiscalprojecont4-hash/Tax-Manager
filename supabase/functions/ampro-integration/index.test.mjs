// node --experimental-strip-types supabase/functions/ampro-integration/index.test.mjs
// O SQL (idempotência, 409, RLS) é testado no Postgres; aqui: contrato HTTP, validação e calendário.
import assert from 'node:assert/strict';
import { validacaoParaAmPro, indiceDeEmpresas, validarEspelho, hashDoSegredo, intervaloDaCompetencia, eventoDoCalendario, tratar, MAX_BYTES, LIMITE_POR_MINUTO } from './index.ts';

const REV = 'a'.repeat(64);
const espelho = (extra = {}) => ({
  schemaVersion: 1, source: 'ampro', mode: 'snapshot', team: { id: 'fiscal', name: 'Alpha' }, competence: '2026-09',
  sourceUpdatedAt: { companies: '2026-09-30T10:00:00.000Z', cycle: '2026-09-30T10:00:00.000Z' },
  companies: [{ id: 'c1', name: 'ACME', displayName: 'Acme', cnpj: '12.345.678/0001-95', state: 'AM', stateRegistration: '', alterdataCode: '9', taxation: 'LP', regime: 'LP', active: true, responsible: 'Jhonathan', updatedAt: '2026-09-30T09:00:00Z' }],
  obligations: [{ id: 'o1', companyId: 'c1', taskKey: 'efd', taskLabel: 'EFD', competence: '2026-08', responsible: 'Jhonathan', executor: 'Marcel', executorUserId: 'u9', executorTeamId: 'omega', status: 'in_progress', statusLabel: 'Em andamento', dueDate: '', updatedAt: '2026-09-30T09:30:00Z' }],
  revision: REV, ...extra,
});

// ---------- validarEspelho ----------
const ok = validarEspelho(espelho());
assert.ok(!ok.erro);
assert.equal(ok.team_id, 'fiscal');
assert.equal(ok.obligations[0].dueDate, null);                       // ausência preservada, sem inventar data
assert.equal(ok.obligations[0].executorTeamId, 'omega');             // apoio entre equipes continua registrado
assert.equal(ok.companies[0].cnpj, '12.345.678/0001-95');            // documento como no cadastro original
assert.equal(ok.companies_version, '2026-09-30T10:00:00.000Z');
const ruim = (mut, re) => { const c = espelho(); mut(c); assert.match(validarEspelho(c).erro, re); };
ruim((c) => { c.schemaVersion = 2; }, /schemaVersion/);
ruim((c) => { c.source = 'x'; }, /source/);
ruim((c) => { c.mode = 'delta'; }, /mode/);
ruim((c) => { c.team.id = 'gama'; }, /team\.id/);
ruim((c) => { c.competence = '2026-13'; }, /competence/);
ruim((c) => { c.revision = 'xyz'; }, /revision/);
ruim((c) => { c.sourceUpdatedAt.cycle = 'lixo'; }, /sourceUpdatedAt/);
ruim((c) => { c.companies = {}; }, /listas/);
ruim((c) => { c.companies[0].id = ''; }, /id é obrigatório/);
ruim((c) => { c.companies.push({ ...c.companies[0] }); }, /repetido/);
ruim((c) => { c.obligations[0].companyId = 'inexistente'; }, /companyId/);
ruim((c) => { c.obligations[0].status = 'done '.repeat(2); }, /status/);
ruim((c) => { c.obligations[0].dueDate = '2026-02-30'; }, /dueDate/);
ruim((c) => { c.obligations.push({ ...c.obligations[0] }); }, /repetido/);
ruim((c) => { c.obligations[0].updatedAt = 'ontem'; }, /updatedAt/);
assert.match(validarEspelho(null).erro, /objeto/);
for (const e of ['pending', 'in_progress', 'review', 'done', 'impediment', 'not_applicable']) {
  const c = espelho(); c.obligations[0].status = e; assert.ok(!validarEspelho(c).erro, e);
}

// ---------- utilitários ----------
assert.equal(await hashDoSegredo('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
assert.deepEqual(intervaloDaCompetencia('2026-09'), { de: '2026-09-01', ate: '2026-10-01' });
assert.deepEqual(intervaloDaCompetencia('2026-12'), { de: '2026-12-01', ate: '2027-01-01' });
assert.deepEqual(
  eventoDoCalendario({ id: 'x', titulo: 'REINF', orgao: 'RFB', vencimento: '2026-09-21', versao: 2, status: 'substituido', substitui_id: null, fonte_url: null }),
  { id: 'x', title: 'REINF', dueDate: '2026-09-21', status: 'superseded', version: 2, replacesId: null, authority: 'RFB', sourceUrl: '' });

// ---------- tratar(), com um banco de mentira ----------
class Consulta {
  constructor(b, t) { this.b = b; this.t = t; this.f = []; this.op = 'select'; this.cab = false; }
  select(_c, o) { if (o?.head) this.cab = true; return this; }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; }
  in(c, vs) { this.f.push((r) => vs.includes(r[c])); return this; }
  gte(c, v) { this.f.push((r) => r[c] >= v); return this; }
  lt(c, v) { this.f.push((r) => r[c] < v); return this; }
  order(c, o) { (this.ord ??= []).push([c, o?.ascending !== false]); return this; }
  range(a, z) { this.fim = [a, z]; return this; }
  insert(c) { this.op = 'insert'; this.corpo = c; return this; }
  update(c) { this.op = 'update'; this.corpo = c; return this; }
  maybeSingle() { this.unico = true; return this; }
  then(ok, ko) { return Promise.resolve(this.exec()).then(ok, ko); }
  exec() {
    const tab = (this.b.tabelas[this.t] ??= []);
    if (this.b.falhaEm === `${this.op}:${this.t}`) return { data: null, error: { message: 'segredo-interno-do-banco' }, count: null };
    if (this.op === 'insert') { tab.push({ criado_em: new Date().toISOString(), ...this.corpo }); return { data: null, error: null }; }
    let rows = tab.filter((r) => this.f.every((f) => f(r)));
    if (this.op === 'update') { rows.forEach((r) => Object.assign(r, this.corpo)); return { data: null, error: null }; }
    if (this.ord) rows = [...rows].sort((x, y) => { for (const [c, asc] of this.ord) if (x[c] !== y[c]) return (x[c] < y[c] ? -1 : 1) * (asc ? 1 : -1); return 0; });
    if (this.cab) return { data: null, error: null, count: rows.length };
    if (this.fim) rows = rows.slice(this.fim[0], this.fim[1] + 1);
    return { data: this.unico ? (rows[0] ?? null) : rows, error: null };
  }
}
const SEGREDO = 'S'.repeat(43);
const SEGREDO_BETA = 'B'.repeat(43);
const REVOGADO = 'R'.repeat(43);
const novo = async (extra = {}) => ({
  chamadas: [], respostaRpc: { status: 'aceito', empresas: 1, obrigacoes: 1 },
  tabelas: {
    ampro_chaves: [
      { id: 'K1', hash: await hashDoSegredo(SEGREDO), equipes: ['fiscal', 'omega', 'beta'], ativa: true },
      { id: 'K2', hash: await hashDoSegredo(SEGREDO_BETA), equipes: ['beta'], ativa: true },
      { id: 'K3', hash: await hashDoSegredo(REVOGADO), equipes: ['fiscal'], ativa: false },
    ],
    obrigacoes_oficiais: [
      { id: 'a1', titulo: 'REINF', orgao: 'RFB', vencimento: '2026-09-21', versao: 1, status: 'aprovado', substitui_id: null, fonte_url: 'https://x' },
      { id: 'a2', titulo: 'DCTF', orgao: 'RFB', vencimento: '2026-09-15', versao: 2, status: 'aprovado', substitui_id: 'a0', fonte_url: null },
      { id: 'a0', titulo: 'DCTF', orgao: 'RFB', vencimento: '2026-09-10', versao: 1, status: 'substituido', substitui_id: null, fonte_url: 'https://x' },
      { id: 'r1', titulo: 'Rascunho', orgao: 'RFB', vencimento: '2026-09-12', versao: 1, status: 'rascunho', substitui_id: null, fonte_url: null },
      { id: 'r2', titulo: 'Rejeitado', orgao: 'RFB', vencimento: '2026-09-13', versao: 1, status: 'rejeitado', substitui_id: null, fonte_url: null },
      { id: 'o1', titulo: 'Outubro', orgao: 'RFB', vencimento: '2026-10-01', versao: 1, status: 'aprovado', substitui_id: null, fonte_url: null },
      { id: 'n1', titulo: 'Agosto', orgao: 'RFB', vencimento: '2026-08-31', versao: 1, status: 'aprovado', substitui_id: null, fonte_url: null },
    ],
    ...extra.tabelas,
  },
  falhaEm: extra.falhaEm,
  from(t) { return new Consulta(this, t); },
  async rpc(nome, args) { this.chamadas.push([nome, args]); return this.respostaRpc instanceof Error ? { data: null, error: { message: 'x' } } : { data: this.respostaRpc, error: null }; },
});
const chamar = (db, metodo, rota, { segredo, corpo, bruto, cab = {}, query = '' } = {}) => tratar(
  new Request(`https://x.supabase.co/functions/v1/ampro-integration/${rota}${query}`, {
    method: metodo,
    headers: { ...(segredo ? { authorization: `Bearer ${segredo}` } : {}), 'content-type': 'application/json', ...cab },
    body: bruto ?? (corpo === undefined ? undefined : JSON.stringify(corpo)),
  }), async () => db);
const json = (r) => r.json();

{ // autenticação e rotas
  const db = await novo();
  assert.equal((await chamar(db, 'POST', 'mirror', { corpo: espelho() })).status, 401);                          // sem credencial
  assert.equal((await chamar(db, 'POST', 'mirror', { segredo: 'curta', corpo: espelho() })).status, 401);          // fora do formato
  assert.equal((await chamar(db, 'POST', 'mirror', { segredo: 'X'.repeat(43), corpo: espelho() })).status, 401);   // desconhecida
  assert.equal((await chamar(db, 'POST', 'mirror', { segredo: REVOGADO, corpo: espelho() })).status, 401);         // revogada
  assert.equal(db.chamadas.length, 0);                                                                              // nada gravado sem autenticar
  assert.equal((await chamar(db, 'GET', 'outra', { segredo: SEGREDO })).status, 404);
  assert.equal((await chamar(db, 'GET', 'mirror', { segredo: SEGREDO })).status, 405);
  assert.equal((await chamar(db, 'POST', 'calendar', { segredo: SEGREDO, corpo: {} })).status, 405);
  assert.equal((await chamar(db, 'OPTIONS', 'mirror')).status, 204);
  const r = await json(await chamar(db, 'POST', 'mirror', { segredo: 'curta' }));
  assert.deepEqual(Object.keys(r).sort(), ['error', 'message']);
}

{ // POST /mirror
  const db = await novo();
  const r = await chamar(db, 'POST', 'mirror', { segredo: SEGREDO, corpo: espelho(), cab: { 'idempotency-key': REV } });
  assert.equal(r.status, 200);
  assert.deepEqual(await json(r), { accepted: true, teamId: 'fiscal', competence: '2026-09', revision: REV });
  assert.equal(db.chamadas.length, 1);
  assert.equal(db.chamadas[0][1].p.team_id, 'fiscal');
  assert.ok(db.tabelas.ampro_chaves[0].ultimo_uso);
  const log = db.tabelas.ampro_log.at(-1);
  assert.deepEqual([log.operacao, log.equipe, log.http, log.itens], ['mirror', 'fiscal', 200, 2]);
  assert.ok(!JSON.stringify(db.tabelas.ampro_log).includes('ACME'));                                               // log sem conteúdo

  db.respostaRpc = { status: 'duplicado' };                                                                         // repetição idempotente = 200
  const rep = await chamar(db, 'POST', 'mirror', { segredo: SEGREDO, corpo: espelho() });
  assert.equal(rep.status, 200); assert.equal((await json(rep)).accepted, true);

  db.respostaRpc = { status: 'desatualizado' };
  const velho = await chamar(db, 'POST', 'mirror', { segredo: SEGREDO, corpo: espelho() });
  assert.equal(velho.status, 409); assert.equal((await json(velho)).error, 'stale_snapshot');

  db.respostaRpc = { status: 'sem_equipe' };
  assert.equal((await chamar(db, 'POST', 'mirror', { segredo: SEGREDO, corpo: espelho() })).status, 403);

  db.respostaRpc = new Error('x');                                                                                  // falha no banco: nunca confirma sucesso
  const f = await chamar(db, 'POST', 'mirror', { segredo: SEGREDO, corpo: espelho() });
  assert.equal(f.status, 500); assert.ok(!JSON.stringify(await json(f)).includes('segredo-interno'));

  db.respostaRpc = { status: 'aceito' };
  assert.equal((await chamar(db, 'POST', 'mirror', { segredo: SEGREDO, corpo: espelho(), cab: { 'idempotency-key': 'b'.repeat(64) } })).status, 400); // chave diferente da revisão
  assert.equal((await chamar(db, 'POST', 'mirror', { segredo: SEGREDO, bruto: '{nao json' })).status, 400);
  assert.equal((await chamar(db, 'POST', 'mirror', { segredo: SEGREDO, corpo: espelho({ competence: '2026-99' }) })).status, 400);
  assert.equal((await chamar(db, 'POST', 'mirror', { segredo: SEGREDO, bruto: 'x'.repeat(MAX_BYTES + 1) })).status, 413);
  assert.equal((await chamar(db, 'POST', 'mirror', { segredo: SEGREDO, corpo: espelho(), cab: { 'content-length': String(MAX_BYTES + 1) } })).status, 413);
}

{ // escopo de equipes da credencial
  const db = await novo();
  assert.equal((await chamar(db, 'POST', 'mirror', { segredo: SEGREDO_BETA, corpo: espelho() })).status, 403);     // beta não grava fiscal
  const n = db.chamadas.length;
  const beta = espelho({ team: { id: 'beta', name: 'Beta' } });
  assert.equal((await chamar(db, 'POST', 'mirror', { segredo: SEGREDO_BETA, corpo: beta })).status, 200);
  assert.equal(db.chamadas.length, n + 1);
}

{ // GET /calendar
  const db = await novo();
  assert.equal((await chamar(db, 'GET', 'calendar', { segredo: SEGREDO })).status, 400);                            // competence obrigatória
  assert.equal((await chamar(db, 'GET', 'calendar', { segredo: SEGREDO, query: '?competence=2026-9' })).status, 400);
  const r = await chamar(db, 'GET', 'calendar', { segredo: SEGREDO, query: '?competence=2026-09' });
  assert.equal(r.status, 200);
  const j = await json(r);
  assert.equal(j.schemaVersion, 1);
  assert.deepEqual(j.events.map((e) => e.id), ['a0', 'a2', 'a1']);                                                  // só o mês, ordenado; sem rascunho/rejeitado
  assert.deepEqual(j.events.map((e) => e.status), ['superseded', 'approved', 'approved']);
  const a2 = j.events.find((e) => e.id === 'a2');
  assert.deepEqual(a2, { id: 'a2', title: 'DCTF', dueDate: '2026-09-15', status: 'approved', version: 2, replacesId: 'a0', authority: 'RFB', sourceUrl: '' });
  assert.deepEqual((await json(await chamar(db, 'GET', 'calendar', { segredo: SEGREDO, query: '?competence=2027-01' }))).events, []); // vazio legítimo
  db.falhaEm = 'select:obrigacoes_oficiais';
  assert.equal((await chamar(db, 'GET', 'calendar', { segredo: SEGREDO, query: '?competence=2026-09' })).status, 500); // falha NÃO vira lista vazia
}

{ // mês com mais de 1000 eventos: sem truncar
  const muitos = Array.from({ length: 2500 }, (_, i) => ({ id: `e${String(i).padStart(5, '0')}`, titulo: 't', orgao: 'RFB', vencimento: '2026-09-15', versao: 1, status: 'aprovado', substitui_id: null, fonte_url: null }));
  const db = await novo({ tabelas: { obrigacoes_oficiais: muitos } });
  const j = await json(await chamar(db, 'GET', 'calendar', { segredo: SEGREDO, query: '?competence=2026-09' }));
  assert.equal(j.events.length, 2500);
  assert.equal(new Set(j.events.map((e) => e.id)).size, 2500);
}

{ // GET /validations
  const EQ = 'eq-alpha';
  const aberta = { id: 'v1', nome: 'Acme Ltda', atividade: 'EFD ICMS/IPI', analista: 'Jhonathan', status: 'andamento', competencia: '2026-09',
    checklist: [{ id: 'c0', label: 'a', done: true }, { id: 'c1', label: 'b', done: false }], justificativa: '', criadoEm: '2026-09-02', concluidaEm: '', atualizadoEm: '2026-09-10',
    retificadora: null, pontos: [{ id: 'p1', categoria: 'ICMS', titulo: 'Crédito', identificado: 'x', motivo: 'y', orientacao: 'z' }] };
  const outroMes = { ...aberta, id: 'v2', competencia: '2026-10' };
  const arquivo = { id: 'a1', competencia: '2026-08', empresa: 'Beta SA', encerradoEm: '2026-09-01', itens: [
    { id: 'v9', atividade: 'DCTF', analista: 'PH', status: 'concluida', justificativa: 'ok', criadoEm: '2026-08-03', concluidaEm: '2026-08-20', atualizadoEm: '2026-08-20',
      checklistFeitos: 5, checklistTotal: 5, pontos: [], retificadora: null }] };
  const tabelas = {
    ampro_equipes: [{ ampro_id: 'fiscal', equipe_id: EQ }, { ampro_id: 'beta', equipe_id: 'eq-beta' }],
    ampro_empresas: [{ equipe_id: EQ, externo_id: 'c1', nome: 'ACME LTDA', nome_exibicao: 'Acme Ltda', cnpj: '12.345.678/0001-95' }],
    dados_equipe: [
      { equipe_id: EQ, colecao: 'validacoes', id: 'v1', dados: aberta }, { equipe_id: EQ, colecao: 'validacoes', id: 'v2', dados: outroMes },
      { equipe_id: EQ, colecao: 'arquivos', id: 'a1', dados: arquivo },
      { equipe_id: 'eq-beta', colecao: 'validacoes', id: 'vb', dados: { ...aberta, id: 'vb', nome: 'Outra Equipe' } },
    ],
  };
  const db = await novo({ tabelas });
  assert.equal((await chamar(db, 'GET', 'validations', { segredo: SEGREDO, query: '?competence=2026-09' })).status, 400);          // team obrigatório
  assert.equal((await chamar(db, 'GET', 'validations', { segredo: SEGREDO, query: '?team=gama&competence=2026-09' })).status, 400);
  assert.equal((await chamar(db, 'GET', 'validations', { segredo: SEGREDO, query: '?team=fiscal' })).status, 400);
  assert.equal((await chamar(db, 'GET', 'validations', { segredo: SEGREDO_BETA, query: '?team=fiscal&competence=2026-09' })).status, 403); // credencial sem a equipe
  assert.equal((await chamar(db, 'POST', 'validations', { segredo: SEGREDO, corpo: {} })).status, 405);
  const r = await chamar(db, 'GET', 'validations', { segredo: SEGREDO, query: '?team=fiscal&competence=2026-09' });
  assert.equal(r.status, 200);
  const j = await json(r);
  assert.deepEqual([j.schemaVersion, j.team.id, j.competence], [1, 'fiscal', '2026-09']);
  assert.equal(j.validations.length, 1);                                                                           // só o mês e só a equipe
  assert.deepEqual(j.validations[0], { id: 'v1', companyId: 'c1', companyName: 'Acme Ltda', cnpj: '12.345.678/0001-95', activity: 'EFD ICMS/IPI',
    analyst: 'Jhonathan', status: 'in_progress', closed: false, checklist: { done: 1, total: 2 }, justification: '', createdAt: '2026-09-02',
    completedAt: null, updatedAt: '2026-09-10', amends: null,
    findings: [{ id: 'p1', category: 'ICMS', title: 'Crédito', identified: 'x', reason: 'y', guidance: 'z' }] });
  const ag = await json(await chamar(db, 'GET', 'validations', { segredo: SEGREDO, query: '?team=fiscal&competence=2026-08' }));
  assert.equal(ag.validations.length, 1);                                                                          // mês já encerrado vem do arquivo
  assert.deepEqual([ag.validations[0].closed, ag.validations[0].status, ag.validations[0].companyId, ag.validations[0].checklist], [true, 'done', null, { done: 5, total: 5 }]);
  assert.deepEqual((await json(await chamar(db, 'GET', 'validations', { segredo: SEGREDO, query: '?team=fiscal&competence=2027-01' }))).validations, []);
  const b = await json(await chamar(db, 'GET', 'validations', { segredo: SEGREDO_BETA, query: '?team=beta&competence=2026-09' }));
  assert.deepEqual(b.validations.map((x) => x.companyName), ['Outra Equipe']);                                      // isolamento entre equipes
  db.falhaEm = 'select:dados_equipe';
  assert.equal((await chamar(db, 'GET', 'validations', { segredo: SEGREDO, query: '?team=fiscal&competence=2026-09' })).status, 500); // falha NÃO vira lista vazia
  assert.equal(indiceDeEmpresas([{ externo_id: 'x', nome: 'Ação S/A', nome_exibicao: '', cnpj: '' }]).get('acao s/a').externo_id, 'x');
  assert.equal(validacaoParaAmPro({ id: 1, status: 'estranho' }, 'Z', '2026-09', false, new Map()).status, 'pending');
}

{ // limite por minuto, por credencial
  const db = await novo();
  db.tabelas.ampro_log = Array.from({ length: LIMITE_POR_MINUTO }, () => ({ chave_id: 'K1', criado_em: new Date().toISOString() }));
  const r = await chamar(db, 'GET', 'calendar', { segredo: SEGREDO, query: '?competence=2026-09' });
  assert.equal(r.status, 429);
  assert.equal((await chamar(db, 'GET', 'calendar', { segredo: SEGREDO_BETA, query: '?competence=2026-09' })).status, 200); // outra credencial não é afetada
}

console.log('ok');
