-- Integration check: every synthetic user, profile and room is rolled back.
begin;
do $test$
declare ids uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()]; rid uuid; m public.morris_rooms; w public.wallgo_rooms; state jsonb:='{"player":1,"winner":null,"draw":false}'::jsonb; i integer; seat integer; cap integer; taken integer; guest integer; denied boolean;
begin
  for i in 1..4 loop
    insert into auth.users(id,aud,role,email) values(ids[i],'authenticated','authenticated','seat-transaction-test-'||ids[i]||'@example.invalid');
    perform public.morris_ensure_profile(ids[i],'事务测试');perform public.wallgo_ensure_profile(ids[i],'事务测试');
  end loop;
  rid:=public.morris_create_seated(ids[1],state,2);
  select * into m from public.morris_rooms where id=rid;
  assert m.host_id=ids[1] and m.black_id=ids[1] and m.white_id is null,'host did not receive second seat';
  perform public.morris_commit(ids[1],rid,0,state,'resign');
  assert (select status from public.morris_rooms where id=rid)='cancelled','second-seat host could not cancel';
  rid:=public.morris_create_seated(ids[1],state,2);
  select * into m from public.morris_rooms where id=rid;
  denied:=false;begin perform public.morris_join_seated(ids[2],m.code,2);exception when others then denied:=true;end;assert denied,'occupied seat was taken';
  perform public.morris_join_seated(ids[2],m.code,1);
  select * into m from public.morris_rooms where id=rid;
  assert m.white_id=ids[2] and m.status='playing','guest did not receive first seat';
  denied:=false;begin perform public.morris_commit(ids[1],rid,1,state,'move');exception when others then denied:=true;end;assert denied,'second-seat host moved first';
  perform public.morris_commit(ids[2],rid,1,state||'{"player":2}'::jsonb,'move');
  perform public.morris_commit(ids[1],rid,2,state||'{"winner":1,"draw":false}'::jsonb,'resign');
  assert (select rating from public.morris_profiles where user_id=ids[2])=1216,'first-seat guest Elo wrong';
  assert (select rating from public.morris_profiles where user_id=ids[1])=1184,'second-seat host Elo wrong';
  assert (select wins from public.morris_profiles where user_id=ids[2])=1,'win awarded to wrong person';
  denied:=false;begin perform public.morris_create_seated(ids[1],state,3);exception when others then denied:=true;end;assert denied,'invalid host seat accepted';
  rid:=public.morris_create(ids[1],state);select * into m from public.morris_rooms where id=rid;
  assert m.white_id=ids[1] and m.host_id=ids[1],'legacy creation broken';
  perform public.morris_join(ids[2],m.code);
  perform public.morris_commit(ids[1],rid,1,state||'{"winner":2}'::jsonb,'resign');
  for cap in 2..3 loop
    for seat in 1..cap loop
      rid:=public.wallgo_create_seated(ids[1],state||jsonb_build_object('players',cap),seat);
      select * into w from public.wallgo_rooms where id=rid;
      assert w.host_id=ids[1],'wall host identity missing';
      assert (array[w.white_id,w.black_id,w.green_id])[seat]=ids[1],'wall host seat wrong';
      denied:=false;begin perform public.wallgo_join_seated(ids[2],w.code,seat);exception when others then denied:=true;end;assert denied,'occupied wall seat was taken';
      guest:=2;
      for taken in 1..cap loop
        if taken=seat then continue;end if;
        perform public.wallgo_join_seated(ids[guest],w.code,taken);
        guest:=guest+1;
        select * into w from public.wallgo_rooms where id=rid;
        assert w.status=case when guest=cap+1 then 'playing' else 'waiting' end,'room started before all seats filled';
      end loop;
      denied:=false;begin perform public.wallgo_join_seated(ids[4],w.code,0);exception when others then denied:=true;end;assert denied,'full room admitted a fourth player';
      assert public.wallgo_create_seated(ids[1],state||jsonb_build_object('players',cap),seat)=rid,'host escaped active room';
      perform public.wallgo_commit(w.white_id,rid,w.revision,state||jsonb_build_object('players',cap,'winner',1,'winners',jsonb_build_array(1)),'move');
      assert (select status from public.wallgo_rooms where id=rid)='finished','selected seats could not settle';
      assert (select wins from public.wallgo_profiles where user_id=w.white_id)>0,'wall result awarded to wrong seat';
    end loop;
  end loop;
  rid:=public.wallgo_create_seated(ids[1],state||'{"players":3}'::jsonb,3);select * into w from public.wallgo_rooms where id=rid;
  perform public.wallgo_join(ids[2],w.code);select * into w from public.wallgo_rooms where id=rid;
  assert w.white_id=ids[2] and w.status='waiting','automatic first empty seat failed';
  perform public.wallgo_commit(ids[1],rid,w.revision,state,'resign');
  assert (select status from public.wallgo_rooms where id=rid)='cancelled','third-seat host cancellation failed';
  assert not has_function_privilege('authenticated','public.morris_create_seated(uuid,jsonb,integer)','EXECUTE'),'clients can forge room creation';
  assert not has_function_privilege('anon','public.wallgo_join_seated(uuid,text,integer)','EXECUTE'),'anonymous clients can choose seats directly';
  assert not has_table_privilege('authenticated','public.morris_rooms','UPDATE'),'room writes exposed';
end;
$test$;
rollback;
select 'passed: host chooses either Morris seat or all WallGo seats; occupied and invalid choices rejected; full-room gating; actual-seat turns and Elo; host cancellation; automatic empty-seat assignment; old-client compatibility; service-only permissions. All test data rolled back.' as verification;
