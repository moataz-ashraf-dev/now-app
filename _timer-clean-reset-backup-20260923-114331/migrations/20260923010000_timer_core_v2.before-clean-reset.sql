-- StudyQuest Timer Core V2
-- New timer lifecycle. Legacy active study_sessions are retired on V2 start
-- without granting rewards.

create table if not exists public.timer_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id text not null,
  subject_id uuid not null references public.subjects(id) on delete restrict,
  task_id uuid null references public.study_plan_tasks(id) on delete set null,

  duration_seconds integer not null check (duration_seconds between 300 and 7200),
  remaining_seconds integer not null check (remaining_seconds between 0 and 7200),

  status text not null check (status in ('running','paused','completed','cancelled')),

  started_at timestamptz not null default now(),
  segment_started_at timestamptz null,
  completed_at timestamptz null,
  cancelled_at timestamptz null,
  created_at timestamptz not null default now(),

  unique (user_id, operation_id)
);

create unique index if not exists timer_sessions_one_active_per_user
  on public.timer_sessions(user_id)
  where status in ('running','paused');

alter table public.timer_sessions enable row level security;
revoke all on table public.timer_sessions from anon, authenticated;

create or replace function public.timer_start_session(
  p_subject_id uuid,
  p_task_id uuid default null,
  p_duration_minutes integer default 25,
  p_operation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_duration integer;
  v_existing public.timer_sessions%rowtype;
  v_timer public.timer_sessions%rowtype;
  v_legacy_deleted integer := 0;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if p_operation_id is null or char_length(p_operation_id) < 8 or char_length(p_operation_id) > 100 then
    raise exception 'invalid_operation_id';
  end if;

  if p_duration_minutes < 5 or p_duration_minutes > 120 then
    raise exception 'invalid_duration';
  end if;

  v_duration := round(p_duration_minutes)::integer;

  if not exists (
    select 1
    from public.subjects
    where id = p_subject_id
      and user_id = v_user
  ) then
    raise exception 'subject_not_owned';
  end if;

  if p_task_id is not null and not exists (
    select 1
    from public.study_plan_tasks
    where id = p_task_id
      and user_id = v_user
  ) then
    raise exception 'task_not_owned';
  end if;

  select *
  into v_existing
  from public.timer_sessions
  where user_id = v_user
    and operation_id = p_operation_id
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'timer_session_id', v_existing.id,
      'operation_id', v_existing.operation_id,
      'subject_id', v_existing.subject_id,
      'task_id', v_existing.task_id,
      'duration_seconds', v_existing.duration_seconds,
      'remaining_seconds',
        case
          when v_existing.status = 'running' and v_existing.segment_started_at is not null
            then greatest(
              0,
              v_existing.remaining_seconds
                - floor(extract(epoch from (now() - v_existing.segment_started_at)))::integer
            )
          else v_existing.remaining_seconds
        end,
      'status', v_existing.status,
      'started_at', v_existing.started_at
    );
  end if;

  if exists (
    select 1
    from public.timer_sessions
    where user_id = v_user
      and status in ('running','paused')
  ) then
    raise exception 'timer_session_exists';
  end if;

  -- Retire every old unfinished legacy session.
  -- This grants NO reward and prevents the legacy active-session lock.
  delete from public.study_sessions
  where user_id = v_user
    and completed = false;

  get diagnostics v_legacy_deleted = row_count;

  insert into public.study_sessions(
    user_id,
    subject_id,
    duration_minutes,
    completed,
    client_operation_id,
    verification_method
  )
  values (
    v_user,
    p_subject_id,
    v_duration,
    false,
    p_operation_id,
    'server'
  );

  insert into public.timer_sessions(
    user_id,
    operation_id,
    subject_id,
    task_id,
    duration_seconds,
    remaining_seconds,
    status,
    started_at,
    segment_started_at
  )
  values (
    v_user,
    p_operation_id,
    p_subject_id,
    p_task_id,
    v_duration * 60,
    v_duration * 60,
    'running',
    now(),
    now()
  )
  returning * into v_timer;

  return jsonb_build_object(
    'timer_session_id', v_timer.id,
    'operation_id', v_timer.operation_id,
    'subject_id', v_timer.subject_id,
    'task_id', v_timer.task_id,
    'duration_seconds', v_timer.duration_seconds,
    'remaining_seconds', v_timer.remaining_seconds,
    'status', v_timer.status,
    'started_at', v_timer.started_at,
    'legacy_sessions_retired', v_legacy_deleted
  );

