-- =====================================================================
-- PROJECONT FISCAL — schema.sql
-- PostgreSQL 15+ / Supabase
--
-- Como aplicar: Supabase → SQL Editor → colar este arquivo inteiro → Run.
-- O arquivo é idempotente (pode rodar de novo sem duplicar nada).
--
-- Princípios (docs/fase-0/02-papeis-permissoes.md):
--   1. Isolamento por equipe desde a primeira tabela: toda linha de trabalho
--      carrega equipe_id e a RLS decide pelo servidor, nunca pelo navegador.
--   2. Quem não tem vínculo com nenhuma equipe não enxerga nada.
--   3. Filhos carregam equipe_id e uma FK composta com o pai — o banco recusa
--      uma linha filha apontando para o pai de outra equipe.
--   4. Toda mudança relevante cai em audit_log (ator, ação, antes, depois).
--   5. Nenhum dado de cliente neste arquivo. A carga de empresas é feita à
--      parte, direto no banco (o repositório é público).
--
-- Papéis por equipe (membros_equipe.papel):
--   gestor_fiscal  gerencia a equipe, aprova calendário e checklists
--   analista       opera tarefas, validações, empresas, projetos
--   revisor        revisa validações e achados
--   auditor        somente leitura (inclui audit_log)
-- Administrador do sistema = perfis.administrador (global, todas as equipes).
--
-- Seções:
--   0 Utilidades        5 Validações (checklist, achados)
--   1 Acesso            6 Projetos
--   2 Empresas          7 Calendário (eventos + obrigações oficiais)
--   3 Auditoria         8 Notificações
--   4 Tarefas           9 RLS · 10 Triggers · 11 Permissões
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. UTILIDADES
-- ---------------------------------------------------------------------

-- Funções auxiliares ficam em "private": o PostgREST (API do Supabase) só
-- expõe "public", então nada daqui vira endpoint.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.cpf_valido(doc text)
returns boolean language plpgsql immutable as $$
declare
  s int; r int; i int;
begin
  if doc is null or doc !~ '^[0-9]{11}$' or doc ~ '^(.)\1{10}$' then return false; end if;
  s := 0;
  for i in 1..9 loop s := s + substr(doc, i, 1)::int * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(doc, 10, 1)::int then return false; end if;
  s := 0;
  for i in 1..10 loop s := s + substr(doc, i, 1)::int * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(doc, 11, 1)::int;
end $$;

create or replace function private.cnpj_valido(doc text)
returns boolean language plpgsql immutable as $$
declare
  p1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  p2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int; r int; i int; d1 int;
begin
  if doc is null or doc !~ '^[0-9]{14}$' or doc ~ '^(.)\1{13}$' then return false; end if;
  s := 0;
  for i in 1..12 loop s := s + substr(doc, i, 1)::int * p1[i]; end loop;
  r := s % 11; d1 := case when r < 2 then 0 else 11 - r end;
  if d1 <> substr(doc, 13, 1)::int then return false; end if;
  s := 0;
  for i in 1..12 loop s := s + substr(doc, i, 1)::int * p2[i]; end loop;
  s := s + d1 * p2[13];
  r := s % 11;
  return (case when r < 2 then 0 else 11 - r end) = substr(doc, 14, 1)::int;
end $$;

create or replace function private.set_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;


-- ---------------------------------------------------------------------
-- 1. ACESSO: perfis, equipes, membros
-- ---------------------------------------------------------------------

