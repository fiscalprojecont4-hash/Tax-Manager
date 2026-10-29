# Função ampro-integration — documento para o AM PRO

Contrato HTTP v1 para espelhar dados do AM PRO no Tax Manager e consultar o calendário fiscal no sentido inverso.

**Estado:** conector AM PRO implementado localmente. Este README especifica a função receptora; não confirma sua implementação ou publicação no Supabase. Credencial, contas vinculadas e agendamentos ainda dependem de configuração.

## 1. Endereço e autenticação

URL base prevista:

```text
https://<projeto>.supabase.co/functions/v1/ampro-integration
```

Configuração no servidor AM PRO, em `.env.local`:

```dotenv
TAX_MANAGER_INTEGRATION_URL=https://<projeto>.supabase.co/functions/v1/ampro-integration
TAX_MANAGER_INTEGRATION_KEY=<segredo-da-integracao>
```

Todas as chamadas usam:

```http
Authorization: Bearer <segredo-da-integracao>
```

- HTTPS obrigatório; o cliente recusa redirecionamentos.
- Gerar ao menos 32 bytes aleatórios, codificados em base64url, para a credencial dedicada. O cliente aceita caracteres A–Z, a–z, 0–9, _ e -, com no mínimo 43 caracteres.
- O receptor deve validar o hash da credencial em tempo constante, restringir as equipes permitidas e permitir revogação/rotação.
- Não usar a chave pública anon nem a administrativa service_role como segredo compartilhado.
- Não colocar o segredo no GitHub Pages, navegador, logs ou variável NEXT_PUBLIC_.
- A credencial é do serviço. Os analistas continuam entrando com suas contas do Supabase Auth.
- A Edge Function deve configurar seu gateway de autenticação para aceitar este token dedicado e validá-lo no handler. Ele não é um JWT do Supabase Auth. Nunca desabilitar a verificação do gateway sem implementar a validação do token na função.

## 2. Equipes e usuários

| Equipe exibida | ID AM PRO | Analista | E-mail Tax Manager |
| --- | --- | --- | --- |
| Alpha | fiscal | Jhonathan | fiscal6@projecont.com.br |
| Omega | omega | Marcel | fiscal4@projecont.com.br |
| Beta | beta | PH | fiscal5@projecont.com.br |

Wendel: `gerencia.fiscal@projecont.com.br` → usuário AM PRO `wendel`, gestor fiscal das três equipes e administrador. Halen não deve ser provisionado nesta integração.

O manifesto desses vínculos está em `TAX_MANAGER_BINDINGS`. Ele não cria contas ou permissões automaticamente. Vincular administrativamente o usuário Auth confirmado ao ID do AM PRO e mapear cada equipe aos UUIDs existentes no Tax Manager. Depois do vínculo, usar IDs estáveis.

O banco receptor deve aplicar RLS: cada analista lê o espelho da própria equipe; Wendel lê as três. Não confiar em e-mail, papel ou equipe informados pelo navegador.

## 3. Enviar o espelho operacional

```http
POST <URL_BASE>/mirror
Authorization: Bearer <segredo>
Content-Type: application/json
Idempotency-Key: <revision>
```

### Campos do corpo

| Campo | Tipo | Regra |
| --- | --- | --- |
| schemaVersion | número | Sempre 1 |
| source | texto | Sempre ampro |
| mode | texto | Sempre snapshot |
| team.id | texto | fiscal, omega ou beta |
| team.name | texto | Alpha, Omega ou Beta; não concede autorização |
| competence | texto | AAAA-MM, mês de 01 a 12 |
| sourceUpdatedAt.companies | texto | Data/hora da versão do cadastro de empresas |
| sourceUpdatedAt.cycle | texto | Data/hora da versão do ciclo operacional |
| companies | lista | Cadastro da equipe |
| obligations | lista | Obrigações do ciclo enviado |
| revision | texto | SHA-256 hexadecimal do corpo sem revision |

O conector ordena empresas e obrigações por ID antes de calcular a revisão. O hash usa `JSON.stringify(data)` e a ordem das propriedades produzida pelo conector; reordenar propriedades no receptor e recalcular pode mudar o hash. Se o receptor verificar o digest, reconstruir exatamente a mesma projeção e ordem.

### Cada empresa em companies

| Campo | Tipo | Conteúdo |
| --- | --- | --- |
| id | texto | companyId original, estável e único na equipe |
| name / displayName | texto | Nome e nome de exibição |
| cnpj | texto | Documento conforme o cadastro original |
| state | texto | UF, ou texto vazio |
| stateRegistration | texto | Inscrição estadual, ou texto vazio |
| alterdataCode | texto | Código Alterdata |
| taxation / regime | texto | Classificação fiscal |
| active | booleano | Situação ativa/inativa |
| responsible | texto | Responsável padrão |
| updatedAt | texto | Data/hora de atualização na origem |

