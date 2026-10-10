import {useEffect,useState} from 'react';
import {Users,Cloud,CloudOff,RefreshCw,Check,Copy} from 'lucide-react';
import {normalizeIdentity} from '../cloud/client';
import Captcha from './Captcha';
import {money,recordDescription} from '../model';
export function SyncBanner({cloud,sync,offline,onOpen}){
  if(!sync)return <button className="sync-banner local" onClick={onOpen}><Users size={17}/><span>{cloud.configured?'本机记录 · 登录后可共同记录':'本机记录 · 共享服务尚未开通'}</span></button>;
  const text=sync.conflicts.length?`${sync.conflicts.length} 处修改待确认`:offline?`离线记录 · ${sync.pending} 项待同步`:sync.error?'同步未完成，点此查看':sync.running?'正在同步…':sync.pending?`${sync.pending} 项待同步`:'已同步 · 两人共享档案';
  const Icon=offline||sync.error?CloudOff:sync.running?RefreshCw:Cloud;
  return <button className={`sync-banner ${sync.error||sync.conflicts.length?'attention':''}`} onClick={onOpen}><Icon size={17}/><span>{text}</span></button>;
}
const describe=(kind,value)=>kind==='budget'?value?money(value):'未设置预算':kind==='profile'?value?`${value.name} · ${value.birthday}`:'还没有档案':value?`${value.deletedAt?'已移除 · ':''}${value.title||value.kind||''} ${recordDescription(value)}`:'云端没有这条记录';
export default function Sharing({cloud,sync,state,onSync,onResolve}){
  const [kind,setKind]=useState(cloud.config.phone?'phone':'email');const [identity,setIdentity]=useState(cloud.config.phone?'+86 ':'');
  const [sent,setSent]=useState(null);const [code,setCode]=useState('');const [deadline,setDeadline]=useState(0);const [clock,setClock]=useState(Date.now());
  const [name,setName]=useState('');const [joinCode,setJoinCode]=useState(()=>new URLSearchParams(location.hash.slice(1)).get('join')||'');const [migrate,setMigrate]=useState(false);
  const [inviteKind,setInviteKind]=useState(cloud.config.phone?'phone':'email');const [target,setTarget]=useState(cloud.config.phone?'+86 ':'');const [invite,setInvite]=useState(null);
  const [captcha,setCaptcha]=useState('');const [captchaReset,setCaptchaReset]=useState(0);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');
  useEffect(()=>{if(deadline<=Date.now())return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[deadline]);
  const remaining=Math.max(0,Math.ceil((deadline-clock)/1000));
  async function run(action){setBusy(true);setError('');setMessage('');try{await action();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function send(e){e.preventDefault();await run(async()=>{let value;try{value=await cloud.requestCode(kind,identity,captcha);}finally{if(cloud.config.captcha){setCaptcha('');setCaptchaReset(value=>value+1);}}setSent({kind,identity:value});setDeadline(Date.now()+60000);setClock(Date.now());setMessage('验证码已发送，请查看短信或邮件');});}
  async function verify(e){e.preventDefault();await run(async()=>{await cloud.verifyCode(sent.kind,sent.identity,code);setCode('');setMessage('已登录');});}
  function changeKind(next){setKind(next);setIdentity(next==='phone'?'+86 ':'');setSent(null);setCode('');setError('');}
  const localForConflict=c=>c.kind==='record'?state.records.find(r=>r.id===c.entity):c.kind==='profile'?state.profile:state.budgetCents;
  return <div className="sharing-content">
    <div className="sharing-intro"><Users size={30}/><h3>一起照顾同一只猫</h3><p>各自登录，私密共享记录、照片和花费。</p></div>
    {!cloud.configured?<div className="sharing-card"><h3>共享服务尚未开通</h3><p>目前仍是本机记录。你的已有资料会保留，开通云服务后可以选择迁移到两人的共享档案。</p><p className="form-hint">在此之前，手机和电脑不会自动同步。请继续导出完整备份。</p></div>:
      cloud.loading?<p role="status">正在读取登录与共享状态…</p>:!cloud.session?<>
      {cloud.config.phone||cloud.config.email?<>
        <div className="segmented-tabs" aria-label="登录方式">{cloud.config.phone&&<button onClick={()=>changeKind('phone')} aria-pressed={kind==='phone'} className={kind==='phone'?'active':''}>手机验证码</button>}{cloud.config.email&&<button onClick={()=>changeKind('email')} aria-pressed={kind==='email'} className={kind==='email'?'active':''}>邮箱验证码</button>}</div>
        <form onSubmit={send} className="sharing-card"><label htmlFor="sharing-identity">{kind==='phone'?'手机号（含国家区号）':'登录邮箱'}</label><input id="sharing-identity" type={kind==='phone'?'tel':'email'} autoComplete={kind==='phone'?'tel':'email'} required value={identity} onChange={e=>{setIdentity(e.target.value);setSent(null);}} placeholder={kind==='phone'?'+86 13812345678':'name@example.com'}/><>{cloud.config.captcha&&<Captcha siteKey={cloud.config.captcha} onToken={setCaptcha} resetKey={captchaReset}/>}</><button className="secondary-button" disabled={busy||remaining>0||Boolean(cloud.config.captcha&&!captcha)}>{remaining?`${remaining} 秒后可重发`:'获取验证码'}</button></form>
        {sent&&<form className="sharing-card" onSubmit={verify}><p>验证码已发往 {sent.identity}</p><label htmlFor="sharing-code">6 位验证码</label><input id="sharing-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e=>setCode(e.target.value)}/><button className="primary-button" disabled={busy}>验证并登录</button></form>}
      </>:<div className="sharing-card"><h3>登录服务正在配置</h3><p>验证码通道开通后，这里会显示登录入口。</p></div>}
      <p className="form-hint">登录不会自动上传本机资料。创建共享档案时，由你选择是否迁移；之后请固定使用同一手机号或邮箱登录。</p>
    </>:!cloud.household?<>
      <div className="sharing-card"><label htmlFor="sharing-name">你的称呼</label><input id="sharing-name" value={name} onChange={e=>setName(e.target.value)} required maxLength={30} placeholder="例如：George / 小圆"/></div>
      <div className="sharing-card"><h3>由我创建共享档案</h3>{state.profile&&<label className="checkbox-field"><input type="checkbox" checked={migrate} onChange={e=>setMigrate(e.target.checked)}/>将本机「{state.profile.name}」的记录和照片上传到私密共享档案</label>}<p className="form-hint">不勾选会从空白开始。本机原档案独立保留。</p><button className="primary-button" disabled={busy||!name.trim()} onClick={()=>run(async()=>{await cloud.create(name,migrate);setMessage('共享档案已创建，本机原资料已保留');})}>创建共享档案</button></div>
      <form className="sharing-card" onSubmit={e=>{e.preventDefault();void run(async()=>{await cloud.join(joinCode,name);history.replaceState(null,'',location.pathname+location.search);setMessage('已加入共享档案');});}}><h3>加入对方的档案</h3><label htmlFor="sharing-join">对方给你的邀请码</label><input id="sharing-join" value={joinCode} onChange={e=>setJoinCode(e.target.value)} required autoComplete="off"/><p className="form-hint">请用对方邀请的邮箱或手机号登录。加入后显示共享档案，本机原资料独立保留。</p><button className="secondary-button" disabled={busy||!name.trim()}>加入共享档案</button></form>
    </>:<>
      <div className="sharing-card"><h3>{state.profile?.name||'猫咪'}的共享档案</h3><p>{sync?.members.map(m=>m.name).join('、')||'正在读取成员'} · 最多两人</p><p>{!sync?'正在读取共享记录…':sync.pending?`${sync.pending} 项仍保存在本机，等待上传`:'当前没有待上传记录'}</p>{sync?.lastSyncedAt&&<small>最近同步：{new Date(sync.lastSyncedAt).toLocaleString('zh-CN',{hour12:false})}</small>}{sync?.error&&<p role="alert" className="form-error">{sync.error}</p>}<button className="secondary-button" disabled={busy||sync?.running} onClick={()=>run(onSync)}><RefreshCw size={17}/>立即同步</button><p className="form-hint">联网时自动同步，页面打开期间约每 15 秒检查一次。离线记录先保存在本机，恢复联网后补传。</p></div>
      {sync?.conflicts.map(c=><div className="sharing-card conflict-card" key={c.key}><h3>同一内容有两份修改</h3><p>本机：{describe(c.kind,localForConflict(c))}</p><p>云端：{describe(c.kind,c.remote)}</p><p className="form-hint">先导出完整备份可保留本机版本，再选择要采用的内容。不会自动覆盖。</p><div className="detail-actions"><button className="secondary-button" disabled={busy} onClick={()=>run(()=>onResolve(c.key,'remote'))}>采用云端版本</button><button className="secondary-button" disabled={busy} onClick={()=>run(()=>onResolve(c.key,'local'))}>保留本机修改</button></div></div>)}
      {sync?.ownerId===cloud.user.id&&sync.members.length<2&&<form className="sharing-card" onSubmit={e=>{e.preventDefault();void run(async()=>{const value=normalizeIdentity(inviteKind,target);const result=await cloud.api.rpc('miao_invite',{p_household:cloud.household,p_kind:inviteKind,p_target:value});setInvite(result);});}}><h3>邀请另一位照顾者</h3><label htmlFor="invite-kind">对方的登录方式</label><select id="invite-kind" value={inviteKind} onChange={e=>{const value=e.target.value;setInviteKind(value);setTarget(value==='phone'?'+86 ':'');}}>{cloud.config.phone&&<option value="phone">手机号</option>}{cloud.config.email&&<option value="email">邮箱</option>}</select><label htmlFor="invite-target">对方的{inviteKind==='phone'?'手机号（含国家区号）':'邮箱'}</label><input id="invite-target" type={inviteKind==='phone'?'tel':'email'} value={target} onChange={e=>setTarget(e.target.value)} required/><button className="primary-button" disabled={busy}>生成专属邀请</button><p className="form-hint">邀请 24 小时有效，仅指定登录身份可以加入。生成新邀请会撤销旧邀请。</p></form>}
      {invite&&<div className="sharing-card"><h3>专属邀请已生成</h3><label htmlFor="invitation-value">邀请码</label><textarea id="invitation-value" readOnly value={invite.token} rows={3}/><button className="secondary-button" onClick={()=>run(async()=>{const url=new URL(location.href);url.hash=`join=${invite.token}`;await navigator.clipboard.writeText(url.href);setMessage('邀请链接已复制，请自行发给对方');})}><Copy size={17}/>复制邀请链接</button><button className="text-button" onClick={()=>run(async()=>{await cloud.api.rpc('miao_revoke_invites',{p_household:cloud.household});setInvite(null);setMessage('邀请已撤销');})}>撤销邀请</button></div>}
    </>}
    {cloud.error&&<p className="form-error" role="alert">{cloud.error}</p>}{error&&<p className="form-error" role="alert">{error}</p>}{message&&<p className="sharing-message" role="status"><Check size={17}/>{message}</p>}
    {cloud.session&&<div className="sharing-card"><p className="form-hint">退出后回到本机档案。共享缓存和待上传记录会保留，下次用同一账号登录后继续同步。</p><button className="secondary-button" disabled={busy||sync?.running} onClick={()=>run(cloud.signOut)}>退出此设备的登录</button></div>}
  </div>;
}
