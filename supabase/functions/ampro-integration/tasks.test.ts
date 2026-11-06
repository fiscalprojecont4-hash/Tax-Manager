import assert from "node:assert/strict";
import { test } from "node:test";
import { tarefaNoPeriodo, tarefaParaAmPro, tratarTarefas } from "./tasks.ts";

type Row = Record<string, unknown>;
type Database = Parameters<typeof tratarTarefas>[1];
type Query = ReturnType<ReturnType<Database["from"]>["select"]>;
const row = (extra: Row = {}): Row => ({ id: "one", equipe_id: "alpha-uuid", titulo: "Conferir documentos", tipo: "operacional", prioridade: "normal", status: "pendente",
  delegado_nome: "Davi", responsavel_id: null, prazo: "2026-11-20", observacoes: "Conferir documentos do responsável", criado_em: "2026-11-01T14:00:00Z", atualizado_em: "2026-11-06T14:00:00Z", concluida_em: null, ...extra });
function database(tables: Record<string, Row[]>, failPage = false) {
  const reads: string[] = [];
  const db: Database = { from(table) {
    reads.push(table);
    return { select() {
      let rows = [...tables[table] || []]; let start = 0; let end = Infinity;
      const query: Query = {
        eq(column, value) { rows = rows.filter(item => item[column] === value); return query; },
        in(column, values) { rows = rows.filter(item => values.includes(String(item[column]))); return query; },
        order(column) { rows.sort((a, b) => String(a[column]).localeCompare(String(b[column]))); return query; },
        range(from, to) { start = from; end = to; return query; },
        async maybeSingle() { return { data: rows[0] || null, error: null }; },
        then(resolve, reject) {
          return Promise.resolve({ data: rows.slice(start, end + 1), error: failPage && table === "tarefas" && start >= 1000 ? new Error("db details") : null }).then(resolve, reject);
        },
      };
      return query;
    } };
  } };
  return { db, reads };
}
const response = (status: number, value: unknown) => Response.json(value, { status });
const error = (status: number, code: string, message: string) => response(status, { code, message });
const request = (team = "fiscal") => new Request(`https://example.org/ampro-integration/tasks?team=${team}&competence=2026-11`);

test("receptor liga delegado ao ID do AM PRO e analista ao e-mail, sem usar e-mail de notificação", () => {
  const members = [{ executor: "DAVI", executor_usuario: "davi", executor_equipe: "fiscal" }];
  assert.equal(tarefaParaAmPro(row(), new Map(), members, "fiscal").assignee.amproUserId, "davi");
  const linked = tarefaParaAmPro(row({ responsavel_id: "profile", notificar_email: "other@example.org" }), new Map([["profile", { email: "fiscal5@projecont.com.br", nome: "PH" }]]), [], "beta");
  assert.equal(linked.assignee.amproUserId, "ph");
  assert.equal(linked.assignee.email, "fiscal5@projecont.com.br");
  assert.equal(JSON.stringify(linked).includes("other@example.org"), false);
});
test("receptor não distribui nome ambíguo nem substitui perfil desconhecido pelo delegado digitado", () => {
  const ambiguous = tarefaParaAmPro(row(), new Map(), [
    { executor: "Davi", executor_usuario: "davi", executor_equipe: "fiscal" },
    { executor: "Davi", executor_usuario: "davi2", executor_equipe: "fiscal" },
  ], "fiscal");
  assert.deepEqual(ambiguous.assignee, { amproUserId: null, email: null, name: null });
  assert.deepEqual(tarefaParaAmPro(row({ responsavel_id: "missing" }), new Map(), [], "fiscal").assignee,
    { amproUserId: null, email: null, name: null });
});
test("receptor inclui pendências antigas, exclui futuras e mantém encerradas só no período", () => {
  const convert = (extra: Row) => tarefaParaAmPro(row(extra), new Map(), [], "fiscal");
  assert.equal(tarefaNoPeriodo(convert({ prazo: "2026-10-01" }), "2026-11"), true);
  assert.equal(tarefaNoPeriodo(convert({ prazo: "2026-12-01" }), "2026-11"), false);
  assert.equal(tarefaNoPeriodo(convert({ prazo: null }), "2026-11"), true);
  assert.equal(tarefaNoPeriodo(convert({ status: "concluida", prazo: "2026-10-01" }), "2026-11"), false);
  assert.equal(tarefaNoPeriodo(convert({ status: "concluida" }), "2026-11"), true);
});
test("receptor pagina mais de mil tarefas e restringe a equipe antes de projetar os dados", async () => {
  const tables = { ampro_equipes: [{ ampro_id: "fiscal", equipe_id: "alpha-uuid" }],
    tarefas: [...Array.from({ length: 1001 }, (_, i) => row({ id: `t${i}` })), row({ id: "beta-private", equipe_id: "beta-uuid", titulo: "Privado Beta" })],
    ampro_obrigacoes: [], perfis: [] };
  const { db } = database(tables); const logs: unknown[] = [];
  const result = await tratarTarefas(request(), db, { equipes: ["fiscal"] }, async (...args) => { logs.push(args); }, response, error);
  assert.equal(result.status, 200);
  const body = await result.json(); assert.equal(body.tasks.length, 1001);
  assert.equal(JSON.stringify(body).includes("Privado Beta"), false);
  assert.deepEqual(logs, [[200, "fiscal", 1001]]);
});
test("credencial sem equipe é recusada sem consultar tarefas", async () => {
  const { db, reads } = database({});
  const result = await tratarTarefas(request("beta"), db, { equipes: ["fiscal"] }, async () => {}, response, error);
  assert.equal(result.status, 403); assert.equal(reads.length, 0);
});
test("falha na segunda página não retorna lista vazia nem sucesso parcial", async () => {
  const { db } = database({ ampro_equipes: [{ ampro_id: "fiscal", equipe_id: "alpha-uuid" }], tarefas: Array.from({ length: 1001 }, (_, i) => row({ id: `t${i}` })), ampro_obrigacoes: [] }, true);
  const result = await tratarTarefas(request(), db, { equipes: ["fiscal"] }, async () => {}, response, error);
  assert.equal(result.status, 500); assert.equal("tasks" in await result.json(), false);
});