### Cada obrigação em obligations

| Campo | Tipo | Conteúdo |
| --- | --- | --- |
| id | texto | itemId original |
| companyId | texto | Referência a uma empresa do payload da mesma equipe |
| taskKey / taskLabel | texto | Chave e nome da obrigação |
| competence | texto | Competência da obrigação; pode ser retroativa |
| responsible / executor | texto | Responsável fiscal e executor atual |
| executorUserId | texto ou null | ID estável do executor, quando disponível |
| executorTeamId | texto ou null | Equipe do executor, inclusive apoio entre equipes |
| status | texto | Estado oficial, conforme lista abaixo |
| statusLabel | texto | Rótulo de exibição do estado |
| dueDate | texto | Prazo conforme a origem; preservar ausência sem inventar data |
| updatedAt | texto | Última alteração operacional na origem |

Estados oficiais aceitos: `pending`, `in_progress`, `review`, `done`, `impediment`, `not_applicable`.

O espelho pertence a `team.id`; `executorTeamId` não transfere propriedade nem amplia permissões de leitura.

### Regras de processamento

1. Validar contrato, tamanho máximo de requisição, credencial e escopo da equipe antes de gravar.
2. Não aceitar empresas/obrigações sem ID, duplicadas ou com referência a empresa ausente.
3. Manter IDs da origem e gravar em tabelas próprias de espelho. Não sobrescrever tarefas nativas do Tax Manager.
4. Usar chave de empresa por equipe + ID; obrigação por equipe + ciclo + ID.
5. Aplicar o snapshot em transação e guardar recibo. A repetição da mesma revisão retorna o mesmo aceite, sem duplicação.
6. Serializar gravações por equipe/ciclo e recusar snapshots anteriores às versões já aceitas. Não usar ordem lexicográfica do hash para decidir qual revisão é mais nova.
7. Não excluir automaticamente registros ausentes no snapshot nesta etapa.
8. Não registrar corpo, credenciais, anexos ou configurações privadas em logs. O conector já usa lista explícita de campos exportáveis.
9. Não confirmar sucesso antes do COMMIT.

### Resposta de sucesso esperada

HTTP 200, inclusive em repetição idempotente:

```json
{
  "accepted": true,
  "teamId": "fiscal",
  "competence": "2026-09",
  "revision": "<mesma-revisao-enviada>"
}
```

O AM PRO confere accepted, equipe, competência e revisão. Um recibo incompatível interrompe o fluxo.

## 4. Consultar o calendário

```http
GET <URL_BASE>/calendar?competence=2026-09
Authorization: Bearer <segredo>
```

A competência é obrigatória no formato AAAA-MM.

### Resposta esperada

HTTP 200:

```json
{
  "schemaVersion": 1,
  "events": [
    {
      "id": "id-estavel-da-obrigacao-oficial",
      "title": "REINF",
      "dueDate": "2026-09-21",
      "status": "approved",
      "version": 1,
      "replacesId": null,
      "authority": "RFB",
      "sourceUrl": "https://<fonte-oficial>"
    }
  ]
}
```

| Campo do evento | Regra |
| --- | --- |
| id | Texto não vazio, único na resposta e estável entre consultas |
| title | Texto não vazio |
| dueDate | Data real no formato AAAA-MM-DD, sem conversão de fuso |
| status | approved, superseded ou cancelled |
| version | Inteiro a partir de 1 |
| replacesId | ID substituído; null ou omitido quando não houver |
| authority | Texto identificando o órgão |
| sourceUrl | Texto com a referência da fonte oficial |

Mapeamento de `obrigacoes_oficiais`: titulo → title; vencimento → dueDate; orgao → authority; fonte_url → sourceUrl; versao → version; substitui_id → replacesId; aprovado → approved; substituido → superseded.

- Exportar somente publicações aprovadas e seus registros de substituição/cancelamento explícito. Rascunho e rejeitado nunca equivalem a cancelled.
- Eventos superseded/cancelled não são prazos ativos.
- Retornar todo o escopo mensal, sem truncamento silencioso em 1000 linhas. Paginar internamente no receptor.
- Incluir informações de substituição e alterações que movam eventos para outro mês, evitando manter o prazo antigo ativo no espelho.
- `events: []` significa consulta concluída, sem eventos no escopo. Não retornar lista vazia para mascarar falha de banco.

O AM PRO valida toda a resposta antes de substituir atomicamente:

```text
data/integrations/tax-manager/calendar/AAAA-MM.json
```

O cache inclui `competence` e `syncedAt`. Falha de rede ou validação preserva o cache anterior. Nesta etapa, salvar o calendário não altera prazos/status oficiais nem cria a visualização no painel.

