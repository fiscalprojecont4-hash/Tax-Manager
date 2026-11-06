// Copiar para supabase/functions/ampro-integration/refresh.ts; chamado após autenticar a chave existente.
type Rpc = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function tratarRefresh(request: Request, db: Rpc, key: { id: string },
  register: (http: number) => PromiseLike<unknown>, response: (status: number, body: unknown) => Response,
  error: (status: number, code: string, message: string) => Response,
) {
  const route = new URL(request.url).pathname.split("/").pop();
  if (route === "refresh-requests") {
    const result = await db.rpc("ampro_claim_refresh", { p_key: key.id });
    if (result.error) { await register(503); return error(503, "queue_unavailable", "Fila de atualização indisponível."); }
    await register(200); // Mantém a contagem do limite de chamadas já aplicada pelo receptor.
    return response(200, result.data);
  }
  if (Number(request.headers.get("content-length") || 0) > 4096) return error(413, "payload_too_large", "Resultado acima do limite.");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 4096) return error(413, "payload_too_large", "Resultado acima do limite.");
  let body;
  try { body = JSON.parse(raw); } catch { return error(400, "invalid_payload", "Resultado inválido."); }
  if (!body || !uuid(body.id) || !uuid(body.leaseId) || typeof body.ok !== "boolean"
    || (body.ok ? typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision) : !["source_unavailable", "sync_failed"].includes(body.errorCode))) {
    return error(400, "invalid_payload", "Resultado inválido.");
  }
  const result = await db.rpc("ampro_finish_refresh", { p_key: key.id, p_id: body.id, p_lease: body.leaseId,
    p_ok: body.ok, p_revision: body.ok ? body.revision : null, p_error: body.ok ? null : body.errorCode });
  if (result.error) { await register(409); return error(409, "invalid_receipt", "Reserva ou recibo de espelho não confirmado."); }
  await register(200);
  return response(200, result.data);
}
