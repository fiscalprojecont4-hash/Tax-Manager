// node --experimental-strip-types supabase/functions/enviar-email/index.test.mjs
import assert from 'node:assert/strict';
import { validarPedido, htmlDoTexto, MAX_DESTINATARIOS } from './index.ts';

const ok = validarPedido({ para: ['A@Projecont.com.br', 'a@projecont.com.br', ' b@x.com '], assunto: 'Tarefa\r\nBcc: x@y.com', texto: 'Olá' });
assert.deepEqual(ok.para, ['a@projecont.com.br', 'b@x.com']);       // minúsculas, sem repetidos
assert.equal(ok.assunto, 'Tarefa Bcc: x@y.com');                    // sem quebra de linha (injeção de cabeçalho)
assert.match(validarPedido({ para: [], assunto: 'a', texto: 'b' }).erro, /destinat/);
assert.match(validarPedido({ para: ['semarroba'], assunto: 'a', texto: 'b' }).erro, /inválido/);
assert.match(validarPedido({ para: ['a@b.com, c@d.com'], assunto: 'a', texto: 'b' }).erro, /inválido/);
assert.match(validarPedido({ para: Array.from({ length: MAX_DESTINATARIOS + 1 }, (_, i) => `u${i}@x.com`), assunto: 'a', texto: 'b' }).erro, /No máximo/);
assert.match(validarPedido({ para: ['a@x.com'], assunto: '', texto: 'b' }).erro, /assunto/);
assert.match(validarPedido({ para: ['a@x.com'], assunto: 'a', texto: 'x'.repeat(10001) }).erro, /longo/);
assert.match(validarPedido({ para: ['a@outro.com'], assunto: 'a', texto: 'b' }, ['projecont.com.br']).erro, /domínios/);
assert.ok(!validarPedido({ para: ['a@projecont.com.br'], assunto: 'a', texto: 'b' }, ['projecont.com.br']).erro);
assert.equal(htmlDoTexto('<script>x</script>\nlinha'), htmlDoTexto('<script>x</script>\nlinha'));
assert.ok(!htmlDoTexto('<script>x</script>').includes('<script>'));
assert.ok(htmlDoTexto('a\nb').includes('a<br>b'));
console.log('ok');
