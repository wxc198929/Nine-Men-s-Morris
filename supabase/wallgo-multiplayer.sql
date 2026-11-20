-- Hosted migration wallgo_three_players. Existing rooms keep capacity 2.
alter table public.wallgo_rooms add column capacity smallint not null default 2 check (capacity in (2,3));
alter table public.wallgo_rooms add column green_id uuid references public.wallgo_profiles(user_id);
alter table public.wallgo_rooms add column rating_deltas jsonb;
alter table public.wallgo_rooms add constraint wallgo_distinct_green check (green_id is null or (capacity=3 and green_id<>white_id and green_id<>black_id));
create index wallgo_rooms_green on public.wallgo_rooms(green_id,updated_at desc) where green_id is not null;

create or replace function public.wallgo_create(p_user uuid,p_state jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare rid uuid; candidate text; n integer:=coalesce((p_state->>'players')::int,2);
begin
  if n not in (2,3) then raise exception '人数无效'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  update public.wallgo_rooms set status='cancelled' where status='waiting' and white_id=p_user and created_at < now()-interval '1 day';
  select id into rid from public.wallgo_rooms where p_user in (white_id,black_id,green_id) and status in ('waiting','playing') limit 1;
  if rid is not null then return rid; end if;
  loop
    candidate=upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
    begin
      insert into public.wallgo_rooms(code,white_id,state,capacity) values(candidate,p_user,p_state,n) returning id into rid;
      return rid;
    exception when unique_violation then null;
    end;
  end loop;
end; $$;

create or replace function public.wallgo_join(p_user uuid,p_code text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare r public.wallgo_rooms; existing uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  select * into r from public.wallgo_rooms where code=p_code for update;
  if r.id is null then raise exception '房间不存在'; end if;
  if p_user in (r.white_id,r.black_id,r.green_id) then return r.id; end if;
  if r.status<>'waiting' or r.created_at < now()-interval '1 day' then raise exception '房间已满或已过期'; end if;
  select id into existing from public.wallgo_rooms where p_user in (white_id,black_id,green_id) and status in ('waiting','playing') limit 1;
  if existing is not null then raise exception '请先结束当前房间的对局'; end if;
  if r.black_id is null then
    update public.wallgo_rooms set black_id=p_user,status=case when capacity=2 then 'playing' else 'waiting' end,revision=revision+1,updated_at=now() where id=r.id;
  elsif r.capacity=3 and r.green_id is null then
    update public.wallgo_rooms set green_id=p_user,status='playing',revision=revision+1,updated_at=now() where id=r.id;
  else raise exception '房间已满'; end if;
  return r.id;
end; $$;

create or replace function public.wallgo_commit(p_user uuid,p_room uuid,p_revision integer,p_state jsonb,p_kind text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare r public.wallgo_rooms; ids uuid[]; ratings integer[]; outcomes integer[]; deltas integer[]; i integer; j integer; d integer; actual double precision; is_draw boolean; is_top boolean;
begin
  select * into r from public.wallgo_rooms where id=p_room for update;
  if r.id is null or not coalesce(p_user in (r.white_id,r.black_id,r.green_id),false) then raise exception '无权操作此房间'; end if;
  if r.revision<>p_revision then raise exception '棋局已更新，请重试'; end if;
  if r.status='waiting' and p_kind='resign' then
    update public.wallgo_rooms set status='cancelled',revision=revision+1,updated_at=now() where id=r.id;
    return r.id;
  end if;
  if r.status<>'playing' then raise exception '对局尚未开始或已结束'; end if;
  ids:=case when r.capacity=3 then array[r.white_id,r.black_id,r.green_id] else array[r.white_id,r.black_id] end;
  if p_kind='move' and p_user is distinct from ids[(r.state->>'player')::int] then raise exception '还未轮到你'; end if;
  if p_kind not in ('move','resign') then raise exception '无效操作'; end if;
  if (p_state->>'winner') is not null or (p_state->>'draw')::boolean then
    perform 1 from public.wallgo_profiles where user_id=any(ids) order by user_id for update;
    ratings:=array[]::integer[]; outcomes:=array[]::integer[]; deltas:=array_fill(0,array[r.capacity::integer]);
    for i in 1..r.capacity loop
      ratings:=array_append(ratings,(select rating from public.wallgo_profiles where user_id=ids[i]));
      is_top:=case when p_state ? 'winners' then (p_state->'winners') @> to_jsonb(array[i]) else (p_state->>'draw')::boolean or (p_state->>'winner')::int=i end;
      outcomes:=array_append(outcomes,case when is_top then 1 else 0 end);
    end loop;
    -- Pairwise Elo uses the same pre-settlement ratings; each pair has equal/opposite deltas.
    for i in 1..r.capacity-1 loop
      for j in i+1..r.capacity loop
        actual:=case when outcomes[i]=outcomes[j] then 0.5 when outcomes[i]>outcomes[j] then 1 else 0 end;
        d:=round((32.0/(r.capacity-1))*(actual-1/(1+power(10.0,(ratings[j]-ratings[i])/400.0))));
        deltas[i]:=deltas[i]+d; deltas[j]:=deltas[j]-d;
      end loop;
    end loop;
    is_draw:=(p_state->>'draw')::boolean;
    for i in 1..r.capacity loop
      update public.wallgo_profiles set rating=rating+deltas[i],wins=wins+(outcomes[i]=1 and not is_draw)::int,losses=losses+(outcomes[i]=0)::int,draws=draws+(outcomes[i]=1 and is_draw)::int where user_id=ids[i];
    end loop;
    update public.wallgo_rooms set status='finished',rating_delta=deltas[1],rating_deltas=to_jsonb(deltas) where id=r.id;
  end if;
  update public.wallgo_rooms set state=p_state,revision=revision+1,updated_at=now() where id=r.id;
  return r.id;
end; $$;
