// Liga as coleções que as telas guardavam só no navegador à tabela public.dados_equipe.
// Uso: no início da página, depois de confirmar a sessão:  await ligarDadosEquipe(supabase);
// Depois disso as telas continuam usando carregar()/gravar() de dados-teste.js: a leitura já vem do
// banco e cada gravação é enviada (só o que mudou). A cada minuto as mudanças dos colegas entram e
// a página recebe o evento "tm:dados" ({ detail: { chave } }) para se redesenhar.

import { contextoEquipe } from './tarefas-db.js';
import { gravarLocal, lerLocal, removerLocal, definirPonte } from './dados-teste.js';

// lista = vários registros com id; doc = um documento por equipe
const COLECOES = { validacoes: 'lista', arquivos: 'lista', mapeamento: 'lista', projetos: 'lista', categorias: 'doc', eventos: 'doc' };
const UNICO = 'unico';
const TAM = 1000;
const DONO = '__dono_equipe';

let ligacao = null;

function aviso(msg) {
  let el = document.getElementById('tmAviso');
  if (!el) {
    el = document.createElement('div'); el.id = 'tmAviso'; el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9999;max-width:min(92vw,520px);'
      + 'padding:10px 16px;border-radius:10px;background:#7a1f1f;color:#fff;font:14px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)';
    document.body.appendChild(el);
  }
  el.textContent = msg; el.hidden = false;
  clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, 8000);
}

/** Linhas do banco -> valor da tela. */
function paraValor(chave, linhas) {
  if (COLECOES[chave] === 'doc') return linhas.length ? linhas[0].dados : undefined;
  const v = linhas.map(l => l.dados);
  return chave === 'arquivos' ? v.reverse() : v; // arquivos: mais recente primeiro
}

/** Valor da tela -> Map(id -> JSON do registro). */
function paraLinhas(chave, valor) {
  const m = new Map();
  if (COLECOES[chave] === 'doc') { if (valor !== undefined && valor !== null) m.set(UNICO, JSON.stringify(valor)); return m; }
  for (const r of Array.isArray(valor) ? valor : []) {
    if (!r || r.id === undefined || r.id === null) { console.warn('Registro sem id ignorado em', chave); continue; }
    m.set(String(r.id), JSON.stringify(r));
  }
  return m;
}

async function lerColecao(supabase, equipeId, chave) {
  const out = [];
  for (let de = 0; ; de += TAM) {
    const { data, error } = await supabase.from('dados_equipe').select('id,dados')
      .eq('equipe_id', equipeId).eq('colecao', chave).order('criado_em').order('id').range(de, de + TAM - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < TAM) break;
  }
  return out;
}

async function aplicarMudancas(supabase, equipeId, chave, atual, base) {
  const novos = paraLinhas(chave, atual);
  const gravar = [...novos].filter(([id, j]) => base.get(id) !== j)
    .map(([id, j]) => ({ equipe_id: equipeId, colecao: chave, id, dados: JSON.parse(j) }));
  const apagar = chave === 'arquivos' ? [] : [...base.keys()].filter(id => !novos.has(id));
  for (let i = 0; i < gravar.length; i += 200) {
    const { error } = await supabase.from('dados_equipe').upsert(gravar.slice(i, i + 200), { onConflict: 'equipe_id,colecao,id' });
    if (error) throw error;
  }
  for (let i = 0; i < apagar.length; i += 200) {
    const { error } = await supabase.from('dados_equipe').delete().eq('equipe_id', equipeId).eq('colecao', chave).in('id', apagar.slice(i, i + 200));
    if (error) throw error;
  }
  // arquivos nunca saem do banco; mantém a base coerente
  return chave === 'arquivos' ? new Map([...base, ...novos]) : novos;
}

export function ligarDadosEquipe(supabase) {
  if (!ligacao) ligacao = iniciar(supabase).catch((e) => { console.error(e); ligacao = null; return null; });
  return ligacao;
}

async function iniciar(supabase) {
  const ctx = await contextoEquipe(supabase);
  if (!ctx) return null;
  const { equipeId } = ctx;
  const bases = {};       // chave -> Map(id -> json) do que o banco tem
  const pendentes = {};   // chave -> timer
  let fila = Promise.resolve();
  let enviando = 0;

  // Dados deixados no navegador por outra equipe/usuário não podem vazar para esta equipe.
  const dono = lerLocal(DONO);
  const migrar = dono === undefined || dono === equipeId;

  for (const chave of Object.keys(COLECOES)) {
    const linhas = await lerColecao(supabase, equipeId, chave);
    bases[chave] = new Map(linhas.map(l => [l.id, JSON.stringify(l.dados)]));
    if (linhas.length) { gravarLocal(chave, paraValor(chave, linhas)); continue; }
    const local = lerLocal(chave);
    if (migrar && local !== undefined && paraLinhas(chave, local).size) {
      bases[chave] = await aplicarMudancas(supabase, equipeId, chave, local, new Map()); // primeira vez: sobe o que já havia
    } else if (COLECOES[chave] === 'doc') {
      removerLocal(chave); // volta ao padrão da tela
    } else {
      gravarLocal(chave, []);
    }
  }
  gravarLocal(DONO, equipeId);

  async function enviar(chave) {
    const atual = lerLocal(chave);
    bases[chave] = await aplicarMudancas(supabase, equipeId, chave, atual, bases[chave]);
  }

  async function recarregar(chave, avisar) {
    const linhas = await lerColecao(supabase, equipeId, chave);
    const base = new Map(linhas.map(l => [l.id, JSON.stringify(l.dados)]));
    const mudou = base.size !== bases[chave].size || [...base].some(([id, j]) => bases[chave].get(id) !== j);
    if (!mudou) return;
    bases[chave] = base;
    if (linhas.length) gravarLocal(chave, paraValor(chave, linhas));
    else if (COLECOES[chave] === 'doc') removerLocal(chave); else gravarLocal(chave, []);
    if (avisar) window.dispatchEvent(new CustomEvent('tm:dados', { detail: { chave } }));
  }

  definirPonte((chave) => {
    if (!(chave in COLECOES)) return;
    clearTimeout(pendentes[chave]);
    pendentes[chave] = setTimeout(() => {
      delete pendentes[chave];
      enviando++;
      fila = fila.catch(() => {}).then(() => enviar(chave)).catch(async (e) => {
        console.error(e);
        aviso('Não foi possível salvar no banco. Recarregando os dados da equipe…');
        try { bases[chave] = new Map(); await recarregar(chave, true); } catch { /* sem rede */ }
      }).finally(() => { enviando--; });
    }, 400);
  });

  const atualizar = async () => {
    if (document.hidden || enviando || Object.keys(pendentes).length) return;
    for (const chave of Object.keys(COLECOES)) {
      try { await recarregar(chave, true); } catch { /* tenta no próximo ciclo */ }
    }
  };
  setInterval(atualizar, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });
  addEventListener('pagehide', () => { Object.keys(pendentes).forEach(c => { clearTimeout(pendentes[c]); enviar(c).catch(() => {}); }); });
  return ctx;
}
