import {newGame,play,legalActions,reachable,availableWalls,regions,EDGES,LABELS,edge,actionNote} from './engine.js';
import {OnlineController} from './online.js';
import {chooseAction} from './search.js';
const $=id=>document.getElementById(id),STORAGE='wall-go-v1';
let mode='ai',level='hard',timeline=[{state:newGame(),actor:0}],selected=null,pending=null,worker=null,busy=false,generation=0,online=null,pendingMode=null;
let recent={};
try{
  const saved=JSON.parse(localStorage.getItem(STORAGE));
  if(saved&&['ai','local'].includes(saved.mode)&&Array.isArray(saved.actions)&&saved.actions.length<=90){
    const loaded=[{state:newGame(),actor:0}];for(const a of saved.actions){const s=loaded.at(-1).state;loaded.push({state:play(s,a),actor:s.player,action:a});}
    timeline=loaded;mode=saved.mode;level=['easy','normal','hard'].includes(saved.level)?saved.level:'hard';
  }
  recent=JSON.parse(localStorage.getItem('wall-go-variety-v1'))||{};
}catch{}
const state=()=>timeline.at(-1).state;
const over=s=>!!s.winner||s.draw;
const key=s=>s.board.join('')+s.walls.join('')+s.player+s.phase;
function persist(){if(mode==='online')return;try{localStorage.setItem(STORAGE,JSON.stringify({mode,level,actions:timeline.slice(1).map(f=>f.action)}));}catch{}}
const cells=Array.from({length:49},(_,i)=>{
  const b=document.createElement('button');b.type='button';b.className='wg-cell';b.dataset.cell=i;b.style.left=(i%7)*100/7+'%';b.style.top=Math.floor(i/7)*100/7+'%';b.onclick=()=>clickCell(i);$('cells').append(b);return b;
});
const walls=EDGES.map((e,id)=>{
  const b=document.createElement('button');b.type='button';b.dataset.wall=id;
  const r=Math.floor(e.a/7),c=e.a%7,horizontal=id<42;
  b.className='wg-wall '+(horizontal?'horizontal':'vertical');
  b.style.left=(c+(horizontal?.5:1))*100/7+'%';b.style.top=(r+(horizontal?1:.5))*100/7+'%';
  b.setAttribute('aria-label',`${LABELS[e.a]} 与 ${LABELS[e.b]} 之间筑墙`);
  b.onclick=()=>{if(pending&&canAct())commit({type:'turn',from:pending.from,to:pending.to,wall:id});};
  $('walls').append(b);return b;
});
function canAct(){return !over(state())&&!busy&&(mode==='online'?online?.canMove:mode!=='ai'||state().player===1);}
function clickCell(at){
  const s=state();if(!canAct()||pending)return;
  if(s.phase==='setup'){if(!s.board[at])commit({type:'place',at});return;}
  if(selected!==null&&reachable(s,selected).includes(at)&&(!s.board[at]||at===selected)){
    if(!availableWalls(s,at).length){$('status-copy').textContent='这个终点无法筑墙，请换一个位置。';return;}
    pending={from:selected,to:at};render();return;
  }
  if(s.board[at]===s.player){selected=at;render();return;}
  if(selected!==null)$('status-copy').textContent='只能上下左右走零到两步，不能穿墙或越过棋子。';
}
function apply(action){const s=state(),next=play(s,action);timeline.push({state:next,actor:s.player,action});selected=null;pending=null;persist();render();}
function commit(action){
  if(mode==='online'){selected=null;pending=null;online.move(action);render();}
  else {apply(action);scheduleAI();}
}
function render(){
  const s=state(),ended=over(s),human=canAct(),reg=regions(s),board=[...s.board];
  if(pending){board[pending.from]=0;board[pending.to]=s.player;}
  const destinations=human&&s.phase==='play'&&selected!==null&&!pending?reachable(s,selected):[];
  cells.forEach((b,i)=>{
    const legal=human&&!pending&&(s.phase==='setup'?!s.board[i]:destinations.includes(i));
    const owner=$('territory-toggle').checked?reg.owners[i]:0;
    b.className='wg-cell'+(owner?' owned-'+owner:'')+(legal?' reachable':'')+(selected===i&&!pending||pending?.to===i?' selected':'')+((s.last?.to??s.last?.at)===i?' last':'');
    b.replaceChildren();if(board[i]){const stone=document.createElement('span');stone.className='wg-stone '+(board[i]===1?'red':'blue');stone.textContent=board[i]===1?'红':'蓝';b.append(stone);}
    b.disabled=!human||!!pending;b.setAttribute('aria-pressed',String((selected===i&&!pending)||pending?.to===i));
    b.setAttribute('aria-label',`${LABELS[i]}，${board[i]===1?'红子':board[i]===2?'蓝子':'空格'}${legal?'，可选择':''}`);
  });
  const choices=pending&&human?availableWalls(s,pending.to):[];
  walls.forEach((b,id)=>{const available=choices.includes(id);b.hidden=!s.walls[id]&&!available;b.disabled=!available;b.classList.toggle('available',available);b.classList.toggle('wall-last',s.last?.wall===id);});
  $('phase').textContent=ended?'对局结束':s.phase==='setup'?`开局布子 · ${s.placed+1} / 4`:'移动与筑墙';$('turn-number').textContent=`第 ${s.turn} 手`;
  const side=s.player===1?'红方':'蓝方',thinking=mode==='ai'&&s.player===2&&!ended;
  let label=ended?'胜负已分':thinking?'电脑正在思考':`轮到${side}`,title=ended?s.draw?'平分秋色':`${s.winner===1?'红方':'蓝方'}获胜`:s.phase==='setup'?`${side}放置一枚棋子`:pending?'在亮起的边上筑墙':selected===null?'选一枚棋子出发':'走到两步内的空格';
  let copy=ended?s.reason:thinking?level==='hard'?'高手正在推演围地与封锁，请稍候。':'电脑正在选择走法。':s.phase==='setup'?'开局顺序为红、蓝、蓝、红，点击空格布子。':pending?'选一道金色墙完成回合，或点击“重选走法”。':selected===null?'先选己方棋子，再移动或选择原地筑墙。':'可以拐弯，不能穿墙或越子；移动后必须筑墙。';
  if(mode==='online'&&!ended&&!human){label=!online.user?'好友联机':!online.connected?'正在重连':online.busy?'正在提交':'等待棋友';title=!online.user?'登录后邀请好友':!online.connected?'正在连接棋桌':!online.room||online.room.status!=='playing'?'创建房间或加入好友':online.busy?'正在确认回合':'等待对方完成回合';copy=!online.user?'与九子棋使用同一账号，墙壁围棋独立计分。':!online.connected?'对局保存在后台，连接恢复后继续。':!online.room||online.room.status!=='playing'?'把六位房间码分享给好友，即可开始。':'棋局会自动同步，无需刷新。';}
  $('status-label').textContent=label;$('status-title').textContent=title;$('status-copy').textContent=copy;
  ['select','move','wall'].forEach((step,i)=>$('step-'+step).classList.toggle('active',human&&s.phase==='play'&&(pending?i===2:selected===null?i===0:i===1)));
  $('stay').disabled=!human||s.phase!=='play'||selected===null||!!pending||!availableWalls(s,selected).length;$('cancel-step').hidden=!pending&&selected===null;
  for(const p of [1,2]){
    const playerId=p===1?online?.room?.white_id:online?.room?.black_id,profile=online?.room?.players.find(x=>x.user_id===playerId);
    $(`name-${p}`).textContent=mode==='online'?(profile?.nickname||(p===1?'红方':'等待棋友'))+(playerId&&playerId===online.user?.id?' · 你':''):mode==='ai'?(p===1?'你 · 红方':'电脑 · 蓝方'):p===1?'红方':'蓝方';
    $(`score-${p}`).textContent=reg.scores[p-1];$(`detail-${p}`).textContent=`最大区域 ${reg.largest[p-1]}`;$(`player-${p}`).classList.toggle('current',!ended&&s.player===p);
  }
  $('neutral-copy').textContent=`${49-reg.scores[0]-reg.scores[1]} 格尚未归属或属于中立区域`;
  $('difficulty-wrap').hidden=mode!=='ai';$('difficulty').value=level;
  document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
  $('undo').disabled=mode==='online'||!(pending||selected!==null||timeline.slice(1).some(f=>mode==='local'||f.actor===1));$('restart').disabled=mode==='online';
  $('last-move').textContent=actionNote(s.last);
  if(mode==='online'&&online.room?.status==='finished'){$('last-move').textContent=`对局已结算 · 红方积分 ${online.room.rating_delta>=0?'+':''}${online.room.rating_delta} · 蓝方积分 ${-online.room.rating_delta>=0?'+':''}${-online.room.rating_delta}`;}
  $('game-result').hidden=!ended;$('result-title').textContent=s.draw?'平分秋色':`${s.winner===1?'红方':'蓝方'}获胜`;$('result-reason').textContent=s.reason;$('play-again').hidden=mode==='online';
}
function cancelAI(){generation++;worker?.terminate();worker=null;busy=false;}
function scheduleAI(){
  const s=state();if(mode!=='ai'||s.player!==2||over(s)||busy)return;
  busy=true;render();const id=++generation,start=performance.now();
  const deliver=action=>setTimeout(()=>{
    if(id!==generation)return;
    recent[key(s)]=JSON.stringify(action);recent=Object.fromEntries(Object.entries(recent).slice(-80));try{localStorage.setItem('wall-go-variety-v1',JSON.stringify(recent));}catch{}
    busy=false;try{apply(action);}catch{const fallback=legalActions(state())[0];if(fallback)apply(fallback);}scheduleAI();
  },Math.max(0,400-(performance.now()-start)));
  const fallback=()=>{if(id!==generation)return;worker?.terminate();worker=null;const chosen=chooseAction(s,{level:'easy',timeMs:80}).action;if(chosen)deliver(chosen);else{busy=false;render();}};
  try{worker=new Worker(new URL('./ai-worker.js',import.meta.url),{type:'module'});worker.onmessage=({data})=>{if(id!==generation||data.id!==id)return;worker?.terminate();worker=null;if(data.error)fallback();else deliver(data.action);};worker.onerror=fallback;worker.postMessage({id,state:s,level,avoid:recent[key(s)]||''});}catch{fallback();}
}
function reset(nextMode=mode){cancelAI();mode=nextMode;selected=null;pending=null;timeline=[{state:mode==='online'&&online.room?online.room.state:newGame(),actor:0}];online.activate(mode==='online');persist();render();scheduleAI();}
function requestReset(nextMode=mode){if(mode==='online'||timeline.length===1||over(state()))reset(nextMode);else{pendingMode=nextMode;$('confirm-dialog').showModal();}}
$('restart').onclick=()=>requestReset();$('play-again').onclick=()=>reset();
$('confirm-cancel').onclick=()=>$('confirm-dialog').close();$('confirm-yes').onclick=()=>{$('confirm-dialog').close();reset(pendingMode||mode);pendingMode=null;};
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{if(mode!==b.dataset.mode)requestReset(b.dataset.mode);});
$('undo').onclick=()=>{
  if(mode==='online')return;if(pending||selected!==null){pending=null;selected=null;render();return;}
  cancelAI();if(mode==='local'){if(timeline.length>1)timeline.pop();}else{const i=timeline.findLastIndex(f=>f.actor===1);if(i>0)timeline=timeline.slice(0,i);}
  persist();render();scheduleAI();
};
$('stay').onclick=()=>{if(canAct()&&selected!==null){pending={from:selected,to:selected};render();}};
$('cancel-step').onclick=()=>{pending=null;selected=null;render();};$('territory-toggle').onchange=render;
$('difficulty').onchange=()=>{level=$('difficulty').value;cancelAI();persist();render();scheduleAI();};
$('rules-open').onclick=()=>$('rules-dialog').showModal();for(const id of ['rules-close','rules-done'])$(id).onclick=()=>$('rules-dialog').close();
online=new OnlineController(()=>{if(online&&mode==='online'){const next=online.room?.state||newGame();if(state()!==next){selected=null;pending=null;}timeline=[{state:next,actor:0}];render();}});
render();scheduleAI();
