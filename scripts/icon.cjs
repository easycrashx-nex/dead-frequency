const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const size=256,raw=Buffer.alloc((size*4+1)*size);
const segment=(x,y,ax,ay,bx,by,width)=>{const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));return Math.hypot(x-ax-t*dx,y-ay-t*dy)<width;};
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=y*(size*4+1)+1+x*4;let c=[16,25,27];
  if(x>16&&x<240&&y>16&&y<240&&(x<19||x>236||y<19||y>236))c=[88,92,76];
  if(segment(x,y,59,174,126,64,10)||segment(x,y,126,64,171,137,10)||segment(x,y,106,175,151,103,9))c=[237,120,56];
  if(segment(x,y,166,169,190,130,8))c=[239,227,208];
  if(x>48&&x<208&&y>205&&y<209)c=[237,120,56];
  raw[i]=c[0];raw[i+1]=c[1];raw[i+2]=c[2];raw[i+3]=255;
}
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type,data){const t=Buffer.from(type),payload=Buffer.concat([t,data]);let crc=0xffffffff;for(const byte of payload)crc=table[(crc^byte)&255]^(crc>>>8);const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);payload.copy(out,4);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;}
const hdr=Buffer.alloc(13);hdr.writeUInt32BE(size,0);hdr.writeUInt32BE(size,4);hdr[8]=8;hdr[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',hdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);
fs.writeFileSync(path.join(__dirname,'../public/icon.ico'),Buffer.concat([ico,png]));fs.writeFileSync(path.join(__dirname,'../public/icon.png'),png);
