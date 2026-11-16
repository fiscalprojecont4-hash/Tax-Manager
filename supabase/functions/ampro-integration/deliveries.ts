// Copiar para supabase/functions/ampro-integration/deliveries.ts no Tax Manager.
// POST /deliveries: placar mensal de entregas por usuário enviado pelo AM PRO (ex.: André 46/192).
// Importado apenas pelo receptor após autenticar a chave e aplicar o limite de chamadas.
type Row = Record<string, unknown>;
type Database = {
  from: (table: string) => { select: (columns: string) => { eq: (column: string, value: unknown) => { maybeSingle: () => PromiseLike<{ data: Row | null; error: unknown }> } } };
  rpc: (fn: string, args: Row) => PromiseLike<{ data: unknown; error: unknown }>;
};

export const LIMITE_BYTES_ENTREGAS = 512 * 1024;
const COUNTS = ["activities", "delivered", "onTime", "late", "undated", "open"] as const;
type Counts = Record<(typeof COUNTS)[number], number>;
export type UsuarioEntregas = Counts & { userId: string | null; name: string; score: string };
export type EntregasAmPro = {
  team: { id: string }; competence: string; revision: string;
  sourceUpdatedAt: { cycle: string; events: string };
  totals: Counts & { score: string }; users: UsuarioEntregas[];
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const isCount = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 100000;
const isInstant = (value: unknown) => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));

function counts(value: unknown): Counts {
  const row = (value || {}) as Row;
  if (!COUNTS.every(key => isCount(row[key]))) throw new Error("Contagem inválida");
  const result = Object.fromEntries(COUNTS.map(key => [key, row[key] as number])) as Counts;
  // atividades = entregues + abertas; entregues = no prazo + atrasadas + sem data.
  if (result.activities !== result.delivered + result.open || result.delivered !== result.onTime + result.late + result.undated) {
    throw new Error("Contagem inconsistente");
  }
  if (text(row.score) !== `${result.onTime}/${result.activities}`) throw new Error("Placar inconsistente");
  return result;
}

/** Valida o corpo inteiro; qualquer falha recusa o envio sem gravar nada. */
export function validarEntregas(body: unknown): EntregasAmPro {
  const b = (body || {}) as Row;
  const team = (b.team || {}) as Row;
  const source = (b.sourceUpdatedAt || {}) as Row;
  if (b.schemaVersion !== 1 || b.source !== "ampro" || b.kind !== "user-deliveries") throw new Error("Contrato inválido");
  if (!["fiscal", "omega", "beta"].includes(text(team.id))) throw new Error("Equipe inválida");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text(b.competence))) throw new Error("Competência inválida");
  if (!/^[0-9a-f]{64}$/.test(text(b.revision))) throw new Error("Revisão inválida");
  if (!isInstant(source.cycle) || !isInstant(source.events)) throw new Error("Data de origem inválida");
  if (!Array.isArray(b.users) || b.users.length > 500) throw new Error("Usuários inválidos");
  const keys = new Set<string>();
  const users = b.users.map(value => {
    const row = (value || {}) as Row;
    const userId = row.userId === null ? null : text(row.userId);
    const name = text(row.name);
    if (userId === "" || !name || name.length > 200 || (userId && userId.length > 120)) throw new Error("Usuário inválido");
    const key = usuarioChave(userId, name);
    if (keys.has(key)) throw new Error("Usuário duplicado");
    keys.add(key);
    return { userId, name, ...counts(row), score: text(row.score) };
  });
  const totals = counts(b.totals);
  for (const key of COUNTS) {
    if (users.reduce((sum, user) => sum + user[key], 0) !== totals[key]) throw new Error("Totais não conferem");
  }
  return {
    team: { id: text(team.id) }, competence: text(b.competence), revision: text(b.revision),
    sourceUpdatedAt: { cycle: text(source.cycle), events: text(source.events) },
    totals: { ...totals, score: text((b.totals as Row).score) }, users,
  };
}

/** Chave estável da linha: ID do AM PRO quando existe; senão o nome normalizado. */
export function usuarioChave(userId: string | null, name: string) {
  if (userId) return `id:${userId}`;
  return `nome:${name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ")}`;
}

export async function tratarEntregas(request: Request, db: Database, key: { equipes: string[] },
  register: (http: number, team?: string | null, count?: number) => PromiseLike<unknown>,
  response: (status: number, body: unknown) => Response,
  error: (status: number, code: string, message: string) => Response,
) {
  if (Number(request.headers.get("content-length") ?? 0) > LIMITE_BYTES_ENTREGAS) {
    await register(413); return error(413, "payload_too_large", "Corpo acima do limite.");
  }
  let payload: EntregasAmPro;
  try {
    const raw = await request.text();
    if (raw.length > LIMITE_BYTES_ENTREGAS) { await register(413); return error(413, "payload_too_large", "Corpo acima do limite."); }
    payload = validarEntregas(JSON.parse(raw));
  } catch {
    await register(400); return error(400, "invalid_payload", "Corpo de entregas inválido.");
  }
  const team = payload.team.id;
  if (request.headers.get("idempotency-key") !== payload.revision) {
    await register(400, team); return error(400, "invalid_payload", "Idempotency-Key deve ser igual a revision.");
  }
  if (!key.equipes.includes(team)) { await register(403, team); return error(403, "forbidden", "Equipe fora do escopo da credencial."); }
  try {
    const mapped = await db.from("ampro_equipes").select("equipe_id").eq("ampro_id", team).maybeSingle();
    if (mapped.error) throw new Error("Falha de leitura");
    if (!mapped.data) { await register(403, team); return error(403, "forbidden", "Equipe sem vínculo no Tax Manager."); }
    const origem = [payload.sourceUpdatedAt.cycle, payload.sourceUpdatedAt.events]
      .map(value => new Date(value).toISOString()).sort().at(-1);
    // Grava resumo + usuários numa única transação (função SQL) e devolve o status.
    const saved = await db.rpc("ampro_gravar_entregas", {
      p_equipe_id: mapped.data.equipe_id, p_ampro_equipe: team, p_competencia: payload.competence,
      p_revisao: payload.revision, p_origem_em: origem, p_totais: payload.totals,
      p_usuarios: payload.users.map(user => ({ ...user, key: usuarioChave(user.userId, user.name) })),
    });
    if (saved.error) throw new Error("Falha de gravação");
    if (saved.data === "stale") { await register(409, team); return error(409, "stale_snapshot", "Já existe placar mais recente para esta equipe e competência."); }
    await register(200, team, payload.users.length);
    return response(200, { accepted: true, teamId: team, competence: payload.competence, revision: payload.revision });
  } catch {
    await register(500, team);
    return error(500, "internal_error", "Não foi possível gravar as entregas. O espelho continua na rota própria.");
  }
}
