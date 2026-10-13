import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDia, registrosDoDia, diasDoMes } from './ingestao-receita.mjs';

const html = readFileSync(new URL('./fixtures/dia-15-07-2026.html', import.meta.url), 'utf8');
const dia = parseDia(html);
assert.equal(dia.arrecadacoes.length, 4);
assert.deepEqual(dia.arrecadacoes[0], {
  codigo: '8053', grupo: 'IRRF', descricao: 'Rendimentos de Capital - Títulos de renda fixa - Pessoa Física',
  periodo: '1º decêndio mês atual (10/07/2026)', documento: 'DARF', origem: 'DCTFWeb Geral Mensal / Reinf RET', base: 'Lei nº 9.779/99 Art. 5º',
});
assert.equal(dia.declaracoes.length, 2);
assert.equal(dia.declaracoes[0].nome, 'EFD-Reinf – Escrituração Fiscal Digital de Retenções e Outras informações Fiscais');
assert.equal(dia.declaracoes[1].interessado, 'PJ'); // linha sem a célula de prazo (rowspan)

const regs = registrosDoDia('2026-07-15', dia, 'u');
assert.equal(regs.length, 3 + 2); // IRRF/DARF, IOF/DARF, Contribuição/GPS + 2 declarações
const irrf = regs.find((r) => r.titulo === 'IRRF — DARF');
assert.match(irrf.descricao, /\(2\): 8053, 3426/);
assert.ok(regs.every((r) => r.orgao === 'RFB' && r.vencimento === '2026-07-15'));

const mes = '<a href="/2026/Outubro/dia-05-10-2026">5</a><a href="/2026/Outubro/dia-15-10-2026">15</a><a href=".../dia-15-10-2026">15</a><a href="dia-01-09-2026">x</a>';
assert.deepEqual(diasDoMes(mes, 2026, 10), ['05', '15']);
console.log('ok');
