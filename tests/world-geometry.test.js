import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLD_SIZE,TERRAIN_HEIGHTS,createTerrainMesh,getGroundHeight,isWater,BRIDGE_SITES,SETTLEMENTS} from '../src/terrain.js';
import {layout,COLLIDERS,INTERIORS,getSupportHeight} from '../src/layout.js';
const blocked=(x,y,z,r=.34)=>COLLIDERS.filter(s=>x+r>s.x-s.w/2+1e-5&&x-r<s.x+s.w/2-1e-5&&z+r>s.z-s.d/2+1e-5&&z-r<s.z+s.d/2-1e-5&&y+1.72>s.y-s.h/2+1e-5&&y<s.y+s.h/2-1e-5);
test('terrain is a true1500m shared mesh with mountains and a preserved flat core',()=>{
 assert.equal(WORLD_SIZE,1500);const {vertices,indices}=createTerrainMesh();assert.equal(vertices.length,301*301*3);assert.equal(indices.length,300*300*6);assert.equal(vertices[0],-750);assert.equal(vertices.at(-1),750);assert.ok(Math.max(...TERRAIN_HEIGHTS)>100);for(const[x,z]of[[-150,-150],[0,0],[140,140],[-7,48]])assert.equal(getGroundHeight(x,z),0);
 for(let i=0;i<indices.length;i+=639){const ids=[indices[i],indices[i+1],indices[i+2]],x=ids.reduce((n,id)=>n+vertices[id*3],0)/3,z=ids.reduce((n,id)=>n+vertices[id*3+2],0)/3,y=ids.reduce((n,id)=>n+vertices[id*3+1],0)/3;assert.ok(Math.abs(getGroundHeight(x,z)-y)<.0001);}
});
test('all houses use real open rooms, finite positive collision volumes and uniqueids',()=>{
 assert.equal(layout.obstacles.filter(o=>o.kind==='building').length,INTERIORS.length);assert.equal(INTERIORS.length,73);assert.equal(new Set(COLLIDERS.map(s=>s.id)).size,COLLIDERS.length);
 for(const s of COLLIDERS)for(const key of['x','y','z','w','h','d'])assert.ok(Number.isFinite(s[key])&&(!['w','h','d'].includes(key)||s[key]>0),`${s.id}/${key}`);
 for(const r of INTERIORS)for(const d of r.doors){assert.ok(d.width>=3.2&&d.height>=2.8);for(const p of[d.inside,d,d.outside])assert.deepEqual(blocked(p.x,p.y+.025,p.z),[],`${r.id} ${d.side} ${JSON.stringify(p)}`);}
});
test('every multistorey staircase has physical .2m risers, upperlandings and head clearance',()=>{
 assert.equal(INTERIORS.filter(r=>r.levels>1).length,46);
 for(const r of INTERIORS)for(const stairs of r.stairs){assert.equal(stairs.waypoints.length,22);for(const[i,p]of stairs.waypoints.entries()){assert.ok(Math.abs(getSupportHeight(p.x,p.z,p.y)-p.y)<.001,`${stairs.id} support${i}`);assert.deepEqual(blocked(p.x,p.y+.025,p.z,.12),[],`${stairs.id} headclearance${i}`);if(i>1&&i<21)assert.ok(Math.abs(p.y-stairs.waypoints[i-1].y-.2)<.00001);}}
});
test('river has three fully traversable bridges above its bed and walls limitsettlement entry',()=>{
 assert.equal(layout.bridges.length,3);for(const b of BRIDGE_SITES){assert.ok(isWater(b.x,b.z));for(let dx=-b.w/2+1;dx<b.w/2;dx+=2){assert.equal(getSupportHeight(b.x+dx,b.z,0),0);assert.deepEqual(blocked(b.x+dx,.025,b.z),[]);}}
 for(const t of SETTLEMENTS){assert.equal(layout.walls.filter(w=>w.id.startsWith(t.id)).length,6);for(const sign of[-1,1])assert.deepEqual(blocked(t.x,t.y+.025,t.z+sign*t.d/2),[],`${t.id}gate`);}
});
test('containers include usable upper floors and vehicles share visiblebodycollision',()=>{
 assert.ok(layout.containers.length>140);for(const s of layout.containers)assert.ok(Math.abs(getSupportHeight(s.x,s.z,s.y)-s.y)<.01,`${s.id} floats`);
 assert.equal(layout.vehicles.length,28);assert.equal(new Set(layout.vehicles.map(v=>v.model)).size,4);for(const v of layout.vehicles)assert.ok(COLLIDERS.some(s=>s.id===`${v.id}-chassis`));
});

test('every stair exit has continuous physical floor support across the final tread and landing',()=>{
 for(const room of INTERIORS)for(const stairs of room.stairs){const lastTread=stairs.waypoints.at(-2),landing=stairs.end;
  for(let z=lastTread.z;z<=landing.z;z+=.025){assert.ok(Math.abs(getSupportHeight(landing.x,z,landing.y)-landing.y)<.001,`${stairs.id}: unsupported landing at${z}`);assert.ok(COLLIDERS.some(s=>['stair','floor'].includes(s.kind)&&Math.abs(s.x-landing.x)<=s.w/2&&Math.abs(s.z-z)<=s.d/2+.0001&&Math.abs(s.y+s.h/2-landing.y)<.001),`${stairs.id}: missing physical floor at${z}`);}
 }
});

test('upper stair approaches provide continuous support from the landing onto the first riser',()=>{
 for(const room of INTERIORS)for(const stairs of room.stairs.filter(s=>s.level>0)){const first=stairs.waypoints[1];
  for(let z=stairs.start.z;z<=first.z;z+=.025){const y=getSupportHeight(stairs.start.x,z,stairs.start.y);assert.ok(y>=stairs.start.y-.001&&y<=stairs.start.y+.201,`${stairs.id}: unsupported approach at${z}`);assert.ok(COLLIDERS.some(s=>['stair','floor'].includes(s.kind)&&Math.abs(s.x-stairs.start.x)<=s.w/2&&Math.abs(s.z-z)<=s.d/2+.0001&&Math.abs(s.y+s.h/2-y)<.001),`${stairs.id}: missing physical approach at${z}`);}
 }
});
