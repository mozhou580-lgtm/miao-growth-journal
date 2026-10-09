import {useCallback,useEffect,useRef,useState} from 'react';
import {emptyState} from './model';
import {loadState,persistState} from './storage';
export function useJournal() {
  const [state,setState]=useState(emptyState);const [ready,setReady]=useState(false);const [error,setError]=useState('');const [saving,setSaving]=useState(false);const current=useRef(state);const queue=useRef(Promise.resolve());
  useEffect(()=>{let active=true;loadState().then(saved=>{if(!active)return;if(saved){if(saved.schemaVersion!==1||!Array.isArray(saved.records))throw new Error('本机记录版本不支持，请保留原数据');current.current=saved;setState(saved);}setReady(true);}).catch(e=>{if(active){setError(e.message);setReady(true);}});return()=>{active=false;};},[]);
  const commit=useCallback(update=>{
    const operation=queue.current.then(async()=>{setSaving(true);try{const next=update(current.current);await persistState(next);current.current=next;setState(next);return next;}finally{setSaving(false);}});
    queue.current=operation.catch(()=>{});return operation;
  },[]);
  return {state,ready,error,saving,commit};
}
