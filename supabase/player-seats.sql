-- Hosted migration selectable_player_seats. Existing room ownership is preserved.

alter table public.morris_rooms add column host_id uuid references public.morris_profiles(user_id);
update public.morris_rooms set host_id=white_id;
alter table public.morris_rooms alter column host_id set not null;
alter table public.morris_rooms alter column white_id drop not null;
alter table public.morris_rooms add constraint morris_host_seated check (coalesce(host_id in (white_id,black_id),false));
create index morris_rooms_host on public.morris_rooms(host_id,created_at) where status='waiting';

create function public.morris_create_seated(p_user uuid,p_state jsonb,p_side integer) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare rid uuid; candidate text; n integer:=2;
begin
  if n not in (2,3) or p_side is null or p_side<1 or p_side>n then raise exception '执方选择无效'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  update public.morris_rooms set status='cancelled' where status='waiting' and host_id=p_user and created_at<now()-interval '1 day';
  select id into rid from public.morris_rooms where p_user in (white_id,black_id) and status in ('waiting','playing') limit 1;
  if rid is not null then return rid; end if;
  loop
    candidate=upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
    begin
      insert into public.morris_rooms(code,host_id,white_id,black_id,state)
      values(candidate,p_user,case when p_side=1 then p_user end,case when p_side=2 then p_user end,p_state) returning id into rid;
      return rid;
    exception when unique_violation then null;
    end;
  end loop;
end; $$;

create function public.morris_join_seated(p_user uuid,p_code text,p_side integer) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare r public.morris_rooms; existing uuid; chosen integer; n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  select * into r from public.morris_rooms where code=p_code for update;
  if r.id is null then raise exception '房间不存在'; end if;
  if p_user in (r.white_id,r.black_id) then return r.id; end if;
  if r.status<>'waiting' or r.created_at<now()-interval '1 day' then raise exception '房间已满或已过期'; end if;
  n:=2;
  if p_side is null or p_side<0 or p_side>n then raise exception '此房间没有该顺位'; end if;
  select id into existing from public.morris_rooms where p_user in (white_id,black_id) and status in ('waiting','playing') limit 1;
  if existing is not null then raise exception '请先结束当前房间的对局'; end if;
  chosen:=case when p_side<>0 then p_side when r.white_id is null then 1 when r.black_id is null then 2 else 0 end;
  if chosen=0 or (case chosen when 1 then r.white_id when 2 then r.black_id end) is not null then raise exception '该顺位已被占用，请选其他空位或自动安排'; end if;
  update public.morris_rooms set white_id=case when chosen=1 then p_user else white_id end,black_id=case when chosen=2 then p_user else black_id end,revision=revision+1,updated_at=now() where id=r.id;
  update public.morris_rooms set status='playing' where id=r.id and white_id is not null and black_id is not null ;
  return r.id;
end; $$;

