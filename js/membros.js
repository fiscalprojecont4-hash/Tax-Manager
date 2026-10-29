// Pessoas da equipe para "Delegado para" (Tarefas) e "Membro em validação" (Validações).
// A lista vem do AM PRO (executores e responsáveis que ele envia, por equipe), somada aos analistas que
// têm login no Tax Manager. O mesmo nome costuma chegar de vários jeitos ("JENIFFER", "Jeniffer Nascimento"):
// aqui eles são reunidos em uma pessoa só.

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const limpa = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const palavras = (s) => norm(s).split(' ').filter(Boolean);

function bonito(nome) {
  if (nome === nome.toUpperCase() && nome !== nome.toLowerCase()) {
    return nome.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
  }
  return nome;
}

/**
 * Reúne as fontes em pessoas únicas. Cada item: { nome, usuario?, id?, email? }
 *  - mesmo `usuario` (id no AM PRO) ou mesmo nome sem acento/caixa = mesma pessoa;
 *  - um nome que é o começo de UM único outro nome ("Jeniffer" e "Jeniffer Nascimento") também.
 * Devolve [{ nome, id, email }] em ordem alfabética; id/email só existem para quem tem login no Tax Manager.
 */
export function unirMembros(itens) {
  const grupos = [];
  for (const it of itens) {
    const nome = limpa(it.nome);
    if (!nome) continue;
    const k = norm(nome);
    let g = grupos.find(x => (it.usuario && x.usuario === it.usuario) || x.chaves.has(k));
    if (!g) { g = { nomes: new Set(), chaves: new Set(), usuario: '', id: null, email: null }; grupos.push(g); }
    g.nomes.add(nome); g.chaves.add(k);
    if (it.usuario && !g.usuario) g.usuario = it.usuario;
    if (it.id) g.id = it.id;
    if (it.email) g.email = it.email;
  }
  // nome curto que é o começo de um único nome mais longo
  grupos.sort((a, b) => Math.max(...[...b.chaves].map(c => c.split(' ').length)) - Math.max(...[...a.chaves].map(c => c.split(' ').length)));
  const vivos = [...grupos];
  for (const curto of [...grupos].reverse()) {
    const pc = palavras([...curto.nomes][0]);
    const candidatos = vivos.filter(g => g !== curto && !(g.usuario && curto.usuario && g.usuario !== curto.usuario)
      && [...g.nomes].some(n => { const p = palavras(n); return p.length > pc.length && pc.every((w, i) => p[i] === w); }));
    if (candidatos.length !== 1) continue;
    const alvo = candidatos[0];
    curto.nomes.forEach(n => alvo.nomes.add(n)); curto.chaves.forEach(c => alvo.chaves.add(c));
    alvo.usuario ||= curto.usuario; alvo.id ||= curto.id; alvo.email ||= curto.email;
    vivos.splice(vivos.indexOf(curto), 1);
  }
  return vivos
    .map(g => ({ nome: bonito([...g.nomes].sort((a, b) => b.length - a.length)[0]), id: g.id, email: g.email }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Nome da lista que corresponde ao texto digitado (sem acento/caixa; aceita e-mail), ou '' se não houver. */
export function acharMembro(membros, texto) {
  const n = norm(texto);
  if (!n) return null;
  return membros.find(m => norm(m.nome) === n || (m.email && norm(m.email) === n)) || null;
}
