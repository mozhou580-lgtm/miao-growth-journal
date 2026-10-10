import {readDataURL} from '../storage.js';
const BUCKET='miao-private';
const check=result=>{if(result.error)throw new Error(result.error.message);return result.data;};
const strip=value=>{const {authorName,editorName,createdBy,updatedBy,_cloudVersion,...rest}=value;return rest;};
export function cloudAPI(client,user){
  const assets=new Map();
  const rpc=async(name,args)=>check(await client.rpc(name,args));
  async function uploadAsset(household,asset){
    if(!asset)return null;
    if(asset.path?.startsWith(`${household}/`)){const {data,...reference}=asset;return reference;}
    const blob=await (await fetch(asset.data)).blob();
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
    const path=`${household}/${user.id}/${hash}`;
    if(assets.has(path))return {id:asset.id||hash,name:asset.name,mime:asset.mime||blob.type,path};
    const result=await client.storage.from(BUCKET).upload(path,blob,{contentType:asset.mime||blob.type,upsert:false});
    if(result.error&&String(result.error.statusCode)!=='409'){
      // A retry may encounter an already uploaded immutable file. Only accept it if readable.
      if(!/already exists|duplicate/i.test(result.error.message))throw new Error(result.error.message);
      check(await client.storage.from(BUCKET).download(path));
    }
    assets.set(path,asset.data);return {id:asset.id||hash,name:asset.name,mime:asset.mime||blob.type,path};
  }
  async function hydrateAsset(asset,localAssets){
    if(!asset)return null;if(asset.data)return asset;
    let data=assets.get(asset.path)||localAssets.get(asset.path);
    if(!data){const blob=check(await client.storage.from(BUCKET).download(asset.path));data=await readDataURL(blob);assets.set(asset.path,data);}
    return {...asset,data};
  }
  const localMap=state=>new Map([state.profile?.avatar,...state.records.flatMap(r=>r.assets||[])].filter(a=>a?.path&&a.data).map(a=>[a.path,a.data]));
  const decorate=(value,row,members)=>({...value,createdBy:row.createdBy,updatedBy:row.updatedBy,
    authorName:members.find(m=>m.id===row.createdBy)?.name||'共同记录者',editorName:members.find(m=>m.id===row.updatedBy)?.name||'共同记录者'});
  return {
    rpc,
    async snapshot(household,state){
      const snapshot=await rpc('miao_snapshot',{p_household:household});const localAssets=localMap(state);
      const [profile,records]=await Promise.all([
        snapshot.profile?hydrateAsset(snapshot.profile.avatar,localAssets).then(avatar=>({...snapshot.profile,avatar})):null,
        Promise.all(snapshot.records.map(async row=>({...row,value:decorate({...row.value,assets:await Promise.all(row.value.assets.map(a=>hydrateAsset(a,localAssets)))},row,snapshot.members)})))
      ]);return {...snapshot,profile,records};
    },
    async apply(household,op,state){
      let payload=op.value;
      if(op.kind==='record')payload={...strip(payload),assets:await Promise.all(payload.assets.map(a=>uploadAsset(household,a)))};
      if(op.kind==='profile')payload={...strip(payload),avatar:await uploadAsset(household,payload.avatar)};
      const result=await rpc('miao_apply',{p_household:household,p_operation:op.id,p_kind:op.kind,p_entity:op.entity,p_expected:op.expected,p_value:payload});
      const map=localMap(state);
      if(result.value&&op.kind==='record')result.value=decorate({...result.value,assets:await Promise.all(result.value.assets.map(a=>hydrateAsset(a,map)))},result,[{id:user.id,name:user.name},...(user.members||[])]);
      if(result.value&&op.kind==='profile')result.value={...result.value,avatar:await hydrateAsset(result.value.avatar,map)};
      return result;
    }
  };
}
