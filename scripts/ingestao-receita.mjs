#!/usr/bin/env node
// Ingestão da Agenda Tributária da Receita Federal -> rascunhos de obrigações oficiais.
//
// Uso:
//   node scripts/ingestao-receita.mjs --ano 2026 --mes 10            (grava data/agenda-receita-2026-10.json)
//   node scripts/ingestao-receita.mjs --ano 2026 --mes 10 --enviar   (também grava rascunhos no Supabase)
//
// Para --enviar são necessárias as variáveis de ambiente SUPABASE_URL e
// SUPABASE_SERVICE_KEY (chave service_role, guardada como Secret do GitHub, nunca no repositório).
// Os registros entram como status 'rascunho'; só viram calendário depois da aprovação do gestor fiscal.
// Mesma obrigação/data com conteúdo diferente entra como nova versão. Mudança de DATA aparece como novo rascunho
// na nova data (o gestor rejeita/substitui o antigo na revisão).

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BASE = 'https://www.gov.br/receitafederal/pt-br/assuntos/agenda-tributaria';
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// ---------- parsing (funções puras, testadas com fixtures) ----------

const ENTIDADES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&ordm;': 'º', '&ordf;': 'ª', '&ndash;': '–', '&mdash;': '—' };

export function texto(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|ordm|ordf|ndash|mdash|#39);/g, (m) => ENTIDADES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t\r\f\v ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

function tabelas(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((t) =>
    [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) =>
      [...r[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => texto(c[1]))));
}

const una = (s) => s.replace(/\s+/g, ' ').trim();

/** Extrai as linhas de uma página de dia: arrecadações (DARF/GPS) e declarações (obrigações acessórias). */
export function parseDia(html) {
  const arrecadacoes = [];
  const declaracoes = [];
  for (const linhas of tabelas(html)) {
    const cab = una(linhas[0]?.join(' ') || '');
    if (/Código de Receita/i.test(cab)) {
      for (let i = 2; i < linhas.length; i++) {
        const a = linhas[i];
        if (a.length < 4 || !/^\d{4}$/.test(a[0])) continue;
        const b = linhas[i + 1] && linhas[i + 1].length <= 3 ? linhas[i + 1] : [];
        arrecadacoes.push({
          codigo: a[0], grupo: una(a[1]), descricao: una(a[2]),
          periodo: una(a[3]),
          documento: una(b[0] || ''), origem: una(b[1] || ''), base: una(b[2] || ''),
        });
      }
    } else if (/Declarações, Demonstrativos/i.test(cab)) {
      for (const l of linhas.slice(1)) {
        if (l.length < 4) continue;
        const [interessado, nome, periodo, base] = l.slice(-4);
        if (!nome) continue;
        declaracoes.push({ interessado: una(interessado), nome: una(nome), periodo: una(periodo), base: una(base) });
      }
    }
  }
  return { arrecadacoes, declaracoes };
}

/** Converte as linhas de um dia em registros de obrigação (agrupando códigos por tributo + documento). */
export function registrosDoDia(dataIso, { arrecadacoes, declaracoes }, fonteUrl) {
  const grupos = new Map();
  for (const a of arrecadacoes) {
    const k = `${a.grupo}|${a.documento}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(a);
  }
  const out = [];
  for (const [k, itens] of grupos) {
    const [grupo, doc] = k.split('|');
    const codigos = itens.map((i) => i.codigo).join(', ');
    const periodos = [...new Set(itens.map((i) => i.periodo.replace(/\s+/g, ' ')))].join('; ');
    out.push({
      titulo: doc ? `${grupo} — ${doc}` : grupo,
      orgao: 'RFB', esfera: 'federal', uf: null, municipio: null, regimes: null,
      competencia: null, vencimento: dataIso,
      descricao: `Códigos de receita (${itens.length}): ${codigos}. Período(s): ${periodos}.`.slice(0, 1000),
      fonte_url: fonteUrl,
    });
  }
  for (const d of declaracoes) {
    out.push({
      titulo: d.nome.length > 140 ? d.nome.slice(0, 137) + '…' : d.nome,
      orgao: 'RFB', esfera: 'federal', uf: null, municipio: null, regimes: null,
      competencia: null, vencimento: dataIso,
      descricao: `Interessado: ${d.interessado}. Referência: ${d.periodo}. Base normativa: ${d.base}.`.slice(0, 1000),
      fonte_url: fonteUrl,
    });
  }
  return out;
}

/** Links de dia (dia-DD-MM-AAAA) encontrados na página do mês. */
export function diasDoMes(html, ano, mes) {
  const set = new Set();
  const re = new RegExp(`dia-(\\d{2})-${String(mes).padStart(2, '0')}-${ano}`, 'gi');
  for (const m of html.matchAll(re)) set.add(m[1]);
  return [...set].sort();
}

// ---------- rede ----------

async function baixar(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'ProjecontTaxManager/1.0 (ingestao agenda tributaria)' } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.text();
}

// O site usa o nome do mês ora em minúsculas, ora capitalizado (ex.: 'julho' e 'Outubro').
async function paginaMes(ano, mes) {
  const nome = MESES[mes - 1];
  for (const slug of [nome, nome[0].toUpperCase() + nome.slice(1)]) {
    const url = `${BASE}/${ano}/${slug}`;
    const html = await baixar(url);
    if (html && /dia-\d{2}-\d{2}-\d{4}/i.test(html)) return { slug, url, html };
  }
  return null;
}

export async function ingerirMes(ano, mes) {
  const pm = await paginaMes(ano, mes);
  if (!pm) throw new Error(`Agenda de ${String(mes).padStart(2, '0')}/${ano} ainda não publicada.`);
  const dias = diasDoMes(pm.html, ano, mes);
  const registros = [];
  for (const dd of dias) {
    const url = `${pm.url}/dia-${dd}-${String(mes).padStart(2, '0')}-${ano}`;
    const html = await baixar(url);
    if (!html) continue;
    const dataIso = `${ano}-${String(mes).padStart(2, '0')}-${dd}`;
    registros.push(...registrosDoDia(dataIso, parseDia(html), url));
  }
  return { fonte: pm.url, dias: dias.length, registros };
}

// ---------- Supabase (rascunhos) ----------

async function enviar({ fonte, registros }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_KEY para usar --enviar.');
  const h = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const rest = (p, init) => fetch(`${url}/rest/v1/${p}`, { ...init, headers: { ...h, ...(init?.headers || {}) } });

  const ing = await (await rest('obrigacoes_ingestoes', {
    method: 'POST', headers: { prefer: 'return=representation' },
    body: JSON.stringify({ fonte, status: 'executando' }),
  })).json();
  const ingestaoId = ing[0].id;
  let novos = 0, alterados = 0, iguais = 0;
  try {
    for (const r of registros) {
      // Já existe a mesma obrigação (órgão + título) nessa data?
      const q = `obrigacoes_oficiais?orgao=eq.${r.orgao}&titulo=eq.${encodeURIComponent(r.titulo)}&vencimento=eq.${r.vencimento}&select=id,versao,status,descricao&order=versao.desc&limit=1`;
      const ex = await (await rest(q)).json();
      if (ex.length && ex[0].descricao === r.descricao) { iguais++; continue; }
      const versao = ex.length ? ex[0].versao + 1 : 1;
      const res = await rest('obrigacoes_oficiais', {
        method: 'POST',
        body: JSON.stringify({ ...r, versao, status: 'rascunho', substitui_id: ex[0]?.id ?? null, ingestao_id: ingestaoId }),
      });
      if (!res.ok) throw new Error(`Falha ao gravar "${r.titulo}": ${res.status} ${await res.text()}`);
      ex.length ? alterados++ : novos++;
    }
    await rest(`obrigacoes_ingestoes?id=eq.${ingestaoId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'ok', finalizado_em: new Date().toISOString(), registros_novos: novos, registros_alterados: alterados }),
    });
  } catch (e) {
    await rest(`obrigacoes_ingestoes?id=eq.${ingestaoId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'erro', finalizado_em: new Date().toISOString(), erro: String(e.message).slice(0, 500) }),
    });
    throw e;
  }
  return { novos, alterados, iguais };
}

// ---------- CLI ----------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
  const hoje = new Date();
  const ano = Number(arg('ano') || hoje.getFullYear());
  const mes = Number(arg('mes') || hoje.getMonth() + 1);
  try {
    const res = await ingerirMes(ano, mes);
    await mkdir('data', { recursive: true });
    const arq = `data/agenda-receita-${ano}-${String(mes).padStart(2, '0')}.json`;
    await writeFile(arq, JSON.stringify(res, null, 2));
    console.log(`${res.dias} dias, ${res.registros.length} obrigações -> ${arq}`);
    if (process.argv.includes('--enviar')) console.log('Rascunhos:', await enviar(res));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
