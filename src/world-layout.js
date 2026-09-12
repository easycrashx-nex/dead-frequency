import {SETTLEMENTS,BRIDGE_SITES,getGroundHeight,roadDistance,isWater} from './terrain.js';

// Every room is assembled from the same boxes used by Rapier and ray tracing.
export function createInterior(footprint,{name,type='warehouse',ceilingHeight=3.4,fixtures=[],lootSpots=[]}={}) {
  const {id,x,z,w,d}=footprint,baseY=getGroundHeight(x,z),thickness=.36;
  const levels=footprint.levels??((w>=13&&d>=14&&footprint.h>=7.8)?(footprint.h>=14?3:2):1);
  const floorHeight=4,clear=levels>1?3.76:ceilingHeight,roofY=baseY+(levels-1)*floorHeight+clear,h=roofY-baseY+.24;
  const width=w<9?3.2:4,height=3;
  const doors=['north','south'].map(side=>{const sign=side==='north'?-1:1,doorZ=z+sign*d/2;return {side,x,y:baseY,z:doorZ,width,height,outside:{x,y:baseY,z:doorZ+sign*2},inside:{x,y:baseY,z:doorZ-sign*2}};});
  const solids=[],supports=[],stairs=[];
  const box=(suffix,kind,sx,sy,sz,sw,sh,sd,style)=>{if(sw>.001&&sh>.001&&sd>.001)solids.push({id:`${id}-${suffix}`,kind,x:sx,y:sy,z:sz,w:sw,h:sh,d:sd,...(style?{style}:{})});};
  const support=(suffix,kind,sx,sy,sz,sw,sd)=>supports.push({id:`${id}-${suffix}`,kind,x:sx,y:sy,z:sz,w:sw,d:sd,interiorId:id});
  const stairX=x+w/2-2,stairStart=z-4,stairEnd=z+4,stairWidth=2.2;
  const floors=[];
  for(let level=0;level<levels;level++){
    const y=baseY+level*floorHeight;
    for(const sign of[-1,1]){
      box(`L${level}-${sign}-side`,'wall',x+sign*(w-thickness)/2,y+clear/2,z,thickness,clear,d);
      const wallZ=z+sign*(d-thickness)/2,side=sign<0?'north':'south';
      if(level===0){for(const segment of[-1,1])box(`${side}-${segment}-wall`,'wall',x+segment*(w+width)/4,y+clear/2,wallZ,(w-width)/2,clear,thickness);box(`${side}-lintel`,'wall',x,y+(clear+height)/2,wallZ,width,clear-height,thickness);}
      else box(`L${level}-${side}`,'wall',x,y+clear/2,wallZ,w,clear,thickness);
    }
    if(level===0){floors.push({x,y,z,w:w-.72,d:d-.72,level});support('ground','floor',x,y,z,w-.72,d-.72);}
    else {
      // Three floor pieces surround a real opening above the complete stair run.
      const holeLeft=stairX-stairWidth/2-.12,holeRight=stairX+stairWidth/2+.12,holeNorth=stairStart,holeSouth=stairEnd,left=x-w/2,right=x+w/2,north=z-d/2,south=z+d/2;
      for(const [suffix,fx,fz,fw,fd] of [['main',(left+holeLeft)/2,z,holeLeft-left,d],['edge',(holeRight+right)/2,z,right-holeRight,d],['north',(holeLeft+holeRight)/2,(north+holeNorth)/2,holeRight-holeLeft,holeNorth-north],['south',(holeLeft+holeRight)/2,(holeSouth+south)/2,holeRight-holeLeft,south-holeSouth]]){
        box(`floor-${level}-${suffix}`,'floor',fx,y-.12,fz,fw,.24,fd);floors.push({x:fx,y,z:fz,w:fw,d:fd,level});support(`floor-${level}-${suffix}`,'floor',fx,y,fz,fw,fd);
      }
    }
    if(level<levels-1){
      const waypoints=[{x:stairX,y,z:stairStart-.65}];
      for(let i=0;i<20;i++) {const top=y+(i+1)*.2,sz=stairStart+(i+.5)*.4;box(`stairs-${level}-${i}`,'stair',stairX,top-.1,sz,stairWidth,.2,.4);support(`step-${level}-${i}`,'stair',stairX,top,sz,stairWidth,.4);waypoints.push({x:stairX,y:top,z:sz});}
      waypoints.push({x:stairX,y:y+4,z:stairEnd+.7});stairs.push({id:`${id}-stairs-${level}`,level,width:stairWidth,start:waypoints[0],end:waypoints.at(-1),waypoints});
      // Solid low parapets guard the floor opening. They never span the steps.
      if(level>0)box(`rail-${level}`,'railing',stairX-stairWidth/2-.18,y+.5,z-.2,.12,1,8.45);
    }
    if(level>0){box(`upper-desk-${level}`,'fixture',x-w*.29,y+.55,z-d*.28,2.2,1.1,1.15,'desk');lootSpots.push([-w*.21,-d*.13,2,level]);}
  }
  box('roof','ceiling',x,roofY+.12,z,w,.24,d);
  // Upper landings remain protected even on the top storey.
  if(levels>1)box('top-stair-rail','railing',stairX-stairWidth/2-.18,baseY+(levels-1)*4+.5,z-.2,.12,1,8.45);
  for(const[suffix,style,dx,dz,sw,sh,sd]of fixtures){if(levels>1&&Math.abs(x+dx-stairX)<sw/2+stairWidth/2+.3&&Math.abs(dz)<4.5)continue;box(suffix,'fixture',x+dx,baseY+sh/2,z+dz,sw,sh,sd,style);}
  return {id,name:name||id.replaceAll('-',' ').toUpperCase(),type,x,z,w,d,h,baseY,levels,floorHeight,ceilingHeight:clear,roofY,doors,solids,supports,stairs,floors,lootSpots:lootSpots.map(([dx,dz,tier,level=0])=>({x:x+dx,y:baseY+level*4,z:z+dz,tier,level}))};
}