exception
  when unique_violation then
    select *
    into v_existing
    from public.timer_sessions
    where user_id = v_user
      and operation_id = p_operation_id
    limit 1;

    if v_existing.id is not null then
      return jsonb_build_object(
        'timer_session_id', v_existing.id,
        'operation_id', v_existing.operation_id,
        'subject_id', v_existing.subject_id,
        'task_id', v_existing.task_id,
        'duration_seconds', v_existing.duration_seconds,
        'remaining_seconds', v_existing.remaining_seconds,
        'status', v_existing.status,
        'started_at', v_existing.started_at
      );
    end if;

    raise exception 'timer_session_exists';
end;
$$;

create or replace function public.timer_get_active_session()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_timer public.timer_sessions%rowtype;
  v_remaining integer;
  v_task_title text;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select *
  into v_timer
  from public.timer_sessions
  where user_id = v_user
    and status in ('running','paused')
  order by created_at desc
  limit 1;

  if v_timer.id is null then
    return null;
  end if;

  v_remaining := v_timer.remaining_seconds;

  if v_timer.status = 'running' and v_timer.segment_started_at is not null then
    v_remaining := greatest(
      0,
      v_timer.remaining_seconds
        - floor(extract(epoch from (now() - v_timer.segment_started_at)))::integer
    );
  end if;

  select title
  into v_task_title
  from public.study_plan_tasks
  where id = v_timer.task_id
    and user_id = v_user;

  return jsonb_build_object(
    'timer_session_id', v_timer.id,
    'operation_id', v_timer.operation_id,
    'subject_id', v_timer.subject_id,
    'task_id', v_timer.task_id,
    'task_title', v_task_title,
    'duration_seconds', v_timer.duration_seconds,
    'remaining_seconds', v_remaining,
    'status', v_timer.status,
    'started_at', v_timer.started_at,
    'segment_started_at', v_timer.segment_started_at
  );
end;
$$;

