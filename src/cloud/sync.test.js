import test from 'node:test';
import assert from 'node:assert/strict';
import {SyncEngine} from './sync.js';
const profile={id:'cat',name:'猫咪',birthday:'2026-06-01'};
const expense=(id,cents)=>({id,type:'expense',cents,category:'食物',day:'2026-10-10',at:'2026-10-10T00:00:00Z',updatedAt:'2026-10-10T00:00:00Z',assets:[]});
function fixture(){
  const disk=new Map();let online=true,loseResponse=false;
  const server={profile,profileVersion:1,budgetCents:null,budgetVersion:0,members:[{id:'a',name:'George'},{id:'b',name:'小圆'}],ownerId:'a',records:[]};const receipts=new Map();
  const store={load:async key=>structuredClone(disk.get(key)),save:async(key,value)=>{disk.set(key,structuredClone(value));}};
  const api={snapshot:async()=>{if(!online)throw new Error('offline');return structuredClone(server);},apply:async(_household,op)=>{
    if(!online)throw new Error('offline');if(receipts.has(op.id))return structuredClone(receipts.get(op.id));
    const row=server.records.find(r=>r.value.id===op.entity);const version=op.kind==='record'?row?.version||0:server[`${op.kind}Version`];
    const value=op.kind==='record'?row?.value:op.kind==='budget'?server.budgetCents:server.profile;
    if(version!==op.expected)return {status:'conflict',version,value:structuredClone(value)};
    const result={status:'applied',version:version+1,value:structuredClone(op.value)};
    if(op.kind==='record'){server.records=server.records.filter(r=>r.value.id!==op.entity);server.records.push({value:structuredClone(op.value),version:result.version});}
    else{server[op.kind==='profile'?'profile':'budgetCents']=structuredClone(op.value);server[`${op.kind}Version`]=result.version;}
    receipts.set(op.id,result);if(loseResponse){loseResponse=false;throw new Error('response lost');}return structuredClone(result);
  }};
  const make=id=>new SyncEngine({key:`${id}:household`,store,api,user:{id,name:id==='a'?'George':'小圆'},household:'household'});
  return {make,server,disk,api,store,setOnline:value=>{online=value;},loseNext:()=>{loseResponse=true;}};
}
test('two devices append different records without losing either; attribution survives',async()=>{
  const f=fixture(),a=f.make('a'),b=f.make('b');await a.init();await a.pull();await b.init();await b.pull();
  await a.commit(s=>({...s,records:[...s.records,expense('one',1999)]}));await b.commit(s=>({...s,records:[...s.records,expense('two',2000)]}));
  await a.sync();await b.sync();await a.sync();assert.equal(a.doc.state.records.length,2);assert.equal(b.doc.state.records.length,2);
  assert.equal(a.doc.state.records.reduce((sum,r)=>sum+r.cents,0),3999);assert.equal(a.doc.state.records.find(r=>r.id==='two').authorName,'小圆');
});
test('offline queue survives close/reopen and lost acknowledgements retry once',async()=>{
  const f=fixture();let a=f.make('a');await a.init();await a.pull();f.setOnline(false);
  await a.commit(s=>({...s,records:[expense('offline',1999)]}));await a.sync();assert.equal(a.doc.outbox.length,1);a.dispose();
  a=f.make('a');await a.init();assert.equal(a.doc.outbox.length,1);f.setOnline(true);f.loseNext();await a.sync();assert.equal(a.doc.outbox.length,1);
  await a.sync();assert.equal(a.doc.outbox.length,0);assert.equal(f.server.records.length,1);assert.equal(f.server.records[0].version,1);
});
test('same-record conflicts preserve local edits and require explicit resolution',async()=>{
  const f=fixture(),a=f.make('a'),b=f.make('b');await a.init();await a.pull();await a.commit(s=>({...s,records:[expense('one',1999)]}));await a.sync();await b.init();await b.pull();
  await a.commit(s=>({...s,records:[{...s.records[0],cents:2999}]}));await b.commit(s=>({...s,records:[{...s.records[0],cents:3999}]}));
  await a.sync();await b.sync();assert.equal(b.doc.conflicts.length,1);assert.equal(b.doc.state.records[0].cents,3999);assert.equal(b.doc.conflicts[0].remote.cents,2999);
  await b.resolve('record:one','local');await b.sync();assert.equal(b.doc.conflicts.length,0);assert.equal(f.server.records[0].value.cents,3999);
  await a.sync();assert.equal(a.doc.state.records[0].cents,3999);
});
test('a new local edit during upload is kept and correctly rebased in sequence',async()=>{
  const f=fixture(),a=f.make('a');await a.init();await a.pull();await a.commit(s=>({...s,records:[expense('one',1999)]}));
  const original=f.api.apply;let release;const gate=new Promise(resolve=>{release=resolve;});let started;const start=new Promise(resolve=>{started=resolve;});
  let once=true;f.api.apply=async(...args)=>{if(once){once=false;started();await gate;}return original(...args);};
  const running=a.sync();await start;await a.commit(s=>({...s,records:[{...s.records[0],cents:2999}]}));release();await running;
  assert.equal(a.doc.outbox.length,0);assert.equal(a.doc.state.records[0].cents,2999);assert.equal(f.server.records[0].version,2);
});
test('failed durable writes preserve input/state and do not upload; local and account stores are isolated',async()=>{
  const f=fixture(),a=f.make('a');await a.init();await a.pull();const saved=f.store.save;f.store.save=async()=>{throw new Error('quota exceeded');};
  await assert.rejects(()=>a.commit(s=>({...s,records:[expense('failed',1999)]})),/quota/);assert.equal(a.doc.state.records.length,0);assert.equal(f.server.records.length,0);
  f.store.save=saved;const local=new SyncEngine({key:'state',store:f.store});await local.init();await local.commit(s=>({...s,profile,records:[expense('local',10)]}));
  const b=f.make('b');await b.init();assert.equal(b.doc.state.profile,null);assert.equal(b.doc.outbox.length,0);assert.equal(f.disk.get('state').records.length,1);
});
test('editing an already open stale form cannot silently overwrite a newer remote revision',async()=>{
  const f=fixture(),a=f.make('a'),b=f.make('b');await a.init();await a.pull();await a.commit(s=>({...s,records:[expense('one',1999)]}));await a.sync();await b.init();await b.pull();
  const staleForm=structuredClone(b.doc.state.records[0]);
  await a.commit(s=>({...s,records:[{...s.records[0],cents:2999}]}));await a.sync();await b.sync();
  assert.equal(b.doc.state.records[0]._cloudVersion,2);
  await b.commit(s=>({...s,records:[{...staleForm,cents:3999}]}));await b.sync();assert.equal(b.doc.conflicts.length,1);assert.equal(f.server.records[0].value.cents,2999);
  await b.resolve('record:one','remote');assert.equal(b.doc.state.records[0].cents,2999);assert.equal(b.doc.outbox.length,0);
});
test('two tabs on the same account use an atomic durable transaction and retain both pending records',async()=>{
  const f=fixture();let queue=Promise.resolve();f.store.mutate=(key,fn)=>{const next=queue.then(()=>{const value=fn(structuredClone(f.disk.get(key)));f.disk.set(key,structuredClone(value));return structuredClone(value);});queue=next.catch(()=>{});return next;};
  const a=f.make('a'),tab=f.make('a');await a.init();await a.pull();await tab.init();
  await Promise.all([a.commit(s=>({...s,records:[...s.records,expense('tab-one',1999)]})),tab.commit(s=>({...s,records:[...s.records,expense('tab-two',2000)]}))]);
  assert.equal(f.disk.get('a:household').outbox.length,2);await a.sync();await tab.sync();assert.equal(f.server.records.length,2);assert.equal(tab.doc.outbox.length,0);
});
