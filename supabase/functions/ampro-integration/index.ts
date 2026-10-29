// Edge Function "ampro-integration" — receptor do contrato HTTP v1 do AM PRO (CONTRATO-AMPRO.md).
//
//   POST /ampro-integration/mirror    AM PRO -> Tax Manager: snapshot operacional de uma equipe e competência
//   GET  /ampro-integration/calendar  Tax Manager -> AM PRO: calendário fiscal aprovado de uma competência
//   GET  /ampro-integration/validations  Tax Manager -> AM PRO: validações e achados de uma equipe e competência
//
// Autenticação: Authorization: Bearer <segredo dedicado da integração> (NÃO é um JWT do Supabase).
// Por isso a função é publicada com verify_jwt = false (supabase/config.toml) e valida o segredo aqui:
// o SHA-256 do segredo é procurado em public.ampro_chaves (chave ativa) e a chave só grava nas equipes
// listadas nela. O segredo nunca vai para o navegador, o GitHub Pages ou os logs.
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente dentro da função.

export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_EMPRESAS = 5000;
export const MAX_OBRIGACOES = 50000;
export const LIMITE_POR_MINUTO = 300;
const PAGINA = 1000;

export const EQUIPES_AMPRO = ['fiscal', 'omega', 'beta'] as const;
export const ESTADOS = ['pending', 'in_progress', 'review', 'done', 'impediment', 'not_applicable'] as const;
const SEGREDO_RE = /^[A-Za-z0-9_-]{43,}$/;
const COMPETENCIA_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const REVISAO_RE = /^[0-9a-f]{64}$/;

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim());

