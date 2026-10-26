// Painel AM PRO no dashboard: lê o espelho gravado pela integração (ampro_obrigacoes) via RPC.
// O isolamento por equipe vem do RLS: analista vê só a sua equipe; gestor/admin vê todas.

// Meta de conclusão (%) — valor provisório; o contrato do AM PRO não envia meta.
export const META_CONCLUSAO = 90;

const fmt = new Intl.NumberFormat('pt-BR');
const $ = (id) => document.getElementById(id);
const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };

export function consolidar(linhas) {
  const t = { total: 0, aplicaveis: 0, concluidas: 0, vencidas: 0, em_risco: 0, impedimentos: 0, ultima_sync: null };
  for (const l of linhas) {
    for (const k of ['total', 'aplicaveis', 'concluidas', 'vencidas', 'em_risco', 'impedimentos']) t[k] += l[k] || 0;
    if (l.ultima_sync && (!t.ultima_sync || l.ultima_sync > t.ultima_sync)) t.ultima_sync = l.ultima_sync;
  }
  t.pct = t.aplicaveis ? Math.round((t.concluidas / t.aplicaveis) * 100) : 0;
  return t;
}

function cicloRotulo(c) { const [a, m] = c.split('-'); return `${m}/${a}`; }

function quando(iso) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Manaus', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function vazio(msg, tag) {
  set('apTag', tag);
  for (const id of ['apConcluidas', 'apRisco', 'apMeta']) set(id, '—');
  set('apConcluidasSub', ''); set('apRiscoSub', ''); set('apMetaSub', '');
  set('apSyncTxt', msg);
  set('apEquipes', '');
  $('apDot')?.classList.remove('ap-on');
}

export async function carregarPainelAmPro(supabase) {
  if (!$('apConcluidas')) return;
  try {
    const sel = $('apCiclo');
    const { data: ciclos, error: e1 } = await supabase.rpc('ampro_ciclos');
    if (e1) throw e1;
    if (!ciclos?.length) { vazio('Nenhum dado recebido do AM PRO ainda.', 'AM PRO · aguardando primeira sincronização'); return; }
    if (sel && !sel.options.length) {
      for (const c of ciclos) sel.add(new Option(cicloRotulo(c.ciclo), c.ciclo));
      sel.addEventListener('change', () => carregarPainelAmPro(supabase));
    }
    const ciclo = sel?.value || ciclos[0].ciclo;
    const { data, error } = await supabase.rpc('ampro_resumo', { p_ciclo: ciclo });
    if (error) throw error;
    if (!data?.length) { vazio('Sem dados para este ciclo.', 'AM PRO · sem dados no ciclo'); return; }

    const t = consolidar(data);
    set('apConcluidas', fmt.format(t.concluidas));
    set('apConcluidasSub', `de ${fmt.format(t.aplicaveis)} · ${t.pct}%`);
    set('apRisco', fmt.format(t.em_risco));
    set('apRiscoSub', `${fmt.format(t.vencidas)} vencidas · ${fmt.format(t.impedimentos)} com impedimento`);
    const bateu = t.pct >= META_CONCLUSAO;
    set('apMeta', bateu ? 'Sim' : 'Não');
    set('apMetaSub', `${t.pct}% de ${META_CONCLUSAO}% (provisória)`);
    set('apTag', 'AM PRO · conectado');
    $('apDot')?.classList.add('ap-on');
    set('apSyncTxt', t.ultima_sync ? `Última sincronização: ${quando(t.ultima_sync)} (Manaus)` : 'Sincronizado.');
    set('apEquipes', data.map((l) => `${l.equipe_nome}: ${l.concluidas}/${l.aplicaveis}`).join(' · '));
  } catch (err) {
    console.error('AM PRO painel:', err);
    vazio('Não foi possível ler os dados do AM PRO.', 'AM PRO · erro de leitura');
  }
}
