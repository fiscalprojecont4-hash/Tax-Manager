// Envio de e-mail pelo servidor (Edge Function "enviar-email" do Supabase -> Resend).
// O clique no ícone de e-mail dispara o envio direto, sem abrir o programa de e-mail do usuário.

import { supabase } from './supabase-client.js';

const EMAIL_RE = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;

/** Extrai e-mails válidos (sem repetição) de um texto separado por vírgula, ponto e vírgula ou espaço. */
export function emailsValidos(texto) {
  const lista = String(texto || '').split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(e => EMAIL_RE.test(e));
  return [...new Set(lista)];
}

/** E-mail do usuário cadastrado com esse nome (tabela perfis; a RLS só mostra colegas de equipe). */
export async function emailDoPerfil(nome) {
  const n = String(nome || '').trim();
  if (!n) return null;
  const exato = n.replace(/[\\%_]/g, c => '\\' + c); // sem curingas: busca o nome inteiro
  const { data, error } = await supabase.from('perfis').select('email').ilike('nome', exato).eq('ativo', true).limit(1);
  if (error || !data?.length) return null;
  return emailsValidos(data[0].email)[0] || null;
}

/**
 * Envia o e-mail. Lança Error com mensagem pronta para o usuário.
 * error.naoConfigurado = true quando a função ainda não foi implantada/configurada no Supabase.
 */
export async function enviarEmail({ para, assunto, texto, entidade = null, entidadeId = null }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada. Entre de novo.');
  const rodape = `\n\n—\nEnviado pelo Tax Manager por ${session.user.email}.`;
  const { data, error } = await supabase.functions.invoke('enviar-email', {
    body: { para, assunto, texto: texto + rodape, entidade, entidadeId },
  });
  if (!error) return data;
  const resp = error.context;
  const status = resp && typeof resp.status === 'number' ? resp.status : 0;
  let msg = '';
  try { msg = (await resp.json()).erro || ''; } catch { /* sem corpo JSON */ }
  const e = new Error(msg || (status ? `Falha no envio (código ${status}).` : 'Não foi possível falar com o servidor de e-mail.'));
  e.naoConfigurado = status === 404 || status === 503;
  throw e;
}