export function createSettlements(){
  const obstacles=[],wallSolids=[],vehicles=[];
  for(const [townIndex,town] of SETTLEMENTS.entries()){
    for(const [i,[dx,dz]]of [[-48,-39],[-23,-39],[48,-39],[-48,0],[48,0],[-48,39],[23,39],[48,39]].entries()){
      const levels=(i+townIndex)%3===0?3:(i%2?2:1);obstacles.push({id:`${town.id}-house-${i}`,kind:'building',x:town.x+dx,z:town.z+dz,w:18+(i%2)*4,d:19+(i%3)*2,h:levels*4,levels,name:`${town.name} ${String(i+1).padStart(2,'0')}`,theme:town.theme});
    }
    const y=town.y+1.7,t=1.1,gate=14;
    for(const sign of[-1,1]){
      wallSolids.push({id:`${town.id}-wall-x${sign}`,kind:'settlement-wall',x:town.x+sign*town.w/2,y,z:town.z,w:t,h:3.4,d:town.d});
      for(const seg of[-1,1])wallSolids.push({id:`${town.id}-wall-z${sign}-${seg}`,kind:'settlement-wall',x:town.x+seg*(town.w+gate)/4,y,z:town.z+sign*town.d/2,w:(town.w-gate)/2,h:3.4,d:t});
    }
    for(let i=0;i<4;i++){vehicles.push({id:`${town.id}-car-${i}`,kind:'vehicle',model:['sedan','pickup','van','truck'][(townIndex+i)%4],x:town.x+(i%2?25:-25),z:town.z+(i<2?-10:10),baseY:town.y,w:i===3?2.8:2.2,d:i===3?7:4.8,h:i===3?3.2:1.8});}
  }
  for(const[x,z,model]of[[-11,54,'sedan'],[39,39,'van'],[-53,15,'pickup'],[69,113,'truck']])vehicles.push({id:`core-car-${model}`,kind:'vehicle',model,x,z,baseY:getGroundHeight(x,z),w:model==='truck'?2.8:2.2,d:model==='truck'?7:4.8,h:model==='truck'?3.2:1.8});
  const bridges=BRIDGE_SITES.map(s=>({...s,kind:'bridge',solids:[{id:`${s.id}-deck`,kind:'bridge',x:s.x,y:s.y-.3,z:s.z,w:s.w,h:.6,d:s.d},...[-1,1].map(sign=>({id:`${s.id}-rail-${sign}`,kind:'bridge-rail',x:s.x,y:s.y+.65,z:s.z+sign*(s.d/2-.15),w:s.w,h:1.3,d:.3})),...[-1,1].map(sign=>({id:`${s.id}-pier-${sign}`,kind:'bridge-pier',x:s.x+sign*28,y:-3.4,z:s.z,w:2.2,h:6.2,d:10}))],supports:[{id:`${s.id}-surface`,kind:'bridge',x:s.x,y:s.y,z:s.z,w:s.w,d:s.d-.6}]}));
  return {obstacles,wallSolids,vehicles,bridges};
}
export function vehicleSolids(v){const y=v.baseY||0,w=v.w,d=v.d;return[{id:`${v.id}-chassis`,kind:'vehicle',x:v.x,y:y+.57,z:v.z,w,h:1.14,d},{id:`${v.id}-cabin`,kind:'vehicle',x:v.x,y:y+1.36,z:v.z+(v.model==='pickup'?.8:v.model==='truck'?1.8:0),w:w*.88,h:v.model==='truck'?2.1:1.0,d:v.model==='truck'?2.1:d*.5},...(v.model==='van'?[{id:`${v.id}-cargo`,kind:'vehicle',x:v.x,y:y+1.45,z:v.z-.45,w:w*.92,h:1.75,d:d*.7}]:[])];}

export function createNaturalObstacles(){
 const result=[];let seed=11491;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let z=-700;z<720;z+=34)for(let x=-700;x<720;x+=34){const px=x+(rand()-.5)*20,pz=z+(rand()-.5)*20,n=rand();if(Math.max(Math.abs(px),Math.abs(pz))<190||isWater(px,pz)||roadDistance(px,pz)<20||SETTLEMENTS.some(s=>Math.abs(px-s.x)<s.w/2+25&&Math.abs(pz-s.z)<s.d/2+25))continue;
 const y=getGroundHeight(px,pz);if(n<.55&&y<100)result.push({id:`pine-${result.length}`,kind:'tree',x:px,z:pz,baseY:y,w:.62,d:.62,h:5.5+rand()*4,crown:2.4+rand()*1.7});
 else if(n>.83){const w=2+rand()*2,d=2+rand()*2,h=1+rand()*1.8;result.push({id:`rock-${result.length}`,kind:'rock',x:px,z:pz,baseY:y,w,d,h});}}
 return result;
}
