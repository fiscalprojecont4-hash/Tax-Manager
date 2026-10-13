import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { diasDoMes, separarBase, registrosDoDia } from './ingestao-sefaz-am.mjs';

assert.deepEqual(diasDoMes({ content: [{ month: 10, day: 15 }, { month: 9, day: 1 }, { month: 10, day: 5 }, { month: 10, day: 5 }] }, 10), [5, 15]);

assert.deepEqual(separarBase('Enviar a EFD (Art. 19, I, do Dec. 28.841/2009)'), { texto: 'Enviar a EFD', base: 'Art. 19, I, do Dec. 28.841/2009' });
assert.equal(separarBase('Recolhimento X (Art. 342, III do RICMS/AM').base, 'Art. 342, III do RICMS/AM'); // sem ")" de fechamento
assert.deepEqual(separarBase('Sem base legal.'), { texto: 'Sem base legal', base: '' });

const resp = JSON.parse(readFileSync(new URL('./fixtures/sefaz-dia-10-13.json', import.meta.url), 'utf8'));
const regs = registrosDoDia('2026-10-13', resp, 'u');
assert.equal(regs.length, 5);
assert.ok(regs.every((r) => r.orgao === 'SEFAZ-AM' && r.esfera === 'estadual' && r.uf === 'AM' && r.vencimento === '2026-10-13'));
assert.match(regs[0].titulo, /^Enviar o arquivo da EFD\/IMCS/);
assert.doesNotMatch(regs[0].titulo, /Art\./);
assert.match(regs[0].descricao, /Base legal: Art\. 19, I, do Dec\. 28\.841\/2009\.$/);
assert.equal(new Set(regs.map((r) => r.titulo)).size, 5);

// textos idênticos no mesmo dia não colidem
const dup = registrosDoDia('2026-10-13', { content: ['Mesma obrigação (Art. 1)', 'Mesma obrigação (Art. 2)'] }, 'u');
assert.equal(new Set(dup.map((r) => r.titulo)).size, 2);
console.log('ok');
