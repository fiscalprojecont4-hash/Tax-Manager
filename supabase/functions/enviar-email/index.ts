// Edge Function "enviar-email" — envia e-mails do Tax Manager pelo Resend.
//
// Quem chama: o site (botão de e-mail em Tarefas e Validações), com o login do usuário.
// Proteções: exige usuário logado e membro ativo de uma equipe; no máximo 10 destinatários por e-mail;
// no máximo 30 e-mails por hora por usuário; todo envio fica registrado em public.emails_enviados;
// o "responder para" é sempre o e-mail do usuário que clicou.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY   chave da API do Resend (começa com re_)
//   EMAIL_FROM       remetente verificado no Resend, ex.: Tax Manager <nao-responda@projecont.com.br>
//   EMAIL_DOMINIOS   (opcional) lista de domínios permitidos como destino, ex.: projecont.com.br,cliente.com.br
// SUPABASE_URL e SUPABASE_ANON_KEY já existem automaticamente dentro da função.

export const LIMITE_POR_HORA = 30;
export const MAX_DESTINATARIOS = 10;

const EMAIL_RE = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;

export interface Pedido {
  para: string[];
  assunto: string;
  texto: string;
  entidade: string | null;
  entidadeId: string | null;
}

/** Valida o corpo da requisição. Retorna o pedido limpo ou { erro }. */
export function validarPedido(corpo: unknown, dominiosPermitidos: string[] = []): Pedido | { erro: string } {
  const c = (corpo ?? {}) as Record<string, unknown>;
  const para = [...new Set((Array.isArray(c.para) ? c.para : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  if (!para.length) return { erro: 'Informe ao menos um destinatário.' };
  if (para.length > MAX_DESTINATARIOS) return { erro: `No máximo ${MAX_DESTINATARIOS} destinatários por e-mail.` };
  const invalido = para.find((e) => !EMAIL_RE.test(e));
  if (invalido) return { erro: `E-mail inválido: ${invalido}` };
  if (dominiosPermitidos.length) {
    const fora = para.find((e) => !dominiosPermitidos.includes(e.split('@')[1]));
    if (fora) return { erro: `Destinatário fora dos domínios permitidos: ${fora}` };
  }
  const assunto = String(c.assunto ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!assunto) return { erro: 'Informe o assunto.' };
  if (assunto.length > 200) return { erro: 'Assunto muito longo (máx. 200 caracteres).' };
  const texto = String(c.texto ?? '').trim();
  if (!texto) return { erro: 'Informe o texto do e-mail.' };
  if (texto.length > 10000) return { erro: 'Texto muito longo (máx. 10.000 caracteres).' };
  const entidade = c.entidade ? String(c.entidade).slice(0, 40) : null;
  const entidadeId = c.entidadeId ? String(c.entidadeId).slice(0, 80) : null;
  return { para, assunto, texto, entidade, entidadeId };
}

const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Texto simples -> HTML seguro (quebras de linha preservadas). */
export function htmlDoTexto(texto: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${escapar(texto).replace(/\n/g, '<br>')}</div>`;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const resp = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'content-type': 'application/json' } });

export async function tratar(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return resp(405, { erro: 'Método não permitido.' });

  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) return resp(401, { erro: 'Entre no sistema para enviar e-mails.' });

  const { createClient } = await import('jsr:@supabase/supabase-js@2');
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error: erroUsuario } = await sb.auth.getUser();
  if (erroUsuario || !user) return resp(401, { erro: 'Sessão inválida. Entre de novo.' });

  const chave = Deno.env.get('RESEND_API_KEY');
  const de = Deno.env.get('EMAIL_FROM');
  if (!chave || !de) return resp(503, { erro: 'Envio de e-mail ainda não configurado no servidor.' });

  const dominios = (Deno.env.get('EMAIL_DOMINIOS') ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  let corpo: unknown;
  try { corpo = await req.json(); } catch { return resp(400, { erro: 'Pedido inválido.' }); }
  const pedido = validarPedido(corpo, dominios);
  if ('erro' in pedido) return resp(400, pedido);

  // Só membros ativos de alguma equipe enviam (a RLS deixa o usuário ver os próprios vínculos).
  const { data: vinculos, error: erroVinculo } = await sb.from('membros_equipe').select('equipe_id').eq('usuario_id', user.id).eq('ativo', true).limit(1);
  if (erroVinculo) return resp(500, { erro: 'Não foi possível verificar a sua equipe.' });
  if (!vinculos?.length) return resp(403, { erro: 'Seu usuário ainda não pertence a uma equipe.' });

  // Limite por hora.
  const desde = new Date(Date.now() - 3600_000).toISOString();
  const { count, error: erroContagem } = await sb.from('emails_enviados').select('id', { count: 'exact', head: true })
    .eq('usuario_id', user.id).eq('status', 'enviado').gte('criado_em', desde);
  if (erroContagem) return resp(500, { erro: 'Não foi possível verificar o limite de envios.' });
  if ((count ?? 0) >= LIMITE_POR_HORA) return resp(429, { erro: `Limite de ${LIMITE_POR_HORA} e-mails por hora atingido. Tente mais tarde.` });

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: de, to: pedido.para, subject: pedido.assunto, text: pedido.texto,
      html: htmlDoTexto(pedido.texto), reply_to: user.email,
    }),
  });
  const detalhe = await r.text();
  const ok = r.ok;
  await sb.from('emails_enviados').insert({
    usuario_id: user.id, para: pedido.para, assunto: pedido.assunto, entidade: pedido.entidade, entidade_id: pedido.entidadeId,
    status: ok ? 'enviado' : 'erro', erro: ok ? null : detalhe.slice(0, 500),
  });
  if (!ok) return resp(502, { erro: 'O serviço de e-mail recusou o envio.', detalhe: detalhe.slice(0, 300) });
  return resp(200, { ok: true, para: pedido.para });
}

// @ts-ignore: Deno só existe no ambiente das Edge Functions
if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(tratar);
