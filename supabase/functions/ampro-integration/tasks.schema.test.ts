// Garante que a rota /tasks só pede colunas que existem no banco (supabase/schema.sql).
// Os testes de tasks.test.ts usam um banco falso, que aceitaria qualquer nome de coluna.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { TAREFAS_COLUNAS, MEMBROS_COLUNAS, PERFIS_COLUNAS } from "./tasks.ts";

const schema = readFileSync(new URL("../../schema.sql", import.meta.url), "utf8");
function colunas(tabela: string) {
  const inicio = schema.indexOf(`create table if not exists public.${tabela} (`);
  assert.notEqual(inicio, -1, `tabela ${tabela} não encontrada`);
  const corpo = schema.slice(inicio, schema.indexOf("\n);", inicio));
  const base = corpo.split("\n").slice(1).map((l) => l.trim().match(/^([a-z_]+)\s+(?:uuid|text|date|timestamptz|boolean|integer|jsonb|bigint)\b/)?.[1]);
  // colunas acrescentadas depois com `alter table ... add column if not exists`
  const extras = [...schema.matchAll(new RegExp(`alter table (?:if exists )?public\\.${tabela}\\s+add column if not exists ([a-z_]+)`, "g"))].map((m) => m[1]);
  return new Set([...base, ...extras].filter(Boolean));
}
const lista = (s: string) => s.split(",");

test("colunas lidas em tarefas, ampro_obrigacoes e perfis existem no schema", () => {
  for (const [tabela, pedidas] of [["tarefas", TAREFAS_COLUNAS], ["ampro_obrigacoes", MEMBROS_COLUNAS], ["perfis", PERFIS_COLUNAS]] as const) {
    const existentes = colunas(tabela);
    for (const c of lista(pedidas)) assert.ok(existentes.has(c), `${tabela}.${c} não existe no schema`);
  }
});
test("ampro_obrigacoes não tem coluna id (a paginação usa ciclo + externo_id)", () => {
  assert.equal(colunas("ampro_obrigacoes").has("id"), false);
  assert.equal(lista(MEMBROS_COLUNAS).includes("id"), false);
});
