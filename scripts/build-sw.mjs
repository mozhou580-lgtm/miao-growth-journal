import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
async function list(dir,prefix=''){const entries=await readdir(dir,{withFileTypes:true});const result=[];for(const entry of entries){const name=prefix+entry.name;if(entry.isDirectory())result.push(...await list(`${dir}/${entry.name}`,`${name}/`));else if(name!=='sw.js')result.push(name);}return result;}
const base=process.env.APP_BASE_PATH||'/';
if(!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))throw new Error('APP_BASE_PATH must be an absolute path ending in /');
const files=await list('dist');const hash=createHash('sha256').update(base);for(const file of files)hash.update(await readFile(`dist/${file}`));const version=hash.digest('hex').slice(0,16);const assets=[base,...files.map(f=>`${base}${f}`)];
const prefix=`miao-journal-${createHash('sha256').update(base).digest('hex').slice(0,8)}-`;
const source=`const CACHE='${prefix}${version}';
const PREFIX=${JSON.stringify(prefix)};
const BASE=${JSON.stringify(base)};
const ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(BASE))return;
 if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match(BASE+'index.html',{ignoreVary:true}).then(result=>result||caches.match(BASE,{ignoreVary:true}))));
 else if(ASSETS.includes(new URL(event.request.url).pathname))event.respondWith(caches.match(event.request,{ignoreVary:true}).then(cached=>cached||fetch(event.request)));
});
`;
await writeFile('dist/sw.js',source);console.log(`Offline worker built: ${assets.length} resources, version ${version}`);
