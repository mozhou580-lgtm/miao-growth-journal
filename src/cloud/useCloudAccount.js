import {useEffect,useRef,useState} from 'react';
import {cloudConfig,cloudConfigured,getCloudClient,normalizeIdentity} from './client';
import {cloudAPI} from './api';
import {SyncEngine} from './sync';
import {loadState,persistState,mutateState} from '../storage';
const store={load:loadState,save:(key,value)=>persistState(value,key),mutate:mutateState};
export const cloudKey=(user,household)=>`shared:${user}:${household}`;
export function useCloudAccount(){
  const [client,setClient]=useState(null);const [session,setSession]=useState(null);
  const [household,setHousehold]=useState(null);const [loading,setLoading]=useState(cloudConfigured);
  const [error,setError]=useState('');const generation=useRef(0);
  useEffect(()=>{let active=true;let unsubscribe;
    getCloudClient().then(async next=>{if(!active||!next)return;setClient(next);
      const subscription=next.auth.onAuthStateChange((_event,current)=>{if(active)setSession(current);});unsubscribe=()=>subscription.data.subscription.unsubscribe();
      const result=await next.auth.getSession();if(result.error)throw result.error;if(active){setSession(result.data.session);setLoading(false);}
    }).catch(e=>{if(active){setError(e.message);setLoading(false);}});
    return()=>{active=false;unsubscribe?.();};
  },[]);
  const userId=session?.user.id;
  useEffect(()=>{const request=++generation.current;setHousehold(null);if(!client)return;if(!userId){setLoading(false);return;}
    setLoading(true);setError('');
    (async()=>{
      const cached=await loadState(`account:${userId}`);if(request!==generation.current)return;
      if(cached?.household)setHousehold(cached.household);
      if(navigator.onLine){const result=await client.rpc('miao_my_household');if(result.error)throw result.error;
        if(request!==generation.current)return;setHousehold(result.data);await persistState({household:result.data},`account:${userId}`);}
    })().catch(e=>{if(request===generation.current)setError(e.message);}).finally(()=>{if(request===generation.current)setLoading(false);});
  },[client,userId]);
  const user=userId?{id:userId,name:'我'}:null;
  const api=client&&user?cloudAPI(client,user):null;
  async function select(id){await persistState({household:id},`account:${userId}`);setHousehold(id);setError('');}
  async function requestCode(kind,identity,captchaToken){
    if(!client)throw new Error('共享服务尚未开通');
    if(!(kind==='phone'?cloudConfig.phone:cloudConfig.email))throw new Error('这种登录方式尚未开通');
    const value=normalizeIdentity(kind,identity);
    if(cloudConfig.captcha&&!captchaToken)throw new Error('请先完成页面验证');
    const options=captchaToken?{captchaToken}:undefined;
    const result=await client.auth.signInWithOtp(kind==='phone'?{phone:value,options}:{email:value,options});
    if(result.error)throw new Error(result.error.message);return value;
  }
  async function verifyCode(kind,identity,token){
    if(!/^\d{6}$/.test(token))throw new Error('请输入收到的 6 位验证码');
    const result=await client.auth.verifyOtp(kind==='phone'?{phone:identity,token,type:'sms'}:{email:identity,token,type:'email'});
    if(result.error)throw new Error(result.error.message);
  }
  async function create(name,migrate){
    const id=await api.rpc('miao_create_household',{p_name:name});
    // Remember server membership before migration. A failed import can be retried
    // without accidentally creating a second household or losing local data.
    await persistState({household:id},`account:${userId}`);
    try{if(migrate){const local=await loadState();if(local?.profile){
      const engine=new SyncEngine({key:cloudKey(userId,id),store,api,user:{id:userId,name},household:id});
      await engine.init();await engine.pull();await engine.commit(()=>local);engine.dispose();
    }}}finally{setHousehold(id);setError('');}
    return id;
  }
  async function join(token,name){const id=await api.rpc('miao_join',{p_token:token.trim(),p_name:name});await select(id);return id;}
  async function signOut(){const result=await client.auth.signOut({scope:'local'});if(result.error)throw new Error(result.error.message);setHousehold(null);setSession(null);}
  return {configured:cloudConfigured,config:cloudConfig,client,session,user,household,loading,error,api,requestCode,verifyCode,create,join,signOut};
}
