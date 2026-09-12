// Static world view: geometry is merged by material inside 100 m spatial cells.
// Terrain LOD and object range culling never change the authoritative collision mesh.
import * as THREE from 'three';
import {WORLD_SIZE,TERRAIN_STEP,getGroundHeight,riverCenter,WATER_LEVEL,ROADS,SETTLEMENTS,roadDistance,isWater} from './terrain.js';
import {vehicleSolids} from './world-layout.js';
const TILE=100;
export function buildWideWorld(scene,layout,mats,{makeBatch,signTexture}) {
 const group=new THREE.Group();scene.add(group);const chunks=new Map(),terrainTiles=[];
 const chunkAt=(x,z)=>{const key=`${Math.floor(x/TILE)}:${Math.floor(z/TILE)}`;if(!chunks.has(key)){const root=new THREE.Group();root.userData.center={x:(Math.floor(x/TILE)+.5)*TILE,z:(Math.floor(z/TILE)+.5)*TILE};group.add(root);chunks.set(key,{root,batch:makeBatch(root)});}return chunks.get(key);};
 const b={box:(m,p,s,r)=>chunkAt(p[0],p[2]).batch.box(m,p,s,r),cylinder:(m,p,...args)=>chunkAt(p[0],p[2]).batch.cylinder(m,p,...args),beam:(m,a,c,r)=>chunkAt((a[0]+c[0])/2,(a[2]+c[2])/2).batch.beam(m,a,c,r)};
 const material=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.88,metalness:.06,...extra});
 const wall=material('#c6ccba',{map:mats.concrete.map,emissive:'#a3baa9',emissiveIntensity:.13});
 const ceiling=material('#a8b6a4',{emissive:'#adc4ab',emissiveIntensity:.17});
 const floor=material('#768477',{map:mats.concrete.map,emissive:'#819878',emissiveIntensity:.12});
 const glow=material('#fff1cd',{emissive:'#fff0bc',emissiveIntensity:2.1});
 const asphalt=material('#404c45'),terrainMat=material('#ffffff',{vertexColors:true,map:mats.concrete.map});
 const entrance=material('#d7e9d2',{map:signTexture('EINGANG','OFFEN / DURCHGANG','#d7ebcd','#29433a'),emissive:'#82b294',emissiveIntensity:.2});
 const stairSign=material('#dfdcb9',{map:signTexture('OBERGESCHOSS','TREPPE / ZUGANG FREI','#dfdbc3','#344139')});
 const colors={residential:material('#b59a78'),farm:material('#a78863'),military:mats.blue,workshop:mats.metal,warehouse:mats.blue};
 const signCache=new Map();
 function sign(text,subtitle,x,y,z,w=3.4,h=.68,yaw=0){const key=`${text}|${subtitle}`;let mat=signCache.get(key);if(!mat){mat=material('#eadfbf',{map:signTexture(text,subtitle)});signCache.set(key,mat);}b.box(mat,[x,y,z],[w,h,.025],[0,yaw,0]);}
 function surfaceGeometry(x,z,size,step){
  const n=Math.round(size/step)+1,positions=[],colors=[],uv=[],indices=[];const grass=new THREE.Color(),rock=new THREE.Color('#8b8d7d'),low=new THREE.Color('#637c53'),core=new THREE.Color('#6b766a');
  for(let iz=0;iz<n;iz++)for(let ix=0;ix<n;ix++){const px=x+ix*step,pz=z+iz*step,y=getGroundHeight(px,pz);positions.push(px,y,pz);uv.push(px*.28,pz*.28);const slope=Math.max(Math.abs(getGroundHeight(px+2,pz)-getGroundHeight(px-2,pz)),Math.abs(getGroundHeight(px,pz+2)-getGroundHeight(px,pz-2)));grass.copy(low).lerp(rock,Math.min(1,Math.max((y-35)/75,slope*.24)));if(Math.max(Math.abs(px),Math.abs(pz))<155)grass.copy(core);else{for(const town of SETTLEMENTS)if(Math.abs(px-town.x)<town.w/2+5&&Math.abs(pz-town.z)<town.d/2+5){grass.copy(core);break;}}grass.multiplyScalar(.94+.06*Math.sin(px*.23+pz*.17));colors.push(grass.r,grass.g,grass.b);}
  for(let iz=0;iz<n-1;iz++)for(let ix=0;ix<n-1;ix++){const a=iz*n+ix,c=a+n;indices.push(a,c,a+1,a+1,c,c+1);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();geo.computeBoundingSphere();return geo;
 }
 for(let z=-WORLD_SIZE/2;z<WORLD_SIZE/2;z+=TILE)for(let x=-WORLD_SIZE/2;x<WORLD_SIZE/2;x+=TILE){
  const near=new THREE.Mesh(surfaceGeometry(x,z,TILE,TERRAIN_STEP),terrainMat),far=new THREE.Mesh(surfaceGeometry(x,z,TILE,20),terrainMat);near.receiveShadow=true;far.receiveShadow=true;group.add(near,far);terrainTiles.push({near,far,x:x+TILE/2,z:z+TILE/2});
 }
 // Roads follow the physical terrain. No flat road boxes conceal slopes.
 function ribbon(a,c,width,mat,offset=.022,skipWater=true){const dx=c.x-a.x,dz=c.z-a.z,len=Math.hypot(dx,dz),n=Math.ceil(len/4),sx=dz/len*width/2,sz=-dx/len*width/2;
  for(let i=0;i<n;i++){const t=i/n,u=(i+1)/n,mx=a.x+dx*(t+u)/2,mz=a.z+dz*(t+u)/2;if(skipWater&&isWater(mx,mz))continue;const p=[a.x+dx*t-sx,a.z+dz*t-sz,a.x+dx*t+sx,a.z+dz*t+sz,a.x+dx*u-sx,a.z+dz*u-sz,a.x+dx*u+sx,a.z+dz*u+sz],v=[];for(let j=0;j<8;j+=2)v.push(p[j],getGroundHeight(p[j],p[j+1])+offset,p[j+1]);const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(v,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1,1,1],2));geo.setIndex([0,2,1,1,2,3]);geo.computeVertexNormals();const mesh=new THREE.Mesh(geo,mat);mesh.receiveShadow=true;const chunk=chunkAt(mx,mz);(chunk.ribbons??=[]).push(mesh);}
 }
 for(const r of ROADS){ribbon(r.a,r.b,13,asphalt);const len=Math.hypot(r.b.x-r.a.x,r.b.z-r.a.z);for(let dist=0;dist<len;dist+=9){const a=dist/len,c=Math.min(1,(dist+3.4)/len);ribbon({x:r.a.x+(r.b.x-r.a.x)*a,z:r.a.z+(r.b.z-r.a.z)*a},{x:r.a.x+(r.b.x-r.a.x)*c,z:r.a.z+(r.b.z-r.a.z)*c},.14,mats.paint,.035);}}
 for(const town of SETTLEMENTS){ribbon({x:town.x,z:town.z-town.d/2-10},{x:town.x,z:town.z+town.d/2+10},14,asphalt);ribbon({x:town.x-town.w/2+3,z:town.z},{x:town.x+town.w/2-3,z:town.z},12,asphalt);}
 for(let z=-146;z<150;z+=7)for(const x of[0,-17,17,-64,64])if(!layout.obstacles.some(o=>Math.abs(x-o.x)<o.w/2+1&&Math.abs(z-o.z)<o.d/2+1))b.box(mats.paint,[x,.014,z],[.12,.014,2.7]);
 // A continuous river surface follows its meandering bed; bridges remain dry.
 const waterMat=material('#457a78',{metalness:.42,roughness:.27,transparent:true,opacity:.83,side:THREE.DoubleSide});
 for(let z=-750;z<750;z+=100){const positions=[],indices=[];for(let i=0;i<=20;i++){const pz=z+i*5,x=riverCenter(pz);positions.push(x-36,WATER_LEVEL,pz,x+36,WATER_LEVEL,pz);}for(let i=0;i<20;i++){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();const mesh=new THREE.Mesh(g,waterMat);chunkAt(riverCenter(z+50),z+50).root.add(mesh);}
 // Real interior solids, including stair treads and separately cut floor slabs.
 for(const room of layout.interiors||[]){
  const {x,z,w,d,baseY=0,levels=1,floorHeight=4}=room,accent=colors[room.type]||mats.blue;
  for(const s of room.solids){b.box(s.kind==='fixture'?mats.metal:s.kind==='floor'||s.kind==='ceiling'?ceiling:s.kind==='stair'?mats.darkConcrete:s.kind==='railing'?mats.darkMetal:wall,[s.x,s.y,s.z],[s.w,s.h,s.d]);
   if(s.kind==='fixture') {const side=s.z<z?1:-1,front=s.z+side*(s.d/2+.015);for(let y=s.y-s.h/2+.35;y<s.y+s.h/2;y+=.5)b.box(mats.darkMetal,[s.x,y,front],[s.w*.77,.028,.02]);b.box(mats.edge,[s.x,s.y+.1,front+side*.02],[Math.min(.23,s.w*.3),.045,.04]);if(s.style==='desk'){b.box(mats.black,[s.x,s.y+s.h/2+.19,s.z-.2],[.7,.38,.05]);b.box(mats.glow,[s.x,s.y+s.h/2+.2,s.z-.164],[.59,.27,.014]);}}
   if(s.kind==='stair')b.box(mats.paint,[s.x,s.y+s.h/2+.007,s.z-s.d/2+.023],[s.w-.06,.012,.045]);
   if(s.kind==='wall'){const level=Math.max(0,Math.floor((s.y-baseY)/floorHeight)),bottom=Math.max(s.y-s.h/2,baseY+level*floorHeight+.05),top=Math.min(s.y+s.h/2,baseY+level*floorHeight+1.05);if(top>bottom){const longX=s.w>s.d,side=longX?(s.z<z?1:-1):(s.x<x?1:-1);b.box(accent,[s.x+(longX?0:side*(s.w/2+.006)),(bottom+top)/2,s.z+(longX?side*(s.d/2+.006):0)],longX?[s.w,top-bottom,.012]:[.012,top-bottom,s.d]);}}
  }
  for(const f of room.floors||[{x,z,y:baseY,w:w-.72,d:d-.72}])b.box(floor,[f.x,f.y+.007,f.z],[f.w,.012,f.d]);
  for(let level=0;level<levels;level++){
   const y=baseY+level*floorHeight,ceil=level<levels-1?y+floorHeight-.25:room.roofY;
   for(const side of[-1,1])for(let dz=-d/2+2.3;dz<d/2-1;dz+=5){const lx=x+side*w*.25;if(room.stairs?.some(s=>Math.abs(lx-s.start.x)<1.5&&dz>-4.5&&dz<4.2))continue;b.box(mats.darkMetal,[lx,ceil-.13,z+dz],[1.6,.15,.32]);b.box(glow,[lx,ceil-.213,z+dz],[1.4,.018,.23]);}
   // Window panels sit on real walls; no window or trim covers an open door.
   for(const side of[-1,1])for(let dx=-w/2+2;dx<w/2-1;dx+=3.3){if(level===0&&Math.abs(dx)<2.8)continue;const wz=z+side*(d/2+.016);b.box(mats.darkMetal,[x+dx,y+2.12,wz],[1.8,1.27,.03]);b.box(mats.glass,[x+dx,y+2.12,wz+side*.024],[1.56,1.03,.018]);b.box(mats.edge,[x+dx,y+2.12,wz+side*.04],[.045,1.08,.02]);}
  }
  for(const door of room.doors){const signZ=door.side==='north'?-1:1,y=door.y||0;for(const side of[-1,1]){b.box(mats.darkMetal,[door.x+side*(door.width/2+.06),y+1.5,door.z],[.12,3,.4]);b.box(mats.orange,[door.x+side*(door.width/2+.06),y+1.5,door.z+signZ*.22],[.085,2.94,.035]);}b.box(entrance,[door.x,y+3.22,door.z+signZ*.2],[1.9,.28,.028],[0,signZ<0?Math.PI:0,0]);}
  sign(room.name.replace(/ \d+$/,''),`${levels} ETAGE${levels>1?'N':''} / NORDWERK`,x,baseY+3.62,z+d/2+.05,Math.min(w-1,4.3),.53);
  if(room.stairs?.length)b.box(stairSign,[room.stairs[0].start.x-1.45,baseY+1.8,room.stairs[0].start.z],[1.2,.55,.035]);
 }
 const containerMaterials=new Map();
 for(const o of layout.obstacles||[]){if(o.kind==='building')continue;const {x,z,w,d,h}=o,y=o.baseY||0;
  if(o.kind==='tree'){b.box(mats.rust,[x,y+h/2,z],[w,h,d]);b.cylinder(mats.leaf,[x,y+h*.77,z],o.crown,h*.65,0,[0,0,0],7);b.cylinder(mats.leaf,[x,y+h*.62,z],o.crown*1.16,h*.6,.3,[0,0,0],7);
  }else if(o.kind==='rock'){b.box(mats.darkConcrete,[x,y+h/2,z],[w,h,d]);b.box(mats.concrete,[x,y+h-.12,z],[w-.05,.24,d-.05]);
  }else if(o.kind==='tank'){
   // Rectangular tank housing exactly fills the AABB; cylinders live inside it.
   b.box(mats.darkConcrete,[x,y+h/2,z],[w,h,d]);for(const side of[-1,1]){b.box(mats.metal,[x,y+h*.55,z+side*(d/2+.008)],[w-.1,h*.82,.016]);for(let dx=-w/2+.3;dx<w/2;dx+=.7)b.box(mats.edge,[x+dx,y+h*.5,z+side*(d/2+.023)],[.055,h*.85,.024]);}b.cylinder(mats.pale,[x,y+h-.2,z],Math.min(w,d)*.46,.4,Math.min(w,d)*.43);sign('TANKANLAGE','DRUCK / GESCHLOSSEN',x,y+h*.45,z+d/2+.05,Math.min(2.6,w*.7),.5);
  }else{
   let mat=mats.metal;if(o.color){if(!containerMaterials.has(o.color))containerMaterials.set(o.color,material(o.color,{metalness:.24}));mat=containerMaterials.get(o.color);}if(o.kind==='barrier')mat=mats.darkConcrete;b.box(mat,[x,y+h/2,z],[w,h,d]);
   if(o.kind==='container'){const longZ=d>w,len=longZ?d:w;for(let n=-len/2+.24;n<len/2;n+=.55)for(const side of[-1,1])b.box(mat,longZ?[x+side*(w/2+.017),y+h/2,z+n]:[x+n,y+h/2,z+side*(d/2+.017)],longZ?[.034,h-.22,.08]:[.08,h-.22,.034]);for(const side of[-1,1])b.box(mats.darkMetal,[x+side*w*.27,y+h/2,z+d/2+.03],[.045,h-.18,.045]);}
   else for(const side of[-1,1])b.box(mats.orange,[x+side*w*.31,y+h*.6,z+d/2+.017],[Math.min(.24,w*.15),h*.32,.025]);
  }
 }
 for(const s of layout.walls||[]){b.box(mats.darkConcrete,[s.x,s.y,s.z],[s.w,s.h,s.d]);b.box(mats.pale,[s.x,s.y+s.h/2-.1,s.z],[s.w,.2,s.d]);const alongX=s.w>s.d,len=alongX?s.w:s.d;for(let t=-len/2+3;t<len/2;t+=6)b.box(mats.concrete,[s.x+(alongX?t:0),s.y,s.z+(alongX?0:t)],alongX?[.35,s.h+.04,s.d+.12]:[s.w+.12,s.h+.04,.35]);}
 for(const town of SETTLEMENTS)for(const side of[-1,1])sign(town.name,'SPERRBEZIRK / ZUGANG',town.x+10,town.y+2.7,town.z+side*(town.d/2+.6),4.9,.8,side<0?Math.PI:0);
 for(const bridge of layout.bridges||[]){for(const s of bridge.solids)b.box(s.kind==='bridge-rail'?mats.darkMetal:mats.darkConcrete,[s.x,s.y,s.z],[s.w,s.h,s.d]);for(let dx=-bridge.w/2+3;dx<bridge.w/2;dx+=7)b.box(mats.paint,[bridge.x+dx,bridge.y+.008,bridge.z],[3,.014,.14]);for(const side of[-1,1])sign(bridge.name,'FLUSSÜBERGANG',bridge.x+side*(bridge.w/2-3),1.05,bridge.z+bridge.d/2+.02,3,.6);}
 const carPaint=[material('#8e9b91',{metalness:.4}),material('#bd754e',{metalness:.4}),material('#536d78',{metalness:.4}),material('#a6a082',{metalness:.4})];
 for(const [index,v]of(layout.vehicles||[]).entries()){
  const mat=carPaint[index%carPaint.length],y=v.baseY||0,solids=vehicleSolids(v);for(const s of solids)b.box(mat,[s.x,s.y,s.z],[s.w,s.h,s.d]);
  const cabin=solids[1],front=cabin.z+cabin.d/2,back=cabin.z-cabin.d/2,cy=cabin.y+cabin.h*.06;
  for(const side of[-1,1]){b.box(mats.glass,[cabin.x,cy,side>0?front+.01:back-.01],[cabin.w*.86,cabin.h*.56,.021]);b.box(mats.glass,[cabin.x+side*(cabin.w/2+.012),cy,cabin.z],[.024,cabin.h*.56,cabin.d*.81]);b.box(mats.edge,[cabin.x+side*(cabin.w/2+.029),cy,cabin.z],[.025,cabin.h*.6,.09]);
   for(const zSign of[-1,1]){const wx=v.x+side*(v.w/2-.08),wz=v.z+zSign*v.d*.32;b.cylinder(mats.black,[wx,y+.39,wz],.42,.21,.42,[0,0,Math.PI/2],16);b.cylinder(mats.edge,[wx+side*.12,y+.39,wz],.22,.035,.22,[0,0,Math.PI/2],12);}b.box(mats.darkMetal,[v.x,y+.32,v.z+side*(v.d/2+.02)],[v.w+.02,.15,.06]);b.box(side>0?glow:mats.orange,[v.x+v.w*.31,y+.81,v.z+side*(v.d/2+.014)],[v.w*.24,.22,.03]);b.box(side>0?glow:mats.orange,[v.x-v.w*.31,y+.81,v.z+side*(v.d/2+.014)],[v.w*.24,.22,.03]);}
  b.box(mats.black,[v.x,y+.64,v.z+v.d/2+.022],[v.w*.32,.24,.025]);if(v.model==='pickup'||v.model==='truck'){b.box(mats.darkMetal,[v.x,y+1.146,v.z-v.d*.25],[v.w*.82,.012,v.d*.36]);for(const side of[-1,1])b.box(mat,[v.x+side*(v.w/2-.05),y+1.26,v.z-v.d*.25],[.1,.22,v.d*.4]);}
 }
 // Relay: the console and structural legs are represented by layout colliders.
 const tx=layout.relay.x,tz=layout.relay.z;
 for(const sx of[-1,1])for(const sz of[-1,1])b.box(mats.darkMetal,[tx+sx*1.2,11,tz+sz*1.2],[.24,22,.24]);
 for(let y=2;y<22;y+=3){const r=1.2;for(const sign of[-1,1]){b.beam(mats.edge,[tx-r,y,tz+sign*r],[tx+r,y+2.7,tz+sign*r],.035);b.box(mats.orange,[tx,y,tz+sign*r],[r*2,.075,.075]);}}
 b.box(mats.darkMetal,[tx,.65,tz],[.9,1.3,.65]);b.box(mats.glow,[tx,1.12,tz+.336],[.48,.18,.02]);b.cylinder(mats.edge,[tx,24,tz],.07,4);sign('RELAIS 06','SIGNAL / AUTORISIERUNG',tx,1.95,tz+.15,1.8,.57);
 const relayLamp=new THREE.Mesh(new THREE.SphereGeometry(.13,8,6),new THREE.MeshBasicMaterial({color:'#ef8150'}));relayLamp.position.set(tx,26.1,tz);group.add(relayLamp);
 const exfils=(layout.extractions||[]).map(ex=>{const root=new THREE.Group();root.position.set(ex.x,(ex.y??getGroundHeight(ex.x,ex.z))+.04,ex.z);group.add(root);const material=new THREE.MeshBasicMaterial({color:'#a4e4c8',transparent:true,opacity:.5,depthWrite:false,side:THREE.DoubleSide}),ring=new THREE.Mesh(new THREE.RingGeometry((ex.radius||4)-.12,ex.radius||4,48),material);ring.rotation.x=-Math.PI/2;root.add(ring);const beam=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,18,6),material.clone());beam.position.y=9;root.add(beam);return{root,ring,beam,material};});
 const farMaterial=material('#ffffff',{vertexColors:true});
 for(const chunk of chunks.values()){
  chunk.nearMeshes=chunk.batch.finish();
  // Road strip triangles are merged per material and chunk, not one mesh per dash.
  const byMat=new Map();for(const m of chunk.ribbons||[]){if(!byMat.has(m.material))byMat.set(m.material,[]);byMat.get(m.material).push(m.geometry);}for(const[mat,geos]of byMat){const vertices=[],normals=[],uvs=[];for(const g of geos){const n=g.toNonIndexed();vertices.push(...n.attributes.position.array);normals.push(...n.attributes.normal.array);uvs.push(...n.attributes.uv.array);n.dispose();g.dispose();}const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));const mesh=new THREE.Mesh(geo,mat);mesh.receiveShadow=true;chunk.root.add(mesh);chunk.nearMeshes.push(mesh);}delete chunk.ribbons;
  const positions=[],normals=[],colors=[];for(const mesh of chunk.nearMeshes){const geo=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry,pa=geo.attributes.position.array,na=geo.attributes.normal.array,col=mesh.material.color;positions.push(...pa);normals.push(...na);for(let i=0;i<pa.length;i+=3)colors.push(col.r,col.g,col.b);if(geo!==mesh.geometry)geo.dispose();}
  const farGeo=new THREE.BufferGeometry();farGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));farGeo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));farGeo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));farGeo.computeBoundingSphere();chunk.farMesh=new THREE.Mesh(farGeo,farMaterial);chunk.root.add(chunk.farMesh);
 }
 let visibleChunks=0,nearTiles=0;
 return {group,exfils,relayLamp,update(camera){visibleChunks=0;nearTiles=0;for(const c of chunks.values()){const p=c.root.userData.center;const distance=Math.hypot(camera.position.x-p.x,camera.position.z-p.z);c.root.visible=distance<1150;c.farMesh.visible=distance>=220;for(const mesh of c.nearMeshes)mesh.visible=distance<220;if(c.root.visible)visibleChunks++;}for(const t of terrainTiles){const d=Math.hypot(camera.position.x-t.x,camera.position.z-t.z);t.near.visible=d<280;t.far.visible=d>=280&&d<1450;if(t.near.visible)nearTiles++;}},stats(){return {worldSize:WORLD_SIZE,worldChunks:chunks.size,visibleWorldChunks:visibleChunks,terrainTiles:terrainTiles.length,nearTerrainTiles:nearTiles,enterableBuildings:layout.interiors.length,multistoreyBuildings:layout.interiors.filter(r=>r.levels>1).length,bridges:layout.bridges.length,vehicles:layout.vehicles.length};}};
}
