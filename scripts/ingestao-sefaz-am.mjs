#!/usr/bin/env node
// Ingestão da Agenda Tributária da SEFAZ-AM -> rascunhos de obrigações oficiais (mesma lógica da Receita).
//
// A agenda do portal (https://www.sefaz.am.gov.br/) é alimentada por uma API pública, sem login:
//   GET https://sistemas.sefaz.am.gov.br/portal/api/agenda-tributaria          -> { content: [{ month, day }] }  (dias com obrigação)
//   GET https://sistemas.sefaz.am.gov.br/portal/api/agenda-tributaria/<mes>/<dia> -> { content: ["texto (Art. ... )", ...] }
// A API não informa o ano: ela serve o ano corrente. Por isso só é possível ingerir o ano atual.
//
// Uso:
//   node scripts/ingestao-sefaz-am.mjs --mes 10            (grava data/agenda-sefaz-am-AAAA-MM.json)
//   node scripts/ingestao-sefaz-am.mjs --mes 10 --enviar    (também grava rascunhos no Supabase; ver ingestao-receita.mjs)

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { enviar } from './ingestao-receita.mjs';

const API = 'https://sistemas.sefaz.am.gov.br/portal/api/agenda-tributaria';
const p2 = (n) => String(n).padStart(2, '0');

// ---------- parsing (funções puras, testadas com fixtures) ----------

/** Dias do mês (números) com obrigação, a partir da resposta da lista geral. */
export function diasDoMes(lista, mes) {
  const set = new Set();
  for (const d of lista?.content ?? []) if (Number(d.month) === Number(mes)) set.add(Number(d.day));
  return [...set].sort((a, b) => a - b);
}

/** Separa "texto da obrigação (Art. 19, I, do Dec. 28.841/2009)" em { texto, base }. */
export function separarBase(t) {
  const s = String(t).replace(/\s+/g, ' ').trim();
  const m = s.match(/\s*\((Arts?\.?[^)]*)\)?\.?\s*$/i);
  return m ? { texto: s.slice(0, m.index).trim().replace(/[.,;]$/, ''), base: m[1].trim() } : { texto: s.replace(/\.$/, ''), base: '' };
}

/** Converte as obrigações de um dia em registros no formato de obrigacoes_oficiais. */
export function registrosDoDia(dataIso, resposta, fonteUrl) {
  const usados = new Set();
  const out = [];
  for (const bruto of resposta?.content ?? []) {
    if (typeof bruto !== 'string' || !bruto.trim()) continue;
    const { texto, base } = separarBase(bruto);
    let titulo = texto.length > 140 ? texto.slice(0, 137) + '…' : texto;
    for (let n = 2; usados.has(titulo); n++) titulo = `${texto.slice(0, 130)}… (${n})`; // títulos iguais no mesmo dia
    usados.add(titulo);
    out.push({
      titulo, orgao: 'SEFAZ-AM', esfera: 'estadual', uf: 'AM', municipio: null, regimes: null,
      competencia: null, vencimento: dataIso,
      descricao: (base ? `${texto}. Base legal: ${base}.` : `${texto}.`).slice(0, 1000),
      fonte_url: fonteUrl,
    });
  }
  return out;
}

// ---------- rede ----------

async function obter(url) {
  const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'ProjecontTaxManager/1.0 (ingestao agenda tributaria)' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.json();
}

export async function ingerirMes(ano, mes) {
  if (ano !== new Date().getFullYear()) throw new Error('A API da SEFAZ-AM não informa o ano; só é possível ingerir o ano corrente.');
  const dias = diasDoMes(await obter(API), mes);
  if (!dias.length) throw new Error(`Agenda da SEFAZ-AM de ${p2(mes)}/${ano} sem obrigações publicadas.`);
  const registros = [];
  for (const d of dias) {
    const url = `${API}/${mes}/${d}`;
    registros.push(...registrosDoDia(`${ano}-${p2(mes)}-${p2(d)}`, await obter(url), url));
  }
  return { fonte: 'https://www.sefaz.am.gov.br/', dias: dias.length, registros };
}

// ---------- CLI ----------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = Number(arg('mes') || hoje.getMonth() + 1);
  try {
    const res = await ingerirMes(ano, mes);
    await mkdir('data', { recursive: true });
    const arq = `data/agenda-sefaz-am-${ano}-${p2(mes)}.json`;
    await writeFile(arq, JSON.stringify(res, null, 2));
    console.log(`${res.dias} dias, ${res.registros.length} obrigações -> ${arq}`);
    if (process.argv.includes('--enviar')) console.log('Rascunhos:', await enviar(res));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
