import {newGame,play} from './engine.js';
export const PUBLIC_PROFILE = 'user_id,nickname,rating,wins,losses,draws';
export function nextState(room,userId,action,kind) {
  const side=room.white_id===userId ? 1 : room.black_id===userId ? 2 : 0;
  if (!side) throw new Error('你不是这个房间的玩家');
  if (kind==='resign' && room.status==='waiting' && userId===(room.host_id||room.white_id)) return room.state;
  if (room.status!=='playing') throw new Error('对局尚未开始或已结束');
  if (kind==='resign') return {...room.state,winner:3-side,draw:false,capture:false,reason:`${side===1?'白':'黑'}方认输`};
  if (kind!=='move' || room.state.player!==side) throw new Error('还未轮到你');
  if (!action || typeof action!=='object') throw new Error('缺少走法');
  // Reconstruct a bounded action; never accept a client-supplied state or result.
  const a=action.type==='move' ? {type:'move',from:action.from,to:action.to} : {type:action.type,at:action.at};
  return play(room.state,a);
}
export function createHandler(admin) {
  async function checked(promise) { const {data,error}=await promise;if(error) throw new Error(error.message);return data; }
  async function roomView(id,userId) {
    const r=await checked(admin.from('morris_rooms').select('*').eq('id',id).single());
    if(r.white_id!==userId && r.black_id!==userId) throw new Error('无权查看此房间');
    const players=await checked(admin.from('morris_profiles').select(PUBLIC_PROFILE).in('user_id',[r.white_id,r.black_id].filter(Boolean)));
    return {...r,players};
  }
  return async function(req) {
    const origin=req.headers.get('Origin');
    const allowed=origin==='https://wxc198929.github.io' || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin||'');
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin',...(allowed?{'Access-Control-Allow-Origin':origin}:{}),'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
    const reply=(data,status=200)=>new Response(JSON.stringify(data),{headers,status});
    if(origin && !allowed) return reply({error:'不支持的来源'},403);
    if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
    if(req.method!=='POST') return reply({error:'请使用 POST'},405);
    try {
      if(Number(req.headers.get('content-length')||0)>4096) return reply({error:'请求过大'},413);
      const raw=await req.text(); if(raw.length>4096) return reply({error:'请求过大'},413);
      const body=JSON.parse(raw);
      if(body.command==='leaderboard') {
        const players=await checked(admin.from('morris_profiles').select(PUBLIC_PROFILE).or('wins.gt.0,losses.gt.0,draws.gt.0').order('rating',{ascending:false}).order('wins',{ascending:false}).order('user_id').limit(50));
        return reply({players});
      }
      const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
      const {data,error}=await admin.auth.getUser(token);
      if(error || !data?.user) return reply({error:'请先登录，或重新登录后继续'},401);
      const user=data.user;
      const profile=await checked(admin.rpc('morris_ensure_profile',{p_user:user.id,p_nickname:typeof user.user_metadata?.nickname==='string'?user.user_metadata.nickname:'棋友'}));
      if(body.command==='me') {
        const rooms=await checked(admin.from('morris_rooms').select('id').or(`white_id.eq.${user.id},black_id.eq.${user.id}`).in('status',['waiting','playing']).order('updated_at',{ascending:false}).limit(1));
        return reply({profile,room:rooms[0]?await roomView(rooms[0].id,user.id):null});
      }
      let id=body.roomId;
      if(body.command==='create') {
        const side=body.side??1;if(![1,2].includes(side))throw new Error('请选择先手或后手');
        id=await checked(admin.rpc('morris_create_seated',{p_user:user.id,p_state:newGame(),p_side:side}));
      }
      else if(body.command==='join') {
        if(!/^[0-9A-F]{6}$/.test(body.code||'')) throw new Error('请输入六位房间码');
        const side=body.side??0;if(![0,1,2].includes(side))throw new Error('执方选择无效');
        id=await checked(admin.rpc('morris_join_seated',{p_user:user.id,p_code:body.code,p_side:side}));
      } else if(!['room','move','resign'].includes(body.command)) throw new Error('未知操作');
      if(typeof id!=='string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('房间编号无效');
      if(['move','resign'].includes(body.command)) {
        const room=await roomView(id,user.id);
        if(!Number.isInteger(body.revision) || room.revision!==body.revision) return reply({error:'棋局已更新，请重试',room},409);
        const next=nextState(room,user.id,body.action,body.command);
        await checked(admin.rpc('morris_commit',{p_user:user.id,p_room:id,p_revision:body.revision,p_state:next,p_kind:body.command}));
      }
      return reply({room:await roomView(id,user.id)});
    } catch(e) { return reply({error:e.message||'服务暂时不可用'},400); }
  };
}
