// Instalar como js/ampro-refresh.js no Tax Manager. Usa somente a sessão do próprio usuário.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function solicitarAtualizacaoAmpro(supabase, cycle, options = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cycle)) throw new Error('Ciclo inválido.');
  const { data: requested, error } = await supabase.rpc('ampro_request_refresh', { p_cycle: cycle });
  if (error || !Array.isArray(requested) || !requested.length) throw new Error('Não foi possível solicitar a atualização do AM PRO.');
  const ids = requested.map(row => row.id);
  const wait = options.wait || delay;
  const attempts = options.attempts ?? 90;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (options.cancelled?.()) return { status: 'cancelled' };
    const { data, error: readError } = await supabase.from('ampro_sync_requests').select('id,status,error_code').in('id', ids);
    if (readError || !Array.isArray(data) || data.length !== ids.length || new Set(data.map(row => row.id)).size !== ids.length || data.some(row => !ids.includes(row.id))) throw new Error('Não foi possível conferir o recebimento no Tax Manager.');
    if (data.every(row => row.status === 'done' || row.status === 'failed')) {
      // Mesmo em falha parcial, relê o que efetivamente chegou ao banco.
      return { status: data.every(row => row.status === 'done') ? 'done' : 'failed' };
    }
    await wait(2000);
  }
  return { status: 'pending' };
}

export function instalarAtualizacaoAmpro(supabase, { cycle, currentCycle, onUpdated }) {
  const hero = document.getElementById('apHero');
  if (!hero || document.getElementById('apRequestRefresh')) return;
  const toolbar = document.createElement('div');
  toolbar.className = 'ap-refresh-toolbar';
  const button = document.createElement('button');
  button.id = 'apRequestRefresh'; button.type = 'button'; button.textContent = 'Atualizar dados do AM PRO';
  const status = document.createElement('span'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  toolbar.append(button, status); (hero.closest('.ap') || hero.parentElement).prepend(toolbar);
  let generation = 0;
  const request = async (selectedCycle) => {
    const currentGeneration = ++generation;
    button.disabled = true;
    status.textContent = 'Atualização solicitada. Aguardando o AM PRO enviar os dados…';
    try {
      const result = await solicitarAtualizacaoAmpro(supabase, selectedCycle, { cancelled: () => generation !== currentGeneration });
      if (generation !== currentGeneration) return;
      let viewUpdated = true;
      if (result.status === 'done' || result.status === 'failed') viewUpdated = await onUpdated() !== false;
      status.textContent = result.status === 'done' ? (viewUpdated ? 'Dados recebidos do AM PRO e painel atualizado.' : 'Dados recebidos. Não foi possível reler o painel neste momento.')
        : result.status === 'failed' ? 'A atualização teve falha. Exibindo os últimos dados disponíveis.'
        : 'Pedido ainda aguardando o AM PRO. O envio horário continua ativo.';
    } catch { if (generation === currentGeneration) status.textContent = 'Não foi possível solicitar ou confirmar a atualização. Exibindo os últimos dados disponíveis.'; }
    finally { if (generation === currentGeneration) button.disabled = false; }
  };
  button.addEventListener('click', () => { void request(cycle()); });
  // Reabrir/recarregar o painel solicita o ciclo operacional atual; SQL reúne pedidos repetidos.
  void request(currentCycle());
  return { request };
}
