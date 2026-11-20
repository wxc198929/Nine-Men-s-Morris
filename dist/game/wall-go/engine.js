export const SIZE=7;
export const LABELS=Array.from({length:49},(_,i)=>'ABCDEFG'[i%7]+(7-Math.floor(i/7)));
export const SETUP_ORDER=[1,2,2,1];
export const DIRECTIONS=['上','右','下','左'];
export const playerCount=s=>s.players===3?3:2;
export const sideName=p=>['','红方','蓝方','绿方'][p]||'棋友';
export const setupOrder=s=>playerCount(s)===3?[1,2,3,3,2,1,1,2,3,3,2,1]:SETUP_ORDER;
export function neighbor(at,dir){
  const r=Math.floor(at/7),c=at%7;
  if(dir===0)return r?at-7:-1;
  if(dir===1)return c<6?at+1:-1;
  if(dir===2)return r<6?at+7:-1;
  if(dir===3)return c?at-1:-1;
  return -1;
}
export function edge(at,dir){
  if(neighbor(at,dir)<0)return -1;
  const r=Math.floor(at/7),c=at%7;
  return dir===0?(r-1)*7+c:dir===2?r*7+c:42+r*6+(dir===1?c:c-1);
}
export const EDGES=Array.from({length:84},(_,id)=>id<42?{a:id,b:id+7}: {a:Math.floor((id-42)/6)*7+(id-42)%6,b:Math.floor((id-42)/6)*7+(id-42)%6+1});
export function newGame(players=2){
  if(![2,3].includes(players))throw new Error('请选择双人或三人');
  const board=Array(49).fill(0);
  if(players===2){board[12]=board[36]=1;board[8]=board[40]=2;}
  return {version:2,players,board,walls:Array(84).fill(0),breaks:Array(players).fill(players===3?1:0),eliminated:[],phase:'setup',placed:0,player:1,turn:1,winner:null,winners:[],draw:false,reason:'',last:null};
}
export function reachable(s,from){
  if(!Number.isInteger(from)||from<0||from>=49||!s.board[from])return [];
  const distance=Array(49).fill(-1),queue=[from];distance[from]=0;
  for(let i=0;i<queue.length;i++){
    const at=queue[i];if(distance[at]>=2)continue;
    for(let d=0;d<4;d++){
      const to=neighbor(at,d),wall=edge(at,d);
      if(to>=0&&!s.walls[wall]&&!s.board[to]&&distance[to]<0){distance[to]=distance[at]+1;queue.push(to);}
    }
  }
  return queue.slice(1);
}
// Each path crosses exactly one existing wall, on either the first or second step.
export function breakOptions(s,from){
  if(playerCount(s)!==3||!s.breaks?.[s.player-1]||s.board[from]!==s.player)return [];
  const result=new Map();
  function walk(at,steps,broken){
    if(steps&&broken!==null&&at!==from)result.set(at+':'+broken,{to:at,breakWall:broken});
    if(steps===2)return;
    for(let d=0;d<4;d++){
      const to=neighbor(at,d),id=edge(at,d);
      if(to<0||s.board[to])continue;
      if(s.walls[id]&&broken!==null&&id!==broken)continue;
      walk(to,steps+1,s.walls[id]?id:broken);
    }
  }
  walk(from,0,null);return [...result.values()];
}
export function availableWalls(s,at,breakWall=null){return [0,1,2,3].map(d=>edge(at,d)).filter(id=>id>=0&&(!s.walls[id]||id===breakWall));}
export function regions(s){
  const seen=Array(49).fill(false),groups=[],owners=Array(49).fill(0),scores=Array(playerCount(s)).fill(0),largest=[...scores];
  for(let start=0;start<49;start++){
    if(seen[start])continue;
    const cells=[start];seen[start]=true;let mask=0;
    for(let k=0;k<cells.length;k++){
      const at=cells[k];if(s.board[at])mask|=1<<(s.board[at]-1);
      for(let d=0;d<4;d++){const to=neighbor(at,d);if(to>=0&&!s.walls[edge(at,d)]&&!seen[to]){seen[to]=true;cells.push(to);}}
    }
    const owner=s.phase!=='setup'&&mask&&!(mask&(mask-1))?Math.log2(mask)+1:0;
    if(owner){scores[owner-1]+=cells.length;largest[owner-1]=Math.max(largest[owner-1],cells.length);for(const i of cells)owners[i]=owner;}
    groups.push({cells,mask,owner});
  }
  return {groups,owners,scores,largest,contested:groups.some(g=>!!(g.mask&(g.mask-1)))};
}
export function legalActions(s){
  if(s.winner||s.draw||s.eliminated?.includes(s.player))return [];
  if(s.phase==='setup')return s.board.flatMap((v,at)=>v?[]:[{type:'place',at}]);
  const actions=[];
  for(let from=0;from<49;from++)if(s.board[from]===s.player){
    for(const to of reachable(s,from))for(const wall of availableWalls(s,to))actions.push({type:'turn',from,to,wall});
    for(const a of breakOptions(s,from))for(const wall of availableWalls(s,a.to,a.breakWall))actions.push({type:'turn',from,...a,wall});
  }
  return actions;
}
function canPlayerMove(s,p){
  const view={...s,player:p};
  for(let from=0;from<49;from++)if(s.board[from]===p){
    if(reachable(s,from).some(to=>availableWalls(s,to).length))return true;
    if(breakOptions(view,from).some(a=>availableWalls(s,a.to,a.breakWall).length))return true;
  }
  return false;
}
function finishOrAdvance(next){
  const n=playerCount(next),active=Array.from({length:n},(_,i)=>i+1).filter(p=>!next.eliminated?.includes(p));
  const r=regions(next),mobile=r.contested?active.filter(p=>canPlayerMove(next,p)):[];
  if(active.length===1||!r.contested||!mobile.length){
    const best=[...active].sort((a,b)=>r.scores[b-1]-r.scores[a-1]||r.largest[b-1]-r.largest[a-1])[0];
    next.winners=active.length===1?active:active.filter(p=>r.scores[p-1]===r.scores[best-1]&&r.largest[p-1]===r.largest[best-1]);
    next.winner=next.winners.length===1?next.winners[0]:null;next.draw=next.winners.length>1;
    next.reason='地盘 '+r.scores.join(' : ')+' · 最大区域 '+r.largest.join(' : ')+(!mobile.length&&r.contested?' · 全部无合法走法，按当前地盘结算':'');
    return next;
  }
  next.skipped=[];
  while(!mobile.includes(next.player)){next.skipped.push(next.player);next.player=next.player%n+1;}
  return next;
}
export function applyUnchecked(s,a){
  const next={...s,board:[...s.board],walls:[...s.walls],breaks:[...(s.breaks||Array(playerCount(s)).fill(0))],eliminated:[...(s.eliminated||[])],last:{...a,player:s.player},turn:s.turn+1};
  if(a.type==='place'){
    next.board[a.at]=s.player;next.placed++;
    if(next.placed===setupOrder(s).length){next.phase='play';next.player=1;}else next.player=setupOrder(s)[next.placed];
  }else{
    next.board[a.from]=0;next.board[a.to]=s.player;
    if(a.breakWall!==undefined){next.walls[a.breakWall]=0;next.breaks[s.player-1]--;}
    next.walls[a.wall]=s.player;next.player=s.player%playerCount(s)+1;
  }
  return next.phase==='play'?finishOrAdvance(next):next;
}
export function play(s,a){
  if(s.winner||s.draw||s.eliminated?.includes(s.player)||!a||typeof a!=='object')throw new Error('对局已结束或走法无效');
  if(s.phase==='setup'){
    if(a.type!=='place'||!Number.isInteger(a.at)||a.at<0||a.at>=49||s.board[a.at])throw new Error('请选择空格放置棋子');
    return applyUnchecked(s,{type:'place',at:a.at});
  }
  const breaking=a.breakWall!==undefined;
  const validPath=breaking?Number.isInteger(a.breakWall)&&breakOptions(s,a.from).some(o=>o.to===a.to&&o.breakWall===a.breakWall):reachable(s,a.from).includes(a.to);
  if(a.type!=='turn'||![a.from,a.to,a.wall].every(Number.isInteger)||s.board[a.from]!==s.player||a.from===a.to||!validPath||!availableWalls(s,a.to,breaking?a.breakWall:null).includes(a.wall))throw new Error('走法无效：须移动1–2步，破墙须跨过该墙，终点必须筑墙；请确认剩余机会或刷新页面');
  return applyUnchecked(s,{type:'turn',from:a.from,to:a.to,wall:a.wall,...(breaking?{breakWall:a.breakWall}:{})});
}
export function resign(s,side){
  if(s.winner||s.draw||s.eliminated?.includes(side)||side<1||side>playerCount(s))throw new Error('对局已结束或已认输');
  if(playerCount(s)===2)return {...s,winner:3-side,winners:[3-side],draw:false,reason:sideName(side)+'认输'};
  const next={...s,board:s.board.map(p=>p===side?0:p),walls:[...s.walls],eliminated:[...(s.eliminated||[]),side],last:null,turn:s.turn+1};
  if(next.phase==='setup')next.phase='play';
  if(next.player===side)next.player=side%playerCount(s)+1;
  return finishOrAdvance(next);
}
export function actionNote(a){
  if(!a)return '请选择空格布子，按提示顺序轮流操作。';
  if(a.type==='place')return sideName(a.player)+'布子 '+LABELS[a.at];
  const direction=[0,1,2,3].find(d=>edge(a.to,d)===a.wall);
  return sideName(a.player)+' '+LABELS[a.from]+' 至 '+LABELS[a.to]+(a.breakWall!==undefined?' · 破墙跨越':'')+' · '+DIRECTIONS[direction]+'侧筑墙';
}

