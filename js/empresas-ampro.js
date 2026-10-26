// Empresas do Tax Manager = empresas do AM PRO (espelho em ampro_empresas).
// O RLS do banco decide o que cada pessoa enxerga: analista, as empresas da sua
// equipe; gestor/admin, as de todas as equipes. As páginas leem a lista por
// dados-teste.empresas(); esta rotina só troca a origem dela.

import { gravar } from './dados-teste.js';

const PAGINA = 1000;

async function lerTudo(supabase, tabela, colunas) {
  const linhas = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase.from(tabela).select(colunas).range(de, de + PAGINA - 1);
    if (error) throw error;
    linhas.push(...data);
    if (data.length < PAGINA) return linhas;
  }
}

export function montarEmpresas(linhas, nomesEquipe) {
  const porChave = new Map();
  for (const l of linhas) {
    if (l.ativa === false) continue;
    const nome = (l.nome_exibicao || l.nome || '').trim();
    if (!nome) continue;
    const equipe = nomesEquipe.get(l.equipe_id) || 'Equipe';
    const chave = (l.cnpj || nome).toLowerCase();
    const atual = porChave.get(chave);
    if (atual) { if (!atual.equipes.includes(equipe)) atual.equipes.push(equipe); continue; }
    porChave.set(chave, {
      nome, origem: 'ampro', externo_id: l.externo_id, cnpj: l.cnpj || '', uf: l.uf || '',
      regime: l.regime || l.tributacao || '', codigo_alterdata: l.codigo_alterdata || '',
      responsavel: l.responsavel || '', executor: l.responsavel || '', equipes: [equipe],
    });
  }
  return [...porChave.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Busca as empresas permitidas e as grava como cadastro do Tax Manager. Devolve a lista, ou null se o banco não respondeu/está vazio (mantém o que já havia). */
export async function sincronizarEmpresasAmPro(supabase) {
  try {
    const [emp, eq] = await Promise.all([
      lerTudo(supabase, 'ampro_empresas', 'equipe_id, externo_id, nome, nome_exibicao, cnpj, uf, regime, tributacao, codigo_alterdata, ativa, responsavel'),
      lerTudo(supabase, 'equipes', 'id, nome'),
    ]);
    const lista = montarEmpresas(emp, new Map(eq.map(e => [e.id, e.nome])));
    if (!lista.length) return null;
    gravar('empresas', lista);
    return lista;
  } catch (err) {
    console.error('Empresas do AM PRO:', err);
    return null;
  }
}
