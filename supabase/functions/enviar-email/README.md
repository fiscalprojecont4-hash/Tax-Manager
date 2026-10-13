# enviar-email — envio de e-mails pelo Tax Manager

O ícone de e-mail em **Tarefas** e **Validações** chama esta função, que envia pelo [Resend](https://resend.com).

- **Tarefas:** vai para os e-mails do campo "Notificar"; se estiver vazio, para o e-mail do usuário a quem a tarefa foi delegada.
- **Validações:** vai para o e-mail do analista da validação (procurado pelo nome na tabela `perfis`).
- O "responder para" é sempre quem clicou. Todo envio fica em `public.emails_enviados` (sem o corpo do e-mail).
- Limites: 10 destinatários por e-mail e 30 e-mails por hora por usuário. Só membro ativo de equipe envia.

## Como colocar no ar

1. **Banco:** rode `supabase/schema.sql` de novo no SQL Editor (cria `emails_enviados`; o arquivo é idempotente).
2. **Resend:** crie a conta, adicione o domínio `projecont.com.br` em *Domains* e crie os registros DNS que ele mostrar
   (SPF/DKIM). Depois crie uma *API key* (permissão de envio).
3. **Função:** Supabase → *Edge Functions* → *Deploy a new function* → nome `enviar-email` → cole o conteúdo de `index.ts`
   → *Deploy*. (Deixe "Verify JWT" ligado.)
4. **Secrets:** Supabase → *Edge Functions* → *Secrets*:
   - `RESEND_API_KEY` = a chave do Resend (`re_...`)
   - `EMAIL_FROM` = `Tax Manager <nao-responda@projecont.com.br>` (o domínio precisa estar verificado)
   - `EMAIL_DOMINIOS` (opcional) = `projecont.com.br` para só permitir destinatários desse domínio.

Enquanto a função não estiver no ar, o ícone abre o programa de e-mail do usuário (comportamento antigo).

## Teste do código

    node --experimental-strip-types supabase/functions/enviar-email/index.test.mjs
