import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame,play,legalActions,completeTurns,positionKey,chooseTurn} from '../dist/game/nine-mens-morris/engine.js';
import {searchBestTurn,searchSuccessors} from '../dist/game/nine-mens-morris/search.js';

function position(white,black,extra = {}) {
  const s = {...newGame(),reserves:[0,0],repetitions:{},...extra};
  white.forEach(i => s.board[i] = 1);black.forEach(i => s.board[i] = 2);
  s.repetitions[positionKey(s)] = 1;
  return s;
}
const actionKey = actions => JSON.stringify(actions);
function apply(s,actions) {for (const a of actions) s = play(s,a);return s;}

test('fast search generates the same legal turns and resulting positions as the game',() => {
  let seed = 21743, inspected = 0;
  const random = n => {seed = (seed*1664525+1013904223)>>>0;return seed%n;};
  for (let game = 0;game < 12;game++) {
    let s = newGame();
    for (let step = 0;step < 65 && !s.winner && !s.draw;step++) {
      const standard = completeTurns(s), fast = searchSuccessors(s);
      assert.deepEqual(fast.map(v => actionKey(v.actions)).sort(),standard.map(v => actionKey(v.actions)).sort());
      for (const move of fast) {
        const next = apply(s,move.actions), node = move.node;
        next.board.forEach((piece,i) => {
          const actual = node.us & (1 << i) ? next.player : node.them & (1 << i) ? 3-next.player : 0;
          assert.equal(actual,piece);
        });
        assert.equal(node.hand,next.reserves[next.player-1]);
        assert.equal(node.otherHand,next.reserves[2-next.player]);
      }
      const legal = legalActions(s);
      s = play(s,legal[random(legal.length)]);inspected++;
    }
  }
  assert.ok(inspected > 500);
});

test('high difficulty blocks an immediate mill in the opening',() => {
  const s = position([0,1],[3],{player:2,reserves:[7,8]});
  const result = searchBestTurn(s,{timeMs:3000,maxDepth:5,nodeLimit:120000});
  assert.deepEqual(result.actions[0],{type:'place',at:2});
  assert.ok(result.depth >= 3);
});

test('high difficulty chooses a win by capture and never flies with three pieces',() => {
  const s = position([0,1,14],[3,4,9]);
  // g4 -> g7 closes a7-d7-g7; the capture leaves black with only two pieces.
  const result = searchBestTurn(s,{timeMs:1000,maxDepth:8});
  assert.deepEqual(result.actions[0],{type:'move',from:14,to:2});
  assert.equal(result.actions[1].type,'capture');
  assert.equal(apply(s,result.actions).winner,1);
});

test('high difficulty can win by trapping the last mobile opponent piece',() => {
  const s = position([1,4,9,10,12,15],[0,3,5]);
  const result = searchBestTurn(s,{timeMs:1000,maxDepth:6});
  assert.equal(apply(s,result.actions).winner,1);
});

test('high difficulty finds a quiet move that sets up a multi-turn win',() => {
  const s = position([0,3,16,19,22],[2,13,14,15]);
  const result = searchBestTurn(s,{timeMs:1000,maxDepth:8,nodeLimit:100000});
  // Several quiet setups have the same winning score. Test the outcome rather
  // than requiring one coordinate, since high difficulty may now vary ties.
  assert.equal(result.actions.length,1);
  assert.equal(result.actions[0].type,'move');
  assert.doesNotThrow(() => apply(s,result.actions));
  assert.ok(result.depth >= 3);
  assert.ok(result.score > 999900);
});

test('pending captures respect protection and are handled as a complete turn',() => {
  const s = position([0,1,2],[3,4,5,9],{capture:true});
  const result = searchBestTurn(s,{timeMs:1000,maxDepth:4});
  assert.deepEqual(result.actions,[{type:'capture',at:9}]);
  assert.equal(apply(s,result.actions).player,2);
});

test('a forced repeated position is scored as a draw',() => {
  const s = position([0,4,8],[2,10,16]);
  for (const turn of completeTurns(s)) s.repetitions[positionKey(turn.state)] = 2;
  const result = searchBestTurn(s,{timeMs:1000,maxDepth:5});
  assert.equal(result.score,0);
  assert.equal(apply(s,result.actions).draw,true);
});

test('search preserves state and returns a legal move when interrupted',() => {
  const s = play(newGame(),{type:'place',at:0}), snapshot = JSON.stringify(s);
  const result = searchBestTurn(s,{timeMs:1,nodeLimit:1});
  assert.equal(JSON.stringify(s),snapshot);
  assert.ok(result.actions.length);
  assert.doesNotThrow(() => apply(s,result.actions));
  assert.ok(result.elapsedMs < 200);
});

test('normal and easy modes retain legal full turns',() => {
  const s = play(newGame(),{type:'place',at:4});
  for (const level of ['normal','easy']) assert.doesNotThrow(() => apply(s,chooseTurn(s,level)));
});

function seededRandom(seed) {
  return () => {seed = (seed*1664525+1013904223)>>>0;return seed/4294967296;};
}
test('identical openings produce different legal responses with the same completed-depth score',() => {
  const s = play(newGame(),{type:'place',at:0});
  const settings = {maxDepth:4,timeMs:3000,nodeLimit:300000};
  const baseline = searchBestTurn(s,{...settings,variety:false});
  assert.equal(baseline.depth,4);
  const replies = new Set();
  for (let seed=1;seed<=16;seed++) {
    const result = searchBestTurn(s,{...settings,random:seededRandom(seed*937)});
    assert.equal(result.depth,baseline.depth);
    assert.equal(result.score,baseline.score);
    assert.doesNotThrow(() => apply(s,result.actions));
    replies.add(actionKey(result.actions));
  }
  assert.ok(replies.size >= 2,`Expected varied replies, received ${replies.size}`);
});
test('remembering the last opening response avoids repeating it across new games',() => {
  const s = play(newGame(),{type:'place',at:0});
  let previous = null;
  for (let game=0;game<8;game++) {
    // The same random stream deliberately tests the novelty memory itself.
    const result = searchBestTurn(s,{maxDepth:4,timeMs:3000,nodeLimit:300000,random:seededRandom(42),avoidActions:previous ? [previous] : []});
    const choice = actionKey(result.actions);
    assert.notEqual(choice,previous);
    previous = choice;
    assert.doesNotThrow(() => apply(s,result.actions));
  }
});
test('variation and novelty never override a necessary defensive move',() => {
  const s = position([0,1],[3],{player:2,reserves:[7,8]});
  for (let seed=1;seed<=6;seed++) {
    const result = searchBestTurn(s,{maxDepth:4,timeMs:1000,random:seededRandom(seed),avoidActions:[actionKey([{type:'place',at:2}])]});
    assert.deepEqual(result.actions[0],{type:'place',at:2});
  }
});
