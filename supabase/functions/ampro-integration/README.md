# ampro-integration — receptor do Tax Manager para o AM PRO

Implementa o contrato **`CONTRATO-AMPRO.md`** (v1, escrito pelo lado do AM PRO). O AM PRO sempre chama de dentro para fora; nada é aberto na rede da Projecont.

| Rota | Quem chama | O que faz |
|---|---|---|
| `POST /mirror` | AM PRO | Snapshot de uma equipe e competência (empresas + obrigações/execução). Aplicado em **uma transação**, com recibo e idempotência. |
| `GET /calendar?competence=AAAA-MM` | AM PRO | Calendário fiscal aprovado do mês, com versões substituídas. Lê o mês inteiro (sem truncar em 1000 linhas). |

## Como a segurança funciona

- Credencial única do serviço (`Authorization: Bearer <segredo>`): 32 bytes aleatórios em base64url (43 caracteres). No banco fica **só o SHA-256**.
- A credencial tem uma lista de equipes que pode escrever (`ampro_chaves.equipes`); `team.id` fora da lista = `403`.
- Isolamento: cada linha do espelho pertence a UMA equipe. Pela RLS, cada analista lê o espelho da própria equipe, e o administrador lê as três. Nada vem do navegador (e-mail, papel ou equipe informados pela página não valem).
- A função é publicada com `verify_jwt = false` (ver `supabase/config.toml`) porque o segredo não é um JWT. A validação do segredo é feita no início da função, antes de qualquer leitura ou gravação.
- O log (`ampro_log`) guarda só rota, equipe, contagem e código HTTP. Nunca o corpo nem a credencial.
- Limite: 300 chamadas por minuto por credencial; corpo de até 8 MB (`413`).

## Respostas

`200` aceito (inclusive repetição da mesma revisão, sem duplicar) · `400` corpo/competência/campo inválido (nada é gravado) · `401` credencial ausente, inválida ou revogada · `403` equipe fora do escopo · `409` snapshot anterior ao já aceito · `413` grande demais · `429` limite · `500` falha (nada foi confirmado). Erros vêm como `{"error":"…","message":"…"}`.

## Regras do snapshot

- Recusa o snapshot **inteiro** (`400`) se faltar `id`, houver `id` repetido ou uma obrigação apontar para empresa fora do payload.
- `409` quando `sourceUpdatedAt.cycle` é anterior ao último aceito da mesma equipe+competência, ou `sourceUpdatedAt.companies` é anterior ao último aplicado na equipe. A decisão usa as datas, nunca a ordem do hash.
- Empresa/obrigação só é sobrescrita se o `updatedAt` recebido não for mais antigo que o gravado.
- Registros ausentes no snapshot **não** são excluídos.
- `dueDate` vazio fica vazio (sem inventar prazo). `executorTeamId` é guardado, mas a propriedade continua sendo de `team.id`.
- O `revision` é validado só no formato (SHA-256 hexadecimal) e usado como chave de idempotência (`Idempotency-Key`, quando enviado, precisa ser igual). Esta função **não recalcula** o hash do corpo.

## Calendário: o que sai e o que não sai

- `approved` = aprovado no Calendário oficial; `superseded` = versão antiga trocada por uma nova aprovada (a nova traz `replacesId`).
- `cancelled` **nunca é enviado** por enquanto: o Tax Manager ainda não tem cancelamento explícito. Rascunho e rejeitado não aparecem.
- Se o gestor **desfaz** uma aprovação, o item volta a rascunho e some da resposta do mês. O contrato não tem como avisar isso, então o AM PRO só perceberá por ausência. Se isso importar, o próximo passo é criar um status de cancelamento.
- Quando uma nova versão muda o vencimento de mês, a versão antiga continua no mês antigo como `superseded` e a nova aparece no mês novo com `replacesId`.

## Publicar (passo a passo)

1. **SQL Editor:** rodar o `supabase/schema.sql` de novo (seção 13; é idempotente). As equipes Alpha, Beta e Omega já existem, e a seção liga `fiscal`→Alpha, `omega`→Omega e `beta`→Beta.
2. **Publicar a função** `ampro-integration` (código: `index.ts`). Com o CLI: `supabase functions deploy ampro-integration --no-verify-jwt`. Pelo painel: Edge Functions → Deploy new function → colar o `index.ts` → desligar **Verify JWT**.
3. **Criar a credencial** no SQL Editor. O segredo aparece **uma única vez** no resultado; copie direto para o `.env.local` do servidor do AM PRO (`TAX_MANAGER_INTEGRATION_KEY`), sem colar em chat ou e-mail:
   ```sql
   select * from private.criar_chave_ampro();
   ```
4. **URL para o AM PRO** (`TAX_MANAGER_INTEGRATION_URL`): `https://debwbmbhmtimozhkeyql.supabase.co/functions/v1/ampro-integration`
5. **Trocar o segredo:** criar outro com o passo 3, colocar no AM PRO e revogar o antigo: `select private.revogar_chave_ampro('<chave_id>');`
6. **Acompanhar:** `select * from public.ampro_recibos order by aceito_em desc;` e `select * from public.ampro_log order by criado_em desc limit 50;`
7. Piloto: `npm run tax:sync -- fiscal 2026-09 --live` no AM PRO, **duas vezes**, e conferir que as contagens não dobram. Depois, entrar como Beta e confirmar que não aparece nada da Alpha.

## Testes

```bash
node --experimental-strip-types supabase/functions/ampro-integration/index.test.mjs
```
Cobre a validação do contrato, autenticação, escopo de equipes, idempotência/409/falhas (HTTP), calendário com mais de 1000 eventos e limite de chamadas. A transação, a idempotência e a RLS foram testadas à parte, em Postgres.
