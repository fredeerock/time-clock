-- Kind Clock schema
-- Apply this entire file in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  preferred_timezone text not null default 'America/Chicago',
  primary_workplace_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists preferred_timezone text;
alter table public.profiles add column if not exists primary_workplace_id uuid;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
update public.profiles set preferred_timezone = 'America/Chicago' where preferred_timezone is null;
create unique index if not exists profiles_email_unique_idx on public.profiles (email) where email is not null;

create table if not exists public.workplaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workplaces add column if not exists created_by_id uuid;
alter table public.workplaces add column if not exists updated_at timestamptz not null default now();
alter table public.workplaces alter column created_at set default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_primary_workplace_fk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_primary_workplace_fk
      foreign key (primary_workplace_id)
      references public.workplaces(id)
      on delete set null;
  end if;
end;
$$;

create table if not exists public.workplace_memberships (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references public.workplaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workplace_id, user_id)
);

create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references public.workplaces(id) on delete cascade,
  code text not null unique,
  expires_at timestamptz not null,
  consumed_by_id uuid references public.profiles(id),
  consumed_at timestamptz,
  created_by_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((consumed_by_id is null and consumed_at is null) or (consumed_by_id is not null and consumed_at is not null))
);

create table if not exists public.clock_sessions (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references public.workplaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'auto_completed', 'corrected')),
  auto_clock_out_mode text not null default 'manual' check (auto_clock_out_mode in ('manual', 'duration', 'time')),
  auto_clock_out_at timestamptz,
  duration_minutes int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at > clock_in_at)
);

create unique index if not exists clock_sessions_one_active_per_user_workplace
  on public.clock_sessions (workplace_id, user_id)
  where status = 'active';

create index if not exists clock_sessions_user_workplace_date_idx
  on public.clock_sessions (user_id, workplace_id, clock_in_at desc);