-- Um perfil por usuário do Supabase Auth (criado automaticamente no cadastro).
create table if not exists public.perfis (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  nome          text,
  administrador boolean not null default false,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.equipes (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null unique,
  descricao     text,
  ativa         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Um usuário pode ter mais de um papel na mesma equipe (uma linha por papel).
create table if not exists public.membros_equipe (
  equipe_id  uuid not null references public.equipes (id) on delete cascade,
  usuario_id uuid not null references public.perfis (id) on delete cascade,
  papel      text not null check (papel in ('gestor_fiscal','analista','revisor','auditor')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  primary key (equipe_id, usuario_id, papel)
);
create index if not exists membros_equipe_usuario_idx on public.membros_equipe (usuario_id) where ativo;

-- Cria o perfil assim que o usuário se cadastra no Auth.
create or replace function private.criar_perfil()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfis (id, email, nome)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'nome', split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists criar_perfil on auth.users;
create trigger criar_perfil after insert on auth.users
  for each row execute function private.criar_perfil();

-- Funções de permissão usadas por todas as policies. SECURITY DEFINER para
-- consultar membros_equipe sem recursão de RLS; search_path vazio por segurança.
create or replace function private.eh_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.administrador from public.perfis p where p.id = auth.uid() and p.ativo), false)
$$;

create or replace function private.eh_membro(p_equipe uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.eh_admin() or exists (
    select 1 from public.membros_equipe m
    where m.equipe_id = p_equipe and m.usuario_id = auth.uid() and m.ativo)
$$;

create or replace function private.tem_papel(p_equipe uuid, p_papeis text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select private.eh_admin() or exists (
    select 1 from public.membros_equipe m
    where m.equipe_id = p_equipe and m.usuario_id = auth.uid() and m.ativo
      and m.papel = any (p_papeis))
$$;

create or replace function private.tem_papel_em_alguma_equipe(p_papeis text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select private.eh_admin() or exists (
    select 1 from public.membros_equipe m
    where m.usuario_id = auth.uid() and m.ativo and m.papel = any (p_papeis))
$$;

-- Os dois usuários participam de alguma equipe em comum? (para ver nomes de colegas)
create or replace function private.compartilham_equipe(p_usuario uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.membros_equipe a
    join public.membros_equipe b on b.equipe_id = a.equipe_id
    where a.usuario_id = auth.uid() and a.ativo and b.usuario_id = p_usuario and b.ativo)
$$;


-- ---------------------------------------------------------------------
-- 2. EMPRESAS (cadastro dos clientes)
-- ---------------------------------------------------------------------
-- Uma linha por CÓDIGO do Alterdata. O mesmo CNPJ pode aparecer em mais de um
-- código (ex.: várias inscrições da mesma empresa), por isso documento não é
-- único; cnpj_raiz agrupa matriz e filiais.
-- Contém CPF de pessoas físicas: dado pessoal (LGPD), protegido pela RLS.

create table if not exists public.empresas (
  id                 uuid primary key default gen_random_uuid(),
  codigo             integer unique,                       -- código no Alterdata
  tipo_pessoa        text not null check (tipo_pessoa in ('PJ','PF')),
  documento          text not null,                        -- só dígitos
  cnpj_raiz          text generated always as
                       (case when tipo_pessoa = 'PJ' then left(documento, 8) end) stored,
  razao_social       text not null,
  nome_fantasia      text,
  etiqueta           text,                                 -- ex.: 'Holding'
  -- perfil fiscal (docs/fase-0/03-perfil-fiscal-empresa.md)
  regime_tributario  text check (regime_tributario in
                       ('simples_nacional','lucro_presumido','lucro_real','mei','outro')),
  uf                 char(2),
  municipio          text,
  cnae_principal     text,
  beneficio_zfm      boolean not null default false,
  inscricao_suframa  text,
  procuracao_status  text check (procuracao_status in ('ativo','pendente','vencido','nao_se_aplica')),
  certificado_status text check (certificado_status in ('ativo','pendente','vencido','nao_se_aplica')),
  situacao_gestta    text check (situacao_gestta in ('ativo','sem_cadastro')),
  ativa              boolean not null default true,
  observacoes        text,
  criado_por         uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now(),
  constraint empresas_documento_valido check (
    (tipo_pessoa = 'PJ' and private.cnpj_valido(documento)) or
    (tipo_pessoa = 'PF' and private.cpf_valido(documento)))
);
create index if not exists empresas_documento_idx on public.empresas (documento);
create index if not exists empresas_raiz_idx      on public.empresas (cnpj_raiz);
create index if not exists empresas_razao_idx     on public.empresas (lower(razao_social));

-- Quais equipes atendem a empresa (N:N — uma empresa pode ser atendida por
-- mais de uma equipe). É este vínculo que libera a visibilidade.
create table if not exists public.empresa_equipes (
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  equipe_id  uuid not null references public.equipes (id) on delete cascade,
  criado_em  timestamptz not null default now(),
  primary key (empresa_id, equipe_id)
);
create index if not exists empresa_equipes_equipe_idx on public.empresa_equipes (equipe_id);

create table if not exists public.inscricoes_estaduais (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  uf         char(2) not null default 'AM',
  numero     text not null,
  ativa      boolean not null default true,
  criado_em  timestamptz not null default now(),
  unique (empresa_id, uf, numero)
);

create or replace function private.pode_ver_empresa(p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.eh_admin() or exists (
    select 1 from public.empresa_equipes ee
    where ee.empresa_id = p_empresa and private.eh_membro(ee.equipe_id))
$$;

create or replace function private.pode_editar_empresa(p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.eh_admin() or exists (
    select 1 from public.empresa_equipes ee
    where ee.empresa_id = p_empresa
      and private.tem_papel(ee.equipe_id, array['gestor_fiscal','analista']))
$$;

-- Empresa recém-criada, ainda sem vínculo: só quem criou enxerga/edita (para
-- conseguir vincular à equipe logo em seguida).
-- sem_vinculo() olha só empresa_equipes (não relê "empresas"), por isso funciona
-- no próprio INSERT ... RETURNING, onde a linha nova ainda não é visível a
-- consultas feitas dentro de funções.
create or replace function private.sem_vinculo(p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.empresa_equipes ee where ee.empresa_id = p_empresa)
$$;

create or replace function private.criada_por_mim_sem_vinculo(p_empresa uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.empresas e where e.id = p_empresa and e.criado_por = auth.uid())
         and private.sem_vinculo(p_empresa)
$$;

-- Tarefas, validações e projetos só podem apontar para empresas que a própria
-- equipe atende: a FK composta (empresa_id, equipe_id) usa a chave primária acima.


-- ---------------------------------------------------------------------
-- 3. AUDITORIA (log estruturado, somente inserção)
-- ---------------------------------------------------------------------

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  ocorrido_em timestamptz not null default now(),
  ator_id     uuid,                      -- null = job/serviço (service_role)
  equipe_id   uuid,                      -- null = registro global (ex.: empresas)
  acao        text not null check (acao in ('INSERT','UPDATE','DELETE')),
  entidade    text not null,             -- nome da tabela
  entidade_id text,
  antes       jsonb,
  depois      jsonb
);
create index if not exists audit_log_entidade_idx on public.audit_log (entidade, entidade_id, ocorrido_em desc);
create index if not exists audit_log_equipe_idx   on public.audit_log (equipe_id, ocorrido_em desc);

create or replace function private.registrar_auditoria()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_antes jsonb; v_depois jsonb; v_ref jsonb;
begin
  if tg_op in ('UPDATE','DELETE') then v_antes  := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_depois := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and v_antes = v_depois then return null; end if;
  v_ref := coalesce(v_depois, v_antes);
  insert into public.audit_log (ator_id, equipe_id, acao, entidade, entidade_id, antes, depois)
  values (auth.uid(),
          nullif(v_ref ->> 'equipe_id', '')::uuid,
          tg_op, tg_table_name,
          coalesce(v_ref ->> 'id', v_ref ->> 'empresa_id'),
          v_antes, v_depois);
  return null;
end $$;


-- ---------------------------------------------------------------------
-- 4. TAREFAS
-- ---------------------------------------------------------------------

create table if not exists public.tarefas (
  id             uuid primary key default gen_random_uuid(),
  equipe_id      uuid not null references public.equipes (id) on delete cascade,
  empresa_id     uuid,                                   -- cliente, quando houver
  titulo         text not null,
  tipo           text not null default 'operacional'
                   check (tipo in ('operacional','estrategico','administrativo')),
  prioridade     text not null default 'normal'
                   check (prioridade in ('baixa','normal','alta','critica')),
  status         text not null default 'pendente'
                   check (status in ('pendente','andamento','concluida')),
  requerente     text not null default 'Interno',
  responsavel_id uuid references public.perfis (id) on delete set null,  -- null = sem delegado
  prazo          date,
  observacoes    text,
  notificar_email text,                                  -- "vincular à agenda de"
  concluida_em   timestamptz,
  criado_por     uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (id, equipe_id),
  foreign key (empresa_id, equipe_id) references public.empresa_equipes (empresa_id, equipe_id)
);
create index if not exists tarefas_equipe_status_idx on public.tarefas (equipe_id, status, prazo);
create index if not exists tarefas_responsavel_idx   on public.tarefas (responsavel_id) where responsavel_id is not null;
create index if not exists tarefas_empresa_idx       on public.tarefas (empresa_id) where empresa_id is not null;

create or replace function private.definir_concluida_em()
returns trigger language plpgsql as $$
begin
  if new.status = 'concluida' and (tg_op = 'INSERT' or old.status is distinct from 'concluida') then
    new.concluida_em := now();
  elsif new.status <> 'concluida' then
    new.concluida_em := null;
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------
-- 5. VALIDAÇÕES: checklist versionado, validação por empresa/competência, achados
-- ---------------------------------------------------------------------

-- Modelo de checklist. Depois de publicado, os itens ficam imutáveis: mudar o
-- checklist = nova versão, e validações antigas continuam apontando para a sua.
create table if not exists public.checklist_modelos (
  id            uuid primary key default gen_random_uuid(),
  equipe_id     uuid not null references public.equipes (id) on delete cascade,
  nome          text not null,
  versao        integer not null default 1,
  publicado     boolean not null default false,
  ativo         boolean not null default true,
  criado_por    uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (equipe_id, nome, versao),
  unique (id, equipe_id)
);

create table if not exists public.checklist_itens (
  id        uuid primary key default gen_random_uuid(),
  modelo_id uuid not null,
  equipe_id uuid not null,
  ordem     integer not null,
  descricao text not null,
  unique (id, equipe_id),
  unique (modelo_id, ordem),
  foreign key (modelo_id, equipe_id) references public.checklist_modelos (id, equipe_id) on delete cascade
);

create table if not exists public.validacoes (
  id            uuid primary key default gen_random_uuid(),
  equipe_id     uuid not null references public.equipes (id) on delete cascade,
  empresa_id    uuid not null,
  competencia   date not null check (extract(day from competencia) = 1),   -- 1º dia do mês
  modelo_id     uuid not null,
  status        text not null default 'pendente'
                  check (status in ('pendente','revisao','aprovado','reprovado')),
  revisor_id    uuid references public.perfis (id) on delete set null,
  observacoes   text,
  aprovado_em   timestamptz,
  criado_por    uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (id, equipe_id),
  unique (equipe_id, empresa_id, competencia),
  foreign key (empresa_id, equipe_id) references public.empresa_equipes (empresa_id, equipe_id),
  foreign key (modelo_id, equipe_id)  references public.checklist_modelos (id, equipe_id)
);
create index if not exists validacoes_equipe_status_idx on public.validacoes (equipe_id, status, competencia desc);

create table if not exists public.validacao_itens (
  validacao_id  uuid not null,
  item_id       uuid not null,
  equipe_id     uuid not null,
  concluido     boolean not null default false,
  concluido_por uuid references public.perfis (id) on delete set null,
  concluido_em  timestamptz,
  primary key (validacao_id, item_id),
  foreign key (validacao_id, equipe_id) references public.validacoes (id, equipe_id) on delete cascade,
  foreign key (item_id, equipe_id)      references public.checklist_itens (id, equipe_id)
);

-- Achados de uma validação (mesmos campos de uma tarefa + categoria, que
-- alimenta o indicador "achados repetidos por categoria").
create table if not exists public.achados (
  id              uuid primary key default gen_random_uuid(),
  validacao_id    uuid not null,
  equipe_id       uuid not null,
  titulo          text not null,
  categoria       text,
  tipo            text not null default 'operacional'
                    check (tipo in ('operacional','estrategico','administrativo')),
  prioridade      text not null default 'normal'
                    check (prioridade in ('baixa','normal','alta','critica')),
  status          text not null default 'pendente'
                    check (status in ('pendente','revisao','aprovado','reprovado')),
  requerente      text,
  prazo           date,
  responsavel_id  uuid references public.perfis (id) on delete set null,
  observacoes     text,
  notificar_email text,
  tarefa_id       uuid,                                  -- tarefa gerada a partir do achado
  criado_por      uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  foreign key (validacao_id, equipe_id) references public.validacoes (id, equipe_id) on delete cascade,
  foreign key (tarefa_id, equipe_id)    references public.tarefas (id, equipe_id) on delete set null (tarefa_id)
);
create index if not exists achados_validacao_idx  on public.achados (validacao_id);
create index if not exists achados_categoria_idx  on public.achados (equipe_id, categoria) where categoria is not null;

-- Toda equipe nova já nasce com o checklist padrão (os mesmos 5 itens do protótipo).
create or replace function private.criar_checklist_padrao()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_modelo uuid;
begin
  insert into public.checklist_modelos (equipe_id, nome, versao)
  values (new.id, 'Checklist padrão', 1) returning id into v_modelo;
  insert into public.checklist_itens (modelo_id, equipe_id, ordem, descricao)
  select v_modelo, new.id, o, d from unnest(array[
    'Notas fiscais do período conferidas',
    'Apuração de ICMS revisada',
    'Guias de recolhimento conferidas',
    'Obrigações acessórias enviadas (SPED, DCTF...)',
    'Pendências do mês anterior resolvidas'
  ]) with ordinality as t(d, o);
  update public.checklist_modelos set publicado = true where id = v_modelo;
  return new;
end $$;

create or replace function private.bloquear_item_publicado()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_modelo uuid; v_publicado boolean;
begin
  v_modelo := coalesce(new.modelo_id, old.modelo_id);
  select publicado into v_publicado from public.checklist_modelos where id = v_modelo;
  if coalesce(v_publicado, false) then
    raise exception 'Checklist já publicado: crie uma nova versão em vez de editar os itens.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

-- Nova validação: escolhe o checklist ativo mais recente da equipe (se não
-- informado) e já cria as linhas de itens a marcar.
create or replace function private.preparar_validacao()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.modelo_id is null then
    select id into new.modelo_id from public.checklist_modelos
    where equipe_id = new.equipe_id and ativo and publicado
    order by versao desc, criado_em desc limit 1;
  end if;
  return new;
end $$;

create or replace function private.criar_itens_validacao()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.checklist_modelos where id = new.modelo_id and publicado) then
    raise exception 'A validação precisa usar um checklist publicado.' using errcode = 'check_violation';
  end if;
  insert into public.validacao_itens (validacao_id, item_id, equipe_id)
  select new.id, i.id, new.equipe_id from public.checklist_itens i where i.modelo_id = new.modelo_id;
  return new;
end $$;

create or replace function private.definir_aprovado_em()
returns trigger language plpgsql as $$
begin
  if new.status = 'aprovado' and (tg_op = 'INSERT' or old.status is distinct from 'aprovado') then
    new.aprovado_em := now();
  elsif new.status <> 'aprovado' then
    new.aprovado_em := null;
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------
-- 6. PROJETOS
-- ---------------------------------------------------------------------

create table if not exists public.projetos (
  id             uuid primary key default gen_random_uuid(),
  equipe_id      uuid not null references public.equipes (id) on delete cascade,
  empresa_id     uuid,
  cliente        text,                                   -- nome livre quando não há cadastro
  titulo         text not null,
  responsavel_id uuid references public.perfis (id) on delete set null,
  prazo          date,
  observacoes    text,
  criado_por     uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (id, equipe_id),
  foreign key (empresa_id, equipe_id) references public.empresa_equipes (empresa_id, equipe_id)
);
create index if not exists projetos_equipe_idx on public.projetos (equipe_id, prazo);

-- Cada etapa é uma mini-tarefa: responsável, prazo e status próprios.
create table if not exists public.projeto_etapas (
  id             uuid primary key default gen_random_uuid(),
  projeto_id     uuid not null,
  equipe_id      uuid not null,
  ordem          integer not null default 0,
  nome           text not null,
  responsavel_id uuid references public.perfis (id) on delete set null,
  prazo          date,
  status         text not null default 'pendente'
                   check (status in ('pendente','andamento','concluida')),
  atualizado_em  timestamptz not null default now(),
  foreign key (projeto_id, equipe_id) references public.projetos (id, equipe_id) on delete cascade
);
create index if not exists projeto_etapas_projeto_idx on public.projeto_etapas (projeto_id, ordem);

-- Anotações do projeto (a tela "Histórico"). O log estruturado fica em audit_log.
create table if not exists public.projeto_historico (
  id         uuid primary key default gen_random_uuid(),
  projeto_id uuid not null,
  equipe_id  uuid not null,
  data       date not null default current_date,
  texto      text not null,
  autor_id   uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em  timestamptz not null default now(),
  foreign key (projeto_id, equipe_id) references public.projetos (id, equipe_id) on delete cascade
);
create index if not exists projeto_historico_projeto_idx on public.projeto_historico (projeto_id, data desc);

-- Progresso e status derivados das etapas (a mesma regra da tela:
-- tudo concluído = concluido; etapa vencida não concluída = atrasado).
create or replace view public.projetos_resumo with (security_invoker = true) as
select p.*,
       count(e.id)                                         as etapas_total,
       count(e.id) filter (where e.status = 'concluida')   as etapas_concluidas,
       case when count(e.id) = 0 then 0
            else round(100.0 * count(e.id) filter (where e.status = 'concluida') / count(e.id)) end as progresso_pct,
       case
         when count(e.id) > 0 and count(e.id) = count(e.id) filter (where e.status = 'concluida') then 'concluido'
         when bool_or(e.status <> 'concluida' and e.prazo < current_date) then 'atrasado'
         else 'andamento'
       end as situacao
from public.projetos p
left join public.projeto_etapas e on e.projeto_id = p.id
group by p.id;


-- ---------------------------------------------------------------------
-- 7. CALENDÁRIO
-- ---------------------------------------------------------------------

-- Eventos e tarefas da equipe no calendário.
create table if not exists public.eventos_calendario (
  id            uuid primary key default gen_random_uuid(),
  equipe_id     uuid not null references public.equipes (id) on delete cascade,
  titulo        text not null,
  tipo          text not null default 'tarefa' check (tipo in ('tarefa','evento')),
  data          date not null,
  hora          time,
  dia_inteiro   boolean not null default false,
  convidados    text[] not null default '{}',
  local         text,
  descricao     text,
  notificar     text not null default '15min'
                  check (notificar in ('nenhuma','no_horario','15min','1h','1d')),
  tarefa_id     uuid,
  criado_por    uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (not dia_inteiro or hora is null),
  foreign key (tarefa_id, equipe_id) references public.tarefas (id, equipe_id) on delete set null (tarefa_id)
);
create index if not exists eventos_equipe_data_idx on public.eventos_calendario (equipe_id, data);

-- Registro de cada execução do job que lê SEFAZ-AM / Receita Federal.
create table if not exists public.obrigacoes_ingestoes (
  id               uuid primary key default gen_random_uuid(),
  fonte            text not null,
  iniciado_em      timestamptz not null default now(),
  finalizado_em    timestamptz,
  status           text not null default 'executando' check (status in ('executando','ok','erro')),
  registros_novos  integer not null default 0,
  registros_alterados integer not null default 0,
  erro             text
);

-- Calendário oficial. Catálogo global (não pertence a uma equipe): o job grava
-- como 'rascunho' e só vira 'aprovado' — e aparece para todos — depois que um
-- gestor fiscal revisa. Mudança de prazo = nova versão (a anterior fica
-- 'substituido'), nunca sobrescrita.
create table if not exists public.obrigacoes_oficiais (
  id            uuid primary key default gen_random_uuid(),
  titulo        text not null,
  orgao         text not null,                           -- 'RFB', 'SEFAZ-AM', 'Prefeitura de Manaus'...
  esfera        text not null check (esfera in ('federal','estadual','municipal')),
  uf            char(2),                                 -- null = nacional
  municipio     text,                                    -- null = todos
  regimes       text[],                                  -- null = todos os regimes
  competencia   date,
  vencimento    date not null,
  descricao     text,
  fonte_url     text,
  versao        integer not null default 1,
  status        text not null default 'rascunho'
                  check (status in ('rascunho','aprovado','substituido','rejeitado')),
  substitui_id  uuid references public.obrigacoes_oficiais (id) on delete set null,
  ingestao_id   uuid references public.obrigacoes_ingestoes (id) on delete set null,
  aprovado_por  uuid references public.perfis (id) on delete set null,
  aprovado_em   timestamptz,
  criado_em     timestamptz not null default now(),
  unique (orgao, titulo, vencimento, versao)
);
create index if not exists obrigacoes_status_venc_idx on public.obrigacoes_oficiais (status, vencimento);

-- Obrigações aprovadas que se aplicam a uma empresa (pelo perfil fiscal dela).
-- SECURITY INVOKER: respeita a RLS de quem chama.
create or replace function public.obrigacoes_da_empresa(p_empresa uuid)
returns setof public.obrigacoes_oficiais
language sql stable security invoker as $$
  select o.*
  from public.obrigacoes_oficiais o
  join public.empresas e on e.id = p_empresa
  where o.status = 'aprovado'
    and (o.uf is null or o.uf = e.uf)
    and (o.municipio is null or lower(o.municipio) = lower(e.municipio))
    and (o.regimes is null or e.regime_tributario = any (o.regimes))
$$;


-- ---------------------------------------------------------------------
-- 8. NOTIFICAÇÕES (o sino)
-- ---------------------------------------------------------------------
-- Quem cria são os jobs/serviços (service_role) e funções do banco; o usuário
-- só lê as suas e marca como lidas. dedupe_key evita alerta repetido do mesmo
-- fato (ex.: 'prazo:tarefa:<id>:2026-10-12').

create table if not exists public.notificacoes (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references public.perfis (id) on delete cascade,
  equipe_id    uuid references public.equipes (id) on delete cascade,
  tipo         text not null check (tipo in ('tarefa','achado','fiscal','projeto')),
  texto        text not null,
  href         text,                                     -- ex.: 'tarefas.html'
  entidade     text,
  entidade_id  uuid,
  dedupe_key   text,
  lida_em      timestamptz,
  criado_em    timestamptz not null default now()
);
create unique index if not exists notificacoes_dedupe_idx on public.notificacoes (usuario_id, dedupe_key) where dedupe_key is not null;
create index if not exists notificacoes_usuario_idx on public.notificacoes (usuario_id, criado_em desc);
create index if not exists notificacoes_nao_lidas_idx on public.notificacoes (usuario_id) where lida_em is null;


-- ---------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------

-- Padrão para tabelas com equipe_id: leitura para qualquer membro (inclui
-- auditor); escrita/exclusão por papéis informados. O WITH CHECK também vale no
-- UPDATE, então ninguém "move" uma linha para uma equipe da qual não faz parte.
create or replace procedure private.aplicar_rls_equipe(
  p_tabela text, p_escrita text[], p_exclusao text[])
language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', p_tabela);
  execute format('drop policy if exists %I on public.%I', p_tabela || '_select', p_tabela);
  execute format('drop policy if exists %I on public.%I', p_tabela || '_insert', p_tabela);
  execute format('drop policy if exists %I on public.%I', p_tabela || '_update', p_tabela);
  execute format('drop policy if exists %I on public.%I', p_tabela || '_delete', p_tabela);
  execute format('create policy %I on public.%I for select to authenticated using (private.eh_membro(equipe_id))',
                 p_tabela || '_select', p_tabela);
  execute format('create policy %I on public.%I for insert to authenticated with check (private.tem_papel(equipe_id, %L::text[]))',
                 p_tabela || '_insert', p_tabela, p_escrita);
  execute format('create policy %I on public.%I for update to authenticated using (private.tem_papel(equipe_id, %L::text[])) with check (private.tem_papel(equipe_id, %L::text[]))',
                 p_tabela || '_update', p_tabela, p_escrita, p_escrita);
  execute format('create policy %I on public.%I for delete to authenticated using (private.tem_papel(equipe_id, %L::text[]))',
                 p_tabela || '_delete', p_tabela, p_exclusao);
end $$;
revoke all on procedure private.aplicar_rls_equipe(text, text[], text[]) from public;

--                                tabela               escrita                                   exclusão
call private.aplicar_rls_equipe('tarefas',             array['gestor_fiscal','analista'],           array['gestor_fiscal']);
call private.aplicar_rls_equipe('projetos',            array['gestor_fiscal','analista'],           array['gestor_fiscal']);
call private.aplicar_rls_equipe('projeto_etapas',      array['gestor_fiscal','analista'],           array['gestor_fiscal','analista']);
call private.aplicar_rls_equipe('projeto_historico',   array['gestor_fiscal','analista'],           array['gestor_fiscal']);
call private.aplicar_rls_equipe('eventos_calendario',  array['gestor_fiscal','analista'],           array['gestor_fiscal','analista']);
call private.aplicar_rls_equipe('validacoes',          array['gestor_fiscal','analista','revisor'], array['gestor_fiscal']);
call private.aplicar_rls_equipe('validacao_itens',     array['gestor_fiscal','analista','revisor'], array['gestor_fiscal']);
call private.aplicar_rls_equipe('achados',             array['gestor_fiscal','analista','revisor'], array['gestor_fiscal']);
call private.aplicar_rls_equipe('checklist_modelos',   array['gestor_fiscal'],                      array['gestor_fiscal']);
call private.aplicar_rls_equipe('checklist_itens',     array['gestor_fiscal'],                      array['gestor_fiscal']);

-- perfis -----------------------------------------------------------------
alter table public.perfis enable row level security;
drop policy if exists perfis_select on public.perfis;
drop policy if exists perfis_update on public.perfis;
create policy perfis_select on public.perfis for select to authenticated
  using (id = auth.uid() or private.eh_admin() or private.compartilham_equipe(id));
create policy perfis_update on public.perfis for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- Sem policy de INSERT/DELETE: o perfil nasce pelo trigger do Auth.

-- equipes / membros_equipe -----------------------------------------------
alter table public.equipes enable row level security;
drop policy if exists equipes_select on public.equipes;
drop policy if exists equipes_write  on public.equipes;
create policy equipes_select on public.equipes for select to authenticated using (private.eh_membro(id));
create policy equipes_write  on public.equipes for all    to authenticated using (private.eh_admin()) with check (private.eh_admin());

alter table public.membros_equipe enable row level security;
drop policy if exists membros_select on public.membros_equipe;
drop policy if exists membros_write  on public.membros_equipe;
create policy membros_select on public.membros_equipe for select to authenticated
  using (usuario_id = auth.uid() or private.tem_papel(equipe_id, array['gestor_fiscal']));
create policy membros_write  on public.membros_equipe for all to authenticated
  using (private.tem_papel(equipe_id, array['gestor_fiscal']))
  with check (private.tem_papel(equipe_id, array['gestor_fiscal']));

-- empresas ---------------------------------------------------------------
alter table public.empresas enable row level security;
drop policy if exists empresas_select on public.empresas;
drop policy if exists empresas_insert on public.empresas;
drop policy if exists empresas_update on public.empresas;
drop policy if exists empresas_delete on public.empresas;
create policy empresas_select on public.empresas for select to authenticated
  using (private.pode_ver_empresa(id) or (criado_por = auth.uid() and private.sem_vinculo(id)));
create policy empresas_insert on public.empresas for insert to authenticated
  with check (criado_por = auth.uid()
              and private.tem_papel_em_alguma_equipe(array['gestor_fiscal','analista']));
create policy empresas_update on public.empresas for update to authenticated
  using (private.pode_editar_empresa(id) or (criado_por = auth.uid() and private.sem_vinculo(id)))
  with check (private.pode_editar_empresa(id) or (criado_por = auth.uid() and private.sem_vinculo(id)));
create policy empresas_delete on public.empresas for delete to authenticated
  using (private.eh_admin());

alter table public.empresa_equipes enable row level security;
drop policy if exists empresa_equipes_select on public.empresa_equipes;
drop policy if exists empresa_equipes_insert on public.empresa_equipes;
drop policy if exists empresa_equipes_delete on public.empresa_equipes;
create policy empresa_equipes_select on public.empresa_equipes for select to authenticated
  using (private.eh_membro(equipe_id));
-- Vincular exige já enxergar a empresa (ou tê-la acabado de criar): ninguém
-- "puxa" para a sua equipe uma empresa de outra só conhecendo o id.
create policy empresa_equipes_insert on public.empresa_equipes for insert to authenticated
  with check (private.tem_papel(equipe_id, array['gestor_fiscal','analista'])
              and (private.pode_ver_empresa(empresa_id) or private.criada_por_mim_sem_vinculo(empresa_id)));
create policy empresa_equipes_delete on public.empresa_equipes for delete to authenticated
  using (private.tem_papel(equipe_id, array['gestor_fiscal']));

alter table public.inscricoes_estaduais enable row level security;
drop policy if exists inscricoes_select on public.inscricoes_estaduais;
drop policy if exists inscricoes_write  on public.inscricoes_estaduais;
create policy inscricoes_select on public.inscricoes_estaduais for select to authenticated
  using (private.pode_ver_empresa(empresa_id) or private.criada_por_mim_sem_vinculo(empresa_id));
create policy inscricoes_write on public.inscricoes_estaduais for all to authenticated
  using (private.pode_editar_empresa(empresa_id) or private.criada_por_mim_sem_vinculo(empresa_id))
  with check (private.pode_editar_empresa(empresa_id) or private.criada_por_mim_sem_vinculo(empresa_id));

-- audit_log: só leitura (gestor fiscal e auditor da equipe; administrador vê tudo).
alter table public.audit_log enable row level security;
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (private.eh_admin()
         or (equipe_id is not null and private.tem_papel(equipe_id, array['gestor_fiscal','auditor'])));

-- calendário oficial -----------------------------------------------------
alter table public.obrigacoes_oficiais enable row level security;
drop policy if exists obrigacoes_select on public.obrigacoes_oficiais;
drop policy if exists obrigacoes_update on public.obrigacoes_oficiais;
create policy obrigacoes_select on public.obrigacoes_oficiais for select to authenticated
  using (status = 'aprovado'
         or private.tem_papel_em_alguma_equipe(array['gestor_fiscal']));
-- Aprovar/rejeitar: gestor fiscal. Inserir rascunhos: só o job (service_role).
create policy obrigacoes_update on public.obrigacoes_oficiais for update to authenticated
  using (private.tem_papel_em_alguma_equipe(array['gestor_fiscal']))
  with check (private.tem_papel_em_alguma_equipe(array['gestor_fiscal']));

alter table public.obrigacoes_ingestoes enable row level security;
drop policy if exists ingestoes_select on public.obrigacoes_ingestoes;
create policy ingestoes_select on public.obrigacoes_ingestoes for select to authenticated
  using (private.tem_papel_em_alguma_equipe(array['gestor_fiscal']));

-- notificações -----------------------------------------------------------
alter table public.notificacoes enable row level security;
drop policy if exists notificacoes_select on public.notificacoes;
drop policy if exists notificacoes_update on public.notificacoes;
create policy notificacoes_select on public.notificacoes for select to authenticated
  using (usuario_id = auth.uid());
create policy notificacoes_update on public.notificacoes for update to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());


-- ---------------------------------------------------------------------
-- 10. TRIGGERS
-- ---------------------------------------------------------------------

-- atualizado_em automático
do $$
declare t text;
begin
  foreach t in array array['perfis','equipes','empresas','tarefas','checklist_modelos','validacoes',
                           'achados','projetos','projeto_etapas','eventos_calendario']
  loop
    execute format('drop trigger if exists set_atualizado_em on public.%I', t);
    execute format('create trigger set_atualizado_em before update on public.%I for each row execute function private.set_atualizado_em()', t);
  end loop;
end $$;

-- auditoria
do $$
declare t text;
begin
  foreach t in array array['membros_equipe','empresas','empresa_equipes','inscricoes_estaduais','tarefas',
                           'checklist_modelos','validacoes','achados','projetos','projeto_etapas',
                           'projeto_historico','eventos_calendario','obrigacoes_oficiais']
  loop
    execute format('drop trigger if exists auditoria on public.%I', t);
    execute format('create trigger auditoria after insert or update or delete on public.%I for each row execute function private.registrar_auditoria()', t);
  end loop;
end $$;

drop trigger if exists definir_concluida_em on public.tarefas;
create trigger definir_concluida_em before insert or update on public.tarefas
  for each row execute function private.definir_concluida_em();

drop trigger if exists definir_aprovado_em on public.validacoes;
create trigger definir_aprovado_em before insert or update on public.validacoes
  for each row execute function private.definir_aprovado_em();

drop trigger if exists preparar_validacao on public.validacoes;
create trigger preparar_validacao before insert on public.validacoes
  for each row execute function private.preparar_validacao();

drop trigger if exists criar_itens_validacao on public.validacoes;
create trigger criar_itens_validacao after insert on public.validacoes
  for each row execute function private.criar_itens_validacao();

drop trigger if exists bloquear_item_publicado on public.checklist_itens;
create trigger bloquear_item_publicado before insert or update or delete on public.checklist_itens
  for each row execute function private.bloquear_item_publicado();

drop trigger if exists criar_checklist_padrao on public.equipes;
create trigger criar_checklist_padrao after insert on public.equipes
  for each row execute function private.criar_checklist_padrao();


-- ---------------------------------------------------------------------
-- 11. PERMISSÕES DE TABELA
-- ---------------------------------------------------------------------
-- Visitante (anon) não toca em nada. Autenticado só passa pelo que a RLS libera;
-- aqui apertamos colunas e operações que a RLS sozinha não consegue limitar.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- perfil: o usuário só edita o próprio nome (administrador/ativo mudam pelo painel
-- do Supabase ou service_role, nunca pelo navegador).
revoke update on public.perfis from authenticated;
grant  update (nome) on public.perfis to authenticated;
revoke insert, delete on public.perfis from authenticated;

-- audit_log é somente leitura para o app; quem grava é o trigger.
revoke insert, update, delete on public.audit_log from authenticated;

-- notificações: o usuário só marca como lida.
revoke insert, delete on public.notificacoes from authenticated;
revoke update on public.notificacoes from authenticated;
grant  update (lida_em) on public.notificacoes to authenticated;

-- calendário oficial: o app só aprova/rejeita; conteúdo vem do job.
revoke insert, delete on public.obrigacoes_oficiais from authenticated;
revoke update on public.obrigacoes_oficiais from authenticated;
grant  update (status, aprovado_por, aprovado_em) on public.obrigacoes_oficiais to authenticated;
revoke insert, update, delete on public.obrigacoes_ingestoes from authenticated;

-- as funções de permissão precisam ser chamáveis pelas policies
grant execute on all functions in schema private to authenticated, service_role;
revoke execute on procedure private.aplicar_rls_equipe(text, text[], text[]) from authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;


-- ---------------------------------------------------------------------
-- PRIMEIRO ACESSO (rodar uma vez, depois de criar o seu usuário em
-- Authentication → Users). Troque o e-mail e descomente:
--
--   update public.perfis set administrador = true where email = 'SEU_EMAIL_AQUI';
--
--   with e as (insert into public.equipes (nome) values ('Fiscal') returning id)
--   insert into public.membros_equipe (equipe_id, usuario_id, papel)
--   select e.id, p.id, papel
--   from e, public.perfis p, unnest(array['gestor_fiscal','analista']) as papel
--   where p.email = 'SEU_EMAIL_AQUI';
-- ---------------------------------------------------------------------