## 4.1 Consultar validações e achados (Tax Manager → AM PRO)

Devolve as validações fiscais feitas pela equipe no Tax Manager em uma competência, com os achados de cada uma. Serve para o AM PRO mostrar, ao lado da obrigação, se a conferência foi feita e o que foi encontrado.

```http
GET <URL_BASE>/validations?team=fiscal&competence=2026-09
Authorization: Bearer <segredo>
```

`team` (fiscal, omega ou beta) e `competence` (AAAA-MM) são obrigatórios. A credencial precisa ter a equipe no seu escopo, senão 403.

### Resposta esperada

HTTP 200:

```json
{
  "schemaVersion": 1,
  "team": { "id": "fiscal" },
  "competence": "2026-09",
  "validations": [
    {
      "id": "v1",
      "companyId": "id-da-empresa-no-AM-PRO",
      "companyName": "Acme Ltda",
      "cnpj": "12.345.678/0001-95",
      "activity": "EFD ICMS/IPI",
      "analyst": "Jhonathan",
      "status": "in_progress",
      "closed": false,
      "checklist": { "done": 3, "total": 5 },
      "justification": "",
      "createdAt": "2026-09-02",
      "completedAt": null,
      "updatedAt": "2026-09-10",
      "amends": null,
      "findings": [
        { "id": "p1", "category": "ICMS", "title": "Crédito indevido", "identified": "…", "reason": "…", "guidance": "…" }
      ]
    }
  ]
}
```

| Campo | Regra |
| --- | --- |
| id | Estável: o mesmo id aparece antes e depois do encerramento do mês |
| companyId / cnpj | Preenchidos quando o nome da empresa na validação coincide (sem acento e sem diferenciar maiúsculas) com uma empresa já espelhada pela equipe. Senão, `null`: use `companyName` |
| status | pending, in_progress, impediment, done ou cancelled |
| closed | `true` quando o mês já foi encerrado no Tax Manager (registro imutável); `false` quando ainda está em andamento |
| checklist | Itens do checklist concluídos e total |
| amends | `{ "competence": "AAAA-MM" }` quando a validação é retificadora de outro mês; senão `null` |
| findings | Achados da validação (categoria, o que foi identificado, motivo e orientação). Pode ser vazio |
| createdAt / completedAt / updatedAt | AAAA-MM-DD, ou `null` quando não houver |

- `validations: []` significa que a consulta funcionou e não há validações no mês. Falha de leitura devolve 500, nunca lista vazia.
- A resposta traz só a equipe pedida. Não há dados de outra equipe.
- Sugestão de cache no AM PRO, no mesmo padrão do calendário: `data/integrations/tax-manager/validations/<team>/AAAA-MM.json`, com `competence`, `team` e `syncedAt`. Falha de rede ou validação preserva o cache anterior.
- Frequência sugerida: de hora em hora, junto com o calendário, para a competência vigente e a anterior.

## 4.2 Exibir o calendário aprovado no AM PRO

O endpoint `/calendar` já responde e o AM PRO já guarda o cache. O que falta é mostrar:

- Listar os eventos `approved` do mês no calendário de execução, com `title`, `dueDate`, `authority` e link em `sourceUrl`.
- Ignorar `superseded` como prazo ativo (use `replacesId` para apontar que o prazo mudou).
- Marcar a origem como "Calendário oficial Tax Manager" e mostrar a hora da última sincronização (`syncedAt`).
- Não alterar prazos nem status das obrigações do AM PRO a partir do calendário: ele só informa.

## 5. Respostas de erro previstas para o receptor

Os códigos abaixo são o contrato recomendado para a função a implementar, não evidência de um endpoint já publicado.

| HTTP | Situação | Ação AM PRO |
| --- | --- | --- |
| 400 | Corpo, competência ou campos inválidos | Corrigir requisição |
| 401 | Credencial ausente, inválida ou revogada | Corrigir configuração; não repetir automaticamente |
| 403 | Equipe fora do escopo da credencial | Revisar autorização |
| 409 | Snapshot anterior ou conflito de revisão | Reconciliar origem; não repetir cegamente |
| 413 | Payload acima do limite | Ajustar estratégia de envio |
| 429 | Limite temporário | Nova tentativa com espera |
| 500/502/503/504 | Falha transitória no receptor | Nova tentativa com espera |

Formato sugerido de erro:

```json
{"error":"invalid_payload","message":"Competencia invalida."}
```

O cliente não depende desse corpo e não o reproduz em logs. Hoje tenta até três vezes em falhas de rede, 429 ou 5xx, com espera de 500 ms e 1000 ms. Timeout de 30 segundos por tentativa. Outros 4xx encerram a operação.

O espelho pode ter sido aceito antes de uma falha na consulta do calendário. A próxima execução reenviará a revisão; a idempotência do receptor é necessária para esse cenário.