create or replace function public.timer_pause_session(
  p_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_timer public.timer_sessions%rowtype;
  v_remaining integer;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select *
  into v_timer
  from public.timer_sessions
  where user_id = v_user
    and operation_id = p_operation_id
  for update;

  if v_timer.id is null then
    raise exception 'timer_not_found';
  end if;

  if v_timer.status <> 'running' then
    return jsonb_build_object(
      'operation_id', v_timer.operation_id,
      'status', v_timer.status,
      'remaining_seconds', v_timer.remaining_seconds
    );
  end if;

  v_remaining := greatest(
    0,
    v_timer.remaining_seconds
      - floor(extract(epoch from (now() - v_timer.segment_started_at)))::integer
  );

  update public.timer_sessions
  set remaining_seconds = v_remaining,
      status = case when v_remaining = 0 then 'completed' else 'paused' end,
      segment_started_at = null,
      completed_at = case when v_remaining = 0 then now() else null end
  where id = v_timer.id;

  return jsonb_build_object(
    'operation_id', v_timer.operation_id,
    'status', case when v_remaining = 0 then 'completed' else 'paused' end,
    'remaining_seconds', v_remaining
  );
end;
$$;

create or replace function public.timer_resume_session(
  p_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_timer public.timer_sessions%rowtype;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select *
  into v_timer
  from public.timer_sessions
  where user_id = v_user
    and operation_id = p_operation_id
  for update;

  if v_timer.id is null then
    raise exception 'timer_not_found';
  end if;

  if v_timer.status <> 'paused' then
    return jsonb_build_object(
      'operation_id', v_timer.operation_id,
      'status', v_timer.status,
      'remaining_seconds', v_timer.remaining_seconds
    );
  end if;

  update public.timer_sessions
  set status = 'running',
      segment_started_at = now()
  where id = v_timer.id;

  return jsonb_build_object(
    'operation_id', v_timer.operation_id,
    'status', 'running',
    'remaining_seconds', v_timer.remaining_seconds
  );
end;
$$;

create or replace function public.timer_cancel_session(
  p_operation_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_timer public.timer_sessions%rowtype;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select *
  into v_timer
  from public.timer_sessions
  where user_id = v_user
    and operation_id = p_operation_id
  for update;

  if v_timer.id is null then
    return false;
  end if;

  if v_timer.status = 'completed' then
    raise exception 'timer_already_completed';
  end if;

  delete from public.study_sessions
  where user_id = v_user
    and client_operation_id = p_operation_id
    and completed = false;

  update public.timer_sessions
  set status = 'cancelled',
      cancelled_at = now(),
      segment_started_at = null
  where id = v_timer.id;

  return true;
end;
$$;

create or replace function public.timer_complete_session(
  p_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_timer public.timer_sessions%rowtype;
  v_remaining integer;
  v_reward jsonb;
  v_duration_minutes integer;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select *
  into v_timer
  from public.timer_sessions
  where user_id = v_user
    and operation_id = p_operation_id
  for update;

  if v_timer.id is null then
    raise exception 'timer_not_found';
  end if;

  if v_timer.status = 'completed' then
    select public.complete_study_session(
      v_timer.subject_id,
      greatest(5, round(v_timer.duration_seconds / 60.0)::integer),
      v_timer.operation_id,
      'server'
    )
    into v_reward;

    return coalesce(v_reward, jsonb_build_object(
      'timer_session_id', v_timer.id,
      'operation_id', v_timer.operation_id,
      'status', 'completed'
    ));
  end if;

  if v_timer.status <> 'running' then
    raise exception 'timer_not_running';
  end if;

  v_remaining := greatest(
    0,
    v_timer.remaining_seconds
      - floor(extract(epoch from (now() - v_timer.segment_started_at)))::integer
  );

  if v_remaining > 0 then
    raise exception 'timer_not_elapsed';
  end if;

  v_duration_minutes := greatest(
    5,
    round(v_timer.duration_seconds / 60.0)::integer
  );

  update public.timer_sessions
  set remaining_seconds = 0,
      status = 'completed',
      completed_at = now(),
      segment_started_at = null
  where id = v_timer.id;

  select public.complete_study_session(
    v_timer.subject_id,
    v_duration_minutes,
    v_timer.operation_id,
    'server'
  )
  into v_reward;

  return jsonb_build_object(
    'timer_session_id', v_timer.id,
    'operation_id', v_timer.operation_id,
    'status', 'completed',
    'remaining_seconds', 0,
    'reward', v_reward
  );
end;
$$;

revoke all on function public.timer_start_session(uuid,uuid,integer,text) from public, anon, authenticated;
revoke all on function public.timer_get_active_session() from public, anon, authenticated;
revoke all on function public.timer_pause_session(text) from public, anon, authenticated;
revoke all on function public.timer_resume_session(text) from public, anon, authenticated;
revoke all on function public.timer_cancel_session(text) from public, anon, authenticated;
revoke all on function public.timer_complete_session(text) from public, anon, authenticated;

grant execute on function public.timer_start_session(uuid,uuid,integer,text) to authenticated;
grant execute on function public.timer_get_active_session() to authenticated;
grant execute on function public.timer_pause_session(text) to authenticated;
grant execute on function public.timer_resume_session(text) to authenticated;
grant execute on function public.timer_cancel_session(text) to authenticated;
grant execute on function public.timer_complete_session(text) to authenticated;
