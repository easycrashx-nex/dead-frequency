import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {getWeapon} from './weapons.js';
import {getAttachment,canAttach,deriveWeapon,getEquipment} from './loadouts.js';
const UP=new THREE.Vector3(0,1,0);
const SLOTS=['optic','magazine','muzzle','grip','stock','barrel'];
export const opticalFieldOfView=(fov,zoom=1)=>2*Math.atan(Math.tan(THREE.MathUtils.degToRad(fov)/2)/Math.max(1,zoom))*180/Math.PI;

export function weaponBuildKey(id, attachments = {}) {
  return `${getWeapon(id)?.id || 'VX-9'}|${SLOTS.map(slot=>{const part=typeof attachments?.[slot]==='string'?attachments[slot]:attachments?.[slot]?.catalogId;return `${slot}:${getAttachment(part)?.slot===slot&&canAttach(id,part)?part:''}`;}).join('|')}`;
}
export function disposeWeaponModel(model) {
  if(!model || model.disposed)return;
  model.disposed=true;model.root.removeFromParent();
  const geometries=new Set(),materials=new Set(model.materials||[]);
  model.root.traverse(node=>{if(node.geometry)geometries.add(node.geometry);if(node.material)(Array.isArray(node.material)?node.material:[node.material]).forEach(material=>materials.add(material));});
  geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());
}

export function createWeaponModelPool(remote = false, limit = 6) {
  const models=new Map();
  return {
    get(id,attachments={}) {
      const key=weaponBuildKey(id,attachments);
      if(models.has(key)){const model=models.get(key);models.delete(key);models.set(key,model);return model;}
      const model=makeWeaponModel(id,remote,attachments);models.set(key,model);
      while(models.size>limit){const first=models.keys().next().value;disposeWeaponModel(models.get(first));models.delete(first);}
      return model;
    },
    get size(){return models.size;},
    dispose(){models.forEach(disposeWeaponModel);models.clear();},
  };
}

function makeBatch(parent) {
  const batches = new Map();
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  function add(geometry, material, pos, size = [1, 1, 1], rot = [0, 0, 0]) {
    position.set(...pos); scale.set(...size); quaternion.setFromEuler(new THREE.Euler(...rot));
    matrix.compose(position, quaternion, scale);
    geometry.applyMatrix4(matrix);
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(geometry);
  }
  return {
    box(mat, p, s, r) { add(new THREE.BoxGeometry(1, 1, 1), mat, p, s, r); },
    bevel(mat, p, s, r) { add(new RoundedBoxGeometry(...s, 1, Math.min(...s) * .12), mat, p, [1, 1, 1], r); },
    cylinder(mat, p, radius, height, radiusTop = radius, rotation = [0, 0, 0], segments = 12) {
      add(new THREE.CylinderGeometry(radiusTop, radius, height, segments), mat, p, [1, 1, 1], rotation);
    },
    sphere(mat, p, s) { add(new THREE.SphereGeometry(1, 12, 8), mat, p, s); },
    beam(mat, a, b, radius = .08) {
      const va = new THREE.Vector3(...a); const vb = new THREE.Vector3(...b); const delta = vb.clone().sub(va);
      const g = new THREE.CylinderGeometry(radius, radius, delta.length(), 5);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, delta.normalize());
      g.applyQuaternion(q); g.translate(...va.add(vb).multiplyScalar(.5).toArray());
      if (!batches.has(mat)) batches.set(mat, []); batches.get(mat).push(g);
    },
    finish(shadows = true) {
      const meshes = [];
      for (const [material, geometries] of batches) {
        const normalized = geometries.some(g => !g.index) ? geometries.map(g => g.index ? g.toNonIndexed() : g) : geometries;
        const merged = mergeGeometries(normalized, false);
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, material); mesh.castShadow = shadows; mesh.receiveShadow = shadows;
        parent.add(mesh); meshes.push(mesh); geometries.forEach(g => g.dispose());
        normalized.forEach((g, i) => { if (g !== geometries[i]) g.dispose(); });
      }
      batches.clear(); return meshes;
    },
  };
}

