# Fase 0 — Campos de perfil fiscal da empresa (para aplicabilidade de obrigações)

Sem esses campos estruturados, o motor de aplicabilidade do calendário (seção 15 do plano) não
consegue decidir quais obrigações valem para qual empresa — é por isso que o plano rejeita
"calendário igual para todo mundo" como regra absoluta.

## Campos propostos `[CONFIRMAR / AJUSTAR COM WENDEL]`

| Campo | Exemplo | Por quê |
|---|---|---|
| CNPJ | — | identificador único |
| Razão social / nome fantasia | — | exibição |
| Regime tributário | Simples Nacional / Lucro Presumido / Lucro Real | define quais obrigações (EFD Contribuições, DCTFWeb, PGDAS, etc.) se aplicam |
| UF | AM | obrigações estaduais (SEFAZ-AM) |
| Município | Manaus | obrigações municipais (ISS) — relevante porque o escritório já lida com ISS de mais de um município, pelo histórico de tarefas |
| Atividade / CNAE principal | — | determina obrigações setoriais (ex.: fabricação de cerveja já aparece várias vezes nas tarefas — IPI, controle de produção) |
| Benefício fiscal ZFM/Suframa | sim/não + inscrição Suframa | relevante dado o contexto amazonense — aparece repetidamente (Disbral, Rego, Gurupy) |
| Equipe responsável (`team_id`) | — | isolamento de dados |
| Status do processo de procuração/certificado digital | ativo / pendente / vencido | já é rastreado manualmente hoje ("levantamento de empresas sem procuração/certificado") |
| Situação cadastral no sistema de gestão (Gestta/Alterdata) | ativo / sem cadastro | hoje rastreado manualmente também |

## Observação

Vários desses campos já aparecem como necessidade recorrente nas tarefas reais do escritório
(controle de procuração/certificado, cadastro no Gestta, inscrição Suframa, regime tributário
para simulação). Isso é um bom sinal de que o modelo de dados bate com o trabalho real, não só
com o que o plano sugere em abstrato.
