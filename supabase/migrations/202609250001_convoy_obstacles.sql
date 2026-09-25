-- Pudle obstacle demo: short-lived convoy reports, isolated by Supabase Auth.
-- Apply to a dedicated Supabase project before enabling the Vercel app.

create table public.convoys (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  join_code text not null unique check (join_code ~ '^[A-F0-9]{12}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create table public.convoy_members (
  convoy_id uuid not null references public.convoys(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (convoy_id, user_id)
);

create index convoy_members_user_idx on public.convoy_members(user_id, convoy_id);

create table public.obstacle_reports (
  id uuid primary key default gen_random_uuid(),
  convoy_id uuid not null references public.convoys(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('tree', 'debris', 'stopped_vehicle', 'other')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes')
);

create index obstacle_reports_convoy_recent_idx
  on public.obstacle_reports(convoy_id, created_at desc);
create index obstacle_reports_reporter_recent_idx
  on public.obstacle_reports(reporter_id, created_at desc);

alter table public.convoys enable row level security;
alter table public.convoy_members enable row level security;
alter table public.obstacle_reports enable row level security;

revoke all on public.convoys, public.convoy_members, public.obstacle_reports from anon, authenticated;
grant select on public.convoys, public.convoy_members to authenticated;
grant select, insert on public.obstacle_reports to authenticated;

create policy "Members can read their active convoy"
  on public.convoys for select to authenticated
  using (
    expires_at > now() and exists (
      select 1 from public.convoy_members m
      where m.convoy_id = id and m.user_id = (select auth.uid())
    )
  );

create policy "Members can read their own membership"
  on public.convoy_members for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Members can read recent reports in their convoy"
  on public.obstacle_reports for select to authenticated
  using (
    expires_at > now() and exists (
      select 1 from public.convoy_members m
      join public.convoys c on c.id = m.convoy_id
      where m.convoy_id = obstacle_reports.convoy_id
        and m.user_id = (select auth.uid())
        and c.expires_at > now()
    )
  );

create policy "Members can report an obstacle to their active convoy"
  on public.obstacle_reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and created_at between now() - interval '10 seconds' and now() + interval '10 seconds'
    and expires_at <= now() + interval '2 minutes 10 seconds'
    and exists (
      select 1 from public.convoy_members m
      join public.convoys c on c.id = m.convoy_id
      where m.convoy_id = obstacle_reports.convoy_id
        and m.user_id = (select auth.uid())
        and c.expires_at > now()
    )
  );

create function public.create_convoy(p_name text)
returns table (convoy_id uuid, code text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_code text := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  v_name text := trim(regexp_replace(p_name, '\s+', ' ', 'g'));
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if v_name is null or char_length(v_name) not between 1 and 80 then
    raise exception 'Convoy name must be 1 to 80 characters';
  end if;
  insert into public.convoys(id, name, join_code, owner_id)
    values (v_id, v_name, v_code, v_user);
  insert into public.convoy_members(convoy_id, user_id) values (v_id, v_user);
  return query select v_id, v_code;
end;
$$;

create function public.join_convoy(p_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select c.id into v_id from public.convoys c
    where c.join_code = upper(trim(p_code)) and c.expires_at > now();
  if v_id is null then raise exception 'Code is invalid or expired'; end if;
  insert into public.convoy_members(convoy_id, user_id)
    values (v_id, v_user) on conflict do nothing;
  return v_id;
end;
$$;

revoke all on function public.create_convoy(text), public.join_convoy(text) from public, anon;
grant execute on function public.create_convoy(text), public.join_convoy(text) to authenticated;

create function public.limit_obstacle_reports()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.reporter_id is distinct from auth.uid() then
    raise exception 'Reporter must be the signed-in user';
  end if;
  if exists (
    select 1 from public.obstacle_reports r
    where r.reporter_id = new.reporter_id
      and r.created_at > now() - interval '5 seconds'
  ) then
    raise exception 'Wait a moment before sending another report';
  end if;
  new.created_at := now();
  new.expires_at := now() + interval '2 minutes';
  return new;
end;
$$;

create trigger limit_obstacle_reports_before_insert
  before insert on public.obstacle_reports
  for each row execute function public.limit_obstacle_reports();

-- A small convoy can use Postgres Changes. Member RLS is checked for each row.
alter publication supabase_realtime add table public.obstacle_reports;
