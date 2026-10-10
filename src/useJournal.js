import {useCallback,useEffect,useRef,useState} from 'react';
import {emptyState} from './model';
import {loadState,persistState,mutateState} from './storage';
import {SyncEngine} from './cloud/sync';
import {cloudAPI} from './cloud/api';
import {cloudKey} from './cloud/useCloudAccount';
const store={load:loadState,save:(key,value)=>persistState(value,key),mutate:mutateState};
export function useJournal(cloud) {
  const [state,setState]=useState(emptyState);const [ready,setReady]=useState(false);const [error,setError]=useState('');const [saving,setSaving]=useState(false);
  const [sync,setSync]=useState(null);const engineRef=useRef(null);
  const userId=cloud?.user?.id,household=cloud?.household,client=cloud?.client;
  useEffect(()=>{let active=true;setReady(false);setError('');setSync(null);
    const shared=Boolean(userId&&household&&client);
    const engine=new SyncEngine({key:shared?cloudKey(userId,household):'state',store,
      api:shared?cloudAPI(client,{id:userId,name:'我'}):null,user:shared?{id:userId,name:'我'}:null,household,
      onChange:(doc,networkError,running)=>{if(active){setState(doc.state);if(shared)setSync({pending:doc.outbox.length,conflicts:doc.conflicts,members:doc.members,ownerId:doc.ownerId,lastSyncedAt:doc.lastSyncedAt,error:networkError,running});}}
    });engineRef.current=engine;
    engine.init().then(async()=>{
      if(shared&&!engine.hadCache){await engine.pull();if(!engine.doc.state.profile&&engine.doc.members.length===0)throw new Error('共享档案暂时无法打开，请联网重试');}
      if(active)setReady(true);if(shared&&navigator.onLine)void engine.sync();
    }).catch(e=>{if(active){setError(e.message);setReady(true);}});
    const refresh=()=>{if(shared&&navigator.onLine&&document.visibilityState!=='hidden')void engine.sync();};
    const interval=shared?setInterval(refresh,15000):null;
    window.addEventListener('online',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;engine.dispose();clearInterval(interval);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[userId,household,client]);
  const commit=useCallback(update=>{
    if(!engineRef.current)return Promise.reject(new Error('记录正在打开，请稍后重试'));
    setSaving(true);return engineRef.current.commit(update).then(next=>{if(navigator.onLine)void engineRef.current.sync();return next;}).finally(()=>setSaving(false));
  },[]);
  const resolveConflict=useCallback(async(key,choice)=>{await engineRef.current.resolve(key,choice);if(navigator.onLine)void engineRef.current.sync();},[]);
  const syncNow=useCallback(()=>engineRef.current?.sync(),[]);
  return {state,ready,error,saving,commit,sync,syncNow,resolveConflict};
}
