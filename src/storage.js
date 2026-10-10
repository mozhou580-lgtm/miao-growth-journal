let dbPromise;
export function openDatabase() {
  if(!dbPromise) dbPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open('miao-growth-journal',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('journal');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('无法打开本机存储，请检查浏览器存储权限'));
    request.onblocked=()=>reject(new Error('存储被其他页面占用，请关闭旧页面后重试'));
  });
  return dbPromise;
}
export async function loadState(key='state') {
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('journal','readonly');const request=tx.objectStore('journal').get(key);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function persistState(state,key='state') {
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('journal','readwrite');tx.objectStore('journal').put(state,key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(new Error('保存失败，本机存储可能已满。输入仍保留，请先导出备份'));
    tx.onabort=()=>reject(new Error('记录未保存，请检查存储空间后重试'));
  });
}
export function download(content,name,type='application/json') {
  const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export async function mutateState(key,update){
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('journal','readwrite');const store=tx.objectStore('journal');const request=store.get(key);let next,problem;
    request.onsuccess=()=>{try{next=update(request.result);store.put(next,key);}catch(error){problem=error;tx.abort();}};
    tx.oncomplete=()=>resolve(next);
    tx.onerror=()=>reject(problem||new Error('保存失败，本机存储可能已满。输入仍保留，请先导出备份'));
    tx.onabort=()=>reject(problem||new Error('记录未保存，请检查存储空间后重试'));
  });
}
export function readDataURL(file) {return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('文件读取失败'));reader.readAsDataURL(file);});}
export async function prepareAsset(file) {
  if(file.size>5*1024*1024)throw new Error('每个附件请控制在 5MB 内');
  if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type))throw new Error('请选择 JPG、PNG、WebP 图片或 PDF 文件');
  const original=await readDataURL(file);
  if(file.type==='application/pdf')return {id:crypto.randomUUID(),name:file.name,mime:file.type,data:original};
  const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('图片无法读取'));image.src=original;});
  const ratio=Math.min(1,1400/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.round(img.naturalWidth*ratio);canvas.height=Math.round(img.naturalHeight*ratio);const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return {id:crypto.randomUUID(),name:file.name,mime:'image/jpeg',data:canvas.toDataURL('image/jpeg',0.84)};
}