function dataHora(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function dataSimples(v: unknown): string | null | undefined {
  const s = str(v);
  if (!s) return null; // preserva a ausência de prazo, sem inventar data
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : undefined;
}

export interface Espelho {
  team_id: string;
  competence: string;
  revision: string;
  companies_version: string;
  cycle_version: string;
  companies: Record<string, unknown>[];
  obligations: Record<string, unknown>[];
}

/** Valida o corpo do POST /mirror. Qualquer problema recusa o snapshot inteiro (ele é aplicado em bloco). */
export function validarEspelho(corpo: unknown): Espelho | { erro: string } {
  if (!ehObjeto(corpo)) return { erro: 'O corpo deve ser um objeto JSON.' };
  if (corpo.schemaVersion !== 1) return { erro: 'schemaVersion deve ser 1.' };
  if (corpo.source !== 'ampro') return { erro: 'source deve ser "ampro".' };
  if (corpo.mode !== 'snapshot') return { erro: 'mode deve ser "snapshot".' };
  const team = corpo.team;
  if (!ehObjeto(team) || !(EQUIPES_AMPRO as readonly string[]).includes(str(team.id))) return { erro: 'team.id deve ser fiscal, omega ou beta.' };
  if (typeof team.name !== 'string') return { erro: 'team.name é obrigatório.' };
  const competence = str(corpo.competence);
  if (!COMPETENCIA_RE.test(competence)) return { erro: 'competence deve ser AAAA-MM (mês de 01 a 12).' };
  const revision = str(corpo.revision).toLowerCase();
  if (!REVISAO_RE.test(revision)) return { erro: 'revision deve ser um SHA-256 hexadecimal.' };
  const versoes = corpo.sourceUpdatedAt;
  if (!ehObjeto(versoes)) return { erro: 'sourceUpdatedAt é obrigatório.' };
  const companiesVersion = dataHora(versoes.companies);
  const cycleVersion = dataHora(versoes.cycle);
  if (!companiesVersion || !cycleVersion) return { erro: 'sourceUpdatedAt.companies e sourceUpdatedAt.cycle devem ser data/hora válidas.' };
  if (!Array.isArray(corpo.companies) || !Array.isArray(corpo.obligations)) return { erro: 'companies e obligations devem ser listas.' };
  if (corpo.companies.length > MAX_EMPRESAS || corpo.obligations.length > MAX_OBRIGACOES) return { erro: 'Quantidade de itens acima do limite.' };

  const empresas: Record<string, unknown>[] = [];
  const idsEmpresas = new Set<string>();
  for (const [i, x] of corpo.companies.entries()) {
    if (!ehObjeto(x)) return { erro: `companies[${i}] deve ser um objeto.` };
    const id = str(x.id);
    if (!id) return { erro: `companies[${i}]: id é obrigatório.` };
    if (idsEmpresas.has(id)) return { erro: `companies[${i}]: id repetido (${id}).` };
    if (x.active !== undefined && typeof x.active !== 'boolean') return { erro: `companies[${i}]: active deve ser booleano.` };
    const atualizado = str(x.updatedAt) ? dataHora(x.updatedAt) : null;
    if (str(x.updatedAt) && !atualizado) return { erro: `companies[${i}]: updatedAt inválido.` };
    idsEmpresas.add(id);
    empresas.push({
      id, name: str(x.name), displayName: str(x.displayName), cnpj: str(x.cnpj), state: str(x.state),
      stateRegistration: str(x.stateRegistration), alterdataCode: str(x.alterdataCode),
      taxation: str(x.taxation), regime: str(x.regime), active: x.active !== false, responsible: str(x.responsible), updatedAt: atualizado,
    });
  }

  const obrigacoes: Record<string, unknown>[] = [];
  const idsObrigacoes = new Set<string>();
  for (const [i, x] of corpo.obligations.entries()) {
    if (!ehObjeto(x)) return { erro: `obligations[${i}] deve ser um objeto.` };
    const id = str(x.id);
    if (!id) return { erro: `obligations[${i}]: id é obrigatório.` };
    if (idsObrigacoes.has(id)) return { erro: `obligations[${i}]: id repetido (${id}).` };
    const companyId = str(x.companyId);
    if (!companyId || !idsEmpresas.has(companyId)) return { erro: `obligations[${i}]: companyId ausente ou fora do payload.` };
    const status = str(x.status);
    if (!(ESTADOS as readonly string[]).includes(status)) return { erro: `obligations[${i}]: status inválido (${ESTADOS.join(', ')}).` };
    const dueDate = dataSimples(x.dueDate);
    if (dueDate === undefined) return { erro: `obligations[${i}]: dueDate deve ser AAAA-MM-DD ou vazio.` };
    const atualizado = str(x.updatedAt) ? dataHora(x.updatedAt) : null;
    if (str(x.updatedAt) && !atualizado) return { erro: `obligations[${i}]: updatedAt inválido.` };
    idsObrigacoes.add(id);
    obrigacoes.push({
      id, companyId, taskKey: str(x.taskKey), taskLabel: str(x.taskLabel), competence: str(x.competence),
      responsible: str(x.responsible), executor: str(x.executor),
      executorUserId: str(x.executorUserId) || null, executorTeamId: str(x.executorTeamId) || null,
      status, statusLabel: str(x.statusLabel), dueDate, updatedAt: atualizado,
    });
  }

  return {
    team_id: str(team.id), competence, revision, companies_version: companiesVersion, cycle_version: cycleVersion,
    companies: empresas, obligations: obrigacoes,
  };
}

/** SHA-256 em hexadecimal (é o que fica guardado em ampro_chaves.hash). */
export async function hashDoSegredo(segredo: string): Promise<string> {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(segredo)));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Primeiro e último dia (exclusivo) da competência AAAA-MM. */
export function intervaloDaCompetencia(competencia: string): { de: string; ate: string } {
  const [a, m] = competencia.split('-').map(Number);
  const prox = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
  return { de: `${competencia}-01`, ate: prox };
}

export function eventoDoCalendario(o: Record<string, unknown>) {
  return {
    id: String(o.id), title: String(o.titulo), dueDate: String(o.vencimento).slice(0, 10),
    status: o.status === 'aprovado' ? 'approved' : 'superseded', version: Number(o.versao),
    replacesId: o.substitui_id ? String(o.substitui_id) : null, authority: String(o.orgao), sourceUrl: String(o.fonte_url ?? ''),
  };
}

