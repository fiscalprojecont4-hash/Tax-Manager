# Tax Manager — Projecont Fiscal

Plataforma interna multiusuário de operações fiscais da Projecont. Substitui o protótipo single-file
HTML ("PROJECONT FISCAL") por uma arquitetura real: login, isolamento de dados por equipe (Row-Level
Security), calendário fiscal oficial aprovado por gestores e integração com o AM PRO.

- **Site:** https://fiscalprojecont4-hash.github.io/Tax-Manager/
- **Banco e autenticação:** Supabase (projeto `debwbmbhmtimozhkeyql`).

## Estado atual

| Área | Situação |
|---|---|
| Login, equipes e papéis (Alpha, Beta, Omega) | ✅ No ar. Cada analista administra a própria equipe; o gestor administra as três. |
| Esqueci minha senha (`redefinir-senha.html`) | ✅ Pronto. Exige cadastrar a URL em *Authentication › URL Configuration › Redirect URLs*. |
| Calendário oficial (Receita Federal e SEFAZ-AM) | ✅ Ingestão diária como rascunho; aprovação em *Administração › Calendário oficial*. |
| Integração com o AM PRO | ✅ Espelho de empresas e obrigações por equipe; API do calendário aprovado. |
| Dashboard com indicadores do AM PRO | ✅ Métrica escolhida por bloco (botão direito), progresso por obrigação. |
| Empresas | ✅ Vêm do AM PRO (só leitura) em Administração, Validações, Conhecimento e Tarefas. |
| Tarefas | ✅ Gravadas no banco (tabela `tarefas`), por equipe; atualizam sozinhas a cada minuto. Delegado = membro da equipe no AM PRO. |
| Validações, Conhecimento, Projetos, Calendário (eventos), Categorias | ✅ No banco (tabela `dados_equipe`, um registro por linha em JSON), por equipe, atualizados a cada minuto. A virada de mês (arquivos) é imutável. |
| Envio de e-mail (`enviar-email`) | 🚧 Código pronto; falta publicar a função e configurar o Resend e o DNS. |
| Calendário de execução do AM PRO exibir os prazos aprovados | ⏳ Depende do AM PRO: o cache do calendário já é gravado, falta a tela. |

## Arquitetura

- **Frontend:** HTML/CSS/JS estático (módulos ES), publicado no GitHub Pages, sem etapa de build.
  O `@supabase/supabase-js` vem do CDN.
- **Backend:** Supabase (PostgreSQL + Auth + RLS + Edge Functions). Todo o modelo está em
  `supabase/schema.sql`, que é **idempotente**: pode ser rodado de novo no SQL Editor a cada mudança.
- **Isolamento por equipe:** cada linha operacional pertence a uma equipe e as políticas RLS decidem
  o que cada pessoa lê e grava. A segurança não depende do navegador nem do sigilo da anon key.
- **Papéis por equipe:** `gestor_fiscal`, `analista`, `revisor`, `auditor` (ver `docs/fase-0/02-papeis-permissoes.md`).

## Estrutura

| Caminho | O que é |
|---|---|
| `*.html`, `css/`, `js/` | Telas e scripts: `dashboard`, `tarefas`, `validacoes`, `conhecimento`, `projetos`, `calendar`, `administracao`, `index` (login), `redefinir-senha`. |
| `js/ampro-painel.js` | Painel do AM PRO no dashboard (RPCs de resumo, por membro e por obrigação). |
| `js/empresas-ampro.js` | Carrega as empresas do espelho do AM PRO como cadastro do Tax Manager. |
| `js/dados-teste.js` | Armazenamento local (no navegador) das telas ainda não ligadas ao banco. Sem dados de exemplo: tudo começa vazio. |
| `supabase/schema.sql` | Modelo de dados, RLS, funções e a integração com o AM PRO (seção 13). |
| `supabase/equipes-iniciais.sql` | Cria as equipes Alpha, Beta e Omega e seus membros. |
| `supabase/functions/ampro-integration/` | Receptor do AM PRO (`POST /mirror`, `GET /calendar`) e o contrato `CONTRATO-AMPRO.md`. |
| `supabase/functions/enviar-email/` | Envio de e-mails pelo Resend. |
| `scripts/` + `.github/workflows/ingestao-calendario.yml` | Ingestão diária (06:00 de Brasília) da Receita Federal e da SEFAZ-AM. |
| `docs/fase-0/` | Definição inicial: mapeamento do protótipo, papéis, perfil fiscal e indicadores. |

## Integração com o AM PRO

O AM PRO sempre chama de dentro para fora (nada é aberto na rede da Projecont):

1. **Espelho:** envia um snapshot por equipe e competência com empresas e obrigações; o Tax Manager aplica em
   uma transação, com recibo e idempotência.
2. **Calendário:** consulta os prazos oficiais aprovados do mês.

A credencial é uma só, guardada só como hash no banco, com lista de equipes permitidas. O que cada
analista vê no site vem do espelho, filtrado por RLS. Detalhes em `supabase/functions/ampro-integration/README.md`.

## Como mudar o banco

1. Edite `supabase/schema.sql` (mantenha-o idempotente: `create ... if not exists`, `create or replace`, `drop policy if exists`).
2. Rode o arquivo inteiro no **SQL Editor** do projeto Supabase e confira "Success".
3. Para equipes e membros, rode `supabase/equipes-iniciais.sql`.

## Desenvolvimento local

```bash
npm install                      # só para desenvolvimento (não vai para o site publicado)
python3 -m http.server 8080      # serve a pasta; abra http://localhost:8080

# testes
node scripts/ingestao-receita.test.mjs
node scripts/ingestao-sefaz-am.test.mjs
node --experimental-strip-types supabase/functions/ampro-integration/index.test.mjs
node --experimental-strip-types supabase/functions/enviar-email/index.test.mjs
```

A URL e a anon key públicas do Supabase ficam em `js/supabase-client.js`. **Nunca** coloque no repositório a
`service_role`, a credencial do AM PRO ou senhas: a ingestão usa os Secrets `SUPABASE_URL` e
`SUPABASE_SERVICE_KEY` do GitHub Actions.

## Próximos passos

1. Notificações e relatórios diários ainda ficam só no navegador.
2. Publicar `enviar-email` e configurar o Resend e o DNS.
3. O AM PRO exibir os prazos aprovados no calendário de execução.
4. Decidir quais dados reais migrar (`docs/fase-0/01-mapeamento-atual.md`).
