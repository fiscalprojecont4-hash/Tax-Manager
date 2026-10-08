# Fase 0 — Equipes, papéis e permissões

## Contexto atual

Desenvolvimento solo (Wendel + Claude). Hoje não há equipe formal usando a ferramenta — mas o
modelo de dados e RLS devem ser desenhados para múltiplos usuários/equipes desde o início,
porque isolar depois é muito mais caro do que isolar desde a primeira tabela.

## Papéis (conforme o plano, adaptado ao contexto da Projecont)

| Papel | Escopo | Quem é hoje `[CONFIRMAR]` |
|---|---|---|
| Administrador do sistema | usuários, equipes, integrações, retenção, configuração | Wendel |
| Gestor fiscal | visualiza/gerencia equipes autorizadas, aprova itens de calendário, padrões, playbooks | Wendel |
| Analista | opera tarefas, validações, empresas e incidentes dentro da equipe designada | Wendel (+ futuros analistas da equipe fiscal) |
| Revisor | revisa validações, evidências, relatórios, correções e registros de conhecimento | a definir |
| Auditor (somente leitura) | consulta registros autorizados e histórico de auditoria sem alterar dados | a definir |

Um usuário pode ter mais de um papel, mas a troca de "contexto de equipe" deve sempre ser
validada no servidor (nunca confiar em um `team_id` só porque o navegador mandou).

## Equipes `[CONFIRMAR]`

A Projecont tem quantas equipes/times fiscais hoje (ex.: equipe Simples Nacional, equipe Lucro
Real/Presumido, equipe específica por cliente)? Isso define a granularidade do `team_id` —
muito grosso (uma equipe só) não resolve isolamento de verdade; muito fino sem necessidade
aumenta a complexidade de gestão de permissões sem ganho real.

## Critério de aceite (herdado do plano, seção 20)

Nenhuma release de produção deve ser aceita até que um usuário não consiga acessar registros
de outra equipe por interface, URL, API, exportação, notificação ou caminho de arquivo — e
esse teste deve ser feito tentando ativamente (trocar IDs na URL, payload, etc.), não só
confiando no desenho da tela.