const STATUS_VALIDACAO: Record<string, string> = {
  pendente: 'pending', andamento: 'in_progress', impedimento: 'impediment', concluida: 'done', cancelada: 'cancelled',
};
const normNome = (v: unknown) => str(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const dia = (v: unknown) => { const t = str(v); return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null; };

export type EmpresaAmPro = { externo_id: string; cnpj: string };
/** Índice nome -> empresa do AM PRO, para ligar a validação à empresa pelo nome (sem acento/maiúscula). */
export function indiceDeEmpresas(linhas: Record<string, unknown>[]): Map<string, EmpresaAmPro> {
  const m = new Map<string, EmpresaAmPro>();
  for (const l of linhas) {
    const e = { externo_id: str(l.externo_id), cnpj: str(l.cnpj) };
    for (const n of [l.nome, l.nome_exibicao]) { const k = normNome(n); if (k && !m.has(k)) m.set(k, e); }
  }
  return m;
}

/** Uma validação do Tax Manager (aberta ou de um arquivo de virada de mês) no formato do contrato. */
export function validacaoParaAmPro(
  v: Record<string, unknown>, empresaNome: string, competencia: string, encerrada: boolean, empresas: Map<string, EmpresaAmPro>,
) {
  const emp = empresas.get(normNome(empresaNome));
  const checklist = Array.isArray(v.checklist) ? v.checklist as Record<string, unknown>[] : null;
  const pontos = Array.isArray(v.pontos) ? v.pontos as Record<string, unknown>[] : [];
  const retif = ehObjeto(v.retificadora) ? v.retificadora : null;
  return {
    id: str(v.id), companyId: emp?.externo_id ?? null, companyName: empresaNome, cnpj: emp?.cnpj || null,
    activity: str(v.atividade), analyst: str(v.analista) || null,
    status: STATUS_VALIDACAO[str(v.status)] ?? 'pending', closed: encerrada,
    checklist: {
      done: checklist ? checklist.filter((c) => c.done === true).length : Number(v.checklistFeitos ?? 0),
      total: checklist ? checklist.length : Number(v.checklistTotal ?? 0),
    },
    justification: str(v.justificativa), createdAt: dia(v.criadoEm), completedAt: dia(v.concluidaEm), updatedAt: dia(v.atualizadoEm),
    amends: retif ? { competence: str(retif.competencia) } : null,
    findings: pontos.map((p) => ({
      id: str(p.id), category: str(p.categoria), title: str(p.titulo), identified: str(p.identificado),
      reason: str(p.motivo), guidance: str(p.orientacao),
    })),
  };
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, idempotency-key',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};
const resp = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const erro = (status: number, codigo: string, mensagem: string) => resp(status, { error: codigo, message: mensagem });

// deno-lint-ignore no-explicit-any
type Cliente = any;
async function clientePadrao(): Promise<Cliente> {
  const { createClient } = await import('jsr:@supabase/supabase-js@2');
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** `criarCliente` existe só para os testes injetarem um banco de mentira. */
export async function tratar(req: Request, criarCliente: () => Promise<Cliente> = clientePadrao): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const rota = url.pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  const metodos: Record<string, string> = { mirror: 'POST', calendar: 'GET', validations: 'GET' };
  if (!(rota in metodos)) return erro(404, 'not_found', 'Rota inexistente. Use /mirror, /calendar ou /validations.');
  if (req.method !== metodos[rota]) return erro(405, 'method_not_allowed', `Use ${metodos[rota]} em /${rota}.`);

  const cab = req.headers.get('authorization') ?? '';
  const segredo = cab.toLowerCase().startsWith('bearer ') ? cab.slice(7).trim() : '';
  if (!SEGREDO_RE.test(segredo)) return erro(401, 'unauthorized', 'Credencial ausente ou inválida.');

  const sb = await criarCliente();
  const { data: chave, error: erroChave } = await sb.from('ampro_chaves')
    .select('id, equipes').eq('hash', await hashDoSegredo(segredo)).eq('ativa', true).maybeSingle();
  if (erroChave) return erro(500, 'internal_error', 'Não foi possível validar a credencial.');
  if (!chave) return erro(401, 'unauthorized', 'Credencial ausente, inválida ou revogada.');

  const registrar = (http: number, equipe: string | null = null, itens = 0) =>
    sb.from('ampro_log').insert({ chave_id: chave.id, operacao: rota, equipe, itens, http });

  const { count, error: erroContagem } = await sb.from('ampro_log').select('id', { count: 'exact', head: true })
    .eq('chave_id', chave.id).gte('criado_em', new Date(Date.now() - 60_000).toISOString());
  if (erroContagem) return erro(500, 'internal_error', 'Não foi possível verificar o limite de chamadas.');
  if ((count ?? 0) >= LIMITE_POR_MINUTO) { await registrar(429); return erro(429, 'rate_limited', 'Limite temporário de chamadas. Tente de novo em instantes.'); }
  await sb.from('ampro_chaves').update({ ultimo_uso: new Date().toISOString() }).eq('id', chave.id);

  if (rota === 'mirror') {
    const tamanho = Number(req.headers.get('content-length') ?? 0);
    if (tamanho > MAX_BYTES) { await registrar(413); return erro(413, 'payload_too_large', 'Payload acima do limite.'); }
    const bruto = await req.text();
    if (new TextEncoder().encode(bruto).length > MAX_BYTES) { await registrar(413); return erro(413, 'payload_too_large', 'Payload acima do limite.'); }
    let corpo: unknown;
    try { corpo = JSON.parse(bruto); } catch { await registrar(400); return erro(400, 'invalid_payload', 'Corpo inválido: envie JSON.'); }

    const v = validarEspelho(corpo);
    if ('erro' in v) { await registrar(400); return erro(400, 'invalid_payload', v.erro); }
    const chaveIdempotencia = (req.headers.get('idempotency-key') ?? '').trim().toLowerCase();
    if (chaveIdempotencia && chaveIdempotencia !== v.revision) { await registrar(400, v.team_id); return erro(400, 'invalid_payload', 'Idempotency-Key deve ser igual a revision.'); }
    if (!(chave.equipes as string[]).includes(v.team_id)) { await registrar(403, v.team_id); return erro(403, 'forbidden', 'Esta credencial não tem permissão para essa equipe.'); }

    const { data, error } = await sb.rpc('ampro_aplicar_espelho', { p: v });
    if (error) { await registrar(500, v.team_id); return erro(500, 'internal_error', 'Falha ao gravar o espelho. Nada foi confirmado.'); }
    if (data?.status === 'desatualizado') { await registrar(409, v.team_id); return erro(409, 'stale_snapshot', 'Snapshot anterior ao já aceito para esta equipe/competência.'); }
    if (data?.status === 'sem_equipe') { await registrar(403, v.team_id); return erro(403, 'forbidden', 'Equipe do AM PRO sem correspondente no Tax Manager.'); }
    if (data?.status !== 'aceito' && data?.status !== 'duplicado') { await registrar(500, v.team_id); return erro(500, 'internal_error', 'Resposta inesperada do banco.'); }
    await registrar(200, v.team_id, v.companies.length + v.obligations.length);
    return resp(200, { accepted: true, teamId: v.team_id, competence: v.competence, revision: v.revision });
  }

  if (rota === 'validations') {
    // GET /validations?team=fiscal&competence=AAAA-MM
    const time = url.searchParams.get('team') ?? '';
    const comp = url.searchParams.get('competence') ?? '';
    if (!(EQUIPES_AMPRO as readonly string[]).includes(time)) { await registrar(400); return erro(400, 'invalid_payload', 'team é obrigatório: fiscal, omega ou beta.'); }
    if (!COMPETENCIA_RE.test(comp)) { await registrar(400, time); return erro(400, 'invalid_payload', 'competence é obrigatório no formato AAAA-MM.'); }
    if (!(chave.equipes as string[]).includes(time)) { await registrar(403, time); return erro(403, 'forbidden', 'Esta credencial não tem permissão para essa equipe.'); }
    const { data: mapa, error: erroMapa } = await sb.from('ampro_equipes').select('equipe_id').eq('ampro_id', time).maybeSingle();
    if (erroMapa) { await registrar(500, time); return erro(500, 'internal_error', 'Falha ao ler a equipe.'); }
    if (!mapa) { await registrar(403, time); return erro(403, 'forbidden', 'Equipe do AM PRO sem correspondente no Tax Manager.'); }

    const ler = async (tabela: string, colunas: string, filtros: Record<string, string>) => {
      const out: Record<string, unknown>[] = [];
      for (let pagina = 0; ; pagina++) {
        let q = sb.from(tabela).select(colunas);
        for (const [c, v] of Object.entries(filtros)) q = q.eq(c, v);
        const { data, error } = await q.range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
        if (error) throw error;
        out.push(...(data ?? []));
        if ((data ?? []).length < PAGINA) break;
      }
      return out;
    };
    try {
      const empresas = indiceDeEmpresas(await ler('ampro_empresas', 'externo_id, nome, nome_exibicao, cnpj', { equipe_id: mapa.equipe_id }));
      const abertas = await ler('dados_equipe', 'dados', { equipe_id: mapa.equipe_id, colecao: 'validacoes' });
      const arquivos = await ler('dados_equipe', 'dados', { equipe_id: mapa.equipe_id, colecao: 'arquivos' });
      const validations: ReturnType<typeof validacaoParaAmPro>[] = [];
      for (const a of arquivos) {
        const arq = a.dados as Record<string, unknown>;
        if (!ehObjeto(arq) || arq.competencia !== comp) continue;
        for (const i of (Array.isArray(arq.itens) ? arq.itens : []) as Record<string, unknown>[]) {
          validations.push(validacaoParaAmPro(i, str(arq.empresa), comp, true, empresas));
        }
      }
      const ids = new Set(validations.map((x) => x.id));
      for (const a of abertas) {
        const v = a.dados as Record<string, unknown>;
        if (!ehObjeto(v) || str(v.competencia) !== comp || ids.has(str(v.id))) continue;
        validations.push(validacaoParaAmPro(v, str(v.nome), comp, false, empresas));
      }
      validations.sort((x, y) => x.companyName.localeCompare(y.companyName, 'pt-BR') || x.activity.localeCompare(y.activity, 'pt-BR') || x.id.localeCompare(y.id));
      await registrar(200, time, validations.length);
      return resp(200, { schemaVersion: 1, team: { id: time }, competence: comp, validations });
    } catch {
      await registrar(500, time);
      return erro(500, 'internal_error', 'Falha ao ler as validações.'); // nunca lista vazia para mascarar falha
    }
  }

  // GET /calendar?competence=AAAA-MM
  const competencia = url.searchParams.get('competence') ?? '';
  if (!COMPETENCIA_RE.test(competencia)) { await registrar(400); return erro(400, 'invalid_payload', 'competence é obrigatório no formato AAAA-MM.'); }
  const { de, ate } = intervaloDaCompetencia(competencia);
  const linhas: Record<string, unknown>[] = [];
  // Lê o mês inteiro, página por página: nunca trunca em 1000 linhas.
  for (let pagina = 0; ; pagina++) {
    const { data, error } = await sb.from('obrigacoes_oficiais')
      .select('id, titulo, orgao, vencimento, versao, status, substitui_id, fonte_url')
      .in('status', ['aprovado', 'substituido']).gte('vencimento', de).lt('vencimento', ate)
      .order('vencimento', { ascending: true }).order('id', { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (error) { await registrar(500); return erro(500, 'internal_error', 'Falha ao ler o calendário.'); } // nunca "events: []" para mascarar falha
    linhas.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) break;
  }
  await registrar(200, null, linhas.length);
  return resp(200, { schemaVersion: 1, events: linhas.map(eventoDoCalendario) });
}

// @ts-ignore: Deno só existe no ambiente das Edge Functions
if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve((req: Request) => tratar(req));
