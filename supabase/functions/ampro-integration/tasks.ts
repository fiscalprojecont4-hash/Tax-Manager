// Copiar para supabase/functions/ampro-integration/tasks.ts no Tax Manager.
// Importado apenas pelo receptor após autenticar a chave e aplicar o limite de chamadas.
type Row = Record<string, unknown>;
type Query = PromiseLike<{ data: Row[] | null; error: unknown }> & {
  eq: (column: string, value: unknown) => Query; in: (column: string, values: string[]) => Query;
  order: (column: string) => Query; range: (from: number, to: number) => Query;
  maybeSingle: () => PromiseLike<{ data: Row | null; error: unknown }>;
};
type Database = { from: (table: string) => { select: (columns: string) => Query } };
export const TAREFAS_COLUNAS = "id,titulo,tipo,prioridade,status,responsavel_id,delegado_nome,prazo,observacoes,criado_em,concluida_em,atualizado_em";
export const MEMBROS_COLUNAS = "ciclo,externo_id,executor,executor_usuario,executor_equipe";
export const PERFIS_COLUNAS = "id,nome,email";
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const normalized = (value: unknown) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
const statusMap: Record<string, string> = { pendente: "pending", andamento: "in_progress", impedimento: "impediment", concluida: "done", cancelada: "cancelled" };
const priorityMap: Record<string, string> = { baixa: "low", normal: "normal", alta: "high", critica: "critical" };
const bindings: Record<string, string> = {
  "fiscal6@projecont.com.br": "jhonathan", "fiscal5@projecont.com.br": "ph", "fiscal4@projecont.com.br": "marcel", "gerencia.fiscal@projecont.com.br": "wendel",
};
function day(value: unknown) {
  if (value == null || value === "") return null;
  const result = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) throw new Error("Data inválida");
  return result;
}
export function tarefaParaAmPro(row: Row, profiles: Map<string, Row>, members: Row[], team: string) {
  const status = statusMap[text(row.status)];
  const priority = priorityMap[text(row.prioridade)];
  if (!text(row.id) || !text(row.titulo) || !status || !priority) throw new Error("Tarefa inválida");
  const name = text(row.delegado_nome);
  let assignee: { amproUserId: string | null; email: string | null; name: string | null };
  if (text(row.responsavel_id)) {
    const profile = profiles.get(text(row.responsavel_id));
    const email = text(profile?.email).toLowerCase();
    // Um ID de perfil desconhecido não pode redistribuir a tarefa pelo nome digitado.
    assignee = email ? { amproUserId: bindings[email] || null, email, name: text(profile?.nome) || name || null }
      : { amproUserId: null, email: null, name: null };
  } else {
    const ids = new Set(members.filter(member => normalized(member.executor) === normalized(name)
      && (!text(member.executor_equipe) || text(member.executor_equipe) === team))
      .map(member => text(member.executor_usuario)).filter(Boolean));
    assignee = { amproUserId: ids.size === 1 ? [...ids][0] : null, email: null, name: ids.size > 1 ? null : name || null };
  }
  return { id: text(row.id), title: text(row.titulo), description: text(row.observacoes), category: text(row.tipo), priority, status,
    dueDate: day(row.prazo), createdAt: day(row.criado_em), completedAt: day(row.concluida_em), updatedAt: day(row.atualizado_em), assignee };
}
export function tarefaNoPeriodo(task: ReturnType<typeof tarefaParaAmPro>, competence: string) {
  const [year, month] = competence.split("-").map(Number);
  const start = `${competence}-01`;
  const end = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  if (!["done", "cancelled"].includes(task.status)) return task.dueDate ? task.dueDate < end : !task.createdAt || task.createdAt < end;
  const date = task.dueDate || task.completedAt;
  return Boolean(date && date >= start && date < end);
}
// `order` precisa ser uma chave única da tabela dentro da equipe, para a paginação não repetir nem pular linhas.
async function all(db: Database, table: string, columns: string, teamId: string, order: string[]) {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = db.from(table).select(columns).eq("equipe_id", teamId);
    for (const column of order) query = query.order(column);
    const result = await query.range(offset, offset + 999);
    if (result.error) throw new Error("Falha de leitura");
    rows.push(...result.data || []);
    if ((result.data || []).length < 1000) return rows;
  }
}
export async function tratarTarefas(request: Request, db: Database, key: { equipes: string[] },
  register: (http: number, team?: string | null, count?: number) => PromiseLike<unknown>,
  response: (status: number, body: unknown) => Response,
  error: (status: number, code: string, message: string) => Response,
) {
  const url = new URL(request.url);
  const team = url.searchParams.get("team") || "";
  const competence = url.searchParams.get("competence") || "";
  if (!["fiscal", "omega", "beta"].includes(team) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)) {
    await register(400); return error(400, "invalid_payload", "Informe team e competence (AAAA-MM).");
  }
  if (!key.equipes.includes(team)) { await register(403, team); return error(403, "forbidden", "Equipe fora do escopo da credencial."); }
  try {
    const mapped = await db.from("ampro_equipes").select("equipe_id").eq("ampro_id", team).maybeSingle();
    if (mapped.error) throw new Error("Falha de leitura");
    if (!mapped.data) { await register(403, team); return error(403, "forbidden", "Equipe sem vínculo no Tax Manager."); }
    const teamId = text(mapped.data.equipe_id);
    const [rows, members] = await Promise.all([
      all(db, "tarefas", TAREFAS_COLUNAS, teamId, ["id"]),
      // ampro_obrigacoes não tem coluna `id`: a chave é (equipe_id, ciclo, externo_id).
      all(db, "ampro_obrigacoes", MEMBROS_COLUNAS, teamId, ["ciclo", "externo_id"]),
    ]);
    const ids = [...new Set(rows.map(row => text(row.responsavel_id)).filter(Boolean))];
    const profiles = new Map<string, Row>();
    for (let offset = 0; offset < ids.length; offset += 200) {
      const result = await db.from("perfis").select(PERFIS_COLUNAS).in("id", ids.slice(offset, offset + 200));
      if (result.error) throw new Error("Falha de leitura");
      for (const profile of result.data || []) profiles.set(text(profile.id), profile);
    }
    const tasks = rows.map(row => tarefaParaAmPro(row, profiles, members, team)).filter(task => tarefaNoPeriodo(task, competence));
    tasks.sort((a, b) => (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31") || a.id.localeCompare(b.id));
    await register(200, team, tasks.length);
    return response(200, { schemaVersion: 1, team: { id: team }, competence, tasks });
  } catch {
    await register(500, team);
    return error(500, "internal_error", "Não foi possível ler as tarefas. O calendário e as validações continuam em rotas próprias.");
  }
}
