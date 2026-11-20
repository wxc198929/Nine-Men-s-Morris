import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {newGame,play,legalActions,breakOptions,edge,regions,resign,stonesPerPlayer} from '../dist/game/wall-go/engine.js';
import {chooseAction} from '../dist/game/wall-go/search.js';
import {nextState} from '../supabase/functions/wallgo-api/handler.js';
function fixture(){const s=newGame(3);s.phase='play';s.board[24]=1;s.board[0]=2;s.board[48]=3;return s;}
const setup=[0,6,48,42,24,12];
test('a lone setup stone does not prematurely claim all territory',()=>{
  const s=play(newGame(3),{type:'place',at:24});assert.deepEqual(regions(s).scores,[0,0,0]);assert.ok(regions(s).owners.every(p=>p===0));
});
test('three sides place exactly two stones each in six placements, then rotate red blue green',()=>{
  let s=newGame(3);const order=[];for(const at of setup){order.push(s.player);s=play(s,{type:'place',at});}
  assert.deepEqual(order,[1,2,3,3,2,1]);assert.equal(s.phase,'play');assert.equal(stonesPerPlayer(s),2);assert.deepEqual(s.breaks,[1,1,1]);
  assert.throws(()=>play(s,{type:'place',at:22}));
  for(const p of [1,2,3]){assert.equal(s.board.filter(v=>v===p).length,2);assert.equal(s.player,p);s=play(s,legalActions(s)[0]);}
  assert.equal(s.player,1);assert.throws(()=>newGame(4));
});
test('break and crossing may occur on either step, with a turn after crossing',()=>{
  const s=fixture(),wall=edge(24,1);s.walls[wall]=2;
  assert.ok(breakOptions(s,24).some(a=>a.to===25&&a.breakWall===wall));
  assert.ok(breakOptions(s,24).some(a=>a.to===18&&a.breakWall===wall));
  assert.ok(breakOptions(s,24).some(a=>a.to===26&&a.breakWall===wall));
  const t=fixture(),second=edge(25,1);t.walls[second]=3;
  assert.ok(breakOptions(t,24).some(a=>a.to===26&&a.breakWall===second));
});
test('breaking, moving and mandatory endpoint construction commit atomically and consume only the actor credit',()=>{
  const s=fixture(),broken=edge(24,1);s.walls[broken]=2;const before=structuredClone(s),wall=edge(26,0);
  const next=play(s,{type:'turn',from:24,to:26,breakWall:broken,wall});
  assert.deepEqual(s,before);assert.equal(next.board[24],0);assert.equal(next.board[26],1);assert.equal(next.walls[broken],0);assert.equal(next.walls[wall],1);assert.deepEqual(next.breaks,[0,1,1]);
  assert.throws(()=>play(s,{type:'turn',from:24,to:26,breakWall:broken}));assert.deepEqual(s,before);
  next.player=1;next.walls[edge(26,1)]=2;
  assert.equal(breakOptions(next,26).length,0);assert.throws(()=>play(next,{type:'turn',from:26,to:27,breakWall:edge(26,1),wall:edge(27,0)}));
});
test('wall ID zero is valid and the crossed wall may be rebuilt at the endpoint',()=>{
  const s=fixture();s.board[0]=1;s.board[24]=0;s.board[10]=2;s.walls[0]=2;
  const next=play(s,{type:'turn',from:0,to:7,breakWall:0,wall:0});
  assert.equal(next.board[7],1);assert.equal(next.walls[0],1);assert.equal(next.breaks[0],0);
});
test('break cannot bypass range, occupied cells, a second wall, remote walls, or the no-stay rule',()=>{
  const s=fixture(),wall=edge(24,1);s.walls[wall]=2;s.walls[edge(25,1)]=3;
  assert.ok(!breakOptions(s,24).some(a=>a.to===26));
  assert.throws(()=>play(s,{type:'turn',from:24,to:24,breakWall:wall,wall}));
  assert.throws(()=>play(s,{type:'turn',from:24,to:27,breakWall:wall,wall:edge(27,0)}));
  assert.throws(()=>play(s,{type:'turn',from:24,to:17,breakWall:wall,wall:edge(17,0)}));
  s.walls[edge(25,1)]=0;s.board[25]=2;assert.ok(!breakOptions(s,24).some(a=>a.to===25||a.to===26));
  const two=newGame();two.phase='play';two.walls[edge(12,0)]=1;assert.equal(breakOptions(two,12).length,0);assert.throws(()=>play(two,{type:'turn',from:12,to:5,breakWall:edge(12,0),wall:edge(5,1)}));
});
test('blue-green mixed regions remain contested and green scores its own territory',()=>{
  const s=fixture();s.board.fill(0);s.board[0]=2;s.board[6]=3;assert.equal(regions(s).contested,true);
  s.board.fill(0);s.board[0]=1;s.board[3]=2;s.board[6]=3;
  for(let r=0;r<7;r++){s.walls[42+r*6+1]=1;s.walls[42+r*6+4]=2;}
  assert.deepEqual(regions(s).scores,[14,21,14]);assert.equal(regions(s).owners[6],3);assert.equal(regions(s).contested,false);
});
test('blocked sides are skipped, including when the same side must move again',()=>{
  const s=fixture();s.board.fill(0);s.board[0]=1;s.board[1]=2;s.board[48]=3;s.player=3;s.breaks=[0,0,0];s.walls.fill(1);
  for(const e of [42,82,83])s.walls[e]=0;
  const next=play(s,{type:'turn',from:48,to:47,wall:83});
  assert.equal(next.player,3);assert.deepEqual(next.skipped,[1,2]);assert.equal(next.winner,null);
  const end=play(next,{type:'turn',from:47,to:46,wall:82});assert.equal(end.winner,3);assert.match(end.reason,/全部无合法走法/);
});
test('ties can include two of the three players without awarding the third a draw',()=>{
  const s=fixture();s.board.fill(0);s.board[0]=1;s.board[7]=2;s.board[14]=3;s.walls.fill(1);
  for(const id of [42,43,48])s.walls[id]=0;
  const end=play(s,{type:'turn',from:0,to:1,wall:42});
  assert.deepEqual(regions(end).scores,[2,2,1]);assert.deepEqual(end.winners,[1,2]);assert.equal(end.draw,true);assert.equal(end.winner,null);
});
test('three-player resignation removes only the resigning stones and permits the remaining sides to finish',()=>{
  const s=fixture(),n=resign(s,2);assert.deepEqual(n.eliminated,[2]);assert.equal(n.board.includes(2),false);assert.equal(n.winner,null);assert.throws(()=>resign(n,2));
  assert.equal(resign(n,3).winner,1);
});
test('server authorizes green, rejects forged credits and passes only the bounded break action',()=>{
  const room={white_id:'red',black_id:'blue',green_id:'green',status:'playing',state:fixture()};room.state.player=3;
  const a=legalActions(room.state)[0];assert.doesNotThrow(()=>nextState(room,'green',a,'move'));assert.throws(()=>nextState(room,'red',a,'move'));
  room.state.player=1;const wall=edge(24,1);room.state.walls[wall]=2;room.state.breaks[0]=0;
  assert.throws(()=>nextState(room,'red',{type:'turn',from:24,to:25,breakWall:wall,wall:edge(25,0),breaks:[1,1,1]},'move'));
  room.state.breaks[0]=1;const n=nextState(room,'red',{type:'turn',from:24,to:25,breakWall:wall,wall:edge(25,0),winner:1},'move');assert.equal(n.breaks[0],0);assert.equal(n.winner,null);
});
test('random complete three-player games terminate, preserve all six stones and never overspend break credits',()=>{
  let seed=983;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  for(let game=0;game<12;game++){
    let s=newGame(3),turns=0;const spent=[0,0,0];
    while(!s.winner&&!s.draw){
      const actions=legalActions(s);assert.ok(actions.length);const a=actions[Math.floor(random()*actions.length)],before=structuredClone(s);const n=play(s,a);
      assert.deepEqual(s,before);
      if(s.phase==='play'){
        assert.notEqual(a.from,a.to);if(a.breakWall!==undefined)spent[s.player-1]++;
        for(const p of [1,2,3]){assert.equal(n.board.filter(v=>v===p).length,2);assert.ok(spent[p-1]<=1);assert.equal(n.breaks[p-1],1-spent[p-1]);}
      }
      s=n;assert.ok(++turns<=100);
    }
  }
});
test('three-player AI values its own result and can choose a necessary wall crossing',()=>{
  const s=fixture();s.walls.fill(1);s.board.fill(0);s.board[0]=1;s.board[6]=2;s.board[48]=3;
  const a=chooseAction(s,{level:'hard',timeMs:500,maxDepth:2}).action;
  assert.ok(a);assert.notEqual(a.breakWall,undefined);assert.doesNotThrow(()=>play(s,a));
});
test('actual worker supports both computer sides in a three-player game',async()=>{
  const url=new URL('../dist/game/wall-go/ai-worker.js',import.meta.url).href;
  const worker=new Worker('const {parentPort}=require("node:worker_threads");globalThis.self={postMessage:m=>parentPort.postMessage(m)};import('+JSON.stringify(url)+').then(()=>{parentPort.on("message",data=>self.onmessage({data}));parentPort.postMessage({ready:true});});',{eval:true});
  try{
    await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
    let s=newGame(3);for(const at of setup)s=play(s,{type:'place',at});s=play(s,legalActions(s)[0]);
    for(const p of [2,3]){
      assert.equal(s.player,p);const pending=new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});worker.postMessage({id:p,state:s,level:'normal'});
      const result=await pending;assert.ok(!result.error);assert.equal(result.id,p);s=play(s,result.action);
    }
    assert.equal(s.player,1);
  }finally{await worker.terminate();}
});
