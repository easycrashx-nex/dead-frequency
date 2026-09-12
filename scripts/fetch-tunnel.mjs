import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await fs.readFile(path.join(root,'vendor/cloudflared.json'),'utf8'));
const target=path.join(root,'vendor/cloudflared.exe');
const valid=buffer=>buffer.length===manifest.size&&createHash('sha256').update(buffer).digest('hex')===manifest.sha256;
const existing=await fs.readFile(target).catch(()=>null);
if(existing&&valid(existing)){console.log('cloudflared: pinned binary verified');}
else{
  const response=await fetch(manifest.url,{signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw new Error(`Download HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(!valid(bytes))throw new Error('cloudflared checksum/size mismatch');
  await fs.writeFile(target+'.partial',bytes);await fs.rename(target+'.partial',target);
  console.log(`cloudflared ${manifest.version}: downloaded and SHA-256 verified`);
}
for(const name of ['LICENSE','NOTICE']){
  const response=await fetch(`https://raw.githubusercontent.com/cloudflare/cloudflared/${manifest.version}/${name}`,{signal:AbortSignal.timeout(15000)});
  if(response.ok)await fs.writeFile(path.join(root,`CLOUDFLARED-${name}.txt`),await response.text());
  else if(name==='LICENSE')throw new Error('Cloudflared license unavailable');
}
