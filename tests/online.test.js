import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {newGame,play} from '../dist/engine.js';
import {nextState,createHandler} from '../supabase/functions/morris-api/handler.js';
const room=()=>({white_id:'white',black_id:'black',status:'playing',state:newGame()});
test('server rejects spectators, out-of-turn moves and illegal moves',()=>{
  assert.throws(()=>nextState(room(),'spectator',{type:'place',at:0},'move'));
  assert.throws(()=>nextState(room(),'black',{type:'place',at:0},'move'));
  assert.throws(()=>nextState(room(),'white',{type:'place',at:24},'move'));
  const r=room();r.state=play(r.state,{type:'place',at:0});
  assert.throws(()=>nextState(r,'black',{type:'place',at:0},'move'));
});
test('server uses its own game state and ignores forged client results',()=>{
  const r=room();const next=nextState(r,'white',{type:'place',at:0,winner:1,state:{winner:1}},'move');
  assert.equal(next.winner,null);assert.equal(next.board[0],1);assert.equal(r.state.board[0],0);
});
test('resigning awards the opponent and finished games reject further actions',()=>{
  assert.equal(nextState(room(),'black',null,'resign').winner,1);
  assert.throws(()=>nextState({...room(),status:'finished'},'white',null,'resign'));
});
test('server enforces adjacent movement even with three pieces',()=>{
  const r=room();r.state.reserves=[0,0];r.state.board[0]=r.state.board[3]=r.state.board[6]=1;r.state.board[2]=r.state.board[5]=r.state.board[8]=2;
  assert.throws(()=>nextState(r,'white',{type:'move',from:0,to:23},'move'));
  assert.equal(nextState(r,'white',{type:'move',from:0,to:1},'move').board[1],1);
});
test('all protected commands require a validated user',async()=>{
  const handle=createHandler({auth:{getUser:async()=>({error:new Error('invalid')})}});
  for(const command of ['me','create','join','room','move','resign']){
    const response=await handle(new Request('https://example.test',{method:'POST',body:JSON.stringify({command})}));assert.equal(response.status,401);
  }
});
test('API rejects foreign origins and oversized requests',async()=>{
  const handle=createHandler({});
  assert.equal((await handle(new Request('https://example.test',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}))).status,403);
  assert.equal((await handle(new Request('https://example.test',{method:'POST',body:'x'.repeat(4097)}))).status,413);
});
test('client and authoritative server share exactly the same game engine',async()=>{
  assert.equal(await readFile(new URL('../dist/engine.js',import.meta.url),'utf8'),await readFile(new URL('../supabase/functions/morris-api/engine.js',import.meta.url),'utf8'));
});
