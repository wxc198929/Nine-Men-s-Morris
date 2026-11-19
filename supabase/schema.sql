-- Hosted migration: morris_online. All writes are server-only.
create table public.morris_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 20),
  rating integer not null default 1200,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.morris_rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  white_id uuid not null references public.morris_profiles(user_id),
  black_id uuid references public.morris_profiles(user_id),
  status text not null default 'waiting' check (status in ('waiting','playing','finished','cancelled')),
  state jsonb not null,
  revision integer not null default 0,
  rating_delta integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (black_id is null or white_id <> black_id)
);
create index morris_rooms_white on public.morris_rooms(white_id,updated_at desc);
create index morris_rooms_black on public.morris_rooms(black_id,updated_at desc);
create index morris_ranking on public.morris_profiles(rating desc,wins desc,user_id);
alter table public.morris_profiles enable row level security;
alter table public.morris_rooms enable row level security;
create policy server_only on public.morris_profiles for all to anon,authenticated using(false) with check(false);
create policy server_only on public.morris_rooms for all to anon,authenticated using(false) with check(false);
revoke all on public.morris_profiles,public.morris_rooms from anon,authenticated;
grant all on public.morris_profiles,public.morris_rooms to service_role;

create function public.morris_ensure_profile(p_user uuid,p_nickname text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  insert into public.morris_profiles(user_id,nickname)
  values(p_user,left(coalesce(nullif(btrim(p_nickname),''),'棋友'),20)) on conflict do nothing;
  select to_jsonb(p) into result from public.morris_profiles p where user_id=p_user;
  return result;
end; $$;

create function public.morris_create(p_user uuid,p_state jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare rid uuid; candidate text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  update public.morris_rooms set status='cancelled' where status='waiting' and white_id=p_user and created_at < now()-interval '1 day';
  select id into rid from public.morris_rooms where (white_id=p_user or black_id=p_user) and status in ('waiting','playing') limit 1;
  if rid is not null then return rid; end if;
  loop
    candidate=upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
    begin
      insert into public.morris_rooms(code,white_id,state) values(candidate,p_user,p_state) returning id into rid;
      return rid;
    exception when unique_violation then null;
    end;
  end loop;
end; $$;

create function public.morris_join(p_user uuid,p_code text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare r public.morris_rooms; existing uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  select * into r from public.morris_rooms where code=p_code for update;
  if r.id is null then raise exception '房间不存在'; end if;
  if r.white_id=p_user or r.black_id=p_user then return r.id; end if;
  if r.status<>'waiting' or r.created_at < now()-interval '1 day' then raise exception '房间已满或已过期'; end if;
  select id into existing from public.morris_rooms where (white_id=p_user or black_id=p_user) and status in ('waiting','playing') limit 1;
  if existing is not null then raise exception '请先结束当前房间的对局'; end if;
  update public.morris_rooms set black_id=p_user,status='playing',revision=revision+1,updated_at=now() where id=r.id;
  return r.id;
end; $$;

create function public.morris_commit(p_user uuid,p_room uuid,p_revision integer,p_state jsonb,p_kind text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare r public.morris_rooms; wr integer; br integer; delta integer; result double precision;
begin
  select * into r from public.morris_rooms where id=p_room for update;
  if r.id is null or (p_user<>r.white_id and p_user is distinct from r.black_id) then raise exception '无权操作此房间'; end if;
  if r.revision<>p_revision then raise exception '棋局已更新，请重试'; end if;
  if r.status='waiting' and p_kind='resign' and p_user=r.white_id then
    update public.morris_rooms set status='cancelled',revision=revision+1,updated_at=now() where id=r.id;
    return r.id;
  end if;
  if r.status<>'playing' then raise exception '对局尚未开始或已结束'; end if;
  if p_kind='move' and p_user<>(case when (r.state->>'player')::int=1 then r.white_id else r.black_id end) then raise exception '还未轮到你'; end if;
  if p_kind not in ('move','resign') then raise exception '无效操作'; end if;
  if (p_state->>'winner') is not null or (p_state->>'draw')::boolean then
    -- Every settlement locks both profiles in the same order and runs once under the room lock.
    perform 1 from public.morris_profiles where user_id in (r.white_id,r.black_id) order by user_id for update;
    select rating into wr from public.morris_profiles where user_id=r.white_id;
    select rating into br from public.morris_profiles where user_id=r.black_id;
    result=case when (p_state->>'draw')::boolean then 0.5 when (p_state->>'winner')::int=1 then 1 else 0 end;
    delta=round(32*(result-1/(1+power(10.0,(br-wr)/400.0))));
    update public.morris_profiles set rating=rating+delta,wins=wins+(result=1)::int,losses=losses+(result=0)::int,draws=draws+(result=0.5)::int where user_id=r.white_id;
    update public.morris_profiles set rating=rating-delta,wins=wins+(result=0)::int,losses=losses+(result=1)::int,draws=draws+(result=0.5)::int where user_id=r.black_id;
    update public.morris_rooms set status='finished',rating_delta=delta where id=r.id;
  end if;
  update public.morris_rooms set state=p_state,revision=revision+1,updated_at=now() where id=r.id;
  return r.id;
end; $$;

revoke all on function public.morris_ensure_profile(uuid,text),public.morris_create(uuid,jsonb),public.morris_join(uuid,text),public.morris_commit(uuid,uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.morris_ensure_profile(uuid,text),public.morris_create(uuid,jsonb),public.morris_join(uuid,text),public.morris_commit(uuid,uuid,integer,jsonb,text) to service_role;
