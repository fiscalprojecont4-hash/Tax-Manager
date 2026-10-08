# Fase 0 — Mapeamento do protótipo atual (gestao_tarefas.html)

Status: rascunho inicial a partir do histórico de desenvolvimento do protótipo. Precisa de
revisão do Wendel antes de ser considerado definitivo (marcar `[CONFIRMAR]` onde houver dúvida).

## 1. Módulos / telas existentes

| Módulo | Função | Armazenamento atual |
|---|---|---|
| Gestão de Tarefas | tarefas do dia a dia, prazos, delegados, prioridade, status | `localStorage` / `window.storage` |
| Empresas para Validação | checklist de validação fiscal por empresa (status, atividade) | idem |
| Memória & Padrões | histórico de achados/soluções agregados por categoria (texto livre) | idem |
| Planejamento Semanal | tarefas recorrentes de validação e planejamento mensal | idem |
| Calendário Fiscal | obrigações fiscais, exportação `.ics` | idem |
| Gestão de Projetos | iniciativas multi-etapa (cliente, responsável, prazo, etapas, histórico) | idem |
| Notificações (sino) | alertas in-app, não depende da permissão do navegador | idem, checagem via `setInterval` na aba aberta |

## 2. Limitações estruturais confirmadas (não são bugs — são a razão da migração)

- Dado mora no navegador/host: sem banco central, sem backup, sem transação, sem controle de
  concorrência entre usuários.
- Sem autenticação real nem isolamento por equipe — qualquer "login" seria só visual.
- Notificações e jobs dependem da aba estar aberta — não há processamento em segundo plano.
- Chaves de API (quando usadas) ficam expostas no código acessível pelo navegador.
- Tudo concentrado em um único arquivo HTML — difícil de testar e evoluir com segurança.
- `Memória & Padrões` usa texto livre, sem taxonomia — limita busca e qualquer tentativa de
  detecção de padrões futura.
- `historico` dos projetos é texto livre (`addHistorico`), não um log estruturado
  ator/ação/entidade/valor-antes/valor-depois.

## 3. Regras de negócio relevantes já capturadas no protótipo

- Tarefas e validações têm prioridade, status, delegado/responsável e prazo com destaque de
  atraso (`isOverdue`).
- Projetos são compostos por etapas, cada etapa com seu próprio responsável/prazo/status
  (confirmado pelo Wendel: "cada etapa também tem seus próprios responsável/prazo/status, meio
  como uma mini-tarefa dentro do projeto").
- Progresso do projeto é calculado como `etapas concluídas / total de etapas`.
- `mailto:` precisa de clique síncrono num `<a>` (gotcha técnico já documentado — não teria
  equivalente direto na nova arquitetura, já que e-mail deixa de depender do cliente de e-mail
  do navegador se notificações passarem a ser server-side).

## 4. O que NÃO existe no protótipo e o plano pede para a Fase 1+

- Autenticação / usuários / equipes
- Perfil fiscal estruturado da empresa (regime, UF, município, atividade) para aplicabilidade
  de obrigações
- Log de auditoria estruturado (ator, ação, entidade, valor antes/depois, timestamp)
- Checklist versionado de validação com fluxo de revisão (aprovar/rejeitar/devolver)
- Separação entre modelo de recorrência (`recurrence_template`) e instância gerada
  (`task_instance`)
- Ingestão de calendário oficial (SEFAZ-AM / Receita Federal) com versionamento e aprovação

## 5. Dados a migrar vs. dados de demonstração `[CONFIRMAR COM WENDEL]`

Pendente de decisão:
- As tarefas/projetos/empresas atualmente no protótipo (ex.: Rembraz, Disbral, Tecnoradio,
  Lusitano, etc.) são dados reais de trabalho e devem ser migrados, ou o protótipo foi usado
  também com dados de teste que não devem ir para o banco novo?
- Há necessidade de preservar o histórico de tarefas já concluídas (ex.: a lista de tarefas de
  agosto/2026 enviada) como registro histórico, ou o início da nova plataforma zera o
  histórico operacional e mantém o PDF/texto antigo só como referência arquivada?

Recomendação: migrar apenas empresas/cadastros-base (não o histórico de tarefas concluídas) no
piloto da Fase 2, e tratar listas de tarefas antigas (como a de agosto/2026) como material de
referência arquivado, não como dado a importar linha por linha.
