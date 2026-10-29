import assert from 'node:assert/strict';
import { unirMembros, acharMembro } from '../js/membros.js';

const m = unirMembros([
  { nome: 'JENIFFER', usuario: 'u5' }, { nome: 'Jeniffer Nascimento', usuario: 'u5' }, { nome: 'Adriely' }, { nome: 'Adriely Monteiro' },
  { nome: 'HALEN' }, { nome: 'halen' }, { nome: 'Rafael' }, { nome: 'Ana' }, { nome: 'Ana Souza' }, { nome: 'Ana Lima' },
  { nome: 'Marcel', id: 'x1', email: 'm@x.com' }, { nome: '  ' },
]);
assert.deepEqual(m.map(x => x.nome), ['Adriely Monteiro', 'Ana', 'Ana Lima', 'Ana Souza', 'Halen', 'Jeniffer Nascimento', 'Marcel', 'Rafael']);
// "Ana" é o começo de duas pessoas diferentes: não se junta a nenhuma
assert.equal(m.find(x => x.nome === 'Marcel').id, 'x1');
assert.equal(acharMembro(m, 'jeniffer nascimento').nome, 'Jeniffer Nascimento');
assert.equal(acharMembro(m, 'M@X.com').nome, 'Marcel');
assert.equal(acharMembro(m, 'Fulano'), null);
// pessoas diferentes com o mesmo começo, mas ids diferentes, não se juntam
assert.equal(unirMembros([{ nome: 'Paulo', usuario: 'a' }, { nome: 'Paulo Silva', usuario: 'b' }]).length, 2);
console.log('membros: ok');
