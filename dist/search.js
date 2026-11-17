import {MILLS,NEIGHBORS,completeTurns} from './engine.js';

const FULL = 0xffffff;
const MATE = 1000000;
const STOP = Symbol('search budget exhausted');
const millMasks = MILLS.map(line => line.reduce((mask,i) => mask | (1 << i),0));
const millsAt = NEIGHBORS.map((_,i) => millMasks.filter(mask => mask & (1 << i)));
const adjacency = NEIGHBORS.map(list => list.reduce((mask,i) => mask | (1 << i),0));
const indexOf = bit => 31-Math.clz32(bit);
function popcount(bits) {
  bits -= (bits >>> 1) & 0x55555555;
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function pack(s) {
  let white = 0, black = 0;
  s.board.forEach((piece,i) => {if (piece === 1) white |= 1 << i;else if (piece === 2) black |= 1 << i;});
  return s.player === 1 ? {us:white,them:black,hand:s.reserves[0],otherHand:s.reserves[1]} : {us:black,them:white,hand:s.reserves[1],otherHand:s.reserves[0]};
}
function key(node,player) {
  return player === 1 ? `${node.us},${node.them},${node.hand},${node.otherHand},1` : `${node.them},${node.us},${node.otherHand},${node.hand},2`;
}
function closed(mask,at) {return millsAt[at].some(line => (line & mask) === line);}
function removable(mask) {
  let protectedBits = 0;
  for (const line of millMasks) if ((line & mask) === line) protectedBits |= line;
  return (mask & ~protectedBits) || mask;
}
function generate(node) {
  const {us,them,hand,otherHand} = node;
  if (hand === 0 && otherHand === 0 && popcount(us) < 3) return [];
  const empty = FULL & ~(us | them);
  const moves = [];
  function add(from,to) {
    const nextUs = (from < 24 ? us ^ (1 << from) : us) | (1 << to);
    const nextHand = hand-(from === 24 ? 1 : 0);
    let targets = closed(nextUs,to) ? removable(them) : 0;
    if (!targets) {
      moves.push({code:from | (to << 5) | (24 << 10),capture:false,node:{us:them,them:nextUs,hand:otherHand,otherHand:nextHand}});
      return;
    }
    while (targets) {
      const bit = targets & -targets;targets ^= bit;
      moves.push({code:from | (to << 5) | (indexOf(bit) << 10),capture:true,node:{us:them ^ bit,them:nextUs,hand:otherHand,otherHand:nextHand}});
    }
  }
  if (hand > 0) {
    let destinations = empty;
    while (destinations) {const bit = destinations & -destinations;destinations ^= bit;add(24,indexOf(bit));}
  } else {
    let pieces = us;
    while (pieces) {
      const bit = pieces & -pieces;pieces ^= bit;
      const from = indexOf(bit);
      let destinations = adjacency[from] & empty;
      while (destinations) {const dest = destinations & -destinations;destinations ^= dest;add(from,indexOf(dest));}
    }
  }
  return moves;
}
function actionsFrom(code) {
  const from = code & 31, to = (code >>> 5) & 31, capture = (code >>> 10) & 31;
  const actions = from === 24 ? [{type:'place',at:to}] : [{type:'move',from,to}];
  if (capture < 24) actions.push({type:'capture',at:capture});
  return actions;
}
// The public rule engine remains the authority for a pending capture at the root.
export function searchSuccessors(s) {
  if (s.winner || s.draw) return [];
  if (s.capture) return completeTurns(s).map(({state,actions}) => ({actions,node:pack(state),code:24 | (24 << 5) | (actions[0].at << 10),capture:true}));
  return generate(pack(s)).map(move => ({...move,actions:actionsFrom(move.code)}));
}
function features(own,other,hand,empty) {
  let score = 0, mobility = 0, blocked = 0, closable = 0, gaps = 0;
  let pieces = own;
  while (pieces) {
    const bit = pieces & -pieces;pieces ^= bit;
    const at = indexOf(bit), exits = popcount(adjacency[at] & empty);
    mobility += exits;
    if (!exits) blocked++;
    score += NEIGHBORS[at].length * 2;
  }
  for (const line of millMasks) {
    if (line & other) continue;
    const n = popcount(line & own);
    if (n === 3) score += 32;
    else if (n === 2) {
      const gap = line & empty;
      score += 16;
      if (hand > 0 || (adjacency[indexOf(gap)] & own & ~line)) {
        closable++;gaps |= gap;score += 58;
      }
    } else if (n === 1) score += 5;
  }
  const distinct = popcount(gaps);
  if (distinct >= 2) score += 65 * (distinct-1);
  if (hand === 0) score += mobility*7-blocked*22;
  else score += mobility*2;
  return {score,closable,mobility};
}
function evaluate(node) {
  const {us,them,hand,otherHand} = node;
  const empty = FULL & ~(us | them);
  const a = features(us,them,hand,empty), b = features(them,us,otherHand,empty);
  return (popcount(us)+hand-popcount(them)-otherHand)*240 + a.score-b.score + (a.closable ? 38 : 0) + 3;
}
function terminal(node,ply) {
  if (node.hand || node.otherHand) return null;
  if (popcount(node.us) < 3) return -MATE+ply;
  if (popcount(node.them) < 3) return MATE-ply;
  const empty = FULL & ~(node.us | node.them);
  let pieces = node.us;
  while (pieces) {const bit = pieces & -pieces;pieces ^= bit;if (adjacency[indexOf(bit)] & empty) return null;}
  return -MATE+ply;
}
function hash(text) {
  let value = 2166136261;
  for (let i = 0;i < text.length;i++) value = Math.imul(value ^ text.charCodeAt(i),16777619);
  return value >>> 0;
}
function restoreRepetitions(s) {
  const result = new Map();
  for (const [original,n] of Object.entries(s.repetitions || {})) {
    const [board,reserves,player] = original.split(':');
    if (board?.length !== 24 || !reserves || !player || n < 1) continue;
    let white = 0, black = 0;
    for (let i=0;i<24;i++) {if (board[i] === '1') white |= 1 << i;else if (board[i] === '2') black |= 1 << i;}
    result.set(`${white},${black},${reserves},${player}`,n);
  }
  return result;
}
/** Time-bounded iterative deepening. A depth counts complete moves, including captures. */
export function searchBestTurn(s,{timeMs = 1800,maxDepth = 12,nodeLimit = 700000} = {}) {
  const started = performance.now();
  const roots = searchSuccessors(s);
  if (!roots.length) return {actions:[],depth:0,nodes:0,elapsedMs:0,score:0};
  const deadline = started+Math.max(1,timeMs);
  const repetitions = restoreRepetitions(s);
  let historyHash = 0;
  for (const [k,n] of repetitions) historyHash ^= hash(k+'#'+n);
  // Include the repetition history in score-cache keys: different draw rights must
  // never share a cached score. Position-only hints are used only for ordering.
  const table = new Map(), hints = new Map(), history = new Map();
  let nodes = 0, completedDepth = 0, bestScore = -Infinity;
  let bestMove = roots[0];
  function budget() {
    nodes++;
    if (nodes >= nodeLimit || ((nodes & 127) === 0 && performance.now() >= deadline)) throw STOP;
  }
  function withPosition(node,player,fn) {
    const k = key(node,player), previous = repetitions.get(k) || 0, oldHash = historyHash;
    if (previous) historyHash ^= hash(k+'#'+previous);
    historyHash ^= hash(k+'#'+(previous+1));
    repetitions.set(k,previous+1);
    try { return fn(previous+1); }
    finally {
      if (previous) repetitions.set(k,previous);else repetitions.delete(k);
      historyHash = oldHash;
    }
  }
  function order(moves,nodeKey,ply) {
    const hint = hints.get(nodeKey);
    for (const move of moves) {
      const end = terminal(move.node,ply+1);
      move.rank = (move.code === hint ? 10000000 : 0) + (end === null ? -evaluate(move.node) : -end) + (move.capture ? 1200 : 0) + (history.get(move.code) || 0);
    }
    moves.sort((a,b) => b.rank-a.rank || a.code-b.code);
    return moves;
  }
  function visit(node,player,depth,alpha,beta,ply,extensions) {
    budget();
    const end = terminal(node,ply);
    if (end !== null) return end;
    const nodeKey = key(node,player);
    if ((repetitions.get(nodeKey) || 0) >= 3) return 0;
    // At the horizon, finish immediate captures so the last searched move
    // cannot appear safe merely by putting the reply beyond the search limit.
    if (depth <= 0) {
      const stand = evaluate(node);
      if (!extensions) return stand;
      if (stand >= beta) return stand;
      alpha = Math.max(alpha,stand);
      const captures = generate(node).filter(move => move.capture);
      for (const move of order(captures,nodeKey,ply)) {
        const value = withPosition(move.node,3-player,() => -visit(move.node,3-player,0,-beta,-alpha,ply+1,extensions-1));
        alpha = Math.max(alpha,value);
        if (alpha >= beta) break;
      }
      return alpha;
    }
    const originalAlpha = alpha, originalBeta = beta;
    const cacheKey = nodeKey+'/'+(historyHash >>> 0);
    const cached = table.get(cacheKey);
    if (cached && cached.depth >= depth && cached.ply === ply) {
      if (cached.bound === 'exact') return cached.value;
      if (cached.bound === 'lower') alpha = Math.max(alpha,cached.value);
      if (cached.bound === 'upper') beta = Math.min(beta,cached.value);
      if (alpha >= beta) return cached.value;
    }
    const moves = order(generate(node),nodeKey,ply);
    if (!moves.length) return -MATE+ply;
    let value = -Infinity, principal = moves[0].code;
    for (const move of moves) {
      const score = withPosition(move.node,3-player,() => -visit(move.node,3-player,depth-1,-beta,-alpha,ply+1,extensions));
      if (score > value) {value = score;principal = move.code;}
      alpha = Math.max(alpha,value);
      if (alpha >= beta) {
        history.set(move.code,Math.min(2000,(history.get(move.code) || 0)+depth*depth));
        break;
      }
    }
    hints.set(nodeKey,principal);
    if (table.size < 100000) table.set(cacheKey,{depth,ply,value,bound:value <= originalAlpha ? 'upper' : value >= originalBeta ? 'lower' : 'exact'});
    return value;
  }
  order(roots,key(pack(s),s.player),0);
  bestMove = roots[0];
  for (let depth = 1;depth <= maxDepth;depth++) {
    let iterationBest = null, value = -Infinity, alpha = -Infinity;
    roots.sort((a,b) => (b.code === bestMove.code)-(a.code === bestMove.code) || (b.score ?? b.rank)-(a.score ?? a.rank));
    try {
      for (const move of roots) {
        if (performance.now() >= deadline) throw STOP;
        const score = withPosition(move.node,3-s.player,() => -visit(move.node,3-s.player,depth-1,-Infinity,-alpha,1,2));
        move.score = score;
        if (score > value) {value = score;iterationBest = move;}
        alpha = Math.max(alpha,value);
      }
      bestMove = iterationBest;bestScore = value;completedDepth = depth;
      if (Math.abs(value) > MATE-100) break;
    } catch (error) {if (error !== STOP) throw error;break;}
  }
  return {actions:bestMove.actions,depth:completedDepth,nodes,elapsedMs:performance.now()-started,score:(completedDepth ? bestScore : -evaluate(bestMove.node)) || 0};
}
