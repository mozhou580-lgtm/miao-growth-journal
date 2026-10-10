import {emptyState} from '../model.js';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const entityKey=op=>op.kind==='record'?`record:${op.entity}`:op.kind;
const read=(state,kind,id)=>kind==='record'?state.records.find(r=>r.id===id):kind==='profile'?state.profile:state.budgetCents;
const write=(state,kind,id,value)=>kind==='record'?{...state,records:[...state.records.filter(r=>r.id!==id),...(value?[value]:[])]}:
  kind==='profile'?{...state,profile:value}:{...state,budgetCents:value};
const fresh=()=>({schemaVersion:1,state:emptyState(),versions:{},outbox:[],conflicts:[],lastSyncedAt:null,members:[],ownerId:null});

// Every operation and its local view are committed in one IndexedDB transaction.
// Operations are never dropped until the server acknowledges their stable UUID.
export class SyncEngine {
  constructor({key,store,api=null,user=null,household=null,onChange=()=>{}}){
    Object.assign(this,{key,store,api,user,household,onChange});this.doc=fresh();this.queue=Promise.resolve();this.running=null;this.disposed=false;this.networkError='';
  }
  emit(){if(!this.disposed)this.onChange(this.doc,this.networkError,Boolean(this.running));}
  async init(){
    const saved=await this.store.load(this.key);this.hadCache=Boolean(saved);
    if(saved){if(this.api){if(saved.schemaVersion!==1||!Array.isArray(saved.outbox))throw new Error('共享缓存版本不支持，请保留原数据');this.doc=saved;}
      else{if(saved.schemaVersion!==1||!Array.isArray(saved.records))throw new Error('本机记录版本不支持，请保留原数据');this.doc.state=saved;}}
    this.emit();return this.doc;
  }
  update(fn){
    const job=this.queue.then(async()=>{
      let next;
      if(this.store.mutate){const saved=await this.store.mutate(this.key,latest=>{
        const current=latest?(this.api?latest:{...this.doc,state:latest}):this.doc;
        next=fn(current);return this.api?next:next.state;
      });if(this.api)next=saved;else next={...next,state:saved};}
      else{next=fn(this.doc);await this.store.save(this.key,this.api?next:next.state);}
      this.doc=next;this.emit();return next;
    });
    this.queue=job.catch(()=>{});return job;
  }
  commit(update){return this.update(doc=>{
    let state=update(doc.state);const outbox=[...doc.outbox];
    if(this.api){
      const append=(kind,entity,value,expectedOverride)=>{
        const key=kind==='record'?`record:${entity}`:kind;
        const pending=outbox.filter(op=>entityKey(op)===key);
        const expected=expectedOverride??((doc.versions[key]||0)+pending.length);
        outbox.push({id:crypto.randomUUID(),kind,entity,value,expected});return expected+1;
      };
      if(!same(state.profile,doc.state.profile)&&state.profile){const revision=append('profile','profile',state.profile,doc.state.profile?state.profile._cloudVersion:undefined);state={...state,profile:{...state.profile,_cloudVersion:revision}};}
      if(!same(state.budgetCents,doc.state.budgetCents)){const revision=append('budget','budget',state.budgetCents,doc.versions.budget!==undefined?state._budgetVersion:undefined);state={...state,_budgetVersion:revision};}
      const old=new Map(doc.state.records.map(r=>[r.id,r]));
      state={...state,records:state.records.map(r=>{
        if(same(r,old.get(r.id)))return r;
        const name=doc.members.find(member=>member.id===this.user.id)?.name||this.user.name;
        const value={...r,createdBy:old.get(r.id)?.createdBy||this.user.id,updatedBy:this.user.id,
          authorName:old.get(r.id)?.authorName||name,editorName:name};
        const revision=append('record',r.id,value,old.has(r.id)?r._cloudVersion:undefined);return {...value,_cloudVersion:revision};
      })};
    }
    return {...doc,state,outbox};
  }).then(doc=>doc.state);}
  async pull(){
    const snapshot=await this.api.snapshot(this.household,this.doc.state);
    await this.update(doc=>{
      const dirty=new Set(doc.outbox.map(entityKey));let state=doc.state;const versions={...doc.versions};
      if(!dirty.has('profile')&&snapshot.profileVersion>=(versions.profile||0)){state={...state,profile:snapshot.profile?{...snapshot.profile,_cloudVersion:snapshot.profileVersion}:null};versions.profile=snapshot.profileVersion;}
      if(!dirty.has('budget')&&snapshot.budgetVersion>=(versions.budget||0)){state={...state,budgetCents:snapshot.budgetCents,_budgetVersion:snapshot.budgetVersion};versions.budget=snapshot.budgetVersion;}
      for(const row of snapshot.records){const key=`record:${row.value.id}`;if(!dirty.has(key)&&row.version>=(versions[key]||0)){state=write(state,'record',row.value.id,{...row.value,_cloudVersion:row.version});versions[key]=row.version;}}
      return {...doc,state,versions,members:snapshot.members,ownerId:snapshot.ownerId,lastSyncedAt:new Date().toISOString()};
    });
  }
  sync(){
    if(!this.api||this.disposed)return Promise.resolve();if(this.running)return this.running;
    this.running=(async()=>{
      try{
        await this.queue;const latest=await this.store.load(this.key);if(latest){this.doc=latest;this.emit();}
        while(!this.disposed){
          const blocked=new Set(this.doc.conflicts.map(c=>c.key));
          const op=this.doc.outbox.find(candidate=>!blocked.has(entityKey(candidate)));if(!op)break;
          const result=await this.api.apply(this.household,op,this.doc.state);
          await this.update(doc=>{
            if(!doc.outbox.some(item=>item.id===op.id))return doc;
            const key=entityKey(op);
            const value=op.kind==='budget'?result.value:result.value?{...result.value,_cloudVersion:result.version}:null;
            if(result.status==='conflict')return {...doc,conflicts:[...doc.conflicts.filter(c=>c.key!==key),{key,kind:op.kind,entity:op.entity,remote:value,version:result.version}]};
            const outbox=doc.outbox.filter(item=>item.id!==op.id);
            // A subsequent edit remains visible while the earlier operation is acknowledged.
            let state=outbox.some(item=>entityKey(item)===key)?doc.state:write(doc.state,op.kind,op.entity,value);
            if(op.kind==='budget'&&!outbox.some(item=>entityKey(item)===key))state={...state,_budgetVersion:result.version};
            return {...doc,state,outbox,versions:{...doc.versions,[key]:result.version},lastSyncedAt:new Date().toISOString()};
          });
        }
        if(!this.disposed)await this.pull();this.networkError='';
      }catch(error){this.networkError=error.message||'同步失败，请联网重试';}
      finally{this.running=null;this.emit();}
    })();this.emit();return this.running;
  }
  resolve(key,choice){return this.update(doc=>{
    const conflict=doc.conflicts.find(c=>c.key===key);if(!conflict)throw new Error('冲突状态已变化，请重试');
    let outbox=doc.outbox.filter(op=>entityKey(op)!==key);let state=doc.state;
    if(choice==='local'){
      const value=read(state,conflict.kind,conflict.entity);
      state=write(state,conflict.kind,conflict.entity,conflict.kind==='budget'?value:{...value,_cloudVersion:conflict.version+1});
      if(conflict.kind==='budget')state={...state,_budgetVersion:conflict.version+1};
      outbox.push({id:crypto.randomUUID(),kind:conflict.kind,entity:conflict.entity,expected:conflict.version,value});
    }else if(choice==='remote'){
      state=write(state,conflict.kind,conflict.entity,conflict.remote);
      if(conflict.kind==='budget')state={...state,_budgetVersion:conflict.version};
    }
    else throw new Error('请选择要保留的版本');
    return {...doc,state,outbox,versions:{...doc.versions,[key]:conflict.version},conflicts:doc.conflicts.filter(c=>c.key!==key)};
  });}
  dispose(){this.disposed=true;}
}
