import {config} from '../shared/online-config.js';
const $=id=>document.getElementById(id);
const HOME='https://wxc198929.github.io/Nine-Men-s-Morris/game/nine-mens-morris/';
export class OnlineController {
  constructor(changed,getSide=()=>1) {
    this.getSide=getSide;this.changed=changed;this.user=null;this.profile=null;this.room=null;this.busy=false;this.active=false;this.connected=true;this.authMode='login';this.epoch=0;
    try {
      this.client=window.supabase.createClient(config.url,config.key);
      this.client.auth.onAuthStateChange((event,session)=>{
        const old=this.user?.id;this.user=session?.user||null;
        if(old!==this.user?.id) {this.epoch++;this.room=null;this.profile=null;this.connected=false;}
        this.draw();this.changed();
        if(event==='PASSWORD_RECOVERY') this.openAuth('reset');
        if(this.user && (old!==this.user.id || event==='INITIAL_SESSION')) setTimeout(()=>this.refreshMe(),0);
      });
    } catch {this.message='账号服务暂时不可用，请刷新重试。';}
    $('account-open').onclick=()=>this.openAuth();
    $('online-login').onclick=()=>this.openAuth();
    $('account-close').onclick=()=>$('account-dialog').close();
    $('account-switch').onclick=()=>this.openAuth(this.authMode==='signup'?'login':'signup');
    $('forgot-password').onclick=()=>this.openAuth('recover');
    $('account-form').onsubmit=e=>{e.preventDefault();this.submitAuth();};
    $('sign-out').onclick=async()=>{
      try {const {error}=await this.client.auth.signOut();if(error)throw error;$('account-dialog').close();}
      catch(e){$('account-message').textContent=this.error(e);}
    };
    $('room-create').onclick=()=>this.roomCommand('create',{side:this.getSide()});
    $('room-join-form').onsubmit=e=>{e.preventDefault();this.roomCommand('join',{code:$('room-code-input').value.trim().toUpperCase(),side:Number($('room-join-side').value)});};
    $('room-copy').onclick=async()=>{
      try {await navigator.clipboard.writeText(this.room.code);this.setMessage('房间码已复制，发给好友即可加入。');}
      catch {this.setMessage('请选中房间码并复制，发给好友。');}
    };
    $('room-resign').onclick=()=>{
      $('resign-copy').textContent=this.room?.status==='waiting'?'取消等待并关闭这个房间？':'认输后对局立即结束，结果将计入排行榜。';
      $('resign-dialog').showModal();
    };
    $('resign-cancel').onclick=()=>$('resign-dialog').close();
    $('resign-confirm').onclick=()=>{$('resign-dialog').close();this.roomCommand('resign',{roomId:this.room.id,revision:this.room.revision});};
    $('ranking-open').onclick=()=>this.ranking();
    $('ranking-close').onclick=()=>$('ranking-dialog').close();
    document.addEventListener('visibilitychange',()=>{if(!document.hidden && this.active)this.poll();});
    this.timer=setInterval(()=>{if(this.active && !document.hidden)this.poll();},2500);
    this.draw();
  }
  get side(){return !this.room||!this.user?0:this.room.white_id===this.user.id?1:this.room.black_id===this.user.id?2:0;}
  get canMove(){return !!(this.connected && !this.busy && this.room?.status==='playing' && this.room.state.player===this.side);}
  error(e){
    const m=e.message||String(e);
    if(/Invalid login credentials/i.test(m))return '邮箱或密码不正确。';
    if(/Email not confirmed/i.test(m))return '请先到邮箱完成账号验证，再登录。';
    if(/Email signups are disabled/i.test(m))return '账号注册暂未开放，请稍后再试。';
    if(/rate.limit|too many|security purposes/i.test(m))return '操作过于频繁，请稍后再试。';
    if(/email_address_not_authorized|Email address.*not authorized|Error sending confirmation/i.test(m))return '注册邮件服务尚未配置完成，请稍后再试。';
    if(/fetch|network|timeout|abort/i.test(m))return '连接暂时中断，正在重连；请勿重复落子。';
    if(/already registered/i.test(m))return '该邮箱已注册，请直接登录。';
    return m;
  }
  async api(command,extra={}) {
    if(!this.client)throw new Error('账号服务暂时不可用');
    const {data,error}=await this.client.auth.getSession();if(error)throw error;
    const response=await fetch(config.url+'/functions/v1/morris-api',{
      method:'POST',headers:{'Content-Type':'application/json',apikey:config.key,...(data.session?{Authorization:'Bearer '+data.session.access_token}:{})},
      body:JSON.stringify({command,...extra}),signal:AbortSignal.timeout(15000)
    });
    const result=await response.json();
    if(!response.ok){if(result.room)this.acceptRoom(result.room);throw new Error(result.error||'服务暂时不可用');}
    return result;
  }
  acceptRoom(room){
    if(this.room?.id===room.id && this.room.revision>room.revision)return;
    if(this.room?.id===room.id && this.room.revision===room.revision){this.connected=true;this.draw();this.changed();return;}
    this.room=room;this.connected=true;this.draw();this.changed();
  }
  async refreshMe(){
    const epoch=this.epoch;
    try {const result=await this.api('me');if(epoch!==this.epoch)return;this.profile=result.profile;this.connected=true;this.message='';if(result.room)this.acceptRoom(result.room);else {this.room=null;this.draw();this.changed();}}
    catch(e){if(epoch===this.epoch){this.connected=false;this.setMessage(this.error(e));this.changed();}}
  }
  activate(value){this.active=value;if(value && this.user)this.refreshMe();this.draw();}
  async poll(){
    if(this.polling || this.busy || !this.user)return;
    this.polling=true;const epoch=this.epoch;
    try {
      if(!this.room){await this.refreshMe();return;}
      const {room}=await this.api('room',{roomId:this.room.id});
      if(epoch===this.epoch){const settled=this.room?.status!=='finished' && room.status==='finished';this.message='';this.acceptRoom(room);if(settled)await this.refreshProfile();}
    } catch(e){if(epoch===this.epoch){this.connected=false;this.setMessage(this.error(e));this.changed();}}
    finally{this.polling=false;}
  }
  async roomCommand(command,extra={}) {
    if(this.busy)return;if(!this.user){this.openAuth();return;}
    this.busy=true;const epoch=this.epoch;this.draw();this.changed();
    try {
      const {room}=await this.api(command,extra);
      if(epoch!==this.epoch)return;
      this.message='';this.acceptRoom(room);
      if(room.status==='finished')await this.refreshProfile();
    } catch(e){if(epoch===this.epoch)this.setMessage(this.error(e));}
    finally{this.busy=false;this.draw();this.changed();}
  }
  async refreshProfile(){const {profile}=await this.api('me');this.profile=profile;this.draw();}
  move(action){return this.roomCommand('move',{roomId:this.room.id,revision:this.room.revision,action});}
  setMessage(text){this.message=text;this.draw();}
  openAuth(mode='login'){
    this.authMode=mode;
    const logged=!!this.user && mode!=='reset';
    $('account-title').textContent=logged?'我的棋友账号':({login:'欢迎回到棋桌',signup:'注册棋友账号',recover:'找回密码',reset:'设置新密码'})[mode];
    $('account-form').hidden=logged;$('account-profile').hidden=!logged;
    $('profile-copy').textContent=logged?`${this.profile?.nickname||'棋友'} · 积分 ${this.profile?.rating??1200}`:'';
    $('account-email').closest('label').hidden=mode==='reset';$('account-email').required=mode!=='reset';
    $('account-password').closest('label').hidden=mode==='recover';$('account-password').required=mode!=='recover';
    $('account-password').minLength=mode==='login'?1:8;
    $('account-password').autocomplete=mode==='login'?'current-password':'new-password';
    $('account-nickname').closest('label').hidden=mode!=='signup';$('account-nickname').required=mode==='signup';
    $('account-password-confirm').closest('label').hidden=!['signup','reset'].includes(mode);$('account-password-confirm').required=['signup','reset'].includes(mode);
    $('account-submit').textContent=({login:'登录',signup:'创建账号',recover:'发送重置邮件',reset:'保存新密码'})[mode];
    $('account-switch').textContent=mode==='signup'?'已有账号？去登录':'还没有账号？免费注册';
    $('account-switch').hidden=logged||mode==='reset';$('forgot-password').hidden=true;
    $('account-message').textContent='';$('account-password').value='';$('account-password-confirm').value='';
    if(!$('account-dialog').open)$('account-dialog').showModal();
  }
  async submitAuth(){
    const mode=this.authMode,email=$('account-email').value.trim(),password=$('account-password').value;
    if(['signup','reset'].includes(mode) && password!==$('account-password-confirm').value){$('account-message').textContent='两次输入的密码不一致。';return;}
    $('account-submit').disabled=true;$('account-message').textContent='正在处理…';
    try {
      let result;
      if(mode==='signup')result=await this.client.auth.signUp({email,password,options:{data:{nickname:$('account-nickname').value.trim()},emailRedirectTo:HOME}});
      else if(mode==='recover')result=await this.client.auth.resetPasswordForEmail(email,{redirectTo:HOME});
      else if(mode==='reset')result=await this.client.auth.updateUser({password});
      else result=await this.client.auth.signInWithPassword({email,password});
      if(result.error)throw result.error;
      if(mode==='recover')$('account-message').textContent='如果该邮箱已注册，你会收到密码重置邮件。';
      else if(mode==='signup' && !result.data.session)$('account-message').textContent='请到邮箱点击验证链接，完成后回来登录。';
      else {$('account-dialog').close();await this.refreshMe();}
    } catch(e){$('account-message').textContent=this.error(e);}
    finally{$('account-submit').disabled=false;$('account-password').value='';$('account-password-confirm').value='';}
  }
  draw(){
    $('account-open').textContent=this.user?(this.profile?.nickname||'我的账号'):'登录 / 注册';
    $('online-panel').hidden=!this.active;
    $('online-login').hidden=!!this.user;
    const live=this.room && ['waiting','playing'].includes(this.room.status);
    $('room-controls').hidden=!this.user||!!live;
    $('room-current').hidden=!this.user||!this.room;
    $('online-profile').textContent=this.user?`${this.profile?.nickname||'棋友'} · 积分 ${this.profile?.rating??1200}`:'登录后创建房间，邀请好友来一局。';
    $('online-message').textContent=this.message||(!this.user?'本地和人机模式无需登录。':'');
    if(this.room){
      $('room-code').textContent=this.room.code;
      $('room-info').textContent=this.room.status==='waiting'?`你执${this.side===1?'白先手':'黑后手'}，等待好友加入`:this.room.status==='playing'?`你执${this.side===1?'白先手':'黑后手'} · ${this.connected?'已连接':'正在重连'}`:this.room.status==='cancelled'?'房间已取消':'对局已结束，可创建新房间';
      $('room-resign').hidden=!live;$('room-resign').textContent=this.room.status==='waiting'?'取消房间':'认输';
      $('room-copy').hidden=this.room.status!=='waiting';
    }
    for(const id of ['room-create','room-join','room-resign'])$(id).disabled=this.busy;
  }
  async ranking(){
    if(!$('ranking-dialog').open)$('ranking-dialog').showModal();$('ranking-body').replaceChildren();$('ranking-message').textContent='正在读取排行榜…';
    try {
      const {players}=await this.api('leaderboard');
      $('ranking-message').textContent=players.length?'仅统计已完成的好友联机对局；初始积分 1200，采用 Elo 计分。':'还没有已完成的联机对局，来争取第一个上榜名额。';
      players.forEach((p,i)=>{const row=document.createElement('tr');for(const value of [i+1,p.nickname,p.rating,`${p.wins} / ${p.losses} / ${p.draws}`]){const td=document.createElement('td');td.textContent=value;row.append(td);}$('ranking-body').append(row);});
    } catch(e){$('ranking-message').textContent=this.error(e);}
  }
}