-- Compatibility entry points keep old clients and maintenance checks working.
create or replace function public.morris_create(p_user uuid,p_state jsonb) returns uuid
language sql security invoker set search_path = '' as $$ select public.morris_create_seated(p_user,p_state,1); $$;
create or replace function public.morris_join(p_user uuid,p_code text) returns uuid
language sql security invoker set search_path = '' as $$ select public.morris_join_seated(p_user,p_code,0); $$;
revoke all on function public.morris_create_seated(uuid,jsonb,integer),public.morris_join_seated(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.morris_create_seated(uuid,jsonb,integer),public.morris_join_seated(uuid,text,integer) to service_role;

alter table public.wallgo_rooms add column host_id uuid references public.wallgo_profiles(user_id);
update public.wallgo_rooms set host_id=white_id;
alter table public.wallgo_rooms alter column host_id set not null;
alter table public.wallgo_rooms alter column white_id drop not null;
alter table public.wallgo_rooms add constraint wallgo_host_seated check (coalesce(host_id in (white_id,black_id,green_id),false));
create index wallgo_rooms_host on public.wallgo_rooms(host_id,created_at) where status='waiting';

create function public.wallgo_create_seated(p_user uuid,p_state jsonb,p_side integer) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare rid uuid; candidate text; n integer:=coalesce((p_state->>'players')::int,2);
begin
  if n not in (2,3) or p_side is null or p_side<1 or p_side>n then raise exception '执方选择无效'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  update public.wallgo_rooms set status='cancelled' where status='waiting' and host_id=p_user and created_at<now()-interval '1 day';
  select id into rid from public.wallgo_rooms where p_user in (white_id,black_id,green_id) and status in ('waiting','playing') limit 1;
  if rid is not null then return rid; end if;
  loop
    candidate=upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
    begin
      insert into public.wallgo_rooms(code,host_id,white_id,black_id,green_id,capacity,state)
      values(candidate,p_user,case when p_side=1 then p_user end,case when p_side=2 then p_user end,case when p_side=3 then p_user end,n,p_state) returning id into rid;
      return rid;
    exception when unique_violation then null;
    end;
  end loop;
end; $$;

create function public.wallgo_join_seated(p_user uuid,p_code text,p_side integer) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare r public.wallgo_rooms; existing uuid; chosen integer; n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  select * into r from public.wallgo_rooms where code=p_code for update;
  if r.id is null then raise exception '房间不存在'; end if;
  if p_user in (r.white_id,r.black_id,r.green_id) then return r.id; end if;
  if r.status<>'waiting' or r.created_at<now()-interval '1 day' then raise exception '房间已满或已过期'; end if;
  n:=r.capacity;
  if p_side is null or p_side<0 or p_side>n then raise exception '此房间没有该顺位'; end if;
  select id into existing from public.wallgo_rooms where p_user in (white_id,black_id,green_id) and status in ('waiting','playing') limit 1;
  if existing is not null then raise exception '请先结束当前房间的对局'; end if;
  chosen:=case when p_side<>0 then p_side when r.white_id is null then 1 when r.black_id is null then 2 when r.green_id is null then 3 else 0 end;
  if chosen=0 or (case chosen when 1 then r.white_id when 2 then r.black_id when 3 then r.green_id end) is not null then raise exception '该顺位已被占用，请选其他空位或自动安排'; end if;
  update public.wallgo_rooms set white_id=case when chosen=1 then p_user else white_id end,black_id=case when chosen=2 then p_user else black_id end,green_id=case when chosen=3 then p_user else green_id end,revision=revision+1,updated_at=now() where id=r.id;
  update public.wallgo_rooms set status='playing' where id=r.id and white_id is not null and black_id is not null and (capacity=2 or green_id is not null);
  return r.id;
end; $$;

-- Compatibility entry points keep old clients and maintenance checks working.
create or replace function public.wallgo_create(p_user uuid,p_state jsonb) returns uuid
language sql security invoker set search_path = '' as $$ select public.wallgo_create_seated(p_user,p_state,1); $$;
create or replace function public.wallgo_join(p_user uuid,p_code text) returns uuid
language sql security invoker set search_path = '' as $$ select public.wallgo_join_seated(p_user,p_code,0); $$;
revoke all on function public.wallgo_create_seated(uuid,jsonb,integer),public.wallgo_join_seated(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.wallgo_create_seated(uuid,jsonb,integer),public.wallgo_join_seated(uuid,text,integer) to service_role;

create or replace function public.morris_commit(p_user uuid,p_room uuid,p_revision integer,p_state jsonb,p_kind text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare r public.morris_rooms; wr integer; br integer; delta integer; result double precision;
begin
  select * into r from public.morris_rooms where id=p_room for update;
  if r.id is null or not coalesce(p_user in (r.white_id,r.black_id),false) then raise exception '无权操作此房间'; end if;
  if r.revision<>p_revision then raise exception '棋局已更新，请重试'; end if;
  if r.status='waiting' and p_kind='resign' and p_user=r.host_id then
    update public.morris_rooms set status='cancelled',revision=revision+1,updated_at=now() where id=r.id;
    return r.id;
  end if;
  if r.status<>'playing' then raise exception '对局尚未开始或已结束'; end if;
  if p_kind='move' and p_user is distinct from (case when (r.state->>'player')::int=1 then r.white_id else r.black_id end) then raise exception '还未轮到你'; end if;
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

