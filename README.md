# Tax Manager — Projecont Fiscal

Plataforma interna multiusuário de operações fiscais da Projecont, substituindo o protótipo
single-file HTML ("PROJECONT FISCAL" / gestao_tarefas.html) por uma arquitetura real com
autenticação, isolamento de dados por equipe (Row-Level Security) e processamento em segundo
plano para tarefas recorrentes, notificações e calendário fiscal.

## Status

🚧 Fase 0 — Definição. Nenhuma funcionalidade implementada ainda. Ver `docs/fase-0/` conforme
for sendo produzido.

## Arquitetura

- **Frontend**: HTML/CSS/JS estático, publicado via GitHub Pages (sem framework com servidor
  próprio — sem Next.js). Reaproveita os conceitos visuais validados no protótipo original.
- **Backend**: Supabase (PostgreSQL + Auth + Row-Level Security + Edge Functions para jobs
  agendados).
- **Isolamento multiusuário**: `team_id` em toda tabela operacional, aplicado via políticas
  RLS no banco — nunca confiado apenas ao que o navegador envia.

Esse é o mesmo padrão já usado com sucesso no Restoo (outro projeto do Wendel).

## Desenvolvimento local

```bash
npm install          # dependências de desenvolvimento (não vão para o site publicado)
cp .env.example .env.local
# preencher .env.local com a URL e a anon key do projeto Supabase
```

O site publicado no GitHub Pages carrega o `@supabase/supabase-js` via CDN
(`<script type="module">`), não via bundle do `node_modules` — mantendo o deploy simples,
sem etapa de build.

## Documentação

- `docs/fase-0/` — mapeamento de telas, entidades, papéis e critérios de aceite (Fase 0 do
  plano de implantação).
- `supabase/schema.sql` — modelo de dados PostgreSQL com RLS (a ser criado na Fase 1).
