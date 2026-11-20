import {newGame,play,legalActions,reachable,breakOptions,availableWalls,regions,EDGES,LABELS,actionNote,playerCount,sideName,setupOrder,stonesPerPlayer} from './engine.js?v=3';
import {OnlineController} from './online.js?v=3';
import {chooseAction} from './search.js?v=3';
const $=id=>document.getElementById(id),STORAGE='wall-go-v3',colors=['','red','blue','green'],short=['','红','蓝','绿'];
let mode='ai',level='hard',playerTotal=2,timeline=[{state:newGame(),actor:0}],selected=null,pending=null,breaking=false,selectedBreak=null,worker=null,busy=false,generation=0,online=null,pendingSettings=null;
let recent={};
try{
  const current=JSON.parse(localStorage.getItem(STORAGE));
  const saved=current||JSON.parse(localStorage.getItem('wall-go-v2'));
  if(saved&&['ai','local'].includes(saved.mode)&&[2,3].includes(saved.players)&&Array.isArray(saved.actions)&&saved.actions.length<=100){
    const loaded=[{state:newGame(saved.players),actor:0}];
    // Old four-stone three-player replays need a fresh game; two-player replays remain valid.
    for(const a of !current&&saved.players===3?[]:saved.actions){const s=loaded.at(-1).state;loaded.push({state:play(s,a),actor:s.player,action:a});}
    timeline=loaded;mode=saved.mode;playerTotal=saved.players;level=['easy','normal','hard'].includes(saved.level)?saved.level:'hard';
  }
  recent=JSON.parse(localStorage.getItem('wall-go-variety-v2'))||{};
}catch{}
const state=()=>timeline.at(-1).state;
const over=s=>!!s.winner||s.draw;
const key=s=>JSON.stringify([s.board,s.walls,s.breaks,s.player,s.phase,s.placed]);
const resultTitle=s=>s.draw?(s.winners?.length<playerCount(s)?s.winners.map(sideName).join('、')+'并列获胜':'平分秋色'):sideName(s.winner)+'获胜';
function clearChoice(){selected=null;pending=null;breaking=false;selectedBreak=null;}
function persist(){if(mode==='online')return;try{localStorage.setItem(STORAGE,JSON.stringify({mode,level,players:playerTotal,actions:timeline.slice(1).map(f=>f.action)}));}catch{}}
const cells=Array.from({length:49},(_,i)=>{
  const b=document.createElement('button');b.type='button';b.className='wg-cell';b.dataset.cell=i;b.style.left=(i%7)*100/7+'%';b.style.top=Math.floor(i/7)*100/7+'%';b.onclick=()=>clickCell(i);$('cells').append(b);return b;
});
const walls=EDGES.map((e,id)=>{
  const b=document.createElement('button');b.type='button';b.dataset.wall=id;
  const r=Math.floor(e.a/7),c=e.a%7,horizontal=id<42;
  b.className='wg-wall '+(horizontal?'horizontal':'vertical');
  b.style.left=(c+(horizontal?.5:1))*100/7+'%';b.style.top=(r+(horizontal?1:.5))*100/7+'%';
  b.onclick=()=>{
    if(!canAct())return;
    if(pending){commit({type:'turn',from:pending.from,to:pending.to,wall:id,...(pending.breakWall!==undefined?{breakWall:pending.breakWall}:{})});}
    else if(breaking&&selected!==null&&breakOptions(state(),selected).some(o=>o.breakWall===id)){selectedBreak=id;render();}
  };
  $('walls').append(b);return b;
});
function canAct(){return !over(state())&&!busy&&(mode==='online'?online?.canMove:mode!=='ai'||state().player===1);}
function destinations(s){
  if(selected===null)return [];
  return breaking?selectedBreak===null?[]:breakOptions(s,selected).filter(o=>o.breakWall===selectedBreak).map(o=>o.to):reachable(s,selected);
}
function clickCell(at){
  const s=state();if(!canAct()||pending)return;
  if(s.phase==='setup'){if(!s.board[at])commit({type:'place',at});return;}
  if(selected!==null&&destinations(s).includes(at)){
    if(!availableWalls(s,at,breaking?selectedBreak:null).length){$('status-copy').textContent='这个终点无法筑墙，请换一个位置。';return;}
    pending={from:selected,to:at,...(breaking?{breakWall:selectedBreak}:{})};render();return;
  }
  if(s.board[at]===s.player){selected=at;breaking=false;selectedBreak=null;render();return;}
  if(selected!==null)$('status-copy').textContent=breaking&&selectedBreak===null?'请先选择亮起的墙，再选择跨墙后的终点。':'须移动1–2步，不能停在原地、穿过未拆的墙或越子。';
}
function apply(action){const s=state(),next=play(s,action);timeline.push({state:next,actor:s.player,action});clearChoice();persist();render();}
function commit(action){
  if(mode==='online'){clearChoice();online.move(action);render();}
  else {try{apply(action);scheduleAI();}catch(e){$('status-copy').textContent=e.message;}}
}
function render(){
  const s=state(),n=playerCount(s),ended=over(s),human=canAct(),reg=regions(s),board=[...s.board];
  if(pending){board[pending.from]=0;board[pending.to]=s.player;}
  const moves=human&&s.phase==='play'&&!pending?destinations(s):[];
  cells.forEach((b,i)=>{
    const legal=human&&!pending&&(s.phase==='setup'?!s.board[i]:moves.includes(i));
    const owner=$('territory-toggle').checked?reg.owners[i]:0;
    b.className='wg-cell'+(owner?' owned-'+owner:'')+(legal?' reachable':'')+(selected===i&&!pending||pending?.to===i?' selected':'')+((s.last?.to??s.last?.at)===i?' last':'');
    b.replaceChildren();if(board[i]){const stone=document.createElement('span');stone.className='wg-stone '+colors[board[i]];stone.textContent=short[board[i]];b.append(stone);}
    b.disabled=!human||!!pending;b.setAttribute('aria-pressed',String((selected===i&&!pending)||pending?.to===i));
    b.setAttribute('aria-label',LABELS[i]+'，'+(board[i]?short[board[i]]+'子':'空格')+(legal?'，可选择':''));
  });
  const choices=pending&&human?availableWalls(s,pending.to,pending.breakWall??null):[];
  const breakChoices=human&&breaking&&!pending&&selected!==null?breakOptions(s,selected).map(o=>o.breakWall):[];
  walls.forEach((b,id)=>{
    const available=choices.includes(id),breakable=breakChoices.includes(id),removed=pending?.breakWall===id;
    b.hidden=(!s.walls[id]||removed)&&!available;b.disabled=!available&&!breakable;
    b.classList.toggle('available',available);b.classList.toggle('breakable',breakable);b.classList.toggle('break-selected',breaking&&selectedBreak===id&&!pending);b.classList.toggle('wall-last',s.last?.wall===id);
    b.setAttribute('aria-label',LABELS[EDGES[id].a]+' 与 '+LABELS[EDGES[id].b]+' 之间'+(breakable?'破墙':'筑墙'));
  });
  $('phase').textContent=ended?'对局结束':s.phase==='setup'?'开局布子 · '+(s.placed+1)+' / '+setupOrder(s).length:'移动与筑墙';$('turn-number').textContent='第 '+s.turn+' 手';
  const side=sideName(s.player),thinking=mode==='ai'&&s.player!==1&&!ended;
  let label=ended?'胜负已分':thinking?side+'电脑正在思考':'轮到'+side;
  let title=ended?resultTitle(s):s.phase==='setup'?side+'放置一枚棋子':pending?'在亮起的边上筑墙':breaking&&selectedBreak===null?'选择要打碎的墙':selected===null?'选一枚棋子出发':'走到两步内的空格';
  let copy=ended?s.reason:thinking?'电脑正在推演围地与封锁，请稍候。':s.phase==='setup'?(n===3?'三方各' + (stonesPerPlayer(s)===2?'两':'四') + '子，按红蓝绿、绿蓝红往返布子。':'开局顺序为红、蓝、蓝、红，点击空格布子。'):pending?(pending.breakWall!==undefined?'破墙和移动尚未提交，筑墙后才消耗一次机会。':'选一道金色墙完成回合，或点击“重选走法”。'):breaking?(selectedBreak===null?'选择橙红色墙；可在第一步或第二步跨墙。':'走1–2步跨过选中的墙，终点仍须筑一道墙。'):selected===null?'先选己方棋子，必须移动1–2步，不能原地筑墙。':'可以拐弯，不能穿墙或越子；移动后必须筑墙。';
  if(s.skipped?.length&&!ended&&!pending)copy+=' '+s.skipped.map(sideName).join('、')+'无合法走法，已跳过。';
  if(mode==='online'&&!ended&&!human){
    const waiting=!online.room||online.room.status!=='playing';
    label=!online.user?'好友联机':!online.connected?'正在重连':online.busy?'正在提交':'等待棋友';
    title=!online.user?'登录后邀请好友':!online.connected?'正在连接棋桌':waiting?'创建房间或等待满员':s.eliminated?.includes(online.side)?'你已认输，等待剩余对局':online.busy?'正在确认回合':'等待'+side+'完成回合';
    copy=!online.user?'与九子棋使用同一账号，墙壁围棋独立计分。':!online.connected?'对局保存在后台，连接恢复后继续。':waiting?'先选择人数创建房间，把六位房间码分享给好友。':'棋局会自动同步，无需刷新。';
  }
  $('status-label').textContent=label;$('status-title').textContent=title;$('status-copy').textContent=copy;
  ['select','move','wall'].forEach((step,i)=>$('step-'+step).classList.toggle('active',human&&s.phase==='play'&&(pending?i===2:selected===null?i===0:i===1)));
  $('break-move').hidden=n!==3;$('break-move').disabled=!human||s.phase!=='play'||selected===null||!!pending||!breakOptions(s,selected).length;
  $('break-move').textContent=breaking?'取消破墙选择':'使用破墙（剩 '+(s.breaks?.[s.player-1]||0)+' 次）';$('break-move').setAttribute('aria-pressed',String(breaking));
  $('cancel-step').hidden=!pending&&selected===null;
  for(const p of [1,2,3]){
    $('player-'+p).hidden=p>n;
    const playerId=online?.room?.[['white_id','black_id','green_id'][p-1]],profile=online?.room?.players.find(x=>x.user_id===playerId);
    $('name-'+p).textContent=mode==='online'?(profile?.nickname||sideName(p))+(playerId&&playerId===online.user?.id?' · 你':''):mode==='ai'?(p===1?'你 · 红方':'电脑 · '+sideName(p)):sideName(p);
    $('score-'+p).textContent=reg.scores[p-1]??0;
    $('detail-'+p).textContent='最大区域 '+(reg.largest[p-1]??0);
    $('breaks-'+p).hidden=n!==3;$('breaks-'+p).textContent=s.eliminated?.includes(p)?'已认输':'破墙 '+(s.breaks?.[p-1]||0)+' / 1';
    $('player-'+p).classList.toggle('current',!ended&&s.player===p);
  }
  $('scores').classList.toggle('three',n===3);
  $('neutral-copy').textContent=(49-reg.scores.reduce((a,b)=>a+b,0))+' 格尚未归属或属于中立区域';
  $('difficulty-wrap').hidden=mode!=='ai';$('difficulty').value=level;
  const live=mode==='online'&&online?.room&&['waiting','playing'].includes(online.room.status);
  $('player-count').value=String(live?online.room.capacity:playerTotal);$('player-count').disabled=!!live;
  $('player-count-note').textContent=n===3?'三方各'+(stonesPerPlayer(s)===2?'两':'四')+'子 · 每人一次破墙跨越':'双人各四子 · 不可破墙';
  document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
  $('undo').disabled=mode==='online'||!(pending||selected!==null||timeline.slice(1).some(f=>mode==='local'||f.actor===1));$('restart').disabled=mode==='online';
  $('last-move').textContent=actionNote(s.last);
  if(mode==='online'&&online.room?.status==='finished'){
    const ds=online.room.rating_deltas||[online.room.rating_delta,-online.room.rating_delta];
    $('last-move').textContent='对局已结算 · '+ds.map((d,i)=>sideName(i+1)+' '+(d>=0?'+':'')+d).join(' · ');
  }
  $('game-result').hidden=!ended;$('result-title').textContent=resultTitle(s);$('result-reason').textContent=s.reason;$('play-again').hidden=mode==='online';
}
function cancelAI(){generation++;worker?.terminate();worker=null;busy=false;}
function scheduleAI(){
  const s=state();if(mode!=='ai'||s.player===1||over(s)||busy)return;
  busy=true;render();const id=++generation,start=performance.now();
  const deliver=action=>setTimeout(()=>{
    if(id!==generation)return;
    recent[key(s)]=JSON.stringify(action);recent=Object.fromEntries(Object.entries(recent).slice(-80));try{localStorage.setItem('wall-go-variety-v2',JSON.stringify(recent));}catch{}
    busy=false;try{apply(action);}catch{const fallback=legalActions(state())[0];if(fallback)apply(fallback);}scheduleAI();
  },Math.max(0,400-(performance.now()-start)));
  const fallback=()=>{if(id!==generation)return;worker?.terminate();worker=null;const chosen=chooseAction(s,{level:'easy',timeMs:80}).action;if(chosen)deliver(chosen);else{busy=false;render();}};
  try{worker=new Worker(new URL('./ai-worker.js?v=3',import.meta.url),{type:'module'});worker.onmessage=({data})=>{if(id!==generation||data.id!==id)return;worker?.terminate();worker=null;if(data.error)fallback();else deliver(data.action);};worker.onerror=fallback;worker.postMessage({id,state:s,level,avoid:recent[key(s)]||''});}catch{fallback();}
}
function reset(nextMode=mode,nextPlayers=playerTotal){
  cancelAI();mode=nextMode;playerTotal=nextPlayers;clearChoice();
  timeline=[{state:mode==='online'&&online.room?online.room.state:newGame(playerTotal),actor:0}];online.activate(mode==='online');persist();render();scheduleAI();
}
function requestReset(nextMode=mode,nextPlayers=playerTotal){
  if(mode==='online'||timeline.length===1||over(state()))reset(nextMode,nextPlayers);
  else {pendingSettings={mode:nextMode,players:nextPlayers};$('player-count').value=String(playerTotal);$('confirm-dialog').showModal();}
}
$('restart').onclick=()=>requestReset();$('play-again').onclick=()=>reset();
$('confirm-cancel').onclick=()=>{$('confirm-dialog').close();pendingSettings=null;};
$('confirm-yes').onclick=()=>{$('confirm-dialog').close();const next=pendingSettings;pendingSettings=null;reset(next?.mode||mode,next?.players||playerTotal);};
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{if(mode!==b.dataset.mode)requestReset(b.dataset.mode);});
$('player-count').onchange=()=>requestReset(mode,Number($('player-count').value));
$('undo').onclick=()=>{
  if(mode==='online')return;if(pending||selected!==null){clearChoice();render();return;}
  cancelAI();if(mode==='local'){if(timeline.length>1)timeline.pop();}else{const i=timeline.findLastIndex(f=>f.actor===1);if(i>0)timeline=timeline.slice(0,i);}
  persist();render();scheduleAI();
};
$('break-move').onclick=()=>{if(canAct()&&selected!==null&&!pending){breaking=!breaking;selectedBreak=null;render();}};
$('cancel-step').onclick=()=>{clearChoice();render();};$('territory-toggle').onchange=render;
$('difficulty').onchange=()=>{level=$('difficulty').value;cancelAI();persist();render();scheduleAI();};
$('rules-open').onclick=()=>$('rules-dialog').showModal();for(const id of ['rules-close','rules-done'])$(id).onclick=()=>$('rules-dialog').close();
online=new OnlineController(()=>{
  if(online&&mode==='online'){
    const next=online.room?.state||newGame(playerTotal);if(state()!==next)clearChoice();
    if(online.room)playerTotal=playerCount(next);
    timeline=[{state:next,actor:0}];render();
  }
},()=>playerTotal);
render();scheduleAI();

