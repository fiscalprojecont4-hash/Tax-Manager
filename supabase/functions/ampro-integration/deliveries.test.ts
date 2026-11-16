import assert from "node:assert/strict";
import { test } from "node:test";
import { tratarEntregas, usuarioChave, validarEntregas } from "./deliveries.ts";

const REV = "a".repeat(64);
const user = (extra = {}) => ({ userId: "andre", name: "André", activities: 192, delivered: 60, onTime: 46, late: 10, undated: 4, open: 132, score: "46/192", ...extra });
const body = (extra: Record<string, unknown> = {}) => ({ schemaVersion: 1, source: "ampro", kind: "user-deliveries", team: { id: "fiscal" }, competence: "2026-11", revision: REV,
  sourceUpdatedAt: { cycle: "2026-11-16T12:00:00Z", events: "2026-11-16T13:00:00Z" }, totals: user(), users: [user()], ...extra });
const response = (status: number, value: unknown) => Response.json(value, { status });
const error = (status: number, code: string, message: string) => Response.json({ code, message }, { status });
function setup(rpc: { data?: unknown; error?: unknown } = { data: "accepted" }, mapped: unknown = { equipe_id: "alpha-uuid" }) {
  const calls: [string, Record<string, unknown>][] = []; const logs: number[] = [];
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mapped as Record<string, unknown> | null, error: null }) }) }) }),
    rpc: async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return { data: rpc.data ?? null, error: rpc.error ?? null }; },
  };
  return { db, calls, logs, register: async (h: number) => { logs.push(h); } };
}
const req = (payload: unknown, key = REV) => new Request("https://x.org/ampro-integration/deliveries", { method: "POST", headers: { "idempotency-key": key }, body: typeof payload === "string" ? payload : JSON.stringify(payload) });
const run = (s: ReturnType<typeof setup>, r: Request, equipes = ["fiscal"]) => tratarEntregas(r, s.db, { equipes }, s.register, response, error);

test("corpo válido grava pela função SQL, com chave estável por usuário", async () => {
  const s = setup(); const r = await run(s, req(body()));
  assert.equal(r.status, 200); assert.equal(s.calls[0][0], "ampro_gravar_entregas");
  assert.equal(s.calls[0][1].p_equipe_id, "alpha-uuid"); assert.equal(s.calls[0][1].p_competencia, "2026-11");
  assert.equal((s.calls[0][1].p_usuarios as { key: string }[])[0].key, "id:andre");
  assert.equal(usuarioChave(null, "José  Ávila"), "nome:jose avila");
});
test("mesma revisão repetida (duplicate) também responde 200", async () => {
  const s = setup({ data: "duplicate" }); assert.equal((await run(s, req(body()))).status, 200);
});
test("placar mais antigo que o gravado = 409", async () => {
  const s = setup({ data: "stale" }); assert.equal((await run(s, req(body()))).status, 409); assert.deepEqual(s.logs, [409]);
});
test("contagens que não fecham, totais que não conferem ou placar errado = 400 sem gravar", async () => {
  for (const b of [body({ totals: user({ open: 1 }) }), body({ users: [user({ score: "1/1" })] }), body({ users: [user(), user({ userId: "outro", name: "Outro" })] }),
    body({ revision: "curta" }), body({ team: { id: "x" } }), body({ competence: "2026-13" }), "{", body({ kind: "outro" })]) {
    const s = setup(); const r = await run(s, req(b, REV)); assert.equal(r.status, 400); assert.equal(s.calls.length, 0);
  }
});
test("Idempotency-Key diferente da revisão = 400", async () => {
  const s = setup(); assert.equal((await run(s, req(body(), "b".repeat(64)))).status, 400); assert.equal(s.calls.length, 0);
});
test("equipe fora do escopo da chave = 403; sem vínculo no Tax Manager = 403", async () => {
  const s = setup(); assert.equal((await run(s, req(body()), ["omega"])).status, 403); assert.equal(s.calls.length, 0);
  const s2 = setup({ data: "accepted" }, null); assert.equal((await run(s2, req(body()))).status, 403);
});
test("corpo grande demais = 413", async () => {
  const s = setup(); assert.equal((await run(s, req("x".repeat(600 * 1024)))).status, 413);
});
test("falha de gravação = 500 sem vazar detalhes", async () => {
  const s = setup({ error: new Error("detalhe interno") }); const r = await run(s, req(body()));
  assert.equal(r.status, 500); assert.equal(JSON.stringify(await r.json()).includes("detalhe"), false);
});
test("validarEntregas recusa usuário duplicado", () => {
  assert.throws(() => validarEntregas(body({ totals: user({ activities: 384, delivered: 120, onTime: 92, late: 20, undated: 8, open: 264, score: "92/384" }), users: [user(), user()] })));
});
