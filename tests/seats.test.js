import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler as morrisHandler,nextState as morrisNext} from '../supabase/functions/morris-api/handler.js';
import {createHandler as wallHandler,nextState as wallNext} from '../supabase/functions/wallgo-api/handler.js';
import {newGame as morrisGame} from '../dist/game/nine-mens-morris/engine.js';
import {newGame as wallGame} from '../dist/game/wall-go/engine.js';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function mock(create,prefix,side=2,players=2){
  const calls=[],room={id,host_id:'host',white_id:side===1?'host':null,black_id:side===2?'host':null,green_id:side===3?'host':null,capacity:players,status:'waiting',revision:0,state:prefix==='morris'?morrisGame():wallGame(players)};
  const admin={auth:{getUser:async()=>({data:{user:{id:'host',user_metadata:{}}}})},rpc:async(name,args)=>{calls.push({name,args});return {data:name.endsWith('ensure_profile')?{user_id:'host'}:id};},from:table=>{
    const q={select:()=>q,eq:()=>q,single:async()=>({data:room}),in:async()=>({data:[]})};return q;
  }};
  return {calls,room,request:async body=>create(admin)(new Request('https://example.test',{method:'POST',body:JSON.stringify(body)}))};
}
for(const [prefix,create] of [['morris',morrisHandler],['wallgo',wallHandler]]){
  test(prefix+' passes the selected host and join seats to server-only operations',async()=>{
    for(const side of prefix==='morris'?[1,2]:[1,2,3]){
      const h=mock(create,prefix,side,3===side?3:2);
      const response=await h.request({command:'create',side,players:side===3?3:2,state:{player:side},winner:side});
      assert.equal(response.status,200);const args=h.calls.find(c=>c.name===prefix+'_create_seated').args;
      assert.equal(args.p_side,side);assert.equal(args.p_user,'host');assert.equal(args.p_state.player,1);assert.equal(args.p_state.winner,null);
    }
    for(const side of prefix==='morris'?[0,1,2]:[0,1,2,3]){
      const h=mock(create,prefix);assert.equal((await h.request({command:'join',code:'ABCDEF',side})).status,200);
      assert.equal(h.calls.find(c=>c.name===prefix+'_join_seated').args.p_side,side);
    }
  });
  test(prefix+' rejects invalid seat choices and preserves older clients default seats',async()=>{
    for(const side of [-1,0,4,'2',1.5]){
      const h=mock(create,prefix);assert.equal((await h.request({command:'create',side})).status,400);assert.ok(!h.calls.some(c=>c.name.endsWith('create_seated')));
    }
    if(prefix==='wallgo'){const h=mock(create,prefix);assert.equal((await h.request({command:'create',players:2,side:3})).status,400);}
    const h=mock(create,prefix);assert.equal((await h.request({command:'create'})).status,200);assert.equal(h.calls.find(c=>c.name.endsWith('create_seated')).args.p_side,1);
    assert.equal((await h.request({command:'join',code:'ABCDEF'})).status,200);assert.equal(h.calls.find(c=>c.name.endsWith('join_seated')).args.p_side,0);
  });
}
test('a host seated second can cancel a waiting room and cannot play ahead of the first seat',()=>{
  const r={host_id:'host',white_id:null,black_id:'host',status:'waiting',state:morrisGame()};
  assert.equal(morrisNext(r,'host',null,'resign'),r.state);assert.throws(()=>morrisNext(r,'other',null,'resign'));
  r.white_id='guest';r.status='playing';assert.throws(()=>morrisNext(r,'host',{type:'place',at:0},'move'));assert.equal(morrisNext(r,'guest',{type:'place',at:0},'move').player,2);
  const w={host_id:'host',white_id:'first',black_id:'second',green_id:'host',status:'playing',state:wallGame(3)};
  assert.throws(()=>wallNext(w,'host',{type:'place',at:0},'move'));assert.equal(wallNext(w,'first',{type:'place',at:0},'move').player,2);
});
