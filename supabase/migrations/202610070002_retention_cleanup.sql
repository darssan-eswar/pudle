-- Retention cleanup and leaving a convoy.
-- Kept separate because these functions contain DELETE statements: apply this file yourself in the
-- Supabase SQL editor (the Supabase AI connector refuses migrations containing DELETE).
-- The purge function lives in a non-API schema, so app users cannot call it.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function public.leave_convoy(p_convoy_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  delete from public.convoy_members where convoy_id = p_convoy_id and user_id = auth.uid();
end;
$$;

-- Physical retention cleanup. Expired rows are already invisible through RLS; this deletes them.
-- Not callable by app users. Schedule it (for example with pg_cron) only after owner approval:
--   select cron.schedule('pudle-purge', '*/15 * * * *', $$select public.purge_expired_hazard_data()$$);
create function private.purge_expired_hazard_data(p_grace interval default interval '1 hour')
returns table (hazard_events_deleted bigint, obstacle_reports_deleted bigint, convoys_deleted bigint)
language plpgsql security definer set search_path = ''
as $$
declare
  v_hazards bigint;
  v_reports bigint;
  v_convoys bigint;
begin
  if p_grace < interval '0' or p_grace > interval '24 hours' then
    raise exception 'Grace period must be between 0 and 24 hours';
  end if;
  delete from public.hazard_events where expires_at < now() - p_grace;
  get diagnostics v_hazards = row_count;
  delete from public.obstacle_reports where expires_at < now() - p_grace;
  get diagnostics v_reports = row_count;
  -- Convoys expire after 24 hours; keep a 7-day window so an owner can see recent history.
  delete from public.road_corridors where expires_at < now();
  delete from public.convoys where expires_at < now() - interval '7 days';
  get diagnostics v_convoys = row_count;
  return query select v_hazards, v_reports, v_convoys;
end;
$$;

revoke all on function public.leave_convoy(uuid) from public, anon;
grant execute on function public.leave_convoy(uuid) to authenticated;
revoke all on function private.purge_expired_hazard_data(interval) from public, anon, authenticated;

-- Optional, after owner approval: run cleanup every 15 minutes with pg_cron.
--   create extension if not exists pg_cron;
--   select cron.schedule('pudle-purge', '*/15 * * * *', $$select private.purge_expired_hazard_data()$$);