// Authored receivers share a grip coordinate. Independent mechanisms and slot
// mounts allow the editor, first person and remote operator to use one factory.
export function makeWeaponModel(id, remote = false, attachments = {}) {
  const specification = getWeapon(id) || getWeapon('VX-9');
  const effective=deriveWeapon(specification.id,attachments);attachments=effective.attachments;
  const mounted=Object.fromEntries(Object.entries(attachments).map(([slot,partId])=>[slot,getAttachment(partId)]));
  const barrelChange=({long:.24,short:-.17,heavy:.065,fluted:.12,ported:-.035,cold:.09})[mounted.barrel?.model]||0;
  const root = new THREE.Group(); root.name = `weapon-${specification.id}`;
  const batch = makeBatch(root), b = { ...batch, box: (...args) => batch.bevel(...args) };
  const materials=[];
  const mat = (color, metalness = .6, roughness = .46) => {const material=new THREE.MeshStandardMaterial({ color, metalness, roughness });materials.push(material);return material;};
  const black = mat('#1f292b', .72, .36), steel = mat('#76858a', .86, .3), rubber = mat('#25302d', .04, .9);
  const colors = { smg: '#56636c', assault: '#667462', bullpup: '#ad9c78', shotgun: '#885239', marksman: '#637567', sniper: '#aaa18a', machinegun: '#6d7251', revolver: '#c0bfb1',pistol:'#47545a' };
  const finishes={'KX-5':'#3d4b51','PDW-46':'#b4b08d','TMP-22':'#484f49','SM-45':'#738071','AK-74':'#48544d','HK-416':'#687678','SC-17':'#b6a37e','AS-VAL':'#526352','QB-95':'#47594d','AUG-77':'#84886a','FS-2000':'#849386','KS-12':'#596568','DB-2':'#c0b8a7','M4-90':'#536057','MK-14':'#7b694d','SVD-63':'#727951','RS-308':'#aca081','AX-50':'#858b86','M24-7':'#626e51','SV-98':'#71846b','PK-90':'#657252','LM-46':'#aa9b73','P9-19':'#50595e','DE-50':'#c1c4bf'};
  const body = mat(finishes[id]||colors[specification.model], specification.model === 'revolver'||id==='DE-50' ? .88 : .5);
  const brass = mat('#bfa061', .8, .35), wood = mat('#76503b', .06, .74);
  const model = { root,materials,id: specification.id, model: specification.model,variant:specification.variant,attachments:{...attachments},buildKey:weaponBuildKey(id,attachments),muzzleZ: -.97, sightHeight: .2, lens: 'reflex', support: [0, 0, 0], mag: null, pump: null, bolt: null, drum: null, cover: null, cartridges: null };
  const cylinder = (m, p, radius, length, segments = 12) => b.cylinder(m, p, radius, length, radius, [Math.PI / 2, 0, 0], segments);
  function part(name, position, draw) {
    const group = new THREE.Group(); group.name = name; group.position.set(...position); group.userData.rest = [...position]; root.add(group);
    const pb = makeBatch(group); draw({ ...pb, box: (...args) => pb.bevel(...args) }); pb.finish(false);
    if(model.breakAction&&/^attachment-(muzzle|barrel)-/.test(name))model.breakAction.attach(group);
    if(model.pump&&name.startsWith('attachment-grip-'))model.pump.attach(group);
    return group;
  }
  function grip(material = rubber) {
    b.box(material, [0, -.136, -.094], [.085, .2, .105], [.24, 0, 0]);
    b.box(black, [0, -.123, -.193], [.09, .019, .13]); b.box(black, [0, -.089, -.255], [.085, .064, .018]);
    if (!remote) for (let y = -.205; y < -.1; y += .025) b.box(black, [-.044, y, -.094], [.009, .009, .079], [.24, 0, 0]);
  }
  function stock(material = body, rear = .23, style = 'solid') {
    model.stockAnchor=rear;
    if(mounted.stock)return;
    if(style==='wire'||style==='skeleton'){
      for(const x of [-.047,.047])b.box(steel,[x,.005,rear*.35],[.017,.023,rear+.09]);
      if(style==='skeleton')b.box(material,[0,-.06,rear*.42],[.042,.035,rear*.82],[-.25,0,0]);
      b.box(rubber,[0,-.037,rear],[.11,.19,.035]);return;
    }
    if(style==='precision'){
      cylinder(steel,[0,.01,.13],.027,.26);b.box(material,[0,.065,rear-.07],[.125,.075,.2]);
      b.box(steel,[0,-.061,rear-.095],[.07,.03,.17]);b.box(rubber,[0,-.038,rear+.04],[.125,.21,.032]);
      for(const z of [rear-.04,rear-.12])b.cylinder(steel,[0,-.004,z],.016,.13,.016);return;
    }
    if(style==='wood'){
      b.box(material,[0,-.047,rear*.32],[.125,.145,rear+.17],[.12,0,0]);
      b.box(material,[0,-.088,rear-.024],[.155,.185,.17],[-.11,0,0]);b.box(rubber,[0,-.064,rear+.056],[.16,.2,.026]);return;
    }
    cylinder(steel, [0, .012, (rear-.155)/2], .024, rear-.075); b.box(material, [0, -.022, rear - .075], [.1, .16, .2]);
    b.box(rubber, [0, -.029, rear + .035], [.12, .19, .028]);
    if(style==='folding'){b.cylinder(steel,[.07,.015,.004],.027,.16,.027);b.box(material,[0,.077,rear-.05],[.14,.051,.16]);}
  }
  function barrel(end, radius = .023, start = -.53) {
    end=Math.min(start-.11,end+(-barrelChange));radius*=({heavy:1.65,fluted:1.13,ported:1.16,cold:1.3})[mounted.barrel?.model]||1;
    cylinder(steel, [0, .026, (end + start) / 2], radius, start - end);
    if(!mounted.muzzle)cylinder(black, [0, .026, end + .023], radius * 1.5, .075);
    cylinder(rubber, [0, .026, end - .017], radius * .73, .006); model.muzzleZ = end - .04;
    if(mounted.barrel){
      const type=mounted.barrel.model;
      if(type==='fluted')for(let a=0;a<6;a++){const angle=a*Math.PI/3;b.box(black,[Math.sin(angle)*radius,.026+Math.cos(angle)*radius,(start+end)/2],[.008,.008,(start-end)*.78]);}
      else if(type==='ported')for(let z=end+.03;z<end+.18;z+=.036)for(const side of [-1,1])b.box(black,[side*radius,.035,z],[.007,.018,.014]);
      else if(type==='cold')for(let z=end+.03;z<start;z+=.11)cylinder(body,[0,.026,z],radius*1.07,.022);
      else if(type==='heavy')for(let z=end+.05;z<start;z+=.075)cylinder(black,[0,.026,z],radius*1.03,.01);
    }
  }
  function rail(start = -.38, end = -.02) {
    b.box(black, [0, .096, (start + end) / 2], [.08, .026, end - start]);
    if (!remote) for (let z = start; z < end; z += .034) b.box(steel, [0, .116, z], [.095, .013, .017]);
  }
  function vents(start, end, width = .145) {
    if (remote) return;
    for (let z = start; z > end; z -= .043) for (const side of [-1, 1]) b.box(black, [side * width / 2, .026, z], [.012, .04, .025]);
  }
  function reflex(z = -.275, wide = false) {
    if(mounted.optic)return;
    const width = wide ? .075 : .061;
    b.box(black, [0, .129, z], [width * 2, .037, .077]);
    for (const side of [-1, 1]) b.box(black, [side * width, .199, z], [.019, .12, .059], [0, 0, side * .1]);
    b.box(black, [0, .263, z], [width * 2, .015, .059]);
    b.box(body, [.091, .164, z], [.035, .046, .064]); model.lensZ = z;
  }
  function scope(length, radius, z) {
    if(mounted.optic)return;
    model.lens = 'scope'; model.lensZ = z + length / 2 - .018;
    for (const pz of [z - length * .29, z + length * .29]) {
      b.box(black, [0, .118, pz], [.066, .067, .045]);
      const mount = new THREE.Mesh(new THREE.TorusGeometry(radius + .003, .006, 5, 20), steel); mount.position.set(0, .2, pz); root.add(mount);
    }
    const tubeMaterial = black.clone(); tubeMaterial.side = THREE.DoubleSide;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 24, 1, true), tubeMaterial);
    tube.rotation.x = Math.PI / 2; tube.position.set(0, .2, z); root.add(tube);
    for (const pz of [z - length / 2, z + length / 2]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius * .79, radius * 1.1, 24), tubeMaterial); ring.position.set(0, .2, pz); root.add(ring);
    }
    b.cylinder(black, [0, .2 + radius + .019, z], .025, .044, .025, [0, 0, 0], 12);
    b.cylinder(black, [radius + .019, .2, z], .025, .044, .025, [0, 0, Math.PI / 2], 12);
    b.box(steel, [0, .2 + radius + .043, z], [.028, .004, .008]);
  }
  function magazine(position, size, material = rubber, curve = 0) {
    const type=mounted.magazine?.model;
    size=[...size];size[1]*=({extended:1.4,compact:.7,precision:1.12})[type]||1;
    model.mag = part('magazine', position, pb => {
      if(type==='drum'){
        pb.box(black,[0,-.065,0],[size[0],.13,size[2]]);
        pb.cylinder(body,[0,-.197,0],.145,.176,.145,[0,0,Math.PI/2],24);
        for(const x of [-.091,.091]){pb.cylinder(black,[x,-.197,0],.122,.008,.122,[0,0,Math.PI/2],24);pb.cylinder(steel,[x*1.05,-.197,0],.047,.009,.047,[0,0,Math.PI/2],16);}return;
      }
      if(type==='precision')material=steel;
      pb.box(material, [0, -size[1] / 2, 0], size, [curve, 0, 0]);
      pb.box(black, [0, -size[1], size[1] * Math.sin(curve) / -2], [size[0] + .013, .023, size[2] + .02]);
      if (!remote) for (const side of [-1, 1]) for (let z = -size[2] * .3; z < size[2] * .4; z += .04) pb.box(steel, [side * (size[0] / 2 + .003), -size[1] * .5, z], [.005, size[1] * .67, .01], [curve, 0, 0]);
      if(type==='pulltab'){for(const x of [-size[0]*.4,size[0]*.4])pb.box(body,[x,-size[1]-.04,.02],[.022,.07,.04]);pb.box(body,[0,-size[1]-.073,.02],[size[0],.021,.045]);}
      if(type==='coupled'){pb.box(body,[size[0]+.023,-size[1]*.45,.02],size,[curve,0,0]);for(const y of [-size[1]*.3,-size[1]*.7])pb.box(black,[size[0]*.55,y,0],[size[0]*2+.043,.046,size[2]+.02]);}
      if(type==='precision')for(const side of [-1,1])pb.box(brass,[side*(size[0]*.5+.004),-.04,0],[.008,.017,size[2]*.6]);
    });
  }
  const receiver=(w,h,start,end,material=body)=>{model.receiverHalfWidth??=w/2;b.box(material,[0,.005,(start+end)/2],[w,h,end-start]);};
  function handguard(start,end,material=body,width=.145,height=.135){receiver(width,height,start,end,material);vents(end-.02,start+.01,width);}
  function bipod(z,spread=.095){for(const side of [-1,1]){b.box(black,[side*spread,-.088,z],[.024,.035,.31],[0,side*.055,0]);b.box(steel,[side*(spread+.01),-.096,z-.146],[.043,.032,.055]);}}
  function boltHandle(z=-.055){model.bolt=part('bolt-handle',[.071,.047,z],pb=>{pb.cylinder(steel,[.043,0,0],.012,.095,.012,[0,0,Math.PI/2],10);pb.box(steel,[.082,-.03,0],[.019,.071,.019]);pb.sphere(black,[.085,-.07,0],[.025,.025,.025]);});}
  function shells(){model.cartridges=part('reload-shell',[-.082,-.2,-.27],pb=>{pb.cylinder(wood,[0,0,0],.018,.093,.018,[Math.PI/2,0,0],10);pb.cylinder(brass,[0,0,.044],.02,.014,.02,[Math.PI/2,0,0],10);});model.cartridges.visible=false;}
  function variant() {
    switch(specification.id){
      case 'KX-5':
        cylinder(body,[0,.021,-.25],.08,.35);receiver(.12,.09,-.33,-.055,black);grip();stock(black,.2,'wire');
        handguard(-.53,-.38,rubber,.145,.15);for(let z=-.4;z>-.52;z-=.025)b.box(black,[0,-.063,z],[.154,.022,.012]);
        barrel(-.69,.022,-.46);rail(-.32,-.06);reflex(-.18);magazine([0,-.056,-.245],[.067,.34,.103],steel,-.18);model.support=[0,-.015,.05];break;
      case 'PDW-46':
        receiver(.19,.18,-.46,.19);b.box(body,[0,-.048,.224],[.2,.24,.059]);grip(body);
        b.box(body,[0,-.12,-.34],[.18,.15,.13]);b.box(black,[0,-.067,-.267],[.105,.065,.08]);
        magazine([0,.105,-.092],[.154,.06,.42],mat('#687e79',.2,.32));
        b.box(steel,[0,.149,-.091],[.088,.01,.36]);barrel(-.59,.021,-.42);reflex(-.4,true);model.support=[0,-.018,.1];break;
      case 'TMP-22':
        receiver(.125,.14,-.31,-.015);grip();barrel(-.415,.023,-.25);stock(black,.15,'wire');
        magazine([0,-.195,-.086],[.067,.225,.09],black,-.08);b.box(rubber,[0,-.125,-.29],[.058,.14,.069]);
        rail(-.28,-.035);reflex(-.17);b.box(steel,[.078,.032,-.09],[.045,.024,.029]);model.support=[0,-.055,.16];break;
      case 'SM-45':
        receiver(.158,.163,-.48,-.012);handguard(-.62,-.44,rubber,.164,.14);grip();stock(body,.29,'folding');
        barrel(-.83,.028,-.56);rail(-.4,-.04);reflex(-.25,true);magazine([0,-.075,-.294],[.08,.273,.13],body);
        b.box(black,[0,-.132,-.52],[.063,.177,.082]);model.support=[0,-.036,-.038];break;
      case 'AK-74':
        receiver(.14,.165,-.38,-.005,black);grip(wood);stock(wood,.285,'wood');
        handguard(-.63,-.4,wood,.145,.136);cylinder(steel,[0,.094,-.629],.018,.34);barrel(-1.055,.023,-.56);
        b.box(black,[0,.081,-.854],[.037,.106,.053]);rail(-.26,-.025);reflex(-.14);magazine([0,-.084,-.306],[.093,.34,.16],body,-.31);break;
      case 'HK-416':
        receiver(.16,.175,-.395,.012);grip();stock(black,.3);handguard(-.82,-.397,body,.171,.166);barrel(-1.07,.025,-.7);
        for(const side of [-1,1])for(let z=-.44;z>-.79;z-=.035)b.box(steel,[side*.091,.015,z],[.02,.063,.018]);
        rail(-.8,.015);reflex(-.265,true);magazine([0,-.081,-.319],[.096,.27,.153],rubber,-.14);model.support=[0,-.026,-.065];break;
      case 'SC-17':
        receiver(.181,.19,-.52,.009);handguard(-.73,-.49,body,.187,.146);grip();stock(body,.34,'folding');
        barrel(-1.045,.03,-.67);rail(-.67,.026);reflex(-.27,true);magazine([0,-.093,-.325],[.117,.221,.182],black,-.05);
        b.box(steel,[-.11,.056,-.321],[.083,.024,.026]);model.support=[0,-.032,-.018];break;
      case 'AS-VAL':
        receiver(.14,.148,-.38,-.01);grip(rubber);stock(black,.31,'skeleton');handguard(-.57,-.36,rubber,.14,.13);
        barrel(-1.06,.05,-.51);for(let z=-.65;z>-.99;z-=.054)cylinder(black,[0,.026,z],.052,.009);
        rail(-.34,-.05);reflex(-.22);magazine([0,-.081,-.28],[.086,.236,.149],body,-.27);break;
      case 'QB-95':
        receiver(.179,.19,-.42,.211);b.box(rubber,[0,-.025,.254],[.188,.216,.05]);grip(body);handguard(-.61,-.42,body,.18,.173);
        for(const z of [-.36,-.09])b.box(black,[0,.165,z],[.06,.15,.043]);b.box(body,[0,.246,-.225],[.077,.037,.351]);
        barrel(-.86,.025,-.54);magazine([0,-.094,.062],[.102,.275,.159],black,-.28);rail(-.35,-.09);reflex(-.2);break;
      case 'AUG-77':
        b.sphere(body,[0,-.017,-.06],[.097,.117,.349]);receiver(.175,.16,-.35,.18);b.box(rubber,[0,-.018,.28],[.18,.217,.027]);
        grip(body);b.box(body,[0,-.157,-.194],[.13,.03,.155]);handguard(-.48,-.35,body,.133,.146);barrel(-.94,.022,-.39);
        b.box(black,[0,-.145,-.429],[.062,.176,.076],[-.18,0,0]);rail(-.35,-.045);scope(.235,.058,-.22);
        magazine([0,-.101,.069],[.097,.247,.16],mat('#848575',.2,.37),-.15);model.support=[0,-.06,0];break;
      case 'FS-2000':
        b.sphere(body,[0,.003,-.145],[.129,.153,.456]);receiver(.226,.21,-.44,.202);b.box(rubber,[0,-.022,.296],[.236,.23,.052]);
        grip(body);handguard(-.63,-.38,rubber,.208,.167);b.box(body,[0,-.156,-.22],[.187,.055,.192]);
        barrel(-.735,.027,-.58);rail(-.48,-.035);reflex(-.255,true);magazine([0,-.117,.095],[.108,.205,.17],black,-.11);
        b.box(steel,[.118,.024,-.489],[.014,.052,.101]);model.support=[0,-.03,-.017];break;
      case 'KS-12':
        receiver(.166,.182,-.413,-.02);grip();stock(body,.28,'folding');handguard(-.7,-.413,black,.185,.164);barrel(-1.02,.038,-.6);
        cylinder(steel,[0,.104,-.57],.022,.38);rail(-.48,-.025);reflex(-.24,true);magazine([0,-.092,-.3],[.126,.29,.204],black,-.22);break;
      case 'DB-2':
        model.lens='iron';model.sightHeight=.116;receiver(.177,.134,-.3,-.014,body);grip(wood);stock(wood,.31,'wood');
        model.breakAction=part('break-action',[0,-.021,-.285],pb=>{const length=.78+barrelChange;for(const x of [-.046,.046]){pb.cylinder(steel,[x,.044,-length/2+.02],.038,.78+barrelChange,.038,[Math.PI/2,0,0],14);pb.cylinder(black,[x,.044,-length+.014],.029,.009,.029,[Math.PI/2,0,0],14);}pb.box(wood,[0,-.021,-.242],[.157,.089,.31]);pb.box(black,[0,.083,-length/2+.02],[.024,.031,length-.04]);});
        b.box(steel,[0,.085,-.065],[.021,.032,.101]);model.muzzleZ=-1.08-barrelChange;model.support=[0,-.022,-.015];shells();break;
      case 'M4-90':
        receiver(.154,.169,-.407,-.008,black);grip(rubber);stock(black,.295);handguard(-.681,-.4,rubber,.172,.144);barrel(-1.17,.035,-.49);
        cylinder(black,[0,-.052,-.786],.03,.64);rail(-.36,-.045);reflex(-.21);b.box(black,[0,.085,-1.03],[.034,.108,.053]);
        for(let z=-.425;z>-.653;z-=.03)b.box(body,[0,-.06,z],[.18,.015,.009]);shells();break;
      case 'MK-14':
        receiver(.151,.151,-.394,-.022,steel);b.box(wood,[0,-.053,-.284],[.172,.107,.596]);grip(wood);stock(wood,.37,'wood');
        handguard(-.749,-.386,wood,.143,.113);barrel(-1.206,.026,-.61);cylinder(black,[0,-.025,-.92],.02,.29);
        rail(-.35,-.045);scope(.237,.067,-.23);magazine([0,-.102,-.292],[.107,.216,.175],steel);model.support=[0,-.031,-.065];break;
      case 'SVD-63':
        receiver(.137,.149,-.39,-.008,black);grip(wood);stock(wood,.363,'skeleton');handguard(-.831,-.389,wood,.139,.148);
        barrel(-1.359,.024,-.7);cylinder(steel,[0,.094,-.949],.018,.275);b.box(black,[0,.11,-1.205],[.027,.091,.036]);
        b.box(steel,[-.086,.039,-.248],[.027,.151,.175]);rail(-.4,-.047);scope(.315,.064,-.25);magazine([0,-.078,-.292],[.102,.195,.182],black,-.23);model.support=[0,-.015,-.07];break;
      case 'RS-308':
        receiver(.166,.172,-.401,.019);grip();stock(body,.381,'precision');handguard(-.958,-.404,body,.169,.152);barrel(-1.283,.03,-.84);
        rail(-.91,.03);scope(.345,.081,-.29);magazine([0,-.091,-.314],[.111,.17,.184],steel);bipod(-.916);model.support=[0,-.024,-.08];break;
      case 'AX-50':
        receiver(.229,.181,-.537,.06);grip();stock(body,.44,'precision');handguard(-.927,-.514,body,.208,.16);barrel(-1.665,.042,-.79);
        b.box(black,[0,.026,-1.616],[.131,.09,.177]);for(const side of [-1,1])for(let z=-1.555;z> -1.68;z-=.045)b.box(steel,[side*.068,.026,z],[.013,.065,.016]);
        rail(-.57,.044);scope(.5,.102,-.3);magazine([0,-.101,-.383],[.142,.161,.241],black);boltHandle(.025);bipod(-.879,.131);model.support=[0,-.047,-.095];break;
      case 'M24-7':
        b.box(body,[0,-.049,-.26],[.147,.128,.71]);cylinder(steel,[0,.04,-.219],.049,.399);grip(body);stock(body,.395,'wood');
        barrel(-1.395,.024,-.574);rail(-.391,.018);scope(.35,.075,-.242);magazine([0,-.104,-.278],[.091,.064,.145],black);boltHandle(-.043);
        for(const x of [-.074,.074])b.box(rubber,[x,-.025,-.511],[.006,.074,.17]);model.support=[0,-.038,-.025];break;
      case 'SV-98':
        receiver(.174,.16,-.523,.025);b.box(body,[0,-.067,-.352],[.17,.094,.62]);grip(wood);stock(body,.448,'precision');
        handguard(-.79,-.507,body,.157,.106);barrel(-1.462,.029,-.694);rail(-.445,.025);scope(.462,.087,-.298);
        magazine([0,-.11,-.307],[.111,.13,.176],black);boltHandle(-.036);bipod(-.756,.117);b.box(steel,[0,-.166,.299],[.055,.103,.026]);model.support=[0,-.034,-.047];break;
      case 'PK-90':
        receiver(.202,.19,-.55,.009,black);grip(wood);stock(wood,.362,'wood');barrel(-1.394,.03,-.49);cylinder(black,[0,.025,-.805],.061,.284);
        magazine([-.074,-.107,-.309],[.31,.287,.257],body);model.cover=part('feed-cover',[0,.097,-.471],pb=>pb.box(body,[0,.014,.21],[.209,.044,.43]));
        model.belt=part('ammunition-belt',[-.135,.052,-.278],pb=>{for(let i=0;i<11;i++)pb.cylinder(brass,[-i*.025,-i*i*.0014,0],.012,.145,.012,[Math.PI/2,0,0],8);});
        b.box(wood,[-.128,.194,-.639],[.03,.039,.201]);for(const z of [-.545,-.725])b.box(steel,[-.127,.118,z],[.021,.153,.023]);rail(-.33,-.066);reflex(-.21);bipod(-1.05,.12);model.support=[0,-.032,-.075];break;
      case 'LM-46':
        receiver(.185,.176,-.468,.035);grip();stock(black,.316,'skeleton');handguard(-.812,-.456,black,.177,.152);barrel(-1.107,.029,-.713);
        magazine([0,-.091,-.307],[.176,.265,.208],body,-.11);rail(-.451,.021);reflex(-.24,true);bipod(-.789);
        b.box(black,[.12,.174,-.511],[.022,.035,.19]);for(const z of [-.425,-.59])b.box(steel,[.118,.113,z],[.024,.139,.02]);model.support=[0,-.037,-.037];break;
      case 'P9-19':case 'DE-50': {
        const heavy=id==='DE-50',length=(heavy?.48:.335)+barrelChange*.55,width=heavy?.111:.09;model.lens='iron';model.sightHeight=.112;model.support=[-.02,-.091,.351];
        b.box(rubber,[0,-.054,-length*.4],[width,.102,length*.75]);grip(heavy?rubber:body);
        model.slide=part('reciprocating-slide',[0,.042,-.09],pb=>{pb.box(body,[0,0,-length*.35],[width,.096,length]);for(const x of [-width*.44,width*.44])pb.box(black,[x,.059,-.041],[.014,.032,.046]);pb.box(black,[0,.054,-length*.8],[.012,.029,.029]);if(!remote)for(let z=-.045;z>-.135;z-=.019)for(const x of [-1,1])pb.box(steel,[x*(width*.5+.002),.01,z],[.006,.059,.007]);});
        cylinder(steel,[0,.044,-length*.61],heavy?.025:.018,length*.82);cylinder(black,[0,.044,-length*.99],heavy?.018:.012,.019);model.muzzleZ=-length*1.02;
        magazine([0,-.21,-.08],[width*.7,heavy?.075:.072,.095],black);b.box(steel,[0,.044,-.031],[.045,.053,.046]);break;
      }
      default:return false;
    }
    return true;
  }
  if(!variant())switch (specification.model) {
    case 'smg':
      b.box(body, [0, .004, -.233], [.137, .148, .34]); b.box(black, [0, -.06, -.19], [.126, .08, .26]);
      b.box(rubber, [0, .002, -.455], [.121, .13, .14]); vents(-.4, -.53, .121); grip();
      barrel(-.66, .022, -.48); cylinder(black, [0, .026, -.591], .036, .068);
      if(!mounted.stock){for (const x of [-.043, .043]) b.box(steel, [x, .015, .066], [.018, .022, .24]);b.box(rubber, [0, -.026, .195], [.1, .17, .03]);} b.box(black, [0, .052, -.04], [.135, .045, .068]);
      rail(-.36, -.02); reflex(-.25); magazine([0, -.07, -.275], [.065, .31, .095], black, -.11);
      b.cylinder(steel, [-.1, .029, -.325], .015, .07, .015, [0, 0, Math.PI / 2], 8);
      model.support = [0, -.014, .035]; break;
    case 'assault':
      b.box(body, [0, .008, -.23], [.147, .16, .4]); b.box(body, [0, .026, -.52], [.137, .13, .23]);
      grip(); stock(); barrel(-.95); vents(-.43, -.64); rail(); reflex(); magazine([0, -.075, -.32], [.095, .26, .14], rubber, -.12); break;
    case 'bullpup':
      b.box(body, [0, -.005, -.085], [.179, .197, .61]); b.box(rubber, [0, -.04, .241], [.18, .22, .035]);
      b.box(black, [0, .091, .065], [.157, .056, .28]); b.box(body, [0, .015, -.466], [.151, .139, .22]);
      grip(body); b.box(body, [-.064, -.105, -.212], [.023, .119, .18]); b.box(body, [.064, -.105, -.212], [.023, .119, .18]);
      barrel(-.765); vents(-.395, -.566, .154); rail(-.48, .045); reflex(-.31, true);
      magazine([0, -.092, .064], [.105, .25, .164], black, -.12);
      b.box(steel, [.094, .02, .067], [.012, .041, .145]); b.box(black, [-.102, .034, -.353], [.04, .025, .036]); break;
    case 'shotgun':
      model.lens = 'iron'; model.sightHeight = .137;
      b.box(black, [0, .012, -.212], [.139, .159, .35]); grip(wood); stock(wood, .245);
      barrel(-1.11, .036, -.35); cylinder(black, [0, -.054, -.663], .034, .6);
      model.pump = part('pump', [0, -.011, -.48], pb => {
        pb.box(wood, [0, -.035, 0], [.159, .116, .235]);
        for (let z = -.1; z < .11; z += .025) pb.box(rubber, [0, -.039, z], [.167, .12, .009]);
      });
      b.box(steel, [.075, .022, -.235], [.012, .067, .164]); b.box(black, [.083, .022, -.231], [.008, .046, .126]);
      b.box(black, [0, .092, -.12], [.1, .032, .066]);
      for (const x of [-.032, .032]) b.box(steel, [x, .119, -.12], [.013, .044, .033]);
      b.box(black, [0, .071, -1], [.022, .075, .038]); b.box(brass, [0, .128, -1], [.012, .022, .015]);
      for (let z = -.31; z < -.08; z += .045) { cylinder(wood, [-.086, -.013, z], .017, .091); b.box(brass, [-.086, -.013, z + .048], [.031, .031, .011]); }
      model.cartridges = part('reload-shell', [-.082, -.2, -.27], pb => { pb.cylinder(wood, [0, 0, 0], .018, .093, .018, [Math.PI / 2, 0, 0], 10); pb.cylinder(brass, [0, 0, .044], .02, .014, .02, [Math.PI / 2, 0, 0], 10); });
      model.cartridges.visible = false; break;
    case 'marksman':
      b.box(body, [0, .003, -.218], [.154, .157, .41]); b.box(body, [0, .027, -.581], [.143, .137, .33]);
      grip(); stock(body, .28); b.box(rubber, [0, .078, .17], [.12, .06, .19]);
      vents(-.435, -.742); barrel(-1.055, .026, -.68);
      if(!mounted.muzzle&&!mounted.barrel){cylinder(black, [0, .026, -1.123], .044, .26); cylinder(rubber, [0, .026, -1.257], .027, .006); model.muzzleZ = -1.28;}
      rail(-.47, .014); scope(.29, .075, -.255); magazine([0, -.078, -.319], [.099, .158, .16], steel);
      for (const side of [-1, 1]) b.box(black, [side * .091, -.027, -.656], [.023, .036, .238], [0, side * .1, 0]); break;
    case 'sniper':
      b.box(body, [0, -.045, -.28], [.157, .151, .71]); cylinder(steel, [0, .036, -.198], .056, .38);
      grip(rubber); stock(body, .34); b.box(body, [0, .079, .205], [.127, .073, .2]);
      b.box(black, [0, -.053, .141], [.106, .029, .15]); b.box(steel, [0, -.105, .286], [.09, .019, .041]);
      barrel(-1.37, .03, -.47); if(!mounted.muzzle&&!mounted.barrel){cylinder(black, [0, .026, -1.307], .049, .15); model.muzzleZ = -1.41;}
      for (let z = -.43; z > -.64; z -= .053) b.box(rubber, [-.08, -.017, z], [.006, .043, .03]);
      rail(-.4, .026); scope(.41, .089, -.255); magazine([0, -.109, -.286], [.09, .095, .155], black);
      model.bolt = part('bolt-handle', [.071, .047, -.065], pb => {
        pb.cylinder(steel, [.035, 0, 0], .012, .09, .012, [0, 0, Math.PI / 2], 10);
        pb.cylinder(steel, [.076, -.033, 0], .012, .079, .012, [0, 0, -.18], 10); pb.sphere(black, [.081, -.077, 0], [.026, .026, .026]);
      });
      for (const side of [-1, 1]) { b.box(black, [side * .075, -.075, -.655], [.029, .032, .247], [0, side * .07, 0]); b.box(steel, [side * .092, -.082, -.768], [.04, .032, .07]); }
      model.support = [0, -.025, 0]; break;
    case 'machinegun':
      b.box(body, [0, -.024, -.256], [.205, .183, .52]); b.box(black, [0, .025, -.627], [.164, .15, .28]);
      grip(); stock(rubber, .275); barrel(-1.14, .031, -.56); vents(-.52, -.78, .165);
      model.cover = part('feed-cover', [0, .087, -.444], pb => { pb.box(body, [0, .018, .18], [.21, .051, .38]); pb.box(steel, [0, .048, .18], [.08, .009, .29]); });
      magazine([-.113, -.106, -.274], [.29, .245, .22], rubber);
      model.belt = part('ammunition-belt', [-.14, .045, -.269], pb => {
        for (let i = 0; i < 7; i++) { const x = -i * .023, y = -(Math.max(0, i - 2) ** 2) * .005;
          pb.cylinder(brass, [x, y, 0], .011, .11, .011, [Math.PI / 2, 0, 0], 8); pb.cylinder(steel, [x, y, -.066], .004, .024, .011, [Math.PI / 2, 0, 0], 8); pb.box(black, [x, y, .014], [.024, .018, .026]); }
      });
      rail(-.32, -.06); reflex(-.2);
      b.box(black, [-.125, .179, -.582], [.027, .041, .24]); for (const z of [-.47, -.68]) b.box(steel, [-.125, .112, z], [.025, .14, .022]);
      for (const side of [-1, 1]) b.box(black, [side * .093, -.088, -.797], [.024, .03, .31], [0, side * .055, 0]); model.support = [0, -.03, -.033]; break;
    case 'revolver':
      model.lens = 'iron'; model.sightHeight = .119; model.support = [-.02, -.091, .351];
      b.box(body, [0, .088, -.231], [.105, .039, .29]); b.box(body, [0, -.06, -.162], [.103, .043, .225]);
      b.box(body, [0, .014, -.082], [.107, .137, .068]); b.box(wood, [0, -.146, -.075], [.1, .195, .133], [.3, 0, 0]);
      b.box(black, [0, -.23, -.049], [.112, .03, .123], [.3, 0, 0]);
      for (const side of [-1, 1]) b.box(body, [side * .041, -.12, -.174], [.014, .022, .137]); b.box(body, [0, -.093, -.238], [.089, .066, .018]);
      cylinder(body, [0, .022, -.423-barrelChange/2], .042, .295+barrelChange); b.box(body, [0, .064, -.448-barrelChange/2], [.053, .043, .305+barrelChange]);
      cylinder(black, [0, .022, -.578-barrelChange], .026, .019); cylinder(rubber, [0, .022, -.59-barrelChange], .018, .005); model.muzzleZ = -.611-barrelChange;
      b.box(body, [0, -.03, -.437-barrelChange/2], [.059, .059, .258+barrelChange]);
      model.drum = part('revolver-cylinder', [0, .013, -.21], pb => {
        pb.cylinder(black, [0, 0, 0], .081, .145, .081, [Math.PI / 2, 0, 0], 18);
        for (let i = 0; i < effective.magSize; i++) { const a = i * Math.PI * 2 / effective.magSize, x = Math.sin(a) * .057, y = Math.cos(a) * .057;
          pb.cylinder(body, [x, y, 0], .023, .148, .023, [Math.PI / 2, 0, 0], 10);
          pb.cylinder(brass, [x, y, .078], .013, .004, .013, [Math.PI / 2, 0, 0], 10); }
      });
      model.crane = part('cylinder-crane', [0, -.115, -.21], pb => {
        pb.box(steel, [0, .064, -.083], [.022, .146, .022]);
        pb.cylinder(steel, [0, 0, -.083], .022, .03, .022, [Math.PI / 2, 0, 0], 10);
        pb.cylinder(steel, [0, .128, -.083], .018, .033, .018, [Math.PI / 2, 0, 0], 10);
      });
      model.crane.add(model.drum); model.drum.position.set(0, .128, 0); model.drum.userData.rest = [0, .128, 0];
      model.bolt = part('hammer', [0, .081, -.036], pb => { pb.box(black, [0, .019, .016], [.043, .057, .035], [-.3, 0, 0]); pb.box(steel, [0, .046, .035], [.053, .018, .035]); });
      for (const x of [-.023, .023]) b.box(black, [x, .11, -.081], [.014, .033, .044]); b.box(black, [0, .094, -.55-barrelChange], [.014, .045, .033]); b.box(brass, [0, .117, -.557-barrelChange], [.007, .008, .009]);
      for (const side of [-1, 1]) { b.cylinder(steel, [side * .057, -.155, -.071], .012, .004, .012, [0, 0, Math.PI / 2], 10); }
      break;
  }
  if(mounted.optic){
    const type=mounted.optic.model,z=id==='PDW-46'?-.4:specification.model==='pistol'?-.12:-.245;
    const eye=id==='QB-95'?.34:.2;
    const optic=part(`attachment-${mounted.optic.id}`,[0,0,0],pb=>{
      pb.box(black,[0,.116,z],[.091,.038,.113]);
      if(type==='open'){
        for(const x of [-.035,.035])pb.box(steel,[x,.16,z],[.017,.06,.027]);
        for(const x of [-.035,.035])pb.sphere(brass,[x,.182,z+.016],[.006,.006,.003]);
        pb.box(black,[0,.144,z-.223],[.012,.048,.023]);model.lens='iron';model.sightHeight=.183;model.lensZ=z;return;
      }
      model.sightHeight=eye;model.lensZ=z;
      if(type==='micro'||type==='holo'){
        const wide=type==='holo',w=wide?.088:.05,depth=wide?.103:.044;
        for(const x of [-w,w])pb.box(black,[x,eye,z],[wide?.025:.014,.114,depth]);
        pb.box(black,[0,eye+.064,z],[w*2+.016,.019,depth]);pb.box(body,[w+.018,eye-.03,z],[.041,.052,depth*.8]);
        if(wide){pb.box(body,[0,eye-.061,z+.061],[.19,.035,.095]);for(const x of [-.035,.035])pb.box(steel,[x,eye-.04,z+.085],[.025,.014,.025]);}
        model.lens='reflex';return;
      }
      const length=({prism:.14,acog:.268,scope:.48})[type],radius=type==='scope'?.096:type==='acog'?.077:.064;
      model.lens='scope';model.lensZ=z+length/2-.008;
      for(const mount of [z-length*.27,z+length*.27])pb.box(black,[0,eye-radius-.011,mount],[.075,.056,.047]);
      if(type==='acog'){pb.box(body,[0,eye+.075,z-.022],[.042,.025,.181]);pb.box(brass,[0,eye+.091,z-.021],[.013,.009,.171]);}
      pb.cylinder(black,[0,eye+radius+.019,z],.027,.041,.027);pb.cylinder(body,[radius+.019,eye,z],.028,.04,.028,[0,0,Math.PI/2]);
    });
    if(['prism','acog','scope'].includes(type)){
      const length=({prism:.14,acog:.268,scope:.48})[type],radius=type==='scope'?.096:type==='acog'?.077:.064;
      const tubeMaterial=black.clone();tubeMaterial.side=THREE.DoubleSide;
      const tube=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,24,1,true),tubeMaterial);tube.rotation.x=Math.PI/2;tube.position.set(0,eye,z);optic.add(tube);
      for(const end of [z-length/2,z+length/2]){const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,.009,6,24),body);ring.position.set(0,eye,end);optic.add(ring);}
    }
  }
  if(mounted.muzzle){
    const type=mounted.muzzle.model,length=({brake:.135,compensator:.092,suppressor:.24,heavycan:.33,choke:.12,ring:.028})[type],radius=type==='heavycan'?.066:type==='suppressor'?.046:.038;
    const front=model.muzzleZ+.025;
    part(`attachment-${mounted.muzzle.id}`,[0,.026,front],pb=>{
      if(type==='brake'){pb.box(steel,[0,0,-length/2],[.107,.063,length]);for(const side of [-1,1])for(const z of [-.038,-.091])pb.box(black,[side*.055,0,z],[.008,.039,.028]);}
      else {pb.cylinder(type==='choke'?steel:black,[0,0,-length/2],radius,length,radius,[Math.PI/2,0,0],20);
        if(type==='compensator')for(let i=0;i<4;i++)pb.box(steel,[0,.038,-.018-i*.019],[.022,.007,.01]);
        if(type==='heavycan')for(let z=-.037;z>-.31;z-=.034)pb.cylinder(body,[0,0,z],radius*1.03,.013,radius*1.03,[Math.PI/2,0,0],20);
        if(type==='suppressor')for(const z of [-.025,-.208])pb.cylinder(steel,[0,0,z],radius*1.03,.01,radius*1.03,[Math.PI/2,0,0],20);
        if(type==='choke')for(let a=0;a<6;a++){const angle=a*Math.PI/3;pb.box(black,[Math.sin(angle)*radius,Math.cos(angle)*radius,-.085],[.009,.009,.043]);}
      }
      pb.cylinder(rubber,[0,0,-length-.003],radius*.67,.008,radius*.67,[Math.PI/2,0,0],16);
    });model.muzzleZ=front-length-.008;
  }
  if(mounted.grip){
    const type=mounted.grip.model,handgun=['pistol','revolver'].includes(specification.model),z=handgun?-.09:Math.max(-.67,Math.min(-.28,model.muzzleZ+.38));
    part(`attachment-${mounted.grip.id}`,[0,handgun?-.137:-.091,z],pb=>{
      pb.box(black,[0,0,0],[handgun?.099:.091,.036,.129]);
      if(type==='rubber')for(const side of [-1,1]){pb.box(body,[side*(handgun?.055:.058),handgun?0:-.024,0],[.017,handgun?.15:.086,.108]);for(let y=-.06;y<.06;y+=.022)pb.box(black,[side*.066,y,0],[.007,.009,.091]);}
      if(type==='vertical'||type==='stubby'){const h=type==='vertical'?.188:.093;pb.cylinder(rubber,[0,-h/2,0],.038,h,.041);for(let y=-.025;y>-h;y-=.023)pb.cylinder(body,[0,y,0],.042,.009,.042);model.support[1]-=type==='vertical'?.06:.025;}
      if(type==='angled'){pb.box(body,[0,-.039,0],[.074,.038,.2],[-.31,0,0]);pb.box(black,[0,-.01,.076],[.076,.086,.025]);}
      if(type==='skeleton'){for(const x of [-.03,.03]){pb.box(steel,[x,-.041,0],[.017,.084,.024]);pb.box(steel,[x,-.095,.018],[.017,.074,.024],[-.48,0,0]);}pb.box(rubber,[0,-.129,.036],[.079,.023,.072]);}
      if(type==='bipod')for(const side of [-1,1]){pb.box(steel,[side*.079,-.157,-.031],[.025,.31,.027],[0,0,-side*.38]);pb.box(rubber,[side*.143,-.299,-.031],[.064,.032,.087]);}
    });
  }
  if(mounted.stock){
    const type=mounted.stock.model,handgun=['pistol','revolver'].includes(specification.model),offset=specification.model==='bullpup'||id==='PDW-46'?.245:0;
    part(`attachment-${mounted.stock.id}`,[0,0,offset],pb=>{
      if(handgun){pb.box(body,[0,-.134,.006],[.105,.187,.038],[.25,0,0]);pb.box(steel,[0,-.229,-.043],[.123,.041,.138]);return;}
      pb.cylinder(steel,[0,.013,.09],.027,.205,.027,[Math.PI/2,0,0]);
      if(type==='light'||type==='folding'){
        for(const x of [-.04,.04])pb.box(type==='light'?steel:body,[x,-.024,.203],[.021,.035,.252]);
        pb.box(rubber,[0,-.032,.33],[.118,.18,.029]);
        if(type==='folding'){pb.cylinder(body,[.057,.012,.02],.038,.154,.038);pb.box(body,[0,.052,.24],[.116,.056,.17]);}
      }else{
        const precision=type==='heavy'||type==='marksman',rear=precision?.357:.284;
        pb.box(body,[0,-.025,rear-.1],[precision?.151:.119,precision?.171:.141,.234]);pb.box(rubber,[0,-.03,rear+.035],[.155,type==='padded'?.23:.2,type==='padded'?.068:.028]);
        if(precision){pb.box(black,[0,.092,rear-.077],[.144,.049,.213]);for(const z of [rear-.025,rear-.148])pb.cylinder(steel,[0,.048,z],.014,.124,.014);}
        if(type==='heavy')pb.box(steel,[0,-.124,rear-.07],[.123,.054,.202]);
        if(type==='balanced'){for(const x of [-.064,.064])pb.box(steel,[x,-.025,rear-.086],[.016,.114,.14]);}
      }
    });
  }
  if(mounted.magazine&&!model.mag){
    const type=mounted.magazine.model;
    part(`attachment-${mounted.magazine.id}`,[specification.model==='revolver'?-.088:-.102,-.016,-.216],pb=>{
      if(type==='pulltab'){pb.box(black,[0,0,0],[.027,.073,.171]);for(const z of [-.068,.068])pb.box(body,[-.025,0,z],[.045,.033,.024]);pb.box(body,[-.047,0,0],[.019,.034,.159]);}
      else if(type==='compact'){pb.box(body,[0,0,0],[.032,.039,.103]);pb.box(steel,[-.02,0,0],[.011,.022,.076]);}
      else {for(let z=-.081;z<.09;z+=.04)pb.cylinder(steel,[0,0,z],.019,.063,.019,[Math.PI/2,0,0],10);pb.box(brass,[-.021,-.031,0],[.018,.027,.172]);}
    });
  }
  if(mounted.barrel&&['pistol','revolver'].includes(specification.model)||mounted.barrel&&id==='DB-2'){
    const type=mounted.barrel.model,z=model.muzzleZ+.066;
    part(`attachment-${mounted.barrel.id}`,[0,.026,z],pb=>{
      const width=type==='heavy'?.06:.046;pb.cylinder(type==='cold'?body:steel,[0,0,0],width,.073,width,[Math.PI/2,0,0],16);
      if(type==='ported')for(const x of [-width,width])pb.box(black,[x,0,0],[.007,.023,.033]);
      if(type==='fluted')for(let a=0;a<6;a++)pb.box(black,[Math.sin(a*Math.PI/3)*width,Math.cos(a*Math.PI/3)*width,0],[.007,.007,.06]);
    });
  }
  if (!remote && !['revolver','pistol'].includes(specification.model)) {
    const side=model.receiverHalfWidth||({smg:.0685,assault:.0735,bullpup:.0895,shotgun:.0695,marksman:.077,sniper:.0785,machinegun:.1025})[specification.model];
    b.box(steel, [side+.005, .026, -.151], [.014, .038, .09]); b.box(black, [side+.013, .026, -.15], [.008, .019, .061]);
    for (const z of [-.064, -.26]) b.cylinder(steel, [-side-.002, -.023, z], .01, .005, .01, [0, 0, Math.PI / 2], 8);
    b.box(brass, [-side-.002, .04, -.067], [.007, .025, .057]);
  }
  b.finish(false);
  root.traverse(o => { if (o.isMesh) { o.castShadow = remote; o.receiveShadow = remote; } });
  return model;
}

