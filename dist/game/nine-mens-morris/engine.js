export const POINTS = [
  [0,0],[3,0],[6,0],[1,1],[3,1],[5,1],[2,2],[3,2],[4,2],
  [0,3],[1,3],[2,3],[4,3],[5,3],[6,3],[2,4],[3,4],[4,4],
  [1,5],[3,5],[5,5],[0,6],[3,6],[6,6]
];
export const LABELS = POINTS.map(([x,y]) => 'abcdefg'[x] + (7-y));
export const MILLS = [
  [0,1,2],[3,4,5],[6,7,8],[9,10,11],[12,13,14],[15,16,17],[18,19,20],[21,22,23],
  [0,9,21],[3,10,18],[6,11,15],[1,4,7],[16,19,22],[8,12,17],[5,13,20],[2,14,23]
];
export const NEIGHBORS = POINTS.map((_,i) => [...new Set(MILLS.flatMap(line => {
  const k = line.indexOf(i);
  return k < 0 ? [] : [line[k-1],line[k+1]].filter(v => v !== undefined);
}))]);
export const count = (s,p) => s.board.filter(v => v === p).length;
export const inMill = (s,i) => s.board[i] !== 0 && MILLS.some(line => line.includes(i) && line.every(k => s.board[k] === s.board[i]));
export const positionKey = s => s.board.join('') + ':' + s.reserves.join(',') + ':' + s.player;
export function newGame() {
  const s = {board:Array(24).fill(0),reserves:[9,9],player:1,capture:false,winner:null,draw:false,reason:'',turn:1,last:null,repetitions:{}};
  s.repetitions[positionKey(s)] = 1;
  return s;
}
export function capturable(s) {
  const theirs = s.board.flatMap((v,i) => v === 3-s.player ? [i] : []);
  const outside = theirs.filter(i => !inMill(s,i));
  return outside.length ? outside : theirs;
}
export function legalActions(s) {
  if (s.winner || s.draw) return [];
  if (s.capture) return capturable(s).map(at => ({type:'capture',at}));
  if (s.reserves[s.player-1] > 0) return s.board.flatMap((v,at) => v === 0 ? [{type:'place',at}] : []);
  // No flying: even with exactly three pieces, only adjacent moves are legal.
  return s.board.flatMap((v,from) => v === s.player ? NEIGHBORS[from].filter(to => s.board[to] === 0).map(to => ({type:'move',from,to})) : []);
}
function finishTurn(s) {
  s.capture = false;
  s.player = 3-s.player;
  s.turn++;
  if (s.reserves.every(n => n === 0)) {
    if (count(s,s.player) < 3) {
      s.winner = 3-s.player;
      s.reason = '对手不足三子';
    } else if (!legalActions(s).length) {
      s.winner = 3-s.player;
      s.reason = '对手无棋可走';
    }
  }
  const key = positionKey(s);
  s.repetitions[key] = (s.repetitions[key] || 0) + 1;
  if (!s.winner && s.repetitions[key] >= 3) {
    s.draw = true;
    s.reason = '同一局面出现三次';
  }
  return s;
}
export function play(s,action) {
  const fields = ['type','at','from','to'];
  if (!legalActions(s).some(a => fields.every(k => a[k] === action[k]))) throw new Error('不合法的走法');
  const next = {...s,board:[...s.board],reserves:[...s.reserves],repetitions:{...s.repetitions},last:{...action,player:s.player}};
  if (action.type === 'capture') {
    next.board[action.at] = 0;
    return finishTurn(next);
  }
  const destination = action.type === 'place' ? action.at : action.to;
  if (action.type === 'place') next.reserves[s.player-1]--;
  else next.board[action.from] = 0;
  next.board[destination] = s.player;
  if (inMill(next,destination) && capturable(next).length) {
    next.capture = true;
    return next;
  }
  return finishTurn(next);
}
export function completeTurns(s) {
  return legalActions(s).flatMap(action => {
    const next = play(s,action);
    if (!next.capture) return [{state:next,actions:[action]}];
    return legalActions(next).map(take => ({state:play(next,take),actions:[action,take]}));
  });
}
function evaluate(s,p) {
  if (s.winner) return s.winner === p ? 100000 : -100000;
  if (s.draw) return 0;
  let value = 0;
  for (const who of [p,3-p]) {
    const sign = who === p ? 1 : -1;
    value += sign * (count(s,who) + s.reserves[who-1]) * 120;
    value += sign * s.board.reduce((n,v,i) => n + (v === who ? NEIGHBORS[i].filter(j => !s.board[j]).length : 0),0) * 3;
    for (const line of MILLS) {
      const own = line.filter(i => s.board[i] === who).length;
      const empty = line.filter(i => !s.board[i]).length;
      if (own === 3) value += sign * 35;
      if (own === 2 && empty === 1) value += sign * 28;
      if (own === 1 && empty === 2) value += sign * 4;
    }
  }
  return value;
}
export function chooseTurn(s,level = 'normal') {
  const p = s.player;
  const options = completeTurns(s);
  if (!options.length) return [];
  if (level === 'easy') {
    options.sort((a,b) => evaluate(b.state,p)-evaluate(a.state,p));
    return options[Math.floor(Math.random()*Math.min(3,options.length))].actions;
  }
  let best = -Infinity;
  let choices = [];
  for (const candidate of options) {
    const replies = completeTurns(candidate.state);
    const value = replies.length ? Math.min(...replies.map(r => evaluate(r.state,p))) : evaluate(candidate.state,p);
    if (value > best) { best = value; choices = [candidate]; }
    else if (value === best) choices.push(candidate);
  }
  return choices[Math.floor(Math.random()*choices.length)].actions;
}
