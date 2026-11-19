import {legalActions,applyUnchecked,regions,neighbor,edge} from './engine.js';
function distances(s,p){
  const d=Array(49).fill(99),q=[];
  for(let i=0;i<49;i++)if(s.board[i]===p){d[i]=0;q.push(i);}
  for(let i=0;i<q.length;i++)for(let dir=0;dir<4;dir++){
    const at=q[i],to=neighbor(at,dir);
    if(to>=0&&!s.walls[edge(at,dir)]&&s.board[to]!==3-p&&d[to]>d[at]+1){d[to]=d[at]+1;q.push(to);}
  }
  return d;
}
export function evaluate(s,p){
  if(s.winner)return s.winner===p?100000:-100000;
  if(s.draw)return 0;
  const reg=regions(s),a=distances(s,p),b=distances(s,3-p);let value=(reg.scores[p-1]-reg.scores[2-p])*18;
  for(let i=0;i<49;i++){
    if(!reg.owners[i])value+=a[i]===b[i]?0:a[i]<b[i]?5:-5;
    if(s.board[i]===p||s.board[i]===3-p){let exits=0;for(let d=0;d<4;d++){const n=neighbor(i,d);if(n>=0&&!s.walls[edge(i,d)]&&!s.board[n])exits++;}value+=(s.board[i]===p?1:-1)*exits*0.7;}
  }
  return value;
}
export function chooseAction(s,options={}){
  const {level='hard',random=Math.random,timeMs=level==='hard'?1800:level==='normal'?350:100,maxDepth=level==='hard'?6:level==='normal'?2:1,nodeLimit=level==='hard'?350000:50000,avoid=''}=options;
  const started=performance.now(),deadline=started+timeMs,root=s.player,cache=new Map();let nodes=0,depth=0;
  const stop=Symbol('time');
  function check(){if(++nodes>nodeLimit||(nodes%32===0&&performance.now()>deadline))throw stop;}
  function ranked(state){
    const key=state.board.join('')+state.walls.join('')+state.player+state.phase;
    if(cache.has(key))return cache.get(key);
    const list=legalActions(state).map(action=>{check();const next=applyUnchecked(state,action);return {action,state:next,score:evaluate(next,state.player),tie:random()};}).sort((a,b)=>b.score-a.score||b.tie-a.tie);
    cache.set(key,list);return list;
  }
  function visit(state,left,alpha,beta){
    check();if(state.winner||state.draw||left===0)return evaluate(state,root);
    const max=state.player===root;
    if(left===1){
      let best=max?-Infinity:Infinity;
      for(const a of legalActions(state)){check();const v=evaluate(applyUnchecked(state,a),root);best=max?Math.max(best,v):Math.min(best,v);if(max)alpha=Math.max(alpha,best);else beta=Math.min(beta,best);if(beta<=alpha)break;}
      return Number.isFinite(best)?best:evaluate(state,root);
    }
    const list=ranked(state).slice(0,level==='hard'?16:8);
    if(!list.length)return evaluate(state,root);
    let best=max?-Infinity:Infinity;
    for(const child of list){const v=visit(child.state,left-1,alpha,beta);best=max?Math.max(best,v):Math.min(best,v);if(max)alpha=Math.max(alpha,best);else beta=Math.min(beta,best);if(beta<=alpha)break;}
    return best;
  }
  const fallback=legalActions(s);if(!fallback.length)return {action:null,depth,nodes};
  let action=fallback[Math.floor(random()*fallback.length)],score=-Infinity;
  try{
    const list=ranked(s);action=list[0].action;score=list[0].score;
    if(level==='easy'){const candidates=list.slice(0,Math.min(6,list.length));action=candidates[Math.floor(random()*candidates.length)].action;return {action,depth:1,nodes,elapsedMs:performance.now()-started};}
    for(let d=1;d<=maxDepth;d++){
      let best=-Infinity,choices=[];
      // First two depths cover every root action. Later depths focus on the best
      // forty from the last completed iteration, with a sixteen-action inner beam.
      for(const c of d<3?list:list.slice(0,40)){
        let v=visit(c.state,d-1,best,Infinity);
        // A cutoff can only prove an upper bound: verify a tie before randomizing.
        if(Number.isFinite(best)&&Math.abs(v-best)<1e-8)v=visit(c.state,d-1,-Infinity,Infinity);
        c.deep=v;
        if(v>best+1e-8){best=v;choices=[c.action];}else if(Math.abs(v-best)<1e-8)choices.push(c.action);
      }
      const fresh=choices.filter(a=>JSON.stringify(a)!==avoid);if(fresh.length)choices=fresh;
      action=choices[Math.floor(random()*choices.length)];score=best;depth=d;
      list.sort((a,b)=>(b.deep??-Infinity)-(a.deep??-Infinity)||b.score-a.score||b.tie-a.tie);
      if(Math.abs(best)>=100000)break;
    }
  }catch(e){if(e!==stop)throw e;}
  return {action,depth,nodes,score,elapsedMs:performance.now()-started};
}
