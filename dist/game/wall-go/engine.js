export const SIZE=7;
export const LABELS=Array.from({length:49},(_,i)=>'ABCDEFG'[i%7]+(7-Math.floor(i/7)));
export const SETUP_ORDER=[1,2,2,1];
export const DIRECTIONS=['上','右','下','左'];
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
export function newGame(){
  const board=Array(49).fill(0);
  board[12]=board[36]=1; // F6, B2: the show's four-stone opening (paper Fig. 1b).
  board[8]=board[40]=2;  // B6, F2.
  return {version:1,board,walls:Array(84).fill(0),phase:'setup',placed:0,player:1,turn:1,winner:null,draw:false,reason:'',last:null};
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
  return queue;
}
export function availableWalls(s,at){return [0,1,2,3].map(d=>edge(at,d)).filter(id=>id>=0&&!s.walls[id]);}
export function regions(s){
  const seen=Array(49).fill(false),groups=[],owners=Array(49).fill(0),scores=[0,0],largest=[0,0];
  for(let start=0;start<49;start++){
    if(seen[start])continue;
    const cells=[start];seen[start]=true;let mask=0;
    for(let k=0;k<cells.length;k++){
      const at=cells[k];mask|=s.board[at]===1?1:s.board[at]===2?2:0;
      for(let d=0;d<4;d++){const to=neighbor(at,d);if(to>=0&&!s.walls[edge(at,d)]&&!seen[to]){seen[to]=true;cells.push(to);}}
    }
    const owner=mask===1?1:mask===2?2:0;
    if(owner){scores[owner-1]+=cells.length;largest[owner-1]=Math.max(largest[owner-1],cells.length);for(const i of cells)owners[i]=owner;}
    groups.push({cells,mask,owner});
  }
  return {groups,owners,scores,largest,contested:groups.some(g=>g.mask===3)};
}
export function legalActions(s){
  if(s.winner||s.draw)return [];
  if(s.phase==='setup')return s.board.flatMap((v,at)=>v?[]:[{type:'place',at}]);
  const actions=[];
  for(let from=0;from<49;from++)if(s.board[from]===s.player){
    for(const to of reachable(s,from))for(const wall of availableWalls(s,to))actions.push({type:'turn',from,to,wall});
  }
  return actions;
}
export function applyUnchecked(s,a){
  const next={...s,board:[...s.board],walls:[...s.walls],last:{...a,player:s.player},turn:s.turn+1};
  if(a.type==='place'){
    next.board[a.at]=s.player;next.placed++;
    if(next.placed===4){next.phase='play';next.player=1;}else next.player=SETUP_ORDER[next.placed];
  }else{next.board[a.from]=0;next.board[a.to]=s.player;next.walls[a.wall]=s.player;next.player=3-s.player;}
  if(next.phase==='play'){
    const r=regions(next);
    if(!r.contested){
      const diff=r.scores[0]-r.scores[1]||r.largest[0]-r.largest[1];
      next.winner=diff>0?1:diff<0?2:null;next.draw=diff===0;
      next.reason=`地盘 ${r.scores[0]} : ${r.scores[1]}`+(r.scores[0]===r.scores[1]?` · 最大区域 ${r.largest[0]} : ${r.largest[1]}`:'');
    }
  }
  return next;
}
export function play(s,a){
  if(s.winner||s.draw||!a||typeof a!=='object')throw new Error('对局已结束或走法无效');
  if(s.phase==='setup'){
    if(a.type!=='place'||!Number.isInteger(a.at)||a.at<0||a.at>=49||s.board[a.at])throw new Error('请选择空格放置棋子');
    return applyUnchecked(s,{type:'place',at:a.at});
  }
  if(a.type!=='turn'||![a.from,a.to,a.wall].every(Number.isInteger)||s.board[a.from]!==s.player||!reachable(s,a.from).includes(a.to)||!availableWalls(s,a.to).includes(a.wall))throw new Error('走法无效：只能移动零到两步，并在终点边上筑一道新墙');
  return applyUnchecked(s,{type:'turn',from:a.from,to:a.to,wall:a.wall});
}
export function actionNote(a){
  if(!a)return '红蓝各两枚棋子已就位，红方先布子。';
  const side=a.player===1?'红方':'蓝方';
  if(a.type==='place')return `${side}布子 ${LABELS[a.at]}`;
  const direction=[0,1,2,3].find(d=>edge(a.to,d)===a.wall);
  return `${side} ${LABELS[a.from]}${a.from===a.to?' 原地':` 至 ${LABELS[a.to]}`} · ${DIRECTIONS[direction]}侧筑墙`;
}
