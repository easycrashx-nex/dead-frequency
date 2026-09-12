// Shared deterministic 1.5 km terrain. Physics and rendering use these exact triangles.
export const WORLD_SIZE = 1500;
export const TERRAIN_STEP = 5;
export const WATER_LEVEL = -3;
export const SETTLEMENTS = [
  {id:'altdorf',name:'ALTDORF',x:-430,z:-390,y:26,w:152,d:134,theme:'residential'},
  {id:'bergwerk',name:'BERGWERK',x:-485,z:330,y:38,w:158,d:142,theme:'workshop'},
  {id:'nordwacht',name:'NORDWACHT',x:38,z:-510,y:18,w:144,d:130,theme:'military'},
  {id:'hafen',name:'OSTHAFEN',x:475,z:-375,y:9,w:170,d:142,theme:'warehouse'},
  {id:'linden',name:'LINDEN',x:492,z:342,y:22,w:150,d:136,theme:'residential'},
  {id:'suedhof',name:'SÜDHOF',x:-25,z:515,y:13,w:156,d:132,theme:'farm'},
];
export const riverCenter = z => 250 + 18 * Math.sin(z / 160);
export const BRIDGE_SITES = [-360,0,360].map((z,i)=>({id:`bridge-${i}`,name:['NORDVIADUKT','WERKBRÜCKE','SÜDBRÜCKE'][i],x:riverCenter(z),z,y:0,w:112,d:14}));
const pt=(x,z,y)=>({x,z,y});
export const ROADS = [
  {id:'west-north',a:pt(-140,-90,0),b:pt(-430,-309,26)},
  {id:'west-south',a:pt(-130,110,0),b:pt(-485,245,38)},
  {id:'north',a:pt(0,-140,0),b:pt(38,-431,18)},
  {id:'south',a:pt(0,140,0),b:pt(-25,435,13)},
  ...BRIDGE_SITES.flatMap((s,i)=>[
    {id:`bridge-west-${i}`,a:pt(150,Math.max(-130,Math.min(130,s.z)),0),b:pt(s.x-65,s.z,0)},
    {id:`bridge-road-${i}`,a:pt(s.x-65,s.z,0),b:pt(s.x+65,s.z,0)},
    {id:`bridge-east-${i}`,a:pt(s.x+65,s.z,0),b:pt(i===1?485:i===0?475:492,i===1?0:i===0?-290:260,i===1?15:i===0?9:22)},
  ]),
  {id:'east-spine-north',a:pt(485,0,15),b:pt(475,-290,9)},
  {id:'east-spine-south',a:pt(485,0,15),b:pt(492,260,22)},
];
const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
function roadSample(x,z,r) { const dx=r.b.x-r.a.x,dz=r.b.z-r.a.z,t=Math.max(0,Math.min(1,((x-r.a.x)*dx+(z-r.a.z)*dz)/(dx*dx+dz*dz)));return {distance:Math.hypot(x-r.a.x-t*dx,z-r.a.z-t*dz),y:r.a.y+(r.b.y-r.a.y)*t}; }
export function roadDistance(x,z) {let nearest=Infinity;for(const r of ROADS)nearest=Math.min(nearest,roadSample(x,z,r).distance);return nearest;}
function terrainSource(x,z) {
  const core=Math.max(Math.abs(x),Math.abs(z));
  if(core<=155)return 0;
  let y=12+8*Math.sin(x*.011)*Math.cos(z*.008)+5*Math.sin((x+z)*.016);
  for(const [mx,mz,height,spread] of [[-640,-550,126,150],[-630,10,105,150],[-460,610,82,155],[590,610,104,165],[635,-610,105,170],[-90,-710,74,125]]) y+=height*Math.exp(-((x-mx)**2+(z-mz)**2)/(spread*spread));
  y*=smooth(155,225,core);
  for(const r of ROADS){const s=roadSample(x,z,r);const t=1-smooth(9,26,s.distance);y=y*(1-t)+s.y*t;}
  for(const s of SETTLEMENTS){const edge=Math.max(Math.abs(x-s.x)-s.w/2,Math.abs(z-s.z)-s.d/2);const t=1-smooth(12,48,edge);y=y*(1-t)+s.y*t;}
  const riverDistance=Math.abs(x-riverCenter(z));
  const riverWeight=1-smooth(19,49,riverDistance);
  const bed=-6.6+.6*Math.sin(z*.035)*Math.cos(x*.07);
  y=y*(1-riverWeight)+bed*riverWeight;
  return y;
}
export const TERRAIN_CELLS=WORLD_SIZE/TERRAIN_STEP;
export const TERRAIN_HEIGHTS=new Float32Array((TERRAIN_CELLS+1)**2);
for(let z=0;z<=TERRAIN_CELLS;z++)for(let x=0;x<=TERRAIN_CELLS;x++)TERRAIN_HEIGHTS[z*(TERRAIN_CELLS+1)+x]=terrainSource(x*TERRAIN_STEP-WORLD_SIZE/2,z*TERRAIN_STEP-WORLD_SIZE/2);
export function getGroundHeight(x,z) {
  const gx=Math.max(0,Math.min(TERRAIN_CELLS-.000001,(x+WORLD_SIZE/2)/TERRAIN_STEP)),gz=Math.max(0,Math.min(TERRAIN_CELLS-.000001,(z+WORLD_SIZE/2)/TERRAIN_STEP));
  const ix=Math.floor(gx),iz=Math.floor(gz),fx=gx-ix,fz=gz-iz,i=iz*(TERRAIN_CELLS+1)+ix;
  const a=TERRAIN_HEIGHTS[i],b=TERRAIN_HEIGHTS[i+1],c=TERRAIN_HEIGHTS[i+TERRAIN_CELLS+1],d=TERRAIN_HEIGHTS[i+TERRAIN_CELLS+2];
  return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz);
}
export function isWater(x,z){return Math.abs(x-riverCenter(z))<48&&getGroundHeight(x,z)<WATER_LEVEL-.35;}
export function isTerrainWalkable(x,z){return Math.abs(x)<WORLD_SIZE/2-1&&Math.abs(z)<WORLD_SIZE/2-1&&!isWater(x,z)&&Math.max(Math.abs(getGroundHeight(x+1,z)-getGroundHeight(x-1,z)),Math.abs(getGroundHeight(x,z+1)-getGroundHeight(x,z-1)))<1.45;}
export function createTerrainMesh() {
  const n=TERRAIN_CELLS+1,vertices=new Float32Array(n*n*3),indices=new Uint32Array(TERRAIN_CELLS*TERRAIN_CELLS*6);
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x;vertices[i*3]=x*TERRAIN_STEP-WORLD_SIZE/2;vertices[i*3+1]=TERRAIN_HEIGHTS[i];vertices[i*3+2]=z*TERRAIN_STEP-WORLD_SIZE/2;}
  let j=0;for(let z=0;z<TERRAIN_CELLS;z++)for(let x=0;x<TERRAIN_CELLS;x++){const a=z*n+x,b=a+1,c=a+n,d=c+1;indices.set([a,c,b,b,c,d],j);j+=6;}
  return {vertices,indices};
}