create table if not exists public.time_off_entries (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references public.workplaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  hours numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.weekly_schedules (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references public.workplaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start_date date not null,
  scheduled_hours numeric not null check (scheduled_hours >= 0),
  created_by_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workplace_id, user_id, week_start_date)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid references public.workplaces(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_workplace_time_idx
  on public.audit_logs (workplace_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists trg_workplaces_updated_at on public.workplaces;
create trigger trg_workplaces_updated_at
before update on public.workplaces
for each row
execute function public.set_updated_at();

drop trigger if exists trg_clock_sessions_updated_at on public.clock_sessions;
create trigger trg_clock_sessions_updated_at
before update on public.clock_sessions
for each row
execute function public.set_updated_at();

drop trigger if exists trg_time_off_entries_updated_at on public.time_off_entries;
create trigger trg_time_off_entries_updated_at
before update on public.time_off_entries
for each row
execute function public.set_updated_at();

drop trigger if exists trg_weekly_schedules_updated_at on public.weekly_schedules;
create trigger trg_weekly_schedules_updated_at
before update on public.weekly_schedules
for each row
execute function public.set_updated_at();

create or replace function public.is_workplace_admin(p_workplace_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.workplace_memberships wm
    where wm.workplace_id = p_workplace_id
      and wm.user_id = auth.uid()
      and wm.role = 'admin'
  );
$$;

create or replace function public.consume_invite_code(p_code text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invite_codes%rowtype;
begin
  if auth.uid() is distinct from p_user_id then
    return jsonb_build_object('ok', false, 'message', 'Not authorized for this user.');
  end if;

  select * into v_invite
  from public.invite_codes
  where code = upper(trim(p_code))
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Invalid invite code.');
  end if;

  if v_invite.consumed_at is not null then
    return jsonb_build_object('ok', false, 'message', 'Invite code already used.');
  end if;

  if v_invite.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'Invite code expired.');
  end if;

  insert into public.workplace_memberships (workplace_id, user_id, role)
  values (v_invite.workplace_id, p_user_id, 'member')
  on conflict (workplace_id, user_id) do nothing;

  update public.invite_codes
  set consumed_by_id = p_user_id,
      consumed_at = now()
  where id = v_invite.id;

  insert into public.audit_logs (workplace_id, actor_user_id, target_user_id, event_type, details)
  values (
    v_invite.workplace_id,
    p_user_id,
    p_user_id,
    'invite_consumed',
    jsonb_build_object('code', v_invite.code)
  );

  return jsonb_build_object('ok', true, 'workplace_id', v_invite.workplace_id);
end;
$$;

create or replace function public.get_weekly_progress(
  p_workplace_id uuid,
  p_user_id uuid,
  p_week_start_date date
)
returns table (
  scheduled_hours numeric,
  worked_hours numeric,
  remaining_hours numeric
)
language sql
security definer
set search_path = public
as $$
  with schedule_row as (
    select coalesce(ws.scheduled_hours, 0)::numeric as scheduled_hours
    from public.weekly_schedules ws
    where ws.workplace_id = p_workplace_id
      and ws.user_id = p_user_id
      and ws.week_start_date = p_week_start_date
    limit 1
  ),
  worked_row as (
    select coalesce(sum(extract(epoch from (coalesce(cs.clock_out_at, now()) - cs.clock_in_at)) / 3600.0), 0)::numeric as worked_hours
    from public.clock_sessions cs
    where cs.workplace_id = p_workplace_id
      and cs.user_id = p_user_id
      and cs.status in ('completed', 'auto_completed', 'corrected')
      and ((cs.clock_in_at at time zone 'America/Chicago')::date >= p_week_start_date)
      and ((cs.clock_in_at at time zone 'America/Chicago')::date < p_week_start_date + interval '7 day')
  )
  select
    coalesce((select scheduled_hours from schedule_row), 0) as scheduled_hours,
    (select worked_hours from worked_row) as worked_hours,
    greatest(coalesce((select scheduled_hours from schedule_row), 0) - (select worked_hours from worked_row), 0) as remaining_hours;
$$;

create or replace function public.admin_correct_clock_session(
  p_session_id uuid,
  p_new_clock_in timestamptz,
  p_new_clock_out timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.clock_sessions%rowtype;
begin
  select * into v_session
  from public.clock_sessions
  where id = p_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Session not found.');
  end if;

  if not public.is_workplace_admin(v_session.workplace_id) then
    return jsonb_build_object('ok', false, 'message', 'Only workplace admin may correct this session.');
  end if;

  if p_new_clock_out <= p_new_clock_in then
    return jsonb_build_object('ok', false, 'message', 'Clock-out must be after clock-in.');
  end if;

  update public.clock_sessions
  set clock_in_at = p_new_clock_in,
      clock_out_at = p_new_clock_out,
      status = 'corrected'
  where id = v_session.id;

  insert into public.audit_logs (
    workplace_id,
    actor_user_id,
    target_user_id,
    event_type,
    details
  )
  values (
    v_session.workplace_id,
    auth.uid(),
    v_session.user_id,
    'clock_session_corrected',
    jsonb_build_object(
      'session_id', v_session.id,
      'old_clock_in_at', v_session.clock_in_at,
      'old_clock_out_at', v_session.clock_out_at,
      'new_clock_in_at', p_new_clock_in,
      'new_clock_out_at', p_new_clock_out,
      'reason', p_reason
    )
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.run_auto_clock_out()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.clock_sessions
  set clock_out_at = auto_clock_out_at,
      status = 'auto_completed'
  where status = 'active'
    and auto_clock_out_at is not null
    and auto_clock_out_at <= now();

  get diagnostics v_count = row_count;

  insert into public.audit_logs (workplace_id, actor_user_id, target_user_id, event_type, details)
  select
    cs.workplace_id,
    null,
    cs.user_id,
    'auto_clock_out_run',
    jsonb_build_object('session_id', cs.id)
  from public.clock_sessions cs
  where cs.status = 'auto_completed'
    and cs.updated_at >= now() - interval '2 minutes';

  return v_count;
end;
$$;

alter table public.profiles enable row level security;
alter table public.workplaces enable row level security;
alter table public.workplace_memberships enable row level security;
alter table public.invite_codes enable row level security;
alter table public.clock_sessions enable row level security;
alter table public.time_off_entries enable row level security;
alter table public.weekly_schedules enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select_self_or_coworker on public.profiles
for select
using (
  id = auth.uid()
  or exists (
    select 1
    from public.workplace_memberships mine
    join public.workplace_memberships other
      on other.workplace_id = mine.workplace_id
    where mine.user_id = auth.uid()
      and other.user_id = profiles.id
  )
);

create policy profiles_insert_self on public.profiles
for insert
with check (id = auth.uid());

create policy profiles_update_self on public.profiles
for update
using (id = auth.uid())
with check (id = auth.uid());

create policy workplaces_select_member on public.workplaces
for select
using (
  exists (
    select 1 from public.workplace_memberships wm
    where wm.workplace_id = workplaces.id and wm.user_id = auth.uid()
  )
);

create policy workplaces_insert_authenticated on public.workplaces
for insert
with check (created_by_id = auth.uid());

create policy workplaces_update_admin on public.workplaces
for update
using (public.is_workplace_admin(id))
with check (public.is_workplace_admin(id));

create policy memberships_select_member on public.workplace_memberships
for select
using (
  user_id = auth.uid()
  or public.is_workplace_admin(workplace_id)
);

create policy memberships_insert_admin_or_self_join on public.workplace_memberships
for insert
with check (
  user_id = auth.uid()
  or public.is_workplace_admin(workplace_id)
);

create policy memberships_update_admin on public.workplace_memberships
for update
using (public.is_workplace_admin(workplace_id))
with check (public.is_workplace_admin(workplace_id));

create policy invite_codes_select_admin on public.invite_codes
for select
using (public.is_workplace_admin(workplace_id));

create policy invite_codes_insert_admin on public.invite_codes
for insert
with check (public.is_workplace_admin(workplace_id) and created_by_id = auth.uid());

create policy clock_sessions_select_self_or_admin on public.clock_sessions
for select
using (
  user_id = auth.uid()
  or public.is_workplace_admin(workplace_id)
);

create policy clock_sessions_insert_self on public.clock_sessions
for insert
with check (user_id = auth.uid());

create policy clock_sessions_update_self_or_admin on public.clock_sessions
for update
using (
  user_id = auth.uid()
  or public.is_workplace_admin(workplace_id)
)
with check (
  user_id = auth.uid()
  or public.is_workplace_admin(workplace_id)
);

create policy time_off_select_self_or_admin on public.time_off_entries
for select
using (
  user_id = auth.uid()
  or public.is_workplace_admin(workplace_id)
);

create policy time_off_insert_self on public.time_off_entries
for insert
with check (user_id = auth.uid());

create policy time_off_update_self_or_admin on public.time_off_entries
for update
using (
  user_id = auth.uid()
  or public.is_workplace_admin(workplace_id)
)
with check (
  user_id = auth.uid()
  or public.is_workplace_admin(workplace_id)
);

create policy schedules_select_self_or_admin on public.weekly_schedules
for select
using (
  user_id = auth.uid()
  or public.is_workplace_admin(workplace_id)
);

create policy schedules_insert_admin on public.weekly_schedules
for insert
with check (public.is_workplace_admin(workplace_id) and created_by_id = auth.uid());

create policy schedules_update_admin on public.weekly_schedules
for update
using (public.is_workplace_admin(workplace_id))
with check (public.is_workplace_admin(workplace_id));

create policy audit_select_admin on public.audit_logs
for select
using (public.is_workplace_admin(workplace_id));

grant execute on function public.consume_invite_code(text, uuid) to authenticated;
grant execute on function public.get_weekly_progress(uuid, uuid, date) to authenticated;
grant execute on function public.admin_correct_clock_session(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.run_auto_clock_out() to service_role;
