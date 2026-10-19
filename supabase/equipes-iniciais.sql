-- Equipes Alpha, Beta e Omega e seus membros (idempotente: pode rodar mais de uma vez).
-- Pré-requisito: os usuários já existem em Authentication > Users (o gatilho criar_perfil
-- cria o registro em public.perfis). Rodar no SQL Editor do Supabase.

-- Usuários criados antes do gatilho criar_perfil podem estar sem perfil: cria os que faltam.
insert into public.perfis (id, email, nome)
select u.id, coalesce(u.email, ''), split_part(coalesce(u.email, ''), '@', 1)
from auth.users u
where not exists (select 1 from public.perfis p where p.id = u.id)
on conflict (id) do nothing;

insert into public.equipes (nome, descricao) values
  ('Equipe Alpha', 'Equipe Alpha'),
  ('Equipe Beta',  'Equipe Beta'),
  ('Equipe Omega', 'Equipe Omega')
on conflict (nome) do nothing;

-- Nomes de exibição.
update public.perfis set nome = 'Jhonathan' where lower(email) = 'fiscal6@projecont.com.br';
update public.perfis set nome = 'PH'        where lower(email) = 'fiscal5@projecont.com.br';
update public.perfis set nome = 'Marcel'    where lower(email) = 'fiscal4@projecont.com.br';
update public.perfis set nome = 'Wendel'    where lower(email) = 'gerencia.fiscal@projecont.com.br';

-- Analistas: um por equipe.
insert into public.membros_equipe (equipe_id, usuario_id, papel)
select e.id, p.id, 'analista'
from (values
  ('Equipe Alpha', 'fiscal6@projecont.com.br'),
  ('Equipe Beta',  'fiscal5@projecont.com.br'),
  ('Equipe Omega', 'fiscal4@projecont.com.br')
) as m (equipe, email)
join public.equipes e on e.nome = m.equipe
join public.perfis  p on lower(p.email) = m.email
on conflict do nothing;

-- Gestor fiscal (Wendel) nas três equipes.
insert into public.membros_equipe (equipe_id, usuario_id, papel)
select e.id, p.id, 'gestor_fiscal'
from public.equipes e
join public.perfis p on lower(p.email) = 'gerencia.fiscal@projecont.com.br'
where e.nome in ('Equipe Alpha', 'Equipe Beta', 'Equipe Omega')
on conflict do nothing;

-- Conferência: deve listar 3 analistas e o gestor nas 3 equipes.
select e.nome as equipe, p.email, m.papel, m.ativo
from public.membros_equipe m
join public.equipes e on e.id = m.equipe_id
join public.perfis  p on p.id = m.usuario_id
order by e.nome, m.papel, p.email;
