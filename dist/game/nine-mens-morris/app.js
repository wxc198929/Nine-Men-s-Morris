import {POINTS,LABELS,MILLS,newGame,count,legalActions,play,chooseTurn,positionKey} from './engine.js';
import {OnlineController} from './online.js';
const $ = id => document.getElementById(id);
const STORAGE = 'morris-no-flying-v1';
const VARIETY_STORAGE = 'morris-ai-variety-v1';
let recentAI = {};
try {
  const savedChoices = JSON.parse(localStorage.getItem(VARIETY_STORAGE));
  if (savedChoices && typeof savedChoices === 'object' && !Array.isArray(savedChoices)) recentAI = Object.fromEntries(Object.entries(savedChoices).filter(([,choice]) => typeof choice === 'string').slice(-128));
} catch {}
let mode = 'ai', level = 'hard', selected = null, generation = 0, busy = false, worker = null;
let timeline = [{state:newGame(),note:'棋盘已备好，白方先行。',actor:0}];
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE));
  if (saved?.version === 1 && ['ai','local'].includes(saved.mode) && Array.isArray(saved.timeline) && saved.timeline.length && saved.timeline.every(f => f.state?.board?.length === 24 && f.state.board.every(v => [0,1,2].includes(v)) && f.state.reserves?.length === 2 && f.state.reserves.every(v => Number.isInteger(v) && v >= 0 && v <= 9) && [1,2].includes(f.state.player) && f.state.repetitions && typeof f.note === 'string')) {
    mode = saved.mode;
    level = ['easy','normal','hard'].includes(saved.level) ? saved.level : 'hard';
    timeline = saved.timeline;
  }
} catch { /* Storage may be unavailable in private browsing. */ }
const state = () => timeline.at(-1).state;
const pointButtons = POINTS.map(([x,y],i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'point';
  b.dataset.point = i;
  b.style.left = (8+x*14)+'%';
  b.style.top = (8+y*14)+'%';
  b.addEventListener('click',() => handlePoint(i));
  $('points').append(b);
  return b;
});
function persist() {
  if (mode === 'online') return;
  try { localStorage.setItem(STORAGE,JSON.stringify({version:1,mode,level,timeline:timeline.slice(-160)})); } catch {}
}
function actionNote(s,a) {
  const name = s.player === 1 ? '白方' : '黑方';
  if (a.type === 'capture') return `${name}成三，吃掉 ${LABELS[a.at]} 的${s.player === 1 ? '黑' : '白'}子。`;
  if (a.type === 'place') return `${name}落子 ${LABELS[a.at]}。`;
  return `${name}：${LABELS[a.from]} → ${LABELS[a.to]}。`;
}
function applyAction(a) {
  const s = state();
  const next = play(s,a);
  timeline.push({state:next,note:actionNote(s,a),actor:s.player,action:a});
  selected = null;
  persist();
  render();
}
function handlePoint(i) {
  const s = state();
  if (mode === 'online' && !online.canMove) return;
  if (s.winner || s.draw || busy || (mode === 'ai' && s.player === 2)) return;
  const actions = legalActions(s);
  if (s.capture || s.reserves[s.player-1] > 0) {
    const action = actions.find(a => a.at === i);
    if (action) commitAction(action);
    else if (s.capture && s.board[i] === 3-s.player) $('status-copy').textContent = '这枚棋子已成三，请先吃未成三的棋子。';
    return;
  }
  if (s.board[i] === s.player) {
    selected = selected === i ? null : i;
    render();
    if (selected !== null && !actions.some(a => a.from === selected)) $('status-copy').textContent = '这枚棋子被堵住了，请选择另一枚。';
    return;
  }
  const action = actions.find(a => a.from === selected && a.to === i);
  if (action) commitAction(action);
  else if (selected !== null && s.board[i] === 0) $('status-copy').textContent = '只能沿线走到相邻空点，三子也不能飞。';
}
function commitAction(action) {
  if (mode === 'online') {selected=null;online.move(action);}
  else {applyAction(action);scheduleAI();}
}
function render() {
  const s = state();
  const over = !!s.winner || s.draw;
  const actions = legalActions(s);
  const computerTurn = mode === 'ai' && s.player === 2 && !over;
  const onlineBlocked = mode === 'online' && !online.canMove;
  const destination = s.last?.type === 'place' ? s.last.at : s.last?.type === 'move' ? s.last.to : -1;
  pointButtons.forEach((button,i) => {
    const legal = !over && !computerTurn && !onlineBlocked && (s.capture ? actions.some(a => a.at === i) : s.reserves[s.player-1] ? actions.some(a => a.at === i) : selected !== null && actions.some(a => a.from === selected && a.to === i));
    button.className = 'point' + (s.board[i] === 1 ? ' white' : s.board[i] === 2 ? ' black' : '') + (legal ? s.capture ? ' removable' : ' legal' : '') + (selected === i ? ' selected' : '') + (destination === i ? ' last' : '');
    button.setAttribute('aria-label',`${LABELS[i]}，${s.board[i] === 1 ? '白子' : s.board[i] === 2 ? '黑子' : '空点'}${legal ? s.capture ? '，可吃' : '，可落子' : ''}`);
    button.setAttribute('aria-pressed',String(selected === i));
    button.disabled = over || computerTurn || onlineBlocked;
  });
  const svg = $('mill-lines');
  svg.replaceChildren();
  MILLS.filter(line => s.board[line[0]] && line.every(i => s.board[i] === s.board[line[0]])).forEach(line => {
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    const [a,b] = [POINTS[line[0]],POINTS[line[2]]];
    path.setAttribute('d',`M${48+a[0]*84} ${48+a[1]*84}L${48+b[0]*84} ${48+b[1]*84}`);
    path.setAttribute('class','mill-line');
    svg.append(path);
  });
  const placing = s.reserves.some(v => v > 0);
  $('phase').textContent = over ? '对局结束' : s.capture ? '三子成线 · 吃子' : placing ? '第一阶段 · 布子' : '第二阶段 · 行棋';
  $('turn-number').textContent = `第 ${s.turn} 手`;
  $('status-label').textContent = over ? s.draw ? '握手言和' : '胜负已分' : computerTurn ? '电脑正在思考' : `轮到${s.player === 1 ? '白' : '黑'}方`;
  $('status-title').textContent = over ? s.draw ? '这局，平分秋色' : `${s.winner === 1 ? '白' : '黑'}方获胜` : s.capture ? '成三了，吃掉一子' : placing ? '落下一枚棋子' : selected === null ? '选一枚棋子出发' : '走到相邻的空点';
  $('status-copy').textContent = over ? s.reason : computerTurn ? level === 'hard' ? '高手正在推演后续变化，请稍候。' : '稍等片刻，对手正在斟酌下一步。' : s.capture ? '点击虚线圈出的对方棋子，将它移出棋盘。' : placing ? '点击棋盘上的亮点，试着让三子连成一线。' : selected === null ? '先选中己方棋子，再点击相邻的亮点。' : '本局不允许飞行，只能沿线移动一步。';
  for (const p of [1,2]) {
    const n = count(s,p);
    $(`player-${p}`).classList.toggle('current',!over && s.player === p);
    $(`badge-${p}`).hidden = over || s.player !== p;
    $(`badge-${p}`).textContent = computerTurn ? '思考中' : '进行中';
    $(`reserve-${p}`).textContent = s.reserves[p-1];
    $(`count-${p}`).textContent = n;
    $(`lost-${p}`).textContent = 9-s.reserves[p-1]-n;
    const rack = $(`stones-${p}`);
    rack.className = 'reserve-stones' + (p === 2 ? ' dark' : '');
    rack.replaceChildren(...Array.from({length:9},(_,i) => {const dot = document.createElement('i');if (i >= s.reserves[p-1]) dot.className = 'used';return dot;}));
  }
  $('name-1').textContent = mode === 'ai' ? '你 · 白方' : '白方';
  $('name-2').textContent = mode === 'ai' ? '电脑 · 黑方' : '黑方';
  $('difficulty-wrap').hidden = mode !== 'ai';
  $('difficulty').value = level;
  document.querySelectorAll('[data-mode]').forEach(b => {b.classList.toggle('active',b.dataset.mode === mode);b.setAttribute('aria-pressed',String(b.dataset.mode === mode));});
  $('undo').disabled = !timeline.slice(1).some(f => mode === 'local' || f.actor === 1);
  if (mode === 'online') {
    $('undo').disabled=true;$('restart').disabled=true;
    const room=online.room;
    for (const [p,id] of [[1,room?.white_id],[2,room?.black_id]]) {
      const player=room?.players.find(x=>x.user_id===id);
      $(`name-${p}`).textContent=(player?.nickname|| (p===2?'等待棋友':'白方'))+(id && id===online.user?.id?' · 你':'');
    }
    if (!over && onlineBlocked) {
      $('status-label').textContent=!online.user?'好友联机':!online.connected?'连接中':!room||room.status!=='playing'?'等待开局':online.busy?'正在提交走法':'轮到对方';
      $('status-title').textContent=!online.user?'登录后邀请好友':!online.connected?'正在连接棋桌':!room||room.status!=='playing'?'邀请好友来一局':online.busy?'落子确认中':'等待棋友落子';
      $('status-copy').textContent=!online.user?'注册游戏账号，即可创建房间并参与积分排名。':!online.connected?'棋局保存在后台，连接恢复后继续。':!room||room.status!=='playing'?'创建房间并分享房间码，或输入好友的房间码。':'双方的棋局会自动同步，请稍候。';
    }
    $('last-move').textContent=room?.status==='playing'?`房间 ${room.code} · ${s.last?actionNote({...s,player:s.last.player},s.last):'棋盘已备好，白方先行。'}`:room?.status==='finished'?`对局已结算 · 白方积分 ${room.rating_delta>=0?'+':''}${room.rating_delta}，黑方积分 ${-room.rating_delta>=0?'+':''}${-room.rating_delta}`:'好友联机对局将自动保存，刷新可继续。';
    $('play-again').hidden=true;
  } else {$('restart').disabled=false;$('play-again').hidden=false;}
  $('last-move').textContent = timeline.at(-1).note;
  $('game-result').hidden = !over;
  if (over) {
    $('result-title').textContent = s.draw ? '平分秋色' : `${s.winner === 1 ? '白' : '黑'}方获胜`;
    $('result-reason').textContent = s.reason;
  }
}
function cancelAI() {
  generation++;
  busy = false;
  worker?.terminate();
  worker = null;
}
function scheduleAI() {
  const s = state();
  if (mode !== 'ai' || s.player !== 2 || s.winner || s.draw || busy) return;
  busy = true;
  render();
  const id = ++generation;
  const start = performance.now();
  function deliver(actions) {
    setTimeout(() => {
      if (generation !== id) return;
      const position = positionKey(s);
      delete recentAI[position];
      recentAI[position] = JSON.stringify(actions);
      recentAI = Object.fromEntries(Object.entries(recentAI).slice(-128));
      try {localStorage.setItem(VARIETY_STORAGE,JSON.stringify(recentAI));} catch {}
      for (const a of actions) applyAction(a);
      busy = false;
      render();
      scheduleAI();
    },Math.max(0,500-(performance.now()-start)));
  }
  function fallback() {
    if (generation !== id) return;
    worker?.terminate();worker = null;
    try {deliver(chooseTurn(s,level === 'hard' ? 'normal' : level));}
    catch {deliver(legalActions(s).slice(0,1));}
  }
  try {
    worker = new Worker(new URL('./ai-worker.js?v=3',import.meta.url),{type:'module'});
    worker.onmessage = ({data}) => {
      if (generation !== id || data.id !== id) return;
      worker?.terminate();worker = null;
      if (data.error) fallback();else deliver(data.actions);
    };
    worker.onerror = fallback;
    worker.postMessage({id,state:s,level,avoidActions:recentAI[positionKey(s)] ? [recentAI[positionKey(s)]] : []});
  } catch { fallback(); }
}
let pendingReset = null;
function reset(nextMode = mode) {
  cancelAI();
  mode = nextMode;
  selected = null;
  timeline = [{state:newGame(),note:'棋盘已备好，白方先行。',actor:0}];
  online.activate(mode === 'online');
  if (mode === 'online' && online.room) timeline=[{state:online.room.state,note:'联机棋局已恢复。',actor:0}];
  persist();render();
}
function requestReset(nextMode = mode) {
  if (mode === 'online') {reset(nextMode);return;}
  if (timeline.length === 1 || state().winner || state().draw) {reset(nextMode);return;}
  pendingReset = nextMode;
  $('confirm-dialog').showModal();
}
$('restart').addEventListener('click',() => requestReset());
$('play-again').addEventListener('click',() => reset());
$('confirm-cancel').addEventListener('click',() => {$('confirm-dialog').close();pendingReset = null;});
$('confirm-yes').addEventListener('click',() => {$('confirm-dialog').close();reset(pendingReset || mode);pendingReset = null;});
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click',() => {if (b.dataset.mode !== mode) requestReset(b.dataset.mode);}));
$('undo').addEventListener('click',() => {
  if (mode === 'online') return;
  cancelAI();
  if (mode === 'local') { if (timeline.length > 1) timeline.pop(); }
  else {
    let index = timeline.findLastIndex(f => f.actor === 1);
    if (index > 0) {
      while (index > 1 && timeline[index-1].state.player === 1 && timeline[index-1].state.capture) index--;
      timeline = timeline.slice(0,index);
    }
  }
  selected = null;persist();render();scheduleAI();
});
$('difficulty').addEventListener('change',() => {level = $('difficulty').value;cancelAI();persist();render();scheduleAI();});
$('rules-open').addEventListener('click',() => $('rules-dialog').showModal());
for (const id of ['rules-close','rules-done']) $(id).addEventListener('click',() => $('rules-dialog').close());
const online = new OnlineController(() => {
  if (mode === 'online') {
    const next=online.room?.state||newGame();
    if (state()!==next) selected=null;
    timeline=[{state:next,note:'联机棋局已同步。',actor:0}];
    render();
  }
});
render();
scheduleAI();