export function equipmentBuildKey(equipment = {}) {
  return ['backpack','carrier','plate','helmet'].map(slot=>`${slot}:${getEquipment(equipment[slot]?.catalogId||equipment[slot])?.id||''}`).join('|');
}
export function makeOperatorEquipment(equipment = {}) {
  const root=new THREE.Group(),torso=new THREE.Group(),head=new THREE.Group();torso.position.y=1.12;head.position.y=1.63;root.add(torso,head);
  const materials=[],mat=color=>{const material=new THREE.MeshStandardMaterial({color,roughness:.83,metalness:.12});materials.push(material);return material;};
  const cloth=mat('#46534a'),web=mat('#263b39'),steel=mat('#8a9894'),blue=mat('#86d0e6'),black=mat('#263330');
  const b=makeBatch(torso),h=makeBatch(head);
  const gear=Object.fromEntries(['backpack','carrier','plate','helmet'].map(slot=>[slot,getEquipment(equipment[slot]?.catalogId||equipment[slot])]));
  if(gear.backpack){
    const type=gear.backpack.model,index=['sling','day','assault','patrol','frame','expedition'].indexOf(type);
    const color=mat(['#667368','#7d7962','#5c725e','#8d8567','#6b8077','#9b8c69'][index]);
    if(type==='sling'){
      b.bevel(color,[.16,-.07,.241],[.31,.3,.158],[0,0,-.23]);b.bevel(web,[.16,.012,.325],[.316,.027,.013],[0,0,-.23]);
      b.bevel(web,[0,.12,.178],[.059,.58,.025],[0,0,-.48]);
    }else{
      const w=[0,.33,.39,.44,.45,.5][index],height=[0,.43,.51,.67,.76,.91][index],depth=[0,.19,.23,.27,.25,.3][index];
      b.bevel(color,[0,.04,.18+depth/2],[w,height,depth]);
      b.bevel(web,[0,.04+height*.38,.19+depth],[w*.96,.069,.035]);
      for(const side of [-1,1]){
        b.bevel(web,[side*w*.28,.06,.2+depth],[.043,height*.86,.018]);
        b.bevel(cloth,[side*.183,.13,.172],[.069,.5,.045]);
        if(index>=2)b.bevel(color,[side*(w/2+.052),-.057,.18+depth*.57],[.125,height*.42,depth*.83]);
      }
      if(index>=2)for(let y=-height*.3;y<height*.27;y+=.087)b.bevel(steel,[0,y,.209+depth],[w*.67,.017,.008]);
      if(type==='frame'){for(const x of [-.267,.267])b.cylinder(steel,[x,.047,.32],.017,.93,.017);for(const y of [-.4,.04,.47])b.bevel(steel,[0,y,.31],[.56,.024,.032]);}
      if(type==='patrol'||type==='expedition'){b.cylinder(color,[0,-height/2-.053,.31],.104,w+.06,.104,[0,0,Math.PI/2],12);for(const x of [-.12,.12])b.bevel(web,[x,-height/2-.054,.414],[.035,.12,.022]);}
      b.bevel(blue,[0,height*.28,.221+depth],[.151,.038,.009]);
    }
  }
  if(gear.carrier){
    const tier=['web','scout','modular','assault','heavy','fortress'].indexOf(gear.carrier.model),w=.34+tier*.037,height=.34+tier*.043,color=mat(['#77806a','#798275','#627768','#73735d','#5b6656','#515e56'][tier]);
    if(tier>0){b.bevel(color,[0,.095,-.191],[w,height,.079]);b.bevel(color,[0,.095,.181],[w,height,.055]);}
    for(const x of [-.19,.19])b.bevel(web,[x,.16,-.031],[.075,.56,.37]);
    for(let i=0;i<Math.min(4,tier+1);i++)b.bevel(color,[(i-(Math.min(4,tier+1)-1)/2)*.12,-.088,-.252],[.106,.193,.079]);
    if(tier>=2)for(let y=.015;y<.28;y+=.06)b.bevel(web,[0,y,-.241],[w*.85,.018,.015]);
    if(tier>=3)for(const x of [-.268,.268])b.bevel(color,[x,.245,-.018],[.157,.123,.315]);
    if(tier>=4)b.bevel(color,[0,-.277,-.181],[.237,.229,.082],[.14,0,0]);
    if(tier===5)for(const x of [-.17,.17])b.bevel(color,[x,.382,-.068],[.088,.15,.246]);
    b.bevel(blue,[0,.269,-.237],[.148,.041,.01]);
  }
  if(gear.plate&&gear.carrier){
    const tier=['fiber','steel','ceramic','composite','titan','boron'].indexOf(gear.plate.model),color=mat(['#5e766c','#a0a7a2','#ccc5ae','#71858a','#9793a4','#454e4d'][tier]);
    // The insert's exposed top edge and reinforced face identify the material
    // without placing a second armor shell outside the carrier's silhouette.
    b.bevel(color,[0,.209,-.241],[.267,.179,.016]);
    if(tier===1){b.bevel(steel,[0,.207,-.255],[.224,.021,.012]);for(const x of [-.104,.104])b.bevel(web,[x,.207,-.256],[.018,.142,.007]);}
    if(tier===2||tier===5)for(const x of [-.085,0,.085])b.bevel(web,[x,.207,-.252],[.008,.151,.006]);
    if(tier===5)for(const y of [.167,.247])b.bevel(steel,[0,y,-.253],[.243,.009,.007]);
    if(tier===3)for(let y=.143;y<.28;y+=.034)b.bevel(steel,[0,y,-.252],[.232,.008,.006]);
    if(tier===4)for(const x of [-.094,.094])b.cylinder(steel,[x,.207,-.254],.013,.008,.013,[Math.PI/2,0,0],10);
    b.bevel(blue,[.094,.256,-.255],[.029,.023,.006]);
  }
  if(gear.helmet){
    const type=gear.helmet.model,tier=['bump','patrol','ballistic','highcut','assault','visor'].indexOf(type),color=mat(['#708272','#777e64','#858574','#687e77','#56675e','#748071'][tier]);
    const shell=new THREE.Mesh(new THREE.SphereGeometry(.207+(tier===5?.012:0),20,12,0,Math.PI*2,0,type==='highcut'?1.45:1.78),color);
    shell.scale.set(1,type==='bump'?.81:.96,1.04);shell.position.set(0,.082,.008);head.add(shell);
    if(type==='bump')for(const x of [-.117,0,.117])h.bevel(black,[x,.237,-.068],[.038,.012,.071],[.28,0,0]);
    if(type==='patrol')h.bevel(color,[0,.075,-.19],[.366,.033,.084]);
    if(type==='ballistic')for(const x of [-.188,.188])h.bevel(color,[x,.027,.02],[.061,.157,.185]);
    if(type==='highcut'||type==='assault')for(const x of [-.209,.209]){h.bevel(web,[x,.078,.014],[.023,.041,.177]);h.bevel(steel,[x,.086,-.025],[.03,.025,.079]);}
    if(type==='assault'){h.bevel(web,[0,.114,-.2],[.079,.094,.043]);h.bevel(steel,[0,.143,-.229],[.053,.028,.029]);}
    if(type==='visor'){
      const glass=new THREE.MeshStandardMaterial({color:'#95c1c3',transparent:true,opacity:.34,roughness:.13,metalness:.25,side:THREE.DoubleSide});materials.push(glass);
      h.bevel(glass,[0,.017,-.216],[.354,.208,.018],[.11,0,0]);for(const x of [-.181,.181])h.bevel(web,[x,.027,-.209],[.021,.229,.026],[.11,0,0]);h.bevel(black,[0,-.09,-.205],[.354,.026,.036]);
    }
    h.bevel(blue,[0,.144,-.196],[.072,.031,.01]);
  }
  b.finish(true);h.finish(true);
  return {root,torso,head,materials,key:equipmentBuildKey(equipment),gear:Object.fromEntries(Object.entries(gear).map(([slot,item])=>[slot,item?.id||null]))};
}
