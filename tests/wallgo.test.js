import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import {newGame,play,reachable,legalActions,edge,neighbor,regions,EDGES} from '../dist/game/wall-go/engine.js';
import {chooseAction} from '../dist/game/wall-go/search.js';
import {nextState,createHandler} from '../supabase/functions/wallgo-api/handler.js';
const start=()=>{let s=newGame();for(const at of [24,16,32,22])s=play(s,{type:'place',at});return s;};
test('WallGo has the documented fixed opening and red/blue/blue/red setup order',()=>{
  let s=newGame();assert.equal(s.board[12],1);assert.equal(s.board[36],1);assert.equal(s.board[8],2);assert.equal(s.board[40],2);
  const original=structuredClone(s);const sides=[];for(const at of [24,16,32,22]){sides.push(s.player);s=play(s,{type:'place',at});}
  assert.deepEqual(sides,[1,2,2,1]);assert.equal(s.phase,'play');assert.equal(s.player,1);assert.equal(s.board.filter(x=>x===1).length,4);assert.equal(s.board.filter(x=>x===2).length,4);assert.deepEqual(newGame(),original);
});
test('every internal edge has one canonical ID in both directions and boundaries have none',()=>{
  assert.equal(EDGES.length,84);const ids=new Set();for(let at=0;at<49;at++)for(let d=0;d<4;d++){const n=neighbor(at,d),e=edge(at,d);if(n<0)assert.equal(e,-1);else{assert.equal(e,edge(n,(d+2)%4));ids.add(e);}}assert.equal(ids.size,84);
});
test('movement includes zero and orthogonal turns, but cannot cross walls or stones',()=>{
  const s=start();s.board=Array(49).fill(0);s.board[24]=1;s.board[25]=2;
  assert.ok(reachable(s,24).includes(24));assert.ok(reachable(s,24).includes(16));assert.ok(!reachable(s,24).includes(26));
  s.walls[edge(24,0)]=1;assert.ok(!reachable(s,24).includes(10));assert.ok(!reachable(s,24).includes(17));
});
test('move and wall form a single immutable turn and only a free endpoint edge is legal',()=>{
  const s=start(),before=structuredClone(s),a=legalActions(s).find(a=>a.to!==a.from),next=play(s,a);
  assert.deepEqual(s,before);assert.equal(next.walls.filter(Boolean).length,1);assert.equal(next.player,2);assert.equal(next.board[a.to],1);assert.equal(next.board[a.from],0);
  assert.throws(()=>play(s,{...a,wall:83}));assert.throws(()=>play(s,{type:'move',from:a.from,to:a.to}));
  const stay=legalActions(s).find(a=>a.from===a.to);assert.ok(stay);assert.equal(play(s,stay).walls[stay.wall],1);
});
test('territory flood fill counts cells, includes stones, and leaves empty areas neutral',()=>{
  const s=start();s.board.fill(0);s.board[0]=1;s.board[6]=2;for(let r=0;r<7;r++)s.walls[42+r*6+2]=1;
  const r=regions(s);assert.deepEqual(r.scores,[21,28]);assert.equal(r.contested,false);assert.deepEqual(r.largest,[21,28]);
  s.board[6]=0;assert.deepEqual(regions(s).scores,[21,0]);
});
test('completed regions use total territory, then largest region, then draw',()=>{
  const s=start();s.walls.fill(1);s.board.fill(0);s.board[0]=s.board[7]=1;s.board[14]=s.board[21]=2;
  for(const id of [42,48,54,55,0])s.walls[id]=0;
  const n=play(s,{type:'turn',from:0,to:0,wall:0});assert.deepEqual(regions(n).scores,[4,4]);assert.equal(n.winner,2);assert.match(n.reason,/最大区域/);
  const t=structuredClone(s);t.walls[55]=1;t.walls[60]=0;const draw=play(t,{type:'turn',from:0,to:0,wall:0});assert.deepEqual(regions(draw).scores,[4,4]);assert.equal(draw.draw,true);
});
test('hard AI finds an immediate winning partition rather than sealing a smaller region',()=>{
  const s=start();s.board.fill(0);for(const i of [0,14,21,28])s.board[i]=1;for(const i of [3,20,27,34])s.board[i]=2;s.walls.fill(1);for(const id of [42,43,44])s.walls[id]=0;
  const r=chooseAction(s,{level:'hard',timeMs:1000,random:()=>.5});assert.equal(play(s,r.action).winner,1);assert.equal(r.action.to,2);assert.equal(r.action.wall,44);
});
test('seeded complete games terminate, preserve eight pieces and add exactly one wall per play turn',()=>{
  let seed=12345;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  for(let g=0;g<12;g++){let s=newGame(),steps=0;while(!s.winner&&!s.draw){const a=legalActions(s);assert.ok(a.length);const n=play(s,a[Math.floor(random()*a.length)]);if(s.phase==='play'){assert.equal(n.walls.filter(Boolean).length,s.walls.filter(Boolean).length+1);assert.equal(n.board.filter(x=>x===1).length,4);assert.equal(n.board.filter(x=>x===2).length,4);}s=n;assert.ok(++steps<=88);}assert.equal(regions(s).contested,false);}
});
test('server rejects spectators, wrong turn, invalid walls and forged client winners',()=>{
  const room={white_id:'red',black_id:'blue',status:'playing',state:start()};const a=legalActions(room.state)[0];
  assert.throws(()=>nextState(room,'outsider',a,'move'));assert.throws(()=>nextState(room,'blue',a,'move'));assert.throws(()=>nextState(room,'red',{...a,wall:-1},'move'));
  assert.equal(nextState(room,'red',{...a,winner:1,state:{winner:1}},'move').winner,null);assert.equal(nextState(room,'red',null,'resign').winner,2);
});
test('wallgo protects API writes and has an engine identical to its browser engine',async()=>{
  const handler=createHandler({auth:{getUser:async()=>({error:new Error('bad token')})}});
  assert.equal((await handler(new Request('https://example.test',{method:'POST',body:'{"command":"create"}'}))).status,401);
  assert.equal(await readFile(new URL('../dist/game/wall-go/engine.js',import.meta.url),'utf8'),await readFile(new URL('../supabase/functions/wallgo-api/engine.js',import.meta.url),'utf8'));
});
test('equally evaluated opening choices vary and the previous choice can be avoided',()=>{
  const s=play(newGame(),{type:'place',at:24}),results=[.01,.25,.5,.75,.99].map(n=>chooseAction(s,{level:'normal',maxDepth:1,timeMs:1000,random:()=>n}));
  assert.ok(new Set(results.map(r=>JSON.stringify(r.action))).size>1);for(const r of results)assert.ok(Math.abs(r.score-results[0].score)<1e-8);
  const avoid=JSON.stringify(results[0].action),other=chooseAction(s,{level:'normal',maxDepth:1,timeMs:1000,random:()=>.01,avoid});assert.notEqual(JSON.stringify(other.action),avoid);
});
test('the actual WallGo browser worker returns a legal complete move and wall',async()=>{
  const url=new URL('../dist/game/wall-go/ai-worker.js',import.meta.url).href;
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');globalThis.self={postMessage:m=>parentPort.postMessage(m)};import(${JSON.stringify(url)}).then(()=>{parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({ready:true});});`,{eval:true});
  try{
    await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
    const s=start(),pending=new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});worker.postMessage({id:7,state:s,level:'hard'});
    const r=await pending;assert.equal(r.id,7);assert.ok(!r.error);assert.ok(r.depth>=2);const next=play(s,r.action);assert.equal(next.player,2);assert.equal(next.walls.filter(Boolean).length,1);
  }finally{await worker.terminate();}
});
