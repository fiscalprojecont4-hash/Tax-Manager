import assert from "node:assert/strict";
import { test } from "node:test";
import { tratarRefresh } from "./refresh.ts";

const ID = "f32fa7e0-2b03-4837-beab-e10cf7466cbb", LEASE = "0aab6dde-226a-4521-8b0e-f64ee02586b0", REV = "a".repeat(64);
const response = (status: number, body: unknown) => Response.json(body, { status });
const error = (status: number, code: string, message: string) => Response.json({ code, message }, { status });
function setup(result: { data?: unknown; error?: unknown } = { data: { ok: 1 } }) {
  const calls: [string, Record<string, unknown>][] = []; const logs: number[] = [];
  return { calls, logs, db: { rpc: async (n: string, a: Record<string, unknown>) => { calls.push([n, a]); return { data: result.data ?? null, error: result.error ?? null }; } },
    register: async (h: number) => { logs.push(h); } };
}
const get = () => new Request("https://x.org/ampro-integration/refresh-requests");
const post = (body: unknown) => new Request("https://x.org/ampro-integration/refresh-result", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

test("refresh-requests reserva pela própria chave e registra 200", async () => {
  const s = setup(); const r = await tratarRefresh(get(), s.db, { id: "k" }, s.register, response, error);
  assert.equal(r.status, 200); assert.deepEqual(s.calls, [["ampro_claim_refresh", { p_key: "k" }]]); assert.deepEqual(s.logs, [200]);
});
test("falha na fila vira 503 sem vazar detalhes", async () => {
  const s = setup({ error: new Error("detalhe interno") }); const r = await tratarRefresh(get(), s.db, { id: "k" }, s.register, response, error);
  assert.equal(r.status, 503); assert.equal(JSON.stringify(await r.json()).includes("detalhe"), false);
});
test("refresh-result valida o corpo antes de chamar o banco", async () => {
  for (const body of ["{", {}, { id: "x", leaseId: LEASE, ok: true, revision: REV }, { id: ID, leaseId: LEASE, ok: true, revision: "curta" },
    { id: ID, leaseId: LEASE, ok: false, errorCode: "outro" }, { id: ID, leaseId: LEASE, ok: "sim" }]) {
    const s = setup(); const r = await tratarRefresh(post(body), s.db, { id: "k" }, s.register, response, error);
    assert.equal(r.status, 400); assert.equal(s.calls.length, 0);
  }
});
test("refresh-result grande demais é recusado (413)", async () => {
  const s = setup(); const r = await tratarRefresh(post("x".repeat(5000)), s.db, { id: "k" }, s.register, response, error);
  assert.equal(r.status, 413); assert.equal(s.calls.length, 0);
});
test("refresh-result aceito repassa chave, reserva e revisão", async () => {
  const s = setup(); const r = await tratarRefresh(post({ id: ID, leaseId: LEASE, ok: true, revision: REV }), s.db, { id: "k" }, s.register, response, error);
  assert.equal(r.status, 200);
  assert.deepEqual(s.calls[0], ["ampro_finish_refresh", { p_key: "k", p_id: ID, p_lease: LEASE, p_ok: true, p_revision: REV, p_error: null }]);
});
test("recibo ausente ou reserva inválida = 409", async () => {
  const s = setup({ error: new Error("x") }); const r = await tratarRefresh(post({ id: ID, leaseId: LEASE, ok: true, revision: REV }), s.db, { id: "k" }, s.register, response, error);
  assert.equal(r.status, 409); assert.deepEqual(s.logs, [409]);
});
