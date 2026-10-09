import {readFile,access} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.APP_BASE_PATH||'/';
const html=await readFile('dist/index.html','utf8');
const manifest=JSON.parse(await readFile('dist/manifest.webmanifest','utf8'));
const worker=await readFile('dist/sw.js','utf8');
const assets=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match=>match[1]);
assert(assets.length>=5,'HTML must contain app and install assets');
for(const asset of assets){assert(asset.startsWith(base),`Asset outside app path: ${asset}`);await access(`dist/${asset.slice(base.length)}`);}
assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
for(const icon of manifest.icons){assert(!icon.src.startsWith('/'));await access(`dist/${icon.src}`);}
assert(worker.includes(`const BASE=${JSON.stringify(base)}`));
assert(worker.includes(`${base}index.html`));
assert(!html.includes('%BASE_URL%'));
console.log(`Build paths and install assets verified for ${base}`);
