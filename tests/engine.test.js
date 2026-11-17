import test from 'node:test';
import assert from 'node:assert/strict';
import {POINTS,MILLS,NEIGHBORS,newGame,legalActions,play,inMill,capturable,count,chooseTurn,positionKey} from '../dist/engine.js';
function position(white,black,extra = {}) {
  const s = {...newGame(),reserves:[0,0],repetitions:{},...extra};
  white.forEach(i => s.board[i] = 1);black.forEach(i => s.board[i] = 2);return s;
}
test('24 points, 16 mills and 32 undirected board edges',() => {
  assert.equal(POINTS.length,24);assert.equal(MILLS.length,16);
  assert.equal(NEIGHBORS.flat().length,64);
  NEIGHBORS.forEach((list,i) => list.forEach(j => assert.ok(NEIGHBORS[j].includes(i))));
  assert.ok(!NEIGHBORS[7].includes(16));
});
test('placement alternates and does not mutate the previous position',() => {
  const s = newGame();const n = play(s,{type:'place',at:0});
  assert.equal(n.player,2);assert.deepEqual(n.reserves,[8,9]);assert.equal(s.board[0],0);
  assert.throws(() => play(n,{type:'place',at:0}));
});
test('a new mill requires capture before passing the turn',() => {
  const s = position([0,1],[3,4,9],{reserves:[7,6]});
  const n = play(s,{type:'place',at:2});
  assert.ok(inMill(n,2));assert.equal(n.capture,true);assert.equal(n.player,1);
  assert.ok(legalActions(n).every(a => a.type === 'capture'));
  const end = play(n,{type:'capture',at:9});assert.equal(end.player,2);assert.equal(count(end,2),2);assert.equal(end.winner,null);
});
test('pieces inside mills are protected unless all opponent pieces are in mills',() => {
  const s = position([0,1,2],[3,4,5,9],{capture:true});
  assert.deepEqual(capturable(s),[9]);assert.throws(() => play(s,{type:'capture',at:3}));
  s.board[9] = 0;assert.deepEqual(capturable(s),[3,4,5]);
});
test('three pieces still cannot fly or move diagonally',() => {
  const s = position([0,4,8],[2,3,9]);
  assert.ok(!legalActions(s).some(a => a.from === 0 && a.to === 23));
  assert.ok(!legalActions(s).some(a => a.from === 0 && a.to === 4));
  assert.ok(legalActions(s).some(a => a.from === 0 && a.to === 1));
  assert.throws(() => play(s,{type:'move',from:0,to:23}));
});
test('simultaneously closing two mills still captures only one piece',() => {
  const s = position([0,2,4,7],[3,5,9,14],{reserves:[1,1]});
  const n = play(s,{type:'place',at:1});assert.ok(n.capture);
  const end = play(n,{type:'capture',at:9});assert.equal(end.capture,false);assert.equal(end.player,2);assert.equal(count(end,2),3);
});
test('reducing an opponent to two pieces after placing wins',() => {
  const s = position([0,1,2,9],[3,4,14],{capture:true});
  const end = play(s,{type:'capture',at:14});assert.equal(end.winner,1);assert.equal(legalActions(end).length,0);
});
test('an opponent with no adjacent move loses, even with three pieces',() => {
  const s = position([1,4,10,14],[0,3,2]);
  const end = play(s,{type:'move',from:14,to:23});
  // g7 now has its only remaining exit g4: use a fully blocked position below.
  assert.equal(end.winner,null);
  const blocked = position([1,9,4,10,13,15],[0,3,5]);
  const n = play(blocked,{type:'move',from:15,to:16});
  assert.equal(n.winner,1);assert.match(n.reason,/无棋可走/);
});
test('reopening and closing a mill permits another capture',() => {
  let s = position([0,1,2,21],[3,5,9,14]);
  s = play(s,{type:'move',from:1,to:4});
  s = play(s,{type:'move',from:5,to:13});
  s = play(s,{type:'move',from:4,to:1});assert.ok(s.capture);
});
test('the same position with the same player three times is a draw',() => {
  const s = position([0,4,8],[2,10,16]);
  const n = play(s,{type:'move',from:0,to:9});
  s.repetitions[positionKey(n)] = 2;
  const end = play(s,{type:'move',from:0,to:9});assert.ok(end.draw);assert.equal(end.winner,null);
});
test('AI blocks immediate mills and returns legal full turns',() => {
  const s = position([0,1],[3],{player:2,reserves:[7,8]});
  const actions = chooseTurn(s);assert.deepEqual(actions[0],{type:'place',at:2});
  let n = s;for (const action of actions) n = play(n,action);assert.equal(n.player,1);
});
test('seeded complete games preserve material, turn and no-flying invariants',() => {
  let seed = 8131;const random = n => {seed = (seed*1664525+1013904223)>>>0;return seed%n;};
  for (let game = 0;game < 20;game++) {
    let s = newGame();
    for (let step = 0;step < 400 && !s.winner && !s.draw;step++) {
      const legal = legalActions(s);assert.ok(legal.length);
      const a = legal[random(legal.length)];
      if (a.type === 'move') assert.ok(NEIGHBORS[a.from].includes(a.to));
      s = play(s,a);
      for (const p of [1,2]) assert.ok(count(s,p)+s.reserves[p-1] <= 9);
      assert.equal(s.board.length,24);
    }
  }
});