## 6. Rotina sugerida

| Processo | Frequência proposta |
| --- | --- |
| AM PRO → Tax Manager: dados operacionais | A cada 5 minutos, por equipe e competência |
| Tax Manager → AM PRO: calendário e validações | **De hora em hora**, no minuto 00 |
| Reconciliação | Diariamente, comparando revisão, contagens e última sincronização |

Usar servidor ligado, fuso America/Manaus e bloqueio de sobreposição. Registrar horário, equipe, competência, revisão, contagens e resultado, sem conteúdo sensível.

**Limitação atual:** `syncTaxManager` e o comando `tax:sync --live` enviam o espelho e consultam o calendário na mesma execução. O intervalo independente de uma hora para calendário exige separar os jobs na implementação seguinte. Este README não instala agendamentos nem altera esse comportamento.

Até separar os jobs, uma execução conjunta a cada hora atende à frequência de calendário, mas deixa os dados operacionais também com atualização horária. Para manter cinco minutos no espelho e uma hora no calendário, implementar os dois jobs antes de ativar o agendamento.

Consultar as competências operacionais necessárias, incluindo anteriores ainda abertas. Usar a competência existente na origem; não presumir que a competência fiscal coincide com o mês civil atual.

## 7. Teste para copiar e colar

### Teste local, seguro, sem chave e sem rede

Cole no PowerShell, na pasta do AM PRO:

```powershell
Set-Location -LiteralPath 'C:\Users\USER47\Desktop\Nova pasta\new dorrance'

# Verifica isolamento, contrato, recibos e cache usando HTTP simulado.
node --import tsx --test tests/tax-manager-integration.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Testes da integracao falharam.' }

# Simula os dados existentes de setembro/2026, sem enviar ao Tax Manager.
npm run tax:sync -- all 2026-09
if ($LASTEXITCODE -ne 0) { throw 'Simulacao nao concluida.' }
```

Esperado: testes aprovados e três linhas JSON com `dryRun: true`, para fiscal, omega e beta. Contagens podem mudar conforme os dados locais. Fonte ausente, inválida ou com vínculos inconsistentes deve encerrar com erro; não enviar fallback ou mock.

### Teste HTTP de leitura, somente após publicar a função

Execute no servidor, com URL e segredo já carregados nas variáveis de ambiente da sessão PowerShell. O PowerShell não carrega `.env.local` automaticamente. Não cole o segredo no comando ou no chat.

```powershell
$taxBaseUrl = $env:TAX_MANAGER_INTEGRATION_URL
$taxSecret = $env:TAX_MANAGER_INTEGRATION_KEY
if (-not $taxBaseUrl -or -not $taxSecret) {
    throw 'Configure URL e credencial no ambiente do servidor antes do teste.'
}
$taxEndpoint = [uri]$taxBaseUrl
if ($taxEndpoint.Scheme -ne 'https' -or $taxEndpoint.UserInfo -or $taxEndpoint.Query -or $taxEndpoint.Fragment) {
    throw 'URL invalida: use HTTPS sem credenciais, query ou fragmento.'
}
$taxHeaders = @{ Authorization = ('Bearer ' + $taxSecret) }
$taxResult = Invoke-RestMethod -Method Get -MaximumRedirection 0 -TimeoutSec 30 `
    -Uri ($taxBaseUrl.TrimEnd('/') + '/calendar?competence=2026-09') `
    -Headers $taxHeaders

if ($taxResult.schemaVersion -ne 1 -or $null -eq $taxResult.events) {
    throw 'Resposta fora do contrato.'
}
Write-Output ('Calendario recebido: ' + @($taxResult.events).Count + ' eventos.')
```

Esse teste não modifica dados e imprime apenas uma contagem. A validação completa de cada evento é feita pelo conector AM PRO.

### Piloto de envio real, após configurar receptor e credencial

O comando a seguir grava o espelho Alpha no Tax Manager e recebe o calendário. Usar somente quando o receptor estiver pronto:

```powershell
npm run tax:sync -- fiscal 2026-09 --live
```

Executar duas vezes e conferir no receptor que as contagens não duplicaram. Validar que o login Beta não consulta o espelho Alpha, nem por acesso REST direto. Só depois ampliar para `all`.

## 8. Arquivos AM PRO relacionados

- Conector e manifesto: `src/services/tax-manager-integration.ts`.
- Comando: `scripts/sync-tax-manager.ts`.
- Testes: `tests/tax-manager-integration.test.ts`.
- Documento inicial: `docs/integracao-tax-manager.md`.

Próximas entregas: receptor Supabase com RLS e idempotência, vínculo dos usuários Auth, credencial de serviço, jobs separados e visualização do calendário no AM PRO.
