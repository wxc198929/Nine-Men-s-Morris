import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {newGame,play} from '../dist/game/nine-mens-morris/engine.js';

test('the actual browser worker dispatches hard search and returns a legal full turn',async () => {
  const moduleUrl = new URL('../dist/game/nine-mens-morris/ai-worker.js',import.meta.url).href;
  const worker = new Worker(`
    const {parentPort} = require('node:worker_threads');
    globalThis.self = {postMessage: message => parentPort.postMessage(message)};
    import(${JSON.stringify(moduleUrl)}).then(() => {
      parentPort.on('message',data => self.onmessage({data}));
      parentPort.postMessage({ready:true});
    }).catch(error => {throw error;});
  `,{eval:true});
  try {
    await new Promise((resolve,reject) => {worker.once('message',resolve);worker.once('error',reject);});
    const s = play(newGame(),{type:'place',at:0});
    const response = new Promise((resolve,reject) => {worker.once('message',resolve);worker.once('error',reject);});
    worker.postMessage({id:42,state:s,level:'hard'});
    const result = await response;
    assert.equal(result.id,42);
    assert.ok(!result.error);
    assert.ok(result.depth >= 3);
    assert.ok(result.elapsedMs < 4000);
    assert.ok(result.actions.length);
    let next = s;
    for (const action of result.actions) next = play(next,action);
    assert.equal(next.player,1);
  } finally {await worker.terminate();}
});
