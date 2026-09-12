import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {resolveLoadout,getEquipment} from './loadouts.js';
import {createWeaponModelPool,weaponBuildKey,equipmentBuildKey,makeOperatorEquipment,disposeWeaponModel} from './weapon-model.js';

const UP=new THREE.Vector3(0,1,0);
function disposeTree(root){
 const geometries=new Set(),materials=new Set(),textures=new Set();
 root.traverse(node=>{if(node.geometry)geometries.add(node.geometry);if(node.material)for(const m of Array.isArray(node.material)?node.material:[node.material]){materials.add(m);for(const value of Object.values(m))if(value?.isTexture)textures.add(value);}});
 geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());root.removeFromParent();
}
// Draw once and merge by material. Breath animates the assembled rig, never its
// geometry. The only changing meshes are an actual changed loadout and its hands.
function batch(parent){
 const groups=new Map(),matrix=new THREE.Matrix4(),q=new THREE.Quaternion();
 const put=(g,m,p=[0,0,0],s=[1,1,1],r=[0,0,0])=>{matrix.compose(new THREE.Vector3(...p),q.setFromEuler(new THREE.Euler(...r)),new THREE.Vector3(...s));g.applyMatrix4(matrix);if(!groups.has(m))groups.set(m,[]);groups.get(m).push(g);};
 return{
  box(m,p,s,r=[0,0,0],radius=.025){put(new RoundedBoxGeometry(...s,3,Math.min(radius,Math.min(...s)*.28)),m,p,[1,1,1],r);},
  sphere(m,p,s){put(new THREE.SphereGeometry(1,28,20),m,p,s);},
  cylinder(m,p,radius,length,rotation=[0,0,0],top=radius){put(new THREE.CylinderGeometry(top,radius,length,20),m,p,[1,1,1],rotation);},
  tube(m,a,c,radius=.06,top=radius){const va=new THREE.Vector3(...a),vc=new THREE.Vector3(...c),dir=vc.clone().sub(va),g=new THREE.CylinderGeometry(top,radius,dir.length(),20);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP,dir.normalize()));g.translate(...va.add(vc).multiplyScalar(.5).toArray());if(!groups.has(m))groups.set(m,[]);groups.get(m).push(g);},
  finish(){for(const[m,geos]of groups){const flat=geos.map(g=>g.index?g.toNonIndexed():g),merged=mergeGeometries(flat);geos.forEach(g=>g.dispose());flat.forEach((g,i)=>{if(g!==geos[i])g.dispose();});const mesh=new THREE.Mesh(merged,m);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);}groups.clear();},
 };
}
function texture(size,paint){const canvas=document.createElement('canvas');canvas.width=canvas.height=size;paint(canvas.getContext('2d'),size);const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;tex.wrapS=tex.wrapT=THREE.RepeatWrapping;return tex;}
function clothTexture(){const tex=texture(128,(ctx,n)=>{ctx.fillStyle='#acb3a3';ctx.fillRect(0,0,n,n);for(let y=0;y<n;y+=2)for(let x=0;x<n;x+=2){const v=120+((x*73+y*29)%72);ctx.fillStyle=`rgba(${v},${v},${v},.22)`;ctx.fillRect(x,y,(y%4)?2:1,1);}ctx.strokeStyle='#d1d1c2';ctx.globalAlpha=.18;for(let i=0;i<n;i+=8){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,n);ctx.stroke();}});tex.repeat.set(7,7);return tex;}
function concreteTexture(){const tex=texture(256,(ctx,n)=>{ctx.fillStyle='#747d77';ctx.fillRect(0,0,n,n);let seed=339;for(let i=0;i<12000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const x=seed%n;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const y=seed%n;ctx.fillStyle=`rgba(${i%2?'255,255,235':'0,10,12'},.035)`;ctx.fillRect(x,y,1+i%3,1);}ctx.strokeStyle='#515c56';ctx.lineWidth=1;ctx.strokeRect(1,1,n-2,n-2);});tex.repeat.set(3,3);return tex;}
function patchTexture(){return texture(256,(ctx,n)=>{ctx.fillStyle='#273832';ctx.fillRect(0,0,n,n);ctx.strokeStyle='#aeb593';ctx.lineWidth=6;ctx.strokeRect(9,9,n-18,n-18);ctx.fillStyle='#c7c8a5';ctx.font='bold 80px Bahnschrift,Arial';ctx.textAlign='center';ctx.fillText('DF',128,118);ctx.font='bold 24px monospace';ctx.fillText('SEKTOR 07',128,165);ctx.fillStyle='#c18550';ctx.fillRect(54,193,148,10);});}

export function createOperatorStage(environment){
 const scene=new THREE.Scene();scene.background=new THREE.Color('#080e11');scene.fog=new THREE.Fog('#080e11',4.2,10);scene.environment=environment;scene.environmentIntensity=.18;
 const camera=new THREE.PerspectiveCamera(34,1,.04,25);camera.position.set(.2,1.07,-3.65);
 const actor=new THREE.Group();actor.name='menu-operator';actor.rotation.y=-.22;scene.add(actor);
 const breathing=new THREE.Group();actor.add(breathing);
 const clothMap=clothTexture(),concreteMap=concreteTexture();
 const material=(color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.83,metalness:.03,...extra});
 const fabric=material('#6e786b',{map:clothMap,bumpMap:clothMap,bumpScale:.0022});
 const fabricDark=material('#46534b',{map:clothMap,bumpMap:clothMap,bumpScale:.0016});
 const seam=material('#8d937b'),rubber=material('#192722',{roughness:.96}),web=material('#2c3b32',{map:clothMap});
 const metal=material('#62726c',{metalness:.72,roughness:.4}),black=material('#111c1b'),skin=material('#91715b',{roughness:.91});
 const patch=material('#ddddbc',{map:patchTexture(),roughness:.96});
 const glass=material('#496c72',{metalness:.65,roughness:.11});
 const body=batch(breathing);
 body.sphere(fabric,[0,1.24,.018],[.249,.322,.161]);body.sphere(fabric,[0,.999,.025],[.25,.155,.167]);
 body.sphere(fabricDark,[0,1.445,.027],[.209,.121,.145]);body.cylinder(fabricDark,[0,1.513,0],.105,.14);
 body.box(web,[0,.925,-.01],[.5,.055,.354],[0,0,0],.02);
 for(const x of[-.19,-.08,.08,.19])body.box(black,[x,.925,-.18],[.04,.066,.016]);body.box(metal,[0,.925,-.197],[.087,.057,.018]);
 for(const side of[-1,1]){
  body.box(fabricDark,[side*.244,1.16,.008],[.026,.26,.19],[0,0,side*.055]);
  body.box(web,[side*.235,.946,-.11],[.086,.125,.082],[0,0,side*.12]);
  body.sphere(fabric,[side*.295,1.39,0],[.101,.124,.117]);
  body.box(seam,[side*.311,1.407,-.11],[.12,.009,.009],[0,0,side*.13]);
 }
 // Visible collar folds and a shoulder identity patch break the generic NPC shape.
 body.box(fabricDark,[-.083,1.49,-.093],[.085,.105,.042],[.12,0,-.2]);body.box(fabricDark,[.083,1.49,-.093],[.085,.105,.042],[.12,0,.2]);
 body.box(patch,[-.359,1.398,-.025],[.008,.104,.101],[0,0,-.05],.003);
 body.box(web,[.235,1.382,-.047],[.071,.135,.084]);body.cylinder(black,[.251,1.514,-.01],.008,.16);
 body.finish();
 const head=new THREE.Group();head.position.y=1.63;head.scale.setScalar(.9);breathing.add(head);const hb=batch(head);
 hb.sphere(fabricDark,[0,.021,.005],[.164,.194,.155]);hb.sphere(fabricDark,[0,-.098,-.061],[.127,.103,.12]);
 hb.sphere(skin,[0,.016,-.139],[.13,.047,.017]);
 hb.box(black,[0,.024,-.151],[.265,.069,.035],[.02,0,0],.023);
 for(const side of[-1,1]){hb.box(glass,[side*.064,.027,-.173],[.105,.043,.018],[0,side*.05,0],.02);hb.box(fabricDark,[side*.172,.01,.002],[.022,.067,.197],[0,0,0],.015);hb.sphere(black,[side*.174,-.016,.018],[.035,.065,.045]);hb.box(metal,[side*.18,.032,-.004],[.012,.055,.041]);}
 hb.sphere(fabricDark,[0,-.086,-.146],[.117,.079,.036]);hb.box(web,[0,-.073,-.181],[.084,.045,.009],[.06,0,0],.013);
 for(const x of[-.025,0,.025])hb.box(black,[x,-.075,-.188],[.006,.025,.004],[0,0,0],.001);
 hb.tube(black,[-.172,-.035,-.014],[-.134,-.091,-.175],.01);hb.sphere(black,[-.131,-.092,-.18],[.019,.015,.029]);hb.finish();
 const lower=new THREE.Group();actor.add(lower);const legs=batch(lower);
 for(const side of[-1,1]){
  const hip=[side*.145,.97,.022],knee=[side*.183,.56,side<0?-.009:.051],ankle=[side*.213,.14,side<0?-.056:.11];
  legs.tube(fabric,hip,knee,.116,.142);legs.sphere(fabric,knee,[.119,.125,.115]);legs.tube(fabric,knee,ankle,.084,.106);
  legs.box(fabricDark,[side*.278,.744,.025],[.101,.214,.151],[0,0,side*.06],.027);legs.box(fabric,[side*.285,.835,.024],[.11,.049,.159],[0,0,side*.06],.014);
  for(const y of[.74,.8])legs.box(seam,[side*.31,y,-.053],[.006,.003,.099],[0,0,0],.001);
  const kneeZ=knee[2]-.105;legs.box(web,[knee[0],.565,kneeZ],[.176,.209,.046],[.075,0,0],.054);legs.box(metal,[knee[0],.568,kneeZ-.03],[.139,.158,.028],[.075,0,0],.033);
  for(const zSide of[-1,1])legs.box(web,[side*.184,.567,knee[2]+zSide*.069],[.216,.027,.053],[0,0,side*.03],.006);
  for(const y of[.3,.35,.415])legs.box(fabricDark,[side*.202,y,ankle[2]-.056],[.125,.015,.039],[.08,0,side*.12],.006);
  const fx=side*.213,fz=ankle[2]-.065;
  legs.box(rubber,[fx,.063,fz],[.219,.118,.372],[0,side*.07,0],.045);legs.box(black,[fx,.02,fz],[.227,.037,.376],[0,side*.07,0],.011);
  legs.box(fabricDark,[fx,.168,ankle[2]],[.187,.218,.212],[0,side*.07,0],.038);legs.box(rubber,[fx,.119,fz-.095],[.207,.063,.151],[0,side*.07,0],.025);
  for(let i=0;i<5;i++){legs.box(seam,[fx,.147+i*.024,ankle[2]-.11],[.097,.007,.009],[0,0,i%2?.11:-.11],.002);for(const edge of[-1,1])legs.box(metal,[fx+edge*.064,.147+i*.024,ankle[2]-.103],[.012,.009,.014],[0,0,0],.002);}
  for(let i=0;i<6;i++)legs.box(black,[fx,.012,fz-.155+i*.057],[.234,.015,.021],[0,side*.07,0],.002);
 }
 legs.finish();
 const riflePivot=new THREE.Group();breathing.add(riflePivot);
 const pool=createWeaponModelPool(false,4);let activeWeapon=null,gearModel=null,armRoot=null,selectionKey='',buildKey='',loadoutName='',loadoutValid=false,time=0,disposed=false,active=false;
 const handPoint=new THREE.Vector3(),supportPoint=new THREE.Vector3();
 function buildArms(weapon){
  if(armRoot){const geometries=new Set();armRoot.traverse(n=>{if(n.geometry)geometries.add(n.geometry);});geometries.forEach(g=>g.dispose());armRoot.removeFromParent();}
  armRoot=new THREE.Group();breathing.add(armRoot);const a=batch(armRoot);
  const handgun=weapon&&['pistol','revolver'].includes(weapon.model);
  riflePivot.position.set(handgun?-.035:-.14,handgun?1.15:1.2,handgun?-.31:-.34);riflePivot.rotation.set(-.08,handgun?-.6:-1.15,-.18);riflePivot.scale.setScalar(.84);riflePivot.updateMatrix();
  handPoint.set(0,-.145,-.097).applyMatrix4(riflePivot.matrix);
  const supportZ=handgun?-.145:Math.max(-.59,Math.min(-.34,weapon?.muzzleZ+.38||-.48));
  supportPoint.set(handgun?.075:0,-.11,supportZ).applyMatrix4(riflePivot.matrix);
  const wrists=weapon?[handPoint.toArray(),supportPoint.toArray()]:[[-.31,.985,-.145],[.31,.985,-.145]];
  for(const[index,side]of[-1,1].entries()){
   const shoulder=[side*.277,1.422,.012],elbow=weapon?[side*.377,1.093,index===0?-.155:-.245]:[side*.344,1.16,-.04],wrist=wrists[index];
   a.tube(fabric,shoulder,elbow,.086,.112);a.sphere(fabric,elbow,[.091,.103,.096]);a.tube(fabric,elbow,wrist,.065,.086);
   a.box(fabricDark,[elbow[0],elbow[1]+.015,elbow[2]+.064],[.126,.131,.04],[.13,0,side*.09],.031);
   a.sphere(web,wrist,[.073,.048,.072]);
   const palm=new THREE.Vector3(...wrist),rotation=weapon?riflePivot.rotation.toArray().slice(0,3):[0,0,0];
   a.box(rubber,[palm.x,palm.y-.009,palm.z],[.118,.096,.094],rotation,.028);
   if(weapon){
    const hand=new THREE.Group();hand.position.copy(palm);hand.rotation.copy(riflePivot.rotation);const f=batch(hand);
    for(let finger=0;finger<4;finger++){const fy=.028-finger*.018;f.box(fabricDark,[.046,fy,-.005],[.04,.016,.087],[0,0,0],.007);f.box(rubber,[-.037,fy,-.042],[.03,.016,.043],[0,0,.18],.006);f.box(metal,[.053,fy,.014],[.018,.012,.025],[0,0,0],.004);}
    f.box(fabricDark,[-.01,.059,-.003],[.082,.025,.041],[0,0,-.4],.011);f.finish();armRoot.add(hand);
   }
   // Wrist fastening is attached to the cuff, never a detached floating prop.
   a.box(black,[wrist[0],wrist[1]+.03,wrist[2]+.025],[.119,.03,.092],[0,0,0],.014);
  }
  a.finish();
 }
 // The distant operator factory deliberately uses broad readable straps. At
 // menu distance the same catalog gear gets sewn shoulder loops, soft pouches,
 // a curved pack and cloth surfaces instead of those distant solid bars.
 function makeStageEquipment(equipment){
  const model=makeOperatorEquipment({helmet:equipment.helmet});model.key=equipmentBuildKey(equipment);model.head.scale.setScalar(.819);model.head.traverse(node=>{if(!node.material||node.material.transparent)return;node.material.map=clothMap;node.material.bumpMap=clothMap;node.material.bumpScale=.0017;node.material.roughness=.97;node.material.metalness=.025;});
  const gear=Object.fromEntries(['backpack','carrier','plate','helmet'].map(slot=>[slot,getEquipment(equipment[slot]?.catalogId||equipment[slot])]));
  model.gear=Object.fromEntries(Object.entries(gear).map(([slot,item])=>[slot,item?.id||null]));
  const mat=(color,extras={})=>{const m=material(color,{map:clothMap,bumpMap:clothMap,bumpScale:.0017,...extras});model.materials.push(m);return m;};
  const olive=mat('#69745d'),strap=mat('#354238'),edge=mat('#9b9c80'),hardware=mat('#646e64',{map:null,bumpMap:null,metalness:.63,roughness:.43});
  const b=batch(model.torso);
  if(gear.backpack){
   const tier=['sling','day','assault','patrol','frame','expedition'].indexOf(gear.backpack.model),w=.3+tier*.034,h=.31+tier*.1,d=.16+tier*.027,color=mat(['#667368','#7d7962','#5c725e','#8d8567','#6b8077','#9b8c69'][tier]);
   b.box(color,[tier===0?.1:0,.02,.19+d/2],[w,h,d],[0,0,tier===0?-.19:0],.065);
   b.box(color,[tier===0?.1:0,.02+h*.15,.19+d],[w*.82,h*.51,.071],[0,0,tier===0?-.19:0],.036);
   for(const side of[-1,1]){b.tube(strap,[side*.15,.27,.16],[side*.19,-.17,.16],.021);if(tier>1)b.box(color,[side*(w/2+.038),-.06,.21+d*.4],[.09,h*.41,d*.65],[0,0,0],.03);}
   for(const y of[-h*.18,h*.25])b.box(strap,[0,y,.213+d],[w*.9,.029,.014],[0,0,0],.006);
   if(tier===4)for(const side of[-1,1])b.tube(hardware,[side*(w/2+.026),-h/2,.24],[side*(w/2+.026),h/2+.08,.24],.012);
   if(tier>=3)b.cylinder(color,[0,-h*.5-.053,.26],.08,w,[0,0,Math.PI/2]);
  }
  if(gear.carrier){
   const tier=['web','scout','modular','assault','heavy','fortress'].indexOf(gear.carrier.model),w=.348+tier*.027,h=.335+tier*.025,color=mat(['#77806a','#798275','#627768','#73735d','#5b6656','#515e56'][tier]);
   if(tier>0){b.box(color,[0,.092,-.172],[w,h,.089],[0,0,0],.055);b.box(color,[0,.092,.164],[w,h,.055],[0,0,0],.047);}
   for(const side of[-1,1]){
    const x=side*.155;
    // Continuous webbing runs up the chest, across the shoulder, down the back.
    b.tube(strap,[x,.031,-.169],[x,.31,-.132],.021);b.tube(strap,[x,.31,-.132],[x,.354,.031],.024);b.tube(strap,[x,.354,.031],[x,.235,.153],.022);
    b.box(hardware,[x,.236,-.158],[.065,.045,.022],[.08,0,0],.009);
    b.box(strap,[side*.21,-.007,.006],[.029,.139,.283],[0,0,side*.035],.014);
   }
   const pouchCount=Math.min(4,tier+2);for(let i=0;i<pouchCount;i++){const x=(i-(pouchCount-1)/2)*.093;b.box(color,[x,-.072,-.236],[.086,.151,.073],[0,0,0],.026);b.box(strap,[x,-.003,-.278],[.075,.036,.015],[0,0,0],.01);b.box(edge,[x,-.122,-.275],[.061,.004,.003],[0,0,0],.001);}
   for(let y=.065;y<.25;y+=.054)for(let x=-w*.35;x<w*.36;x+=.054)b.box(strap,[x,y,-.222],[.039,.014,.009],[0,0,0],.003);
   if(tier>=3)for(const side of[-1,1])b.box(color,[side*.255,.234,.016],[.115,.076,.198],[0,0,side*.15],.029);
   if(tier>=4)b.box(color,[0,-.232,-.153],[.215,.187,.053],[.14,0,0],.042);
   if(tier===5)for(const side of[-1,1])b.box(color,[side*.171,.337,-.024],[.063,.079,.154],[0,0,side*.12],.025);
   b.box(olive,[0,.25,-.229],[.135,.05,.012],[0,0,0],.009);
   b.box(edge,[0,.25,-.238],[.099,.009,.004],[0,0,0],.001);
  }
  if(gear.plate&&gear.carrier){const tier=['fiber','steel','ceramic','composite','titan','boron'].indexOf(gear.plate.model),color=mat(['#5e766c','#a0a7a2','#ccc5ae','#71858a','#9793a4','#454e4d'][tier],{map:null,bumpMap:null});b.box(color,[0,.247,-.18],[.208,.02,.035],[0,0,0],.006);}
  b.finish();return model;
 }
 function loadoutKey(profile){const selection=profile?.loadout||{};return JSON.stringify([selection,...Object.values(selection.custom||{}).filter(v=>typeof v==='string').map(id=>{const item=profile?.stash?.find(i=>i.id===id);return[item?.id,item?.catalogId,item?.attachments];})]);}
 function select(profile){
  const key=loadoutKey(profile);if(key===selectionKey)return;selectionKey=key;
  const loadout=resolveLoadout(profile||{});loadoutValid=loadout.valid;loadoutName=loadout.name||'Eigenes Kit';
  const equipment=loadout.equipment||{},gearKey=equipmentBuildKey(equipment);
  if(gearModel?.key!==gearKey){if(gearModel)disposeWeaponModel(gearModel);gearModel=makeStageEquipment(equipment);breathing.add(gearModel.root);}
  const next=loadout.weapon?weaponBuildKey(loadout.weapon.id,loadout.weapon.attachments):'';
  if(next!==buildKey||!armRoot){buildKey=next;if(activeWeapon)activeWeapon.root.visible=false;activeWeapon=loadout.weapon?pool.get(loadout.weapon.id,loadout.weapon.attachments):null;if(activeWeapon){riflePivot.add(activeWeapon.root);activeWeapon.root.visible=true;activeWeapon.root.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;}});}buildArms(activeWeapon);}
 }
 // Bunker architecture frames the operator; no flat terminal panels in the center.
 const room=new THREE.Group();scene.add(room);const b=batch(room);
 const concrete=material('#343f3e',{map:concreteMap,roughness:.96}),floor=material('#303b38',{map:concreteMap,roughness:.62,metalness:.18}),steel=material('#223137',{metalness:.66,roughness:.57}),paint=material('#73705a',{metalness:.28,roughness:.74});
 const lamp=material('#e5dcc2',{emissive:'#f2ba75',emissiveIntensity:3,roughness:.5}),cold=material('#c8e3e5',{emissive:'#78b7c7',emissiveIntensity:2.5});
 b.box(floor,[0,-.065,0],[12,.12,12]);b.box(concrete,[0,1.65,1.7],[10,3.4,.3]);
 for(const x of[-3,-1.8,1.3,2.9]){b.box(steel,[x,1.67,1.49],[.13,3.3,.18]);b.box(metal,[x-.055,1.67,1.382],[.018,3.3,.014]);}
 for(const y of[.16,2.85])b.box(steel,[0,y,1.49],[10,.11,.14]);
 for(const x of[-2.1,-1.65,-1.2]){b.box(steel,[x,1.07,1.175],[.42,2.11,.43]);b.box(fabricDark,[x,1.085,.946],[.376,1.98,.023]);for(let n=0;n<6;n++)b.box(black,[x,1.73+n*.044,.929],[.24,.014,.015]);b.box(metal,[x+.125,1.10,.917],[.02,.15,.023]);b.box(paint,[x-.04,1.42,.913],[.185,.071,.012]);}
 for(const x of[-2.7,2.25]){b.cylinder(steel,[x,1.6,1.40],.087,3.3);for(const y of[.55,1.8,2.8])b.cylinder(metal,[x,y,1.4],.105,.06);}
 b.box(steel,[1.82,.77,.75],[1.64,.105,.84]);b.box(paint,[1.82,.835,.75],[1.7,.03,.87]);for(const x of[1.11,2.53])for(const z of[.4,1.1])b.box(steel,[x,.38,z],[.075,.73,.075]);
 for(const x of[1.4,2.1]){b.box(black,[x,.94,.8],[.54,.17,.38]);b.box(metal,[x,1.03,.8],[.56,.035,.4]);for(const side of[-1,1])b.box(rubber,[x+side*.16,.95,.8],[.033,.21,.42]);}
 b.box(steel,[2.4,1.05,1.06],[.08,.5,.08]);b.tube(steel,[2.4,1.28,1.06],[2.15,1.52,.8],.031);b.box(steel,[2.1,1.5,.73],[.38,.075,.21],[0,0,-.21]);b.box(lamp,[2.1,1.458,.73],[.32,.02,.17],[0,0,-.21]);
 b.box(steel,[.13,2.9,.85],[1.7,.11,.25]);b.box(cold,[.13,2.835,.85],[1.51,.023,.15]);
 // Floor seams, drainage and restrained painted boundaries anchor the silhouette.
 for(const x of[-.76,.76])b.box(paint,[x,.001,-.1],[.019,.008,1.1]);
 for(let i=0;i<13;i++)b.box(black,[-.6+i*.1,.003,.64],[.045,.009,.11]);
 b.finish();
 const shadowTexture=texture(128,(ctx,n)=>{const gradient=ctx.createRadialGradient(n/2,n/2,8,n/2,n/2,n/2);gradient.addColorStop(0,'rgba(0,0,0,.72)');gradient.addColorStop(.42,'rgba(0,0,0,.38)');gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,n,n);});
 const contact=new THREE.Mesh(new THREE.PlaneGeometry(1.35,.93),new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false}));contact.rotation.x=-Math.PI/2;contact.position.set(0,.004,.04);scene.add(contact);
 const hemi=new THREE.HemisphereLight('#b2d9e6','#1a201c',.62);scene.add(hemi);
 const keyLight=new THREE.SpotLight('#c3dbe0',22,9,.63,.68,2);keyLight.position.set(-1.6,2.85,-2.0);keyLight.target.position.set(0,1.08,0);keyLight.castShadow=true;keyLight.shadow.mapSize.set(1024,1024);keyLight.shadow.bias=-.00012;keyLight.shadow.normalBias=.015;scene.add(keyLight,keyLight.target);
 const rim=new THREE.SpotLight('#f5b76b',28,8,.61,.65,2);rim.position.set(1.7,2.15,1.0);rim.target.position.set(0,1.1,-.1);scene.add(rim,rim.target);
 const front=new THREE.DirectionalLight('#b9cbd2',.67);front.position.set(.2,1.1,-3);scene.add(front);
 const workLight=new THREE.PointLight('#d79c62',1.8,3,2);workLight.position.set(2.1,1.4,.7);scene.add(workLight);
 const dustPositions=[];for(let i=0;i<55;i++)dustPositions.push(Math.sin(i*18.19)*2,.35+(i%19)*.13,Math.cos(i*8.17)*1.2);const dustGeometry=new THREE.BufferGeometry();dustGeometry.setAttribute('position',new THREE.Float32BufferAttribute(dustPositions,3));const dust=new THREE.Points(dustGeometry,new THREE.PointsMaterial({color:'#aec4c4',size:.006,transparent:true,opacity:.25,depthWrite:false}));scene.add(dust);
 return{
  scene,camera,
  update(profile,dt,width,height,settings={}){if(disposed)return;active=true;select(profile);time+=Math.min(.1,Math.max(0,dt));breathing.position.y=Math.sin(time*1.45)*.0045;breathing.rotation.z=Math.sin(time*.73)*.002;head.rotation.y=Math.sin(time*.35)*.025;head.rotation.x=Math.sin(time*.61)*.008;actor.rotation.y=-.22+Math.sin(time*.18)*.025;
   if(gearModel){gearModel.head.rotation.copy(head.rotation);gearModel.head.position.y=head.position.y;}
   camera.aspect=width/Math.max(1,height);camera.fov=height<650?37:34;const aspect=camera.aspect;camera.position.set(.18,1.07,aspect<1.4?-4.5:-4.25);const composition=aspect<1.7?-.055:.11;camera.lookAt(composition,1.0,0);camera.updateProjectionMatrix();
   keyLight.castShadow=settings.shadows!=='off'&&settings.quality!=='low';dust.visible=settings.particles!==false;dust.rotation.y=time*.009;
  },
  setActive(value){active=!!value;},
  setEnvironment(texture){scene.environment=texture;},
  restoreContext(){keyLight.shadow.map?.dispose();keyLight.shadow.map=null;keyLight.shadow.mapPass?.dispose();keyLight.shadow.mapPass=null;},
  stats(){return{menuOperator:active,menuStage:'bunker',menuLoadoutValid:loadoutValid,menuLoadoutName:loadoutName,menuWeaponId:activeWeapon?.id||null,menuWeaponBuildKey:buildKey||null,menuAttachments:{...activeWeapon?.attachments},menuEquipment:gearModel?.gear||{},menuCachedWeapons:pool.size,menuCameraFov:camera.fov,menuEnvironmentId:scene.environment?.id??null,menuBreath:breathing.position.y,menuCharacterHeight:1.88};},
  dispose(){if(disposed)return;disposed=true;pool.dispose();if(gearModel)disposeWeaponModel(gearModel);disposeTree(scene);},
 };
}
