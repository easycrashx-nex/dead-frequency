import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {createOperatorStage} from './operator-stage.js';
import {buildWideWorld} from './world-render.js';
import {getGroundHeight} from './terrain.js';
import { CONTAINER_TYPES } from './loot-catalog.js';
import { getWeapon } from './weapons.js';
import {createWeaponModelPool,weaponBuildKey,disposeWeaponModel,makeOperatorEquipment,equipmentBuildKey,opticalFieldOfView} from './weapon-model.js';
import {renderResolution,applyRenderResolution} from './render-resolution.js';

// The renderer is deliberately a view adapter. No simulation objects are mutated.
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;
const aimFovReduction=(fov,player,amount)=> (fov-opticalFieldOfView(fov,player?.adsZoom||player?.weaponStats?.adsZoom||1.35))*amount;

function seeded(seed = 91) {
  return () => { seed = Math.imul(seed ^ (seed >>> 15), 1 | seed); seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed); return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296; };
}

function canvasTexture(w, h, paint, repeat = 1) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  paint(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  return tex;
}

function weatheredTexture(base, seed, repeat = 1) {
  const rand = seeded(seed);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 17500; i++) {
      const v = rand() > .52 ? 255 : 0;
      ctx.fillStyle = `rgba(${v},${v},${v},${rand() * .085})`;
      const s = rand() * 2 + .25; ctx.fillRect(rand() * w, rand() * h, s, s);
    }
    for (let i = 0; i < 35; i++) {
      ctx.strokeStyle = `rgba(20,29,28,${.01 + rand() * .07})`;
      ctx.lineWidth = 1 + rand() * 7; ctx.beginPath();
      const x = rand() * w; const y = rand() * h; ctx.moveTo(x, y); ctx.lineTo(x + rand() * 18 - 9, y + 20 + rand() * 160); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(26,34,31,.11)'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  }, repeat);
}

function signTexture(title, subtitle = 'RESTRICTED AREA', color = '#e6d6b2', dark = '#283a39') {
  return canvasTexture(1024, 384, (ctx, w, h) => {
    ctx.fillStyle = dark; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c3723c'; ctx.fillRect(0, 0, 18, h);
    ctx.strokeStyle = `${color}55`; ctx.lineWidth = 3; ctx.strokeRect(36, 30, w - 70, h - 60);
    ctx.fillStyle = color; ctx.font = '700 101px "Bahnschrift", "Arial Narrow", Arial';
    ctx.fillText(title, 72, 167, w - 140);
    ctx.fillStyle = '#b5b6a6'; ctx.font = '500 32px "Bahnschrift", Arial';
    ctx.fillText(subtitle, 78, 256, w - 150);
    ctx.fillStyle = '#c3723c';
    for (let i = 0; i < 9; i++) ctx.fillRect(w - 230 + i * 14, 307, 7, 20);
  });
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

function makePalette() {
  const concrete = weatheredTexture('#a7a48e', 20);
  const steelMap = weatheredTexture('#82958a', 38);
  const roadMap = weatheredTexture('#5e6962', 11, 30);
  const mat = (color, roughness = .8, metalness = .08, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  return {
    concrete: mat('#d0d9cf', .95, 0, { map: concrete }),
    pale: mat('#ebe9d6', .85, .02, { map: concrete }),
    darkConcrete: mat('#98aaa0', .95, 0, { map: concrete }),
    metal: mat('#819a90', .66, .36, { map: steelMap }),
    darkMetal: mat('#415652', .57, .38),
    edge: mat('#a3aea1', .51, .5),
    orange: mat('#b35c32', .74, .28),
    rust: mat('#775344', .96, .13),
    blue: mat('#436c6b', .82, .24),
    black: mat('#202c2a', .92, .05),
    glass: mat('#334d4a', .21, .72),
    paint: mat('#c2b695', .96, 0),
    road: mat('#bdc8bc', .97, 0, { map: roadMap }),
    soil: mat('#6b7560', 1, 0),
    leaf: mat('#596549', 1, 0, { side: THREE.DoubleSide }),
    glow: mat('#aed2b7', .5, .15, { emissive: '#80dfc0', emissiveIntensity: 2 }),
    warning: mat('#d19150', .45, .2, { emissive: '#e57932', emissiveIntensity: .75 }),
  };
}

function createSky(scene) {
  const sun = new THREE.Vector3(-.66, .24, -.71).normalize();
  const material = new THREE.ShaderMaterial({
    uniforms: { sunDirection: { value: sun } }, side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vDirection; void main(){ vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `
      varying vec3 vDirection; uniform vec3 sunDirection;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){
        vec3 d=normalize(vDirection); float h=max(d.y,0.); float s=max(dot(d,sunDirection),0.);
        vec3 c=mix(vec3(.57,.49,.35),vec3(.095,.225,.25),pow(h,.42));
        c+=vec3(.37,.21,.10)*pow(s,9.)+vec3(.72,.41,.17)*pow(s,60.);
        c=mix(c,vec3(1.6,1.28,.81),smoothstep(.9992,.99965,s));
        vec2 uv=d.xz/(max(d.y,.06))*vec2(1.2,4.); float n=noise(uv*.7)*.5+noise(uv*1.7)*.25+noise(uv*4.)*.125;
        float clouds=smoothstep(.40,.57,n)*smoothstep(.025,.2,h)*(1.-smoothstep(.42,.85,h));
        c=mix(c,vec3(.49,.51,.44)+vec3(.22,.10,.0)*pow(s,5.),clouds*.36);
        gl_FragColor=vec4(c,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1900, 32, 16), material);
  sky.renderOrder = -10; scene.add(sky);
  return sky;
}

function label(parent, text, subtitle, position, size, rotation = 0) {
  const material = new THREE.MeshStandardMaterial({ map: signTexture(text, subtitle), roughness: .92, metalness: .06 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material);
  mesh.position.set(...position); mesh.rotation.y = rotation; parent.add(mesh);
  return mesh;
}

function buildWorld(scene,layout,mats){return buildWideWorld(scene,layout,mats,{makeBatch,signTexture});}

function coloredPart(parent, draw) {
  const fake = new THREE.Group();
  const partBatch = makeBatch(fake); const b = { ...partBatch, box: (...args) => partBatch.bevel(...args) }; const cache = new Map();
  const color = (hex) => {
    if (!cache.has(hex)) cache.set(hex, new THREE.MeshStandardMaterial({ color: hex }));
    return cache.get(hex);
  };
  draw(b, color); b.finish(false);
  const gs = [];
  for (const mesh of [...fake.children]) {
    const g = mesh.geometry; const count = g.getAttribute('position').count; const col = mesh.material.color;
    const array = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { array[i * 3] = col.r; array[i * 3 + 1] = col.g; array[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(array, 3)); gs.push(g);
  }
  const normalized = gs.some(g => !g.index) ? gs.map(g => g.index ? g.toNonIndexed() : g) : gs;
  const geometry = mergeGeometries(normalized); gs.forEach(g => g.dispose());
  normalized.forEach((g, i) => { if (g !== gs[i]) g.dispose(); }); cache.forEach(m => m.dispose());
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .82, metalness: .18 });
  const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh); return mesh;
}

function makeEnemy(kind = 'scav', teammate = false) {
  const root = new THREE.Group(); const torso = new THREE.Group(); torso.position.y = 1.12; root.add(torso);
  const heavy = /heavy|guard|elite|boss/i.test(kind); const fabric = teammate ? '#4d6971' : kind==='boss' ? '#514438' : kind==='bodyguard' ? '#353e43' : heavy ? '#485653' : '#626655';
  coloredPart(torso, (b, c) => {
    b.box(c(fabric), [0, .06, 0], [.49, .62, .3]);
    if(!teammate){
    b.box(c('#303f3b'), [0, .11, -.185], [.43, .43, .12]);
    b.box(c('#36433d'), [0, .14, .19], [.44, .49, .15]);
    b.box(c(kind==='boss'?'#bd9b5d':kind==='bodyguard'?'#a0745e':'#b1834e'), [-.23, .13, -.065], [.06, .54, .37]);
    b.box(c('#777961'), [.23, .13, -.06], [.065, .54, .35]);
    for (let i = 0; i < 3; i++) b.box(c('#72735a'), [(i - 1) * .13, -.11, -.258], [.105, .22, .08]);
    b.box(c('#242e2b'), [0, -.28, 0], [.49, .085, .34]);
    b.box(c(teammate ? '#8edcf4' : '#be7744'), [0, .27, -.249], [.08, .055, .015]);
    b.box(c('#57634f'), [0, .14, .3], [.4, .43, .14]);
    }
  });
  const head = new THREE.Group(); head.position.y = 1.63; root.add(head);
  coloredPart(head, (b, c) => {
    b.sphere(c('#38423e'), [0, .02, 0], [.185, .215, .18]);
    if(!teammate)b.sphere(c('#53604f'), [0, .105, .02], [.205, .19, .205]);
    b.box(c('#252f2e'), [0, .035, -.157], [.305, .105, .078]);
    b.box(c('#2c3631'), [0, -.097, -.113], [.23, .13, .11]);
    b.cylinder(c('#687365'), [-.206, .015, 0], .065, .06, .065, [0, 0, Math.PI / 2]);
    b.cylinder(c('#687365'), [.206, .015, 0], .065, .06, .065, [0, 0, Math.PI / 2]);
  });
  const visor = new THREE.Mesh(new THREE.BoxGeometry(.252, .041, .012), new THREE.MeshStandardMaterial({ color: teammate ? '#b8d4dc' : '#c7a76b', emissive: teammate ? '#3c839c' : '#ba692c', emissiveIntensity: .42, roughness: .2, metalness: .7 }));
  visor.position.set(0, .044, -.202); head.add(visor);
  const legs = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * .14, .93, 0); root.add(pivot);
    coloredPart(pivot, (b, c) => {
      b.cylinder(c(fabric), [0, -.2, 0], .112, .43, .134, [0, 0, 0], 10);
      b.cylinder(c('#414e42'), [0, -.59, .01], .09, .39, .105, [0, 0, 0], 10);
      b.box(c('#303d36'), [0, -.4, -.105], [.22, .21, .115]);
      b.box(c('#242d29'), [0, -.81, -.045], [.215, .18, .32]);
      b.box(c('#758065'), [0, -.22, -.127], [.13, .04, .022]);
    }); legs.push(pivot);
  }
  const arms = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * .3, 1.38, 0); root.add(pivot);
    coloredPart(pivot, (b, c) => {
      b.cylinder(c(fabric), [s * .025, -.16, -.045], .087, .38, .112, [-.25, 0, s * .1], 10);
      b.box(c('#343e37'), [s * .04, -.02, -.005], [.225, .22, .27]);
      b.cylinder(c(fabric), [s * -.03, -.28, -.245], .078, .37, .089, [Math.PI / 2 - .08, s * .32, 0], 10);
      b.box(c('#242e29'), [s * -.06, -.27, -.425], [.155, .15, .19]);
      if (s === 1 || teammate) b.box(c(teammate ? '#7fd6f5' : kind==='boss'?'#e3bc70':kind==='bodyguard'?'#bb5140':'#ab6c3e'), [s * .145, -.06, -.02], [.016, .095, .13]);
    }); arms.push(pivot);
  }
  const gun = new THREE.Group(); gun.position.set(.13, 1.13, teammate ? -.29 : -.42); root.add(gun);
  const weaponModels = teammate ? createWeaponModelPool(true,3) : null;
  let activeWeapon=null,gearModel=null;
  if (!teammate) coloredPart(gun, (b, c) => {
    b.box(c('#283330'), [0, 0, -.17], [.12, .16, .49]);
    b.box(c('#3e4c46'), [0, .015, -.44], [.13, .13, .25]);
    b.cylinder(c('#202824'), [0, .02, -.69], .025, .3, .025, [Math.PI / 2, 0, 0], 8);
    b.box(c('#343d32'), [0, -.155, -.16], [.075, .2, .16], [-.14, 0, 0]);
    b.box(c('#2c3430'), [0, -.01, .16], [.1, .13, .19]);
    b.box(c('#202d29'), [0, .14, -.19], [.07, .09, .13]);
  });
  const flash = new THREE.Mesh(new THREE.OctahedronGeometry(.14, 0), new THREE.MeshBasicMaterial({ color: '#ffd796', transparent: true, opacity: .95 }));
  flash.position.set(0, .015, -.86); flash.scale.set(.65, .65, 2.5); flash.visible = false; gun.add(flash);
  let marker = null;
  if (teammate) {
    marker = new THREE.Mesh(new THREE.OctahedronGeometry(.095), new THREE.MeshBasicMaterial({ color: '#8cddff', transparent: true, opacity: .8 }));
    marker.position.y = 2.15; root.add(marker);
  }
  const operator = { root, head, torso, legs, arms, gun, flash, marker, death: 0, lastX: 0, lastZ: 0, stride: 0, hit: 0, shotTime: 0, move: 0, crouch: 0, weaponId: null, aiTask: 'patrol', scanClock: 0 };
  operator.selectWeapon = (id,attachments={}) => {
    if (!weaponModels) return;
    if(!id){if(activeWeapon)activeWeapon.root.visible=false;activeWeapon=null;operator.weaponId=null;operator.weaponBuildKey=null;operator.weaponAttachments={};flash.visible=false;return;}
    const key=weaponBuildKey(id,attachments);if(activeWeapon?.buildKey===key)return;
    const active=weaponModels.get(id,attachments);if(activeWeapon)activeWeapon.root.visible=false;
    activeWeapon=active;gun.add(active.root);active.root.visible=true;operator.weaponId=active.id;
    operator.weaponBuildKey=key;operator.weaponVariant=active.variant;operator.weaponAttachments={...active.attachments};
    flash.position.z = active.muzzleZ;
    const handgun=['revolver','pistol'].includes(active.model);
    arms[0].position.x = -.23; arms[0].scale.z = handgun ? 1.18 : 1.85;
    arms[0].rotation.y = handgun ? -.67 : -.42;
  };
  operator.selectEquipment=equipment=>{
    if(!teammate)return;
    const key=equipmentBuildKey(equipment);if(gearModel?.key===key)return;
    if(gearModel)disposeWeaponModel(gearModel);
    gearModel=makeOperatorEquipment(equipment);root.add(gearModel.root);operator.equipment=gearModel.gear;
  };
  operator.animateEquipment=()=>{if(gearModel){gearModel.head.rotation.copy(head.rotation);gearModel.torso.position.y=torso.position.y;}};
  operator.animateWeapon=(player,dt)=>{
    if(!activeWeapon)return;
    const reload=player.reload>0?Math.sin(clamp(1-player.reload/(player.reloadDuration||player.weaponStats?.reloadSeconds||2),0,1)*Math.PI)**2:0;
    if(activeWeapon.mag)activeWeapon.mag.position.y=activeWeapon.mag.userData.rest[1]-reload*.2;
    if(activeWeapon.cover)activeWeapon.cover.rotation.x=-reload*1.34;
    if(activeWeapon.breakAction)activeWeapon.breakAction.rotation.x=-reload*.62;
    if(activeWeapon.crane)activeWeapon.crane.rotation.z=reload*1.35;
    if(activeWeapon.slide)activeWeapon.slide.position.z=activeWeapon.slide.userData.rest[2]+(player.ammo===0?.069:operator.shotTime>0?.07:0);
    if(activeWeapon.bolt&&activeWeapon.model==='sniper')activeWeapon.bolt.position.z=damp(activeWeapon.bolt.position.z,activeWeapon.bolt.userData.rest[2]+(operator.shotTime>0?.12:0),18,dt);
  };
  operator.dispose=()=>{weaponModels?.dispose();if(gearModel)disposeWeaponModel(gearModel);};
  return operator;
}

function makeFirstPersonRig(camera) {
  const rig=new THREE.Group();camera.add(rig);rig.scale.setScalar(.87);
  const gun=new THREE.Group();rig.add(gun);
  const gunmetal=new THREE.MeshStandardMaterial({color:'#263632',metalness:.78,roughness:.39});
  const rubber=new THREE.MeshStandardMaterial({color:'#192924',roughness:.93});
  const arms = new THREE.Group(); gun.add(arms);
  const rightArm = new THREE.Group(); const leftArm = new THREE.Group(); arms.add(rightArm, leftArm);
  let armBatch = makeBatch(rightArm); let ab = { ...armBatch, box: (...args) => armBatch.bevel(...args) };
  const sleeve = new THREE.MeshStandardMaterial({ color: '#525f4b', roughness: .92 });
  const gloves = new THREE.MeshStandardMaterial({ color: '#29372d', roughness: .84 });
  const seam = new THREE.MeshStandardMaterial({ color: '#858773', roughness: .89 });
  function sleeveBetween(elbow, wrist, elbowRadius, wristRadius) {
    const start = new THREE.Vector3(...elbow), end = new THREE.Vector3(...wrist);
    const axis = end.clone().sub(start); const length = axis.length();
    const rotation = new THREE.Quaternion().setFromUnitVectors(UP, axis.normalize());
    const euler = new THREE.Euler().setFromQuaternion(rotation);
    ab.cylinder(sleeve, start.add(end).multiplyScalar(.5).toArray(), elbowRadius, length, wristRadius, [euler.x, euler.y, euler.z], 12);
    return rotation;
  }
  // Endpoint-built sleeves meet the glove cuffs with overlap instead of relying
  // on independent cylinder rotations that can leave gaps in the silhouette.
  sleeveBetween([.19, -.31, .21], [.054, -.17, -.038], .09, .063);
  ab.cylinder(gloves, [.049, -.16, -.045], .064, .12, .06, [.98, -.3, .24], 12);
  ab.box(gloves, [.035, -.146, -.078], [.135, .102, .118], [.2, -.16, 0]);
  ab.box(seam, [.113, -.14, -.071], [.015, .068, .065], [.2, 0, 0]);
  for (let i = 0; i < 3; i++) ab.box(gloves, [-.009, -.147 + i * .018, -.134], [.057, .015, .039]);
  ab.finish(false); armBatch = makeBatch(leftArm); ab = { ...armBatch, box: (...args) => armBatch.bevel(...args) };
  const wristPosition = [-.075, -.106, -.36];
  const wristRotation = sleeveBetween([-.235, -.31, .025], wristPosition, .09, .064);
  ab.box(gloves, [-.045, -.062, -.46], [.112, .1, .147], [-.12, .08, 0]);
  for (let i = 0; i < 4; i++) ab.box(gloves, [.019, -.045 + i * .012, -.479 + i * .006], [.068, .019, .074], [0, 0, .12]);
  ab.box(gloves, [-.092, -.022, -.441], [.046, .053, .082], [.18, -.25, -.25]);
  ab.finish(false);
  const wrist = new THREE.Group(); wrist.name = 'support-wrist';
  wrist.position.set(...wristPosition); wrist.quaternion.copy(wristRotation); leftArm.add(wrist);
  const wristBatch = makeBatch(wrist); const wb = { ...wristBatch, box: (...args) => wristBatch.bevel(...args) };
  wb.cylinder(sleeve, [0, -.01, 0], .071, .066, .066, [0, 0, 0], 16);
  wb.cylinder(gloves, [0, .047, 0], .062, .112, .06, [0, 0, 0], 16);
  wb.cylinder(seam, [0, -.025, 0], .072, .008, .071, [0, 0, 0], 16);
  // A complete strap encircles the cuff. The case rests directly on that strap;
  // its screen, bezel and buckle all remain in this single wrist-local frame.
  wb.cylinder(rubber, [0, .012, 0], .07, .047, .07, [0, 0, 0], 16);
  wb.box(rubber, [0, .012, .08], [.091, .063, .024]);
  wb.box(gunmetal, [0, .012, .093], [.079, .051, .006]);
  const wristScreen = new THREE.MeshStandardMaterial({ color: '#57816b', emissive: '#629778', emissiveIntensity: .35, roughness: .42, metalness: .08 });
  wb.box(wristScreen, [0, .013, .097], [.061, .035, .003]);
  wb.box(seam, [0, .025, .099], [.036, .003, .002]);
  wb.box(seam, [-.013, .013, .099], [.009, .003, .002]);
  wb.box(gunmetal, [0, .012, -.071], [.043, .031, .01]);
  wb.finish(false);
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(.103, .101), new THREE.MeshBasicMaterial({ color: '#82c7a7', transparent: true, opacity: .09, side: THREE.DoubleSide, depthWrite: false }));
  lens.position.set(0, .195, -.275); gun.add(lens);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(.0027, 12), new THREE.MeshBasicMaterial({ color: '#f68256', depthTest: false }));
  dot.position.set(0, .2, -.28); dot.renderOrder = 22; gun.add(dot);
  const flash = new THREE.Group(); flash.position.set(0, .025, -.975); gun.add(flash);
  const flame = new THREE.Mesh(new THREE.OctahedronGeometry(.13, 0), new THREE.MeshBasicMaterial({ color: '#ffe1a7', transparent: true, opacity: .9, depthWrite: false }));
  flame.scale.set(.65, .65, 2.25); flash.add(flame);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(.07, 0), new THREE.MeshBasicMaterial({ color: '#fff7d7', transparent: true, opacity: .95, depthWrite: false }));
  core.scale.set(.55, .55, 2); flash.add(core); flash.visible = false;
  const light = new THREE.PointLight('#ffb461', 0, 5, 2); light.position.set(0, .08, -.9); gun.add(light);
  rig.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.renderOrder = 10; } });
  return { rig, gun, arms, rightArm, leftArm, mag:null, flash, light, lens, dot, recoil: 0, kick: 0, flashTime: 0, aim: 0, crouch: 0, bob: 0, reloadClock: 0, sprintBlend: 0, moveBlend: 0, bobAmplitude: 0 };
}

function makeWeapon(camera) {
  const weapon=makeFirstPersonRig(camera),assembly=weapon.gun;
  const models=createWeaponModelPool(false,6);
  let active = null, reloadProgress = 0, cycleProgress = 0;
  const smoothPulse = (t, start, end) => t <= start || t >= end ? 0 : Math.sin((t - start) / (end - start) * Math.PI) ** 2;
  weapon.select = (id,attachments={}) => {
    if(!id){if(active)active.root.visible=false;active=null;weapon.armed=false;weapon.flash.visible=false;return;}
    const key=weaponBuildKey(id,attachments);if(active?.buildKey===key)return;
    const next=models.get(id,attachments);if(active)active.root.visible=false;
    active=next;assembly.add(active.root);active.root.visible=true;weapon.armed=true;
    active.root.traverse(node=>{if(node.isMesh){node.frustumCulled=false;node.renderOrder=10;}});
    weapon.weaponId=active.id;weapon.model=active.model;weapon.sightHeight=active.sightHeight;
    weapon.mag=active.mag;weapon.flash.position.z=active.muzzleZ;weapon.light.position.z=active.muzzleZ+.075;
    weapon.hasReticle=active.lens!=='iron';weapon.lens.visible=weapon.hasReticle;
    weapon.lens.position.set(0,active.sightHeight,active.lensZ||-.275);
    weapon.lens.scale.setScalar(active.lens==='scope'?.7:1);
    weapon.dot.position.set(0,active.sightHeight,active.lensZ||-.275);
    weapon.recoil=weapon.kick=weapon.reloadClock=0;
    weapon.leftArm.position.set(...active.support);weapon.rightArm.position.set(0,0,0);
  };
  weapon.animate = (p, dt) => {
    if (!active) return;
    const specification = p.weaponStats || getWeapon(active.id);
    reloadProgress = p.reload > 0 ? clamp(1 - p.reload / (p.reloadDuration || specification.reloadSeconds), 0, 1) : 0;
    cycleProgress = p.shotTimer > 0 ? clamp(1 - p.shotTimer / (p.cycleDuration || specification.fireInterval), 0, 1) : 0;
    const reload = p.reload > 0 ? smoothPulse(reloadProgress, 0, 1) : 0;
    const pump = active.pump ? smoothPulse(cycleProgress, .12, .85) * .137 : 0;
    const cycling = active.bolt ? smoothPulse(cycleProgress, .08, .84) : 0;
    weapon.leftArm.position.set(...active.support);
    if (active.pump) { active.pump.position.z = active.pump.userData.rest[2] + pump; weapon.leftArm.position.z += pump; }
    if (p.reload) {
      // The entire support forearm, cuff and watch move together. Reloaded parts
      // keep their own attachment points, including the rear bullpup magazine.
      if (active.mag) {
        const rest = active.mag.userData.rest;
        weapon.leftArm.position.x += reload * (rest[0] + .015 - active.support[0]);
        weapon.leftArm.position.y += reload * (rest[1] - .248 - active.support[1]);
        weapon.leftArm.position.z += reload * (rest[2] + .46 - active.support[2]);
      } else {
        weapon.leftArm.position.x -= reload * .065; weapon.leftArm.position.y -= reload * .085;
        weapon.leftArm.position.z += reload * (active.model === 'revolver' ? -.09 : .12);
      }
    }
    if (active.mag) {
      active.mag.position.set(...active.mag.userData.rest); active.mag.position.y -= reload * (active.model === 'machinegun' ? .21 : .24);
      active.mag.rotation.x = reload * -.12; active.mag.rotation.z = reload * .06;
    }
    if (active.cover) active.cover.rotation.x = -reload * 1.34;
    if(active.slide)active.slide.position.z=active.slide.userData.rest[2]+(p.ammo===0?.069:smoothPulse(cycleProgress,0,.55)*.075);
    if(active.breakAction)active.breakAction.rotation.x=-reload*.62;
    if (active.belt) { active.belt.position.y = active.belt.userData.rest[1] + reload * .087; active.belt.rotation.z = reload * -.4; }
    if (active.bolt) {
      if (active.model === 'sniper') {
        active.bolt.position.z = active.bolt.userData.rest[2] + cycling * .129;
        active.bolt.rotation.z = cycling * -.82;
        weapon.rightArm.position.z = cycling * .075;
      } else active.bolt.rotation.x = -cycling * .43;
    }
    if (active.drum) {
      active.crane.rotation.z = reload * 1.35;
      const turn = (specification.magSize - Math.max(0, p.ammo ?? specification.magSize)) * Math.PI * 2 / specification.magSize;
      active.drum.rotation.z = damp(active.drum.rotation.z, turn, 18, dt);
    }
    if (active.cartridges) {
      active.cartridges.visible = !!p.reload;
      active.cartridges.position.y = -.19 + Math.sin(reloadProgress * Math.PI * 8) ** 2 * .105;
    }
    if (active.model !== 'sniper') weapon.rightArm.position.set(0, 0, 0);
  };
  weapon.stats = () => ({ weaponId: active?.id||null, actualWeaponId:active?.id||null,weaponModelId:active?.id||null,weaponModel: active?.model||null, weaponVariant:active?.variant||null,weaponBuildKey:active?.buildKey||null,weaponAttachments:{...active?.attachments},attachmentIds:Object.values(active?.attachments||{}),weaponSlideOffset:active?.slide?active.slide.position.z-active.slide.userData.rest[2]:0,weaponBreakAngle:active?.breakAction?.rotation.x||0,cachedWeaponModels: models.size, weaponReloadProgress: reloadProgress, weaponCycleProgress: cycleProgress,
    weaponPumpOffset: active?.pump ? active.pump.position.z - active.pump.userData.rest[2] : 0,
    weaponBoltOffset: active?.model === 'sniper' ? active.bolt.position.z - active.bolt.userData.rest[2] : 0,
    weaponDrumOpen: active?.crane ? Math.sin(active.crane.rotation.z) * .128 : 0, weaponDrumRotation: active?.drum?.rotation.z || 0, weaponFeedCover: active?.cover?.rotation.x || 0 });
  weapon.select('VX-9');
  weapon.dispose=()=>models.dispose();
  weapon.rig.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.renderOrder = 10; } }); weapon.dot.renderOrder = 22;
  return weapon;
}

function makeEffects(scene) {
  const capacity = 80; const items = [];
  const vertices = new Float32Array(capacity * 6); const colors = new Float32Array(capacity * 6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .85, depthWrite: false, blending: THREE.AdditiveBlending }));
  lines.frustumCulled = false; scene.add(lines);
  return {
    add(from, to, enemy = false, life = .085) {
      if (!from || !to) return;
      if (items.length >= capacity) items.shift();
      items.push({ from: { ...from }, to: { ...to }, life, maxLife: life, enemy });
    },
    update(dt) {
      for (let i = items.length - 1; i >= 0; i--) { items[i].life -= dt; if (items[i].life <= 0) items.splice(i, 1); }
      items.forEach((item, i) => {
        const k = i * 6; const intensity = item.life / item.maxLife;
        vertices[k] = item.from.x; vertices[k + 1] = item.from.y; vertices[k + 2] = item.from.z;
        vertices[k + 3] = item.to.x; vertices[k + 4] = item.to.y; vertices[k + 5] = item.to.z;
        for (let j = 0; j < 2; j++) { colors[k + j * 3] = intensity; colors[k + j * 3 + 1] = intensity * (item.enemy ? .4 : .78); colors[k + j * 3 + 2] = intensity * .3; }
      });
      geometry.attributes.position.needsUpdate = true; geometry.attributes.color.needsUpdate = true; geometry.setDrawRange(0, items.length * 2);
    },
    clear() { items.length = 0; },
  };
}

function makeLootField(scene) {
  const template = new THREE.Group();
  const caseMesh = coloredPart(template, (b, c) => {
    b.box(c('#2b3b36'), [0, .135, 0], [.47, .25, .33]);
    b.box(c('#89968c'), [0, .255, 0], [.49, .045, .35]);
    for (const x of [-.16, .16]) b.box(c('#35483f'), [x, .15, 0], [.036, .3, .38]);
    b.box(c('#b8dcbb'), [0, .181, .179], [.2, .035, .015]);
    b.box(c('#b8b8a3'), [0, .274, 0], [.15, .018, .04]);
  });
  let capacity = 128;
  let cases = new THREE.InstancedMesh(caseMesh.geometry, caseMesh.material, capacity);
  let halos = new THREE.InstancedMesh(new THREE.RingGeometry(.29, .32, 24), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .44, side: THREE.DoubleSide, depthWrite: false }), capacity);
  let markers = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.075, 0), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .8 }), capacity);
  for (const mesh of [cases, halos, markers]) { mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0; scene.add(mesh); }
  const object = new THREE.Object3D(); const normal = new THREE.Color('#9adfc1'); const rare = new THREE.Color('#ecc17c');
  function reserve(count) {
    if (count <= capacity) return;
    while (capacity < count) capacity *= 2;
    [cases, halos, markers] = [cases, halos, markers].map(previous => {
      const next = new THREE.InstancedMesh(previous.geometry, previous.material, capacity);
      next.instanceMatrix.setUsage(THREE.DynamicDrawUsage); next.frustumCulled = false;
      scene.remove(previous); previous.dispose(); scene.add(next); return next;
    });
  }
  return {
    stats() { return { lootCapacity: capacity, renderedLoot: cases.count }; },
    update(items, elapsed, visible) {
      reserve(visible ? (items || []).reduce((count, item) => count + Number(!item.taken), 0) : 0);
      let index = 0;
      for (const item of items || []) {
        if (item.taken || !visible) continue;
        object.position.set(item.x, (item.y ?? getGroundHeight(item.x,item.z)) + .025, item.z); object.rotation.set(0, 0, 0); object.scale.set(1, 1, 1); object.updateMatrix(); cases.setMatrixAt(index, object.matrix);
        object.position.y = (item.y ?? getGroundHeight(item.x,item.z)) + .037; object.rotation.x = -Math.PI / 2; object.updateMatrix(); halos.setMatrixAt(index, object.matrix);
        object.position.y = (item.y ?? getGroundHeight(item.x,item.z)) + .69 + Math.sin(elapsed * 2 + item.x) * .07; object.rotation.set(0, elapsed * .5, 0); object.scale.set(1, 1.6, 1); object.updateMatrix(); markers.setMatrixAt(index, object.matrix);
        const color = /rare|legend|epic|selten|high/i.test(String(item.rarity)) ? rare : normal; halos.setColorAt(index, color); markers.setColorAt(index, color); index++;
      }
      for (const mesh of [cases, halos, markers]) { mesh.count = index; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    },
  };
}

function makeContainerField(scene, spots = []) {
  const group = new THREE.Group(); group.name = 'searchable-containers'; scene.add(group);
  const models = new Map(), entries = new Map();
  const transform = new THREE.Object3D(), hinge = new THREE.Object3D();
  const baseMatrix = new THREE.Matrix4(), lidMatrix = new THREE.Matrix4(), hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const indicatorColor = new THREE.Color();
  const statusMaterial = new THREE.MeshStandardMaterial({ map: signTexture('DURCHSUCHT', 'BESTAND GEPRÜFT', '#c7c5ae', '#364540'), roughness: .9 });
  const indicatorMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#9bbcb0', emissiveIntensity: .24, roughness: .6 });

  function marking(type, top = false) {
    return canvasTexture(top ? 512 : 1024, top ? 512 : 320, (ctx, w, h) => {
      ctx.fillStyle = '#243531'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = type.color; ctx.fillRect(0, 0, top ? 15 : 24, h);
      const size = top ? 218 : 122, cx = top ? 256 : 114, cy = top ? 212 : 151;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(size / 100, size / 100); ctx.strokeStyle = '#e1e5cc'; ctx.fillStyle = '#e1e5cc'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
      if (type.id === 'tools') { ctx.moveTo(-30, 32); ctx.lineTo(20, -18); ctx.moveTo(5, -36); ctx.lineTo(4, -18); ctx.lineTo(22, -1); ctx.lineTo(39, -4); ctx.stroke(); }
      else if (type.id === 'electronics') {
        ctx.strokeRect(-24, -24, 48, 48); ctx.fillRect(-11, -11, 22, 22);
        for (const p of [-15, 0, 15]) { ctx.beginPath(); ctx.moveTo(p, -37); ctx.lineTo(p, -26); ctx.moveTo(p, 26); ctx.lineTo(p, 37); ctx.moveTo(-37, p); ctx.lineTo(-26, p); ctx.moveTo(26, p); ctx.lineTo(37, p); ctx.stroke(); }
      } else if (type.id === 'medical') { ctx.fillRect(-12, -37, 24, 74); ctx.fillRect(-37, -12, 74, 24); }
      else if (type.id === 'ammo') {
        for (const x of [-24, 0, 24]) { ctx.beginPath(); ctx.moveTo(x - 7, 31); ctx.lineTo(x - 7, -13); ctx.lineTo(x, -32); ctx.lineTo(x + 7, -13); ctx.lineTo(x + 7, 31); ctx.closePath(); ctx.fill(); }
      } else if (type.id === 'provisions') { ctx.arc(0, 0, 29, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-41, -34); ctx.lineTo(-41, 34); ctx.moveTo(42, -34); ctx.lineTo(42, 34); ctx.moveTo(-48, -34); ctx.lineTo(-48, -13); ctx.lineTo(-35, -13); ctx.lineTo(-35, -34); ctx.stroke(); }
      else if (type.id === 'industrial') {
        ctx.arc(0, 0, 26, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.stroke();
        for (let i = 0; i < 8; i++) { ctx.save(); ctx.rotate(i * TAU / 8); ctx.fillRect(-6, -39, 12, 16); ctx.restore(); }
      } else { ctx.moveTo(0, -39); ctx.lineTo(32, -25); ctx.lineTo(27, 14); ctx.lineTo(0, 38); ctx.lineTo(-27, 14); ctx.lineTo(-32, -25); ctx.closePath(); ctx.stroke(); ctx.fillRect(-6, -14, 12, 27); }
      ctx.restore(); ctx.fillStyle = '#e1e5cc'; ctx.font = `700 ${top ? 36 : 71}px Bahnschrift, Arial`; ctx.textAlign = top ? 'center' : 'left';
      ctx.fillText(type.name.toUpperCase(), top ? w / 2 : 224, top ? 394 : 148, top ? w - 58 : w - 255);
      ctx.fillStyle = type.color; ctx.font = `${top ? 22 : 29}px Bahnschrift, Arial`;
      ctx.fillText(top ? 'NORDWERK / VERSORGUNG' : type.description.toUpperCase(), top ? w / 2 : 227, top ? 444 : 218, top ? w - 50 : w - 265);
      if (!top) { ctx.fillStyle = '#9aa895'; for (let i = 0; i < 28; i++) ctx.fillRect(228 + i * 11, 261, i % 3 ? 5 : 8, 22); }
    });
  }
  function instanced(geometry, material, count, shadows = true) {
    const mesh = new THREE.InstancedMesh(geometry, material, count); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = shadows; mesh.receiveShadow = true; mesh.frustumCulled = false; group.add(mesh); return mesh;
  }
  for (const type of CONTAINER_TYPES) {
    const locations = spots.filter(spot => spot.type === type.id); if (!locations.length) continue;
    const count = locations.length, template = new THREE.Group();
    const bodyColor = { tools: '#ab622f', electronics: '#375965', medical: '#c9d3bb', ammo: '#687951', provisions: '#9e8158', industrial: '#ab8535', security: '#313c45' }[type.id];
    const body = coloredPart(template, (b, c) => {
      b.box(c('#263831'), [0, .105, 0], [.97, .13, .97]);
      for (const s of [-1, 1]) {
        b.box(c(bodyColor), [s * .46, .455, 0], [.08, .67, .98]);
        b.box(c(bodyColor), [0, .455, s * .46], [.86, .67, .08]);
        b.box(c('#222f2b'), [s * .41, .79, 0], [.09, .045, .91]);
        b.box(c('#222f2b'), [0, .79, s * .41], [.84, .045, .09]);
        for (const z of [-.38, .38]) b.box(c('#2c3831'), [s * .39, .035, z], [.16, .07, .16]);
        b.box(c('#bcc2ac'), [s * .32, .69, .516], [.105, .23, .055]);
        b.box(c('#303e36'), [s * .32, .69, .553], [.055, .11, .026]);
        b.box(c('#b1bba8'), [s * .514, .55, 0], [.06, .15, .36]);
        b.box(c('#293930'), [s * .548, .55, 0], [.025, .055, .23]);
      }
      b.box(c('#172820'), [0, .177, 0], [.82, .035, .82]);
      if (type.id === 'tools') for (const y of [.28, .42]) { b.box(c('#543d29'), [0, y, .511], [.8, .015, .012]); b.box(c('#b9c0aa'), [0, y + .07, .525], [.24, .025, .026]); }
      if (type.id === 'electronics' || type.id === 'security') for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(c('#222d2b'), [sx * .443, .47, sz * .445], [.13, .65, .13]);
      if (type.id === 'medical') for (const s of [-1, 1]) { b.box(c(type.color), [s * .506, .45, 0], [.018, .39, .13]); b.box(c(type.color), [s * .507, .45, 0], [.02, .13, .39]); }
      if (type.id === 'ammo') for (const x of [-.36, .36]) b.box(c('#9f9b61'), [x, .44, .514], [.07, .6, .014]);
      if (type.id === 'provisions') for (let y = .25; y < .75; y += .16) for (const s of [-1, 1]) b.box(c('#635d40'), [s * .506, y, 0], [.018, .018, .82]);
      if (type.id === 'industrial') for (let x = -.4; x < .45; x += .16) b.box(c('#343b2b'), [x, .28, .518], [.08, .16, .018], [0, 0, -.36]);
      if (type.id === 'security') { b.box(c('#8995a0'), [-.41, .43, .519], [.14, .33, .039]); b.box(c('#262e34'), [-.41, .48, .547], [.07, .12, .026]); }
    });
    const lid = coloredPart(template, (b, c) => {
      b.box(c('#26342d'), [0, .018, .47], [.99, .04, .99]);
      b.box(c(bodyColor), [0, .082, .47], [.995, .106, .995]);
      b.box(c('#536157'), [0, .149, .47], [.81, .027, .77]);
      for (const x of [-.34, .34]) {
        b.box(c(type.id === 'security' ? '#85929a' : '#293a32'), [x, .105, .47], [.065, .17, 1.005]);
        b.cylinder(c('#9ba796'), [x, .015, 0], .042, .16, .042, [0, 0, Math.PI / 2], 8);
      }
      if (type.id === 'provisions') for (let z = .12; z < .92; z += .17) b.box(c('#b09a6a'), [0, .17, z], [.91, .035, .12]);
      b.box(c('#243531'), [0, type.id === 'provisions' ? .198 : .167, .405], [.575, .012, .525]);
      if (type.id === 'industrial' || type.id === 'electronics') for (const x of [-.46, .46]) for (const z of [.065, .88]) b.box(c('#263630'), [x, .12, z], [.13, .18, .17]);
      for (const x of [-.12, .12]) b.box(c('#29372f'), [x, .157, .79], [.045, .08, .095]);
      b.box(c('#bdc0aa'), [0, .182, .79], [.24, .035, .048]);
    });
    const cargo = coloredPart(template, (b, c) => {
      if (type.id === 'ammo') for (let x = -.29; x < .3; x += .115) for (const z of [-.2, .05, .28]) { b.cylinder(c('#ab9658'), [x, .4, z], .04, .37, .037, [0, 0, 0], 8); b.cylinder(c('#bcbbaa'), [x, .62, z], .036, .1, .002, [0, 0, 0], 8); }
      else if (type.id === 'provisions') for (const x of [-.23, .07, .29]) for (const z of [-.22, .19]) { b.cylinder(c(x > 0 ? '#a07f4b' : '#56716c'), [x, .38, z], .105, .34, .105, [0, 0, 0], 12); b.cylinder(c('#afb6a0'), [x, .558, z], .108, .025, .108, [0, 0, 0], 12); }
      else if (type.id === 'tools') for (let i = 0; i < 4; i++) { const x = -.27 + i * .17; b.box(c('#94a79a'), [x, .31, 0], [.045, .055, .57], [0, i % 2 ? .15 : -.1, 0]); b.cylinder(c('#a6b5a3'), [x, .31, -.27], .078, .052, .078, [0, 0, 0], 8); b.box(c('#9d653c'), [x, .33, .23], [.08, .075, .22]); }
      else if (type.id === 'industrial') for (const x of [-.22, .23]) { b.cylinder(c('#607267'), [x, .33, 0], .19, .28, .19, [0, 0, 0], 12); b.cylinder(c('#a3aa92'), [x, .485, 0], .14, .035, .14, [0, 0, 0], 12); b.cylinder(c('#26382c'), [x, .51, 0], .055, .03, .055, [0, 0, 0], 10); }
      else for (let i = 0; i < 3; i++) {
        const x = -.27 + i * .27, tone = type.id === 'medical' ? '#cbd3b7' : type.id === 'electronics' ? '#47765c' : '#aaab87';
        b.box(c(tone), [x, .4, 0], [.23, .34, .58]);
        if (type.id === 'medical') { b.box(c('#a85d51'), [x, .577, 0], [.07, .016, .22]); b.box(c('#a85d51'), [x, .578, 0], [.17, .018, .07]); }
        else if (type.id === 'electronics') for (const z of [-.16, .09]) b.box(c('#263a31'), [x, .586, z], [.13, .035, .15]);
        else b.box(c('#777e68'), [x, .577, 0], [.24, .018, .065]);
      }
    });
    const frontGeometry = new THREE.PlaneGeometry(.67, .205); frontGeometry.translate(0, .483, .522);
    const topGeometry = new THREE.PlaneGeometry(.55, .5); topGeometry.rotateX(-Math.PI / 2); topGeometry.translate(0, type.id === 'provisions' ? .206 : .175, .405);
    const frontMaterial = new THREE.MeshStandardMaterial({ map: marking(type), roughness: .8, emissive: '#b3c6a3', emissiveIntensity: .09 });
    const topMaterial = new THREE.MeshStandardMaterial({ map: marking(type, true), roughness: .83, emissive: '#b3c6a3', emissiveIntensity: .06 });
    const statusGeometry = new THREE.PlaneGeometry(.46, .09); statusGeometry.translate(0, .235, .529);
    const indicatorGeometry = new THREE.BoxGeometry(.13, .025, .016); indicatorGeometry.translate(.32, .605, .537);
    const meshes = { body: instanced(body.geometry, body.material, count), lid: instanced(lid.geometry, lid.material, count), cargo: instanced(cargo.geometry, cargo.material, count), front: instanced(frontGeometry, frontMaterial, count, false), top: instanced(topGeometry, topMaterial, count, false), status: instanced(statusGeometry, statusMaterial, count, false), indicator: instanced(indicatorGeometry, indicatorMaterial, count, false) };
    models.set(type.id, meshes);
    locations.forEach((spot, index) => entries.set(spot.id, { spot, index, meshes, open: 0, type }));
  }
  let visibleCount = 0, openedCount = 0, emptyCount = 0;
  function reset() { for (const entry of entries.values()) entry.open = 0; }
  return {
    reset,
    stats() { return { containerTypes: models.size, renderedContainers: visibleCount, openedContainers: openedCount, emptyContainers: emptyCount,
      containerPoses: [...entries].filter(([, entry]) => entry.open > .001).map(([id, entry]) => ({ id, open: entry.open, lidAngle: -entry.open * Math.PI * .61 })) }; },
    update(containers, dt, visible, paused = false, cameraPosition = null) {
      group.visible = visible; visibleCount = openedCount = emptyCount = 0;
      const counts=new Map();
      for (const state of containers || []) {
        if(state.kind==='corpse')continue; const entry = entries.get(state.id); if (!entry) continue;
        const {spot,meshes,type}=entry; if(!visible || (cameraPosition&&Math.hypot(spot.x-cameraPosition.x,spot.z-cameraPosition.z)>100))continue; const index=counts.get(type.id)||0;counts.set(type.id,index+1);
        if (!paused) entry.open = damp(entry.open, state.opened ? 1 : 0, 10, dt);
        const empty = !!state.searched && !(state.items || []).some(item => !item.taken);
        if (visible) { visibleCount++; if (state.opened) openedCount++; if (empty) emptyCount++; }
        transform.position.set(spot.x, (spot.y ?? getGroundHeight(spot.x,spot.z)) + .003, spot.z); transform.rotation.set(0, spot.rotation || 0, 0); transform.scale.set(spot.w, spot.h, spot.d); transform.updateMatrix(); baseMatrix.copy(transform.matrix);
        meshes.body.setMatrixAt(index, baseMatrix); meshes.front.setMatrixAt(index, baseMatrix); meshes.indicator.setMatrixAt(index, baseMatrix);
        meshes.status.setMatrixAt(index, state.searched ? baseMatrix : hiddenMatrix);
        meshes.cargo.setMatrixAt(index, !empty && entry.open > .08 ? baseMatrix : hiddenMatrix);
        indicatorColor.set(empty ? '#4a5750' : state.searched ? '#b6ae76' : type.color); meshes.indicator.setColorAt(index, indicatorColor);
        // Scale the physical lid before rotating it around the northern hinge.
        transform.scale.set(1, 1, 1); transform.updateMatrix();
        hinge.position.set(0, spot.h * .82, -spot.d * .47); hinge.rotation.set(-entry.open * Math.PI * .61, 0, 0); hinge.scale.set(spot.w, spot.h, spot.d); hinge.updateMatrix();
        lidMatrix.multiplyMatrices(transform.matrix, hinge.matrix); meshes.lid.setMatrixAt(index, lidMatrix); meshes.top.setMatrixAt(index, lidMatrix);
      }
      for (const [id,meshes] of models) for (const mesh of Object.values(meshes)) { mesh.count=counts.get(id)||0;mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    },
  };
}

export function createRenderer(canvas, layout) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .98;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog('#a5a28c', 260, 1400);
  const environmentScene = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer); let environment = pmrem.fromScene(environmentScene, .06);
  scene.environment = environment.texture; scene.environmentIntensity = .32; environmentScene.dispose(); pmrem.dispose();
  const operatorStage=createOperatorStage(environment.texture);let menuStageActive=true;
  const camera = new THREE.PerspectiveCamera(82, 1, .035, 2200); camera.rotation.order = 'YXZ'; scene.add(camera);
  const sky = createSky(scene); const mats = makePalette();
  const hemi = new THREE.HemisphereLight('#c5e0dc', '#918466', 1.85); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffd3a0', 3.8); sun.position.set(-48, 56, -54); scene.add(sun); scene.add(sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -50; sun.shadow.camera.right = 50; sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 190; sun.shadow.bias = -.00018; sun.shadow.normalBias = .035;
  sun.shadow.autoUpdate = true;
  const fill = new THREE.DirectionalLight('#b9dcda', .65); fill.position.set(35, 20, 35); scene.add(fill);
  const world = buildWorld(scene, layout, mats); const weapon = makeWeapon(camera, mats); const effects = makeEffects(scene);
  const enemies = new Map(); const teammates = new Map(); const lootField = makeLootField(scene);
  const containerField = makeContainerField(scene, layout.containers);
  const dir = new THREE.Vector3(); const tmp = new THREE.Vector3();
  let elapsed = 0; let lastState = null; let lastPhase = ''; let fps = 60; let shake = 0; let quality = 'high';
  const settings = { quality: 'high', renderScale: 1, shadows: 'auto', particles: true, brightness: 1, contrast: 1, saturation: 1,
    fov: 82, headBob: 1, weaponSway: 1, screenShake: 1, adsZoom: 1, sprintFov: 4, showWeapon: true };
  let width = 1; let height = 1; let disposed = false; let frameDt = 1 / 60;
  let resolutionDirty=true, appliedResolution=null, resolutionChanges=0;
  const gl=renderer.getContext(), maxDimension=Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),renderer.capabilities.maxTextureSize);
  const rnd = seeded(404);
  const dustCount = 135; const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) { dustPositions[i * 3] = (rnd() - .5) * 90; dustPositions[i * 3 + 1] = .5 + rnd() * 10; dustPositions[i * 3 + 2] = (rnd() - .5) * 90; }
  const dustGeometry = new THREE.BufferGeometry(); dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: '#ffe0aa', size: .023, transparent: true, opacity: .36, depthWrite: false })); scene.add(dust);

  function resize() {
    width = Math.max(1, canvas.clientWidth || window.innerWidth); height = Math.max(1, canvas.clientHeight || window.innerHeight);
    resolutionDirty=true;camera.aspect = width / height; camera.updateProjectionMatrix();
  }

  function applyPendingResolution() {
    if(!resolutionDirty)return;
    const next=renderResolution({width,height,devicePixelRatio:window.devicePixelRatio,quality,renderScale:settings.renderScale,maxDimension});
    const applied=applyRenderResolution(renderer,next,appliedResolution);
    if(applied!==appliedResolution)resolutionChanges++;
    appliedResolution=applied;resolutionDirty=false;
  }

  function applyQuality() {
    quality = settings.quality;
    const shadowQuality = settings.shadows === 'auto' ? quality === 'low' ? 'off' : quality : settings.shadows;
    const shadowsEnabled = shadowQuality !== 'off', mapSize = shadowQuality === 'high' ? 2048 : 1024;
    renderer.shadowMap.enabled = shadowsEnabled; sun.castShadow = shadowsEnabled;
    if (sun.shadow.mapSize.x !== mapSize || !shadowsEnabled) {
      sun.shadow.mapSize.set(mapSize, mapSize); sun.shadow.map?.dispose(); sun.shadow.map = null;
      sun.shadow.mapPass?.dispose(); sun.shadow.mapPass = null;
    }
    dust.visible = settings.particles && quality !== 'low'; resize();
  }

  function setSettings(next = {}) {
    if (disposed || !next || typeof next !== 'object') return;
    const previous = { ...settings };
    const ranges = { renderScale: [.5, 1.5], brightness: [.7, 1.4], contrast: [.75, 1.3], saturation: [0, 1.5], fov: [65, 110],
      headBob: [0, 1], weaponSway: [0, 1], screenShake: [0, 1], adsZoom: [0, 1], sprintFov: [0, 8] };
    for (const [key, [min, max]] of Object.entries(ranges)) if (Number.isFinite(next[key])) settings[key] = clamp(next[key], min, max);
    if (['low', 'medium', 'high'].includes(next.quality)) settings.quality = next.quality;
    if (['auto', 'off', 'medium', 'high'].includes(next.shadows)) settings.shadows = next.shadows;
    for (const key of ['particles', 'showWeapon']) if (typeof next[key] === 'boolean') settings[key] = next[key];
    if (['quality', 'renderScale', 'shadows', 'particles'].some(key => settings[key] !== previous[key])) applyQuality();
    renderer.toneMappingExposure = .98 * settings.brightness;
    // Canvas composition grades the 3D image after tone mapping, preserving HUD
    // contrast and avoiding a second full-resolution render target at defaults.
    canvas.style.filter = settings.contrast === 1 && settings.saturation === 1 ? '' : `contrast(${settings.contrast}) saturate(${settings.saturation})`;
    if (['fov', 'adsZoom', 'sprintFov'].some(key => settings[key] !== previous[key]) && lastState && lastState.phase !== 'hub') {
      camera.fov = settings.fov - weapon.aim * aimFovReduction(settings.fov,lastState.player,settings.adsZoom) + weapon.sprintBlend * settings.sprintFov;
      camera.updateProjectionMatrix();
    }
    weapon.rig.visible = settings.showWeapon && weapon.armed && !!lastState && ['raid', 'paused', 'extracted'].includes(lastState.phase);
    if (lastState?.phase === 'paused' && ['headBob', 'screenShake'].some(key => settings[key] !== previous[key])) {
      camera.position.y = (lastState.player.y || 0) + 1.65 - weapon.crouch + Math.sin(weapon.bob * 2) * weapon.bobAmplitude * settings.headBob;
      camera.rotation.z = Math.cos(weapon.bob) * weapon.bobAmplitude * .2 * settings.headBob + Math.sin(elapsed * 33) * shake * .006 * settings.screenShake;
    }
  }

  function setQuality(value) {
    setSettings({ quality: ['low', 'medium', 'high'].includes(value) ? value : 'high' });
  }

  function clearEntities() {
    enemies.forEach(e => { scene.remove(e.root); disposeGroup(e.root); }); enemies.clear();
    teammates.forEach(e => { e.dispose?.();scene.remove(e.root); disposeGroup(e.root); }); teammates.clear();
    effects.clear();
  }

  function update(state, dt, input = {}) {
    if (disposed || !state) return;
    dt = clamp(dt || 1 / 60, 0, .1); frameDt = dt; elapsed += dt; fps = damp(fps, 1 / Math.max(dt, .001), 2, dt);
    lastState = state;
    const p = state.player || {}; const phase = state.phase; const isRaidView = ['raid', 'paused', 'dead', 'extracted'].includes(phase);
    menuStageActive=!isRaidView;operatorStage.setActive(menuStageActive);
    if(menuStageActive){if(lastPhase!==phase)clearEntities();lastPhase=phase;weapon.rig.visible=false;operatorStage.update(state.profile,dt,width,height,settings);return;}
    weapon.select(isRaidView ? p.weapon : state.profile?.selectedWeapon,isRaidView?p.attachments:{});
    if (phase === 'raid' && ['hub', '', 'extracted', 'dead'].includes(lastPhase)) {
      clearEntities();
      containerField.reset();
      weapon.recoil = weapon.kick = weapon.flashTime = weapon.aim = weapon.crouch = weapon.bob = weapon.reloadClock = 0;
      weapon.sprintBlend = weapon.moveBlend = weapon.bobAmplitude = 0;
      weapon.rig.position.set(.265, -.315, -.49); weapon.rig.rotation.set(0, 0, 0);
      camera.fov = Number.isFinite(input.fov) ? clamp(input.fov, 65, 110) : settings.fov; camera.updateProjectionMatrix(); shake = 0;
    }
    if (phase === 'paused' && lastPhase !== 'paused') {
      weapon.flashTime = 0; weapon.flash.visible = false; weapon.light.intensity = 0;
    }
    lastPhase = phase;
    weapon.rig.visible = settings.showWeapon && weapon.armed && isRaidView && phase !== 'dead' && !p.downed;
    if (phase !== 'paused') {
      const active = phase === 'raid';
      const aim = active && weapon.armed && input.aim && !p.sprinting && !p.reload && !p.heal ? 1 : 0;
      weapon.aim = damp(weapon.aim, aim, 2.3 / Math.max(.09,p.adsSeconds||p.weaponStats?.adsSeconds||.19), dt);
      weapon.crouch = damp(weapon.crouch, input.crouch ? .48 : 0, 13, dt);
      // One cosmetic locomotion blend drives every part of the sprint pose.
      // Exponential damping reaches 90% in 0.19 s at any frame rate and cannot
      // overshoot when stamina exhaustion switches authoritative sprint off.
      weapon.sprintBlend = damp(weapon.sprintBlend, active && p.sprinting ? 1 : 0, 12, dt);
      weapon.moveBlend = damp(weapon.moveBlend, active && p.moving ? 1 : 0, 12, dt);
      const walkingFrequency = THREE.MathUtils.lerp(7.8, 5, weapon.crouch / .48);
      const bobFrequency = THREE.MathUtils.lerp(walkingFrequency, 12, weapon.sprintBlend);
      weapon.bob += dt * bobFrequency * weapon.moveBlend;
      const amplitude = THREE.MathUtils.lerp(.013, .03, weapon.sprintBlend) * weapon.moveBlend * (1 - weapon.aim * .85);
      weapon.bobAmplitude = amplitude;
      const bobY = Math.sin(weapon.bob * 2) * amplitude;
      const weaponAmplitude = amplitude * settings.weaponSway;
      const deathOffset = phase === 'dead' ? .92 : p.downed ? 1 : 0;
      camera.position.set(p.x || 0, (p.y || 0) + 1.65 - weapon.crouch + bobY * settings.headBob - deathOffset, p.z || 0);
      shake = damp(shake, 0, 9, dt);
      // Parent supplies the single authoritative aim offset to both player state
      // and hitscan. Cosmetic weapon motion must never alter camera pitch/yaw.
      camera.rotation.set(p.pitch || 0, p.yaw || 0, phase === 'dead' ? -.21 : Math.cos(weapon.bob) * amplitude * .2 * settings.headBob + Math.sin(elapsed * 33) * shake * .006 * settings.screenShake, 'YXZ');
      const fov = Number.isFinite(input.fov) ? clamp(input.fov, 65, 110) : settings.fov;
      camera.fov = damp(camera.fov, fov - weapon.aim * aimFovReduction(fov,p,settings.adsZoom) + weapon.sprintBlend * settings.sprintFov, 12, dt); camera.updateProjectionMatrix();
      weapon.recoil = damp(weapon.recoil, 0, 18, dt); weapon.kick = damp(weapon.kick, 0, 19, dt);
      weapon.flashTime -= dt; weapon.flash.visible = weapon.flashTime > 0; weapon.light.intensity = weapon.flashTime > 0 && quality === 'high' ? 4.5 : 0;
      if (weapon.flash.visible) weapon.flash.rotation.z += dt * 40;
      const isReloading = !!p.reload;
      weapon.reloadClock = isReloading ? weapon.reloadClock + dt : 0;
      const reload = isReloading ? Math.sin(Math.min(1, weapon.reloadClock / .23) * Math.PI / 2) : 0;
      const healing = p.heal ? 1 : 0;
      const swayX = clamp(input.lookDX || 0, -70, 70) * -.00022 * (1 - weapon.aim * .8) * settings.weaponSway;
      const swayY = clamp(input.lookDY || 0, -70, 70) * -.00015 * (1 - weapon.aim * .8) * settings.weaponSway;
      const x = THREE.MathUtils.lerp(.265, 0, weapon.aim) + Math.cos(weapon.bob) * weaponAmplitude + swayX;
      const y = THREE.MathUtils.lerp(-.315, -weapon.sightHeight * .87, weapon.aim) - Math.abs(bobY) * settings.weaponSway + swayY - reload * .1 - healing * .3;
      const z = THREE.MathUtils.lerp(-.49, -.43, weapon.aim) + weapon.recoil * (.011 - weapon.aim * .007);
      weapon.rig.position.x = damp(weapon.rig.position.x, x, 22, dt); weapon.rig.position.y = damp(weapon.rig.position.y, y, 20, dt); weapon.rig.position.z = damp(weapon.rig.position.z, z, 25, dt);
      weapon.rig.rotation.set(weapon.kick * (.015 - weapon.aim * .014) + reload * .16 - weapon.sprintBlend * .2, reload * .38 + swayX * 2, reload * -.47 + weapon.sprintBlend * .16 + Math.cos(weapon.bob) * weaponAmplitude * .35);
      weapon.animate(p, dt);
      weapon.dot.visible = weapon.hasReticle && weapon.aim > .3;
      weapon.dot.scale.setScalar(1/Math.max(1,p.adsZoom||p.weaponStats?.adsZoom||1.35));
      weapon.lens.material.opacity = .055 + weapon.aim * .025;
    }
    sky.position.copy(camera.position);
    // A local, texel-snapped shadow window preserves detail throughout the
    // expanded district instead of stretching a single map over 300 metres.
    const shadowStep = 100 / sun.shadow.mapSize.x;
    const shadowX = Math.round(camera.position.x / shadowStep) * shadowStep;
    const shadowZ = Math.round(camera.position.z / shadowStep) * shadowStep;
    const shadowY = camera.position.y - 1.65; sun.position.set(shadowX - 48, shadowY + 56, shadowZ - 54); sun.target.position.set(shadowX, shadowY, shadowZ);
    world.update(camera);
    world.relayLamp.visible = Math.sin(elapsed * 2.4) > .5;
    world.exfils.forEach((ex, i) => { ex.material.opacity = .4 + Math.sin(elapsed * 2 + i) * .12; ex.beam.material.opacity = state.raid?.extractionProgress > 0 ? .4 : .13; });
    dust.rotation.y = elapsed * .003;
    dust.position.set(camera.position.x, camera.position.y - 1.65, camera.position.z);
    const present = new Set();
    for (const en of phase === 'hub' ? [] : state.enemies || []) {
      present.add(en.id);
      let model = enemies.get(en.id);
      if (!model) { model = makeEnemy(en.kind); model.lastX = en.x; model.lastZ = en.z; enemies.set(en.id, model); scene.add(model.root); }
      const speed = Math.hypot(en.x - model.lastX, en.z - model.lastZ) / Math.max(dt, .001);
      model.lastX = en.x; model.lastZ = en.z;
      model.death = damp(model.death, en.dead ? 1 : 0, 6, dt);
      model.root.position.set(en.x, (en.y || 0) + model.death * .12, en.z);
      model.root.rotation.set(0, en.yaw || 0, model.death * -1.5);
      model.root.position.y += model.death * .07;
      if (!en.dead && phase !== 'paused') model.stride += dt * Math.min(speed * 3, 10);
      const stride = Math.min(speed / 2, 1) * .53 * (1 - model.death);
      model.legs[0].rotation.x = Math.sin(model.stride) * stride; model.legs[1].rotation.x = -Math.sin(model.stride) * stride;
      model.torso.position.y = 1.12 + Math.cos(model.stride * 2) * stride * .022;
      model.flash.visible = !en.dead && !!en.attackFlash;
      // Task presentation only: the authoritative body yaw and every hitbox
      // height remain unchanged. Search glances never rotate the whole agent.
      const task = en.ai?.task || en.mode || 'patrol';
      const searching = ['investigate', 'scan', 'sweep', 'search'].includes(task);
      const poseDt = phase === 'paused' && !state.multiplayer ? 0 : dt;
      if (model.aiTask !== task) model.scanClock = 0;
      model.aiTask = task; model.scanClock = searching && !en.dead ? model.scanClock + poseDt : 0;
      const scanCycle = model.scanClock % 4.4;
      const glance = !searching ? 0 : scanCycle < 1.1 ? Math.sin(scanCycle / 1.1 * Math.PI) * .12
        : scanCycle > 2.2 && scanCycle < 3.3 ? -Math.sin((scanCycle - 2.2) / 1.1 * Math.PI) * .12 : 0;
      model.head.rotation.y = damp(model.head.rotation.y, en.dead ? 0 : glance, 9, poseDt);
      const readyPitch = ['patrol', 'return'].includes(task) ? -.14 : searching ? -.045 : 0;
      model.gun.rotation.x = damp(model.gun.rotation.x, (en.dead ? 0 : readyPitch) - (model.flash.visible ? .06 : 0), 11, poseDt);
      for (const arm of model.arms) arm.rotation.x = model.gun.rotation.x * .65;
      model.hit = Math.max(0, model.hit - dt);
      model.root.scale.setScalar(model.hit > 0 ? 1.008 : 1);
    }
    for (const [id, model] of enemies) if (!present.has(id)) { scene.remove(model.root); disposeGroup(model.root); enemies.delete(id); }
    const teamPresent = new Set();
    for (const member of state.multiplayer && phase !== 'hub' ? state.teammates || [] : []) {
      if (member.phase === 'extracted' || member.phase === 'disconnected') continue;
      teamPresent.add(member.id);
      let model = teammates.get(member.id);
      if (!model) {
        model = makeEnemy('guard', true); model.root.position.set(member.x, member.y || 0, member.z); model.root.rotation.y = member.yaw || 0;
        teammates.set(member.id, model); scene.add(model.root);
      }
      // Interpolate remote presentation between network snapshots. Authority,
      // aim and the local FPS camera and weapon remain entirely independent.
      const x = model.root.position.x, z = model.root.position.z;
      const teleport = Math.hypot(member.x - x, member.z - z) > 8;
      model.root.position.x = teleport ? member.x : damp(x, member.x, 16, dt);
      model.root.position.z = teleport ? member.z : damp(z, member.z, 16, dt);
      const yawDelta = Math.atan2(Math.sin((member.yaw || 0) - model.root.rotation.y), Math.cos((member.yaw || 0) - model.root.rotation.y));
      const yaw = model.root.rotation.y + damp(0, yawDelta, 18, dt);
      const downed=!!member.downed; const dead = !downed && (!!member.dead || member.phase === 'dead' || member.hp <= 0);
      model.death = damp(model.death, dead || downed ? 1 : 0, 6, dt);
      model.crouch = damp(model.crouch, member.crouching ? 1 : 0, 12, dt);
      model.root.position.y = damp(model.root.position.y, (member.y || 0) - model.crouch * .28 + model.death * .19, 16, dt);
      model.root.rotation.set(0, yaw, model.death * -1.5);
      const speed = teleport ? 0 : Math.hypot(model.root.position.x - x, model.root.position.z - z) / Math.max(dt, .001);
      model.move = damp(model.move, dead || downed ? 0 : Math.min(speed / 2.6, 1), 12, dt);
      model.stride += dt * Math.min(speed * 2.8, 12);
      const stride = model.move * .53 * (1 - model.death);
      model.legs[0].rotation.x = Math.sin(model.stride) * stride - model.crouch * .2;
      model.legs[1].rotation.x = -Math.sin(model.stride) * stride - model.crouch * .2;
      model.torso.position.y = 1.12 + Math.cos(model.stride * 2) * stride * .022;
      model.head.rotation.x = damp(model.head.rotation.x, clamp(member.pitch || 0, -.75, .75), 15, dt);
      model.shotTime = Math.max(0, model.shotTime - dt);
      model.flash.visible = !dead && !downed && (model.shotTime > 0 || !!member.attackFlash);
      model.gun.rotation.x = damp(model.gun.rotation.x, clamp(member.pitch || 0, -.8, .8) + (member.reload ? .27 : 0), 15, dt);
      model.selectWeapon(member.weapon,member.attachments);model.selectEquipment(member.equipment);model.animateEquipment();model.animateWeapon(member,dt);
      model.arms.forEach(arm => { arm.rotation.x = model.gun.rotation.x * .65; });
      model.marker.visible = !dead; model.marker.material.color.set(downed?'#efb56d':'#8cddff'); model.marker.position.set(downed?-1.2:0,downed?.5:2.15+Math.sin(elapsed*2)*.025,0); model.marker.rotation.z=-model.root.rotation.z;
    }
    for (const [id, model] of teammates) if (!teamPresent.has(id)) { model.dispose?.();scene.remove(model.root); disposeGroup(model.root); teammates.delete(id); }
    lootField.update(state.loot, elapsed, phase !== 'hub');
    containerField.update(state.containers, dt, phase !== 'hub', phase === 'paused' && !state.multiplayer,camera.position);
    effects.update(dt);
  }

  function events(list) {
    for (const event of list || []) {
      if (event.type === 'shot') {
        weapon.select(event.weapon || lastState?.player?.weapon,lastState?.player?.attachments);
        const impulse = ({ smg: .26, assault: .36, bullpup: .32, shotgun: .53, marksman: .43, sniper: .58, machinegun: .34, revolver: .46 })[weapon.model];
        weapon.recoil = Math.min(weapon.recoil + impulse, .65); weapon.kick = Math.min(weapon.kick + impulse, .65); weapon.flashTime = .04;
        camera.getWorldDirection(dir); camera.updateMatrixWorld();
        weapon.flash.getWorldPosition(tmp);
        const from = { x: tmp.x, y: tmp.y, z: tmp.z };
        const to = event.to || { x: camera.position.x + dir.x * 65, y: camera.position.y + dir.y * 65, z: camera.position.z + dir.z * 65 };
        for (const end of event.pelletEnds?.length ? event.pelletEnds : [to]) effects.add(from, end);
      } else if (event.type === 'teammateShot') {
        const model = teammates.get(event.playerId); if (model) { model.shotTime = .08; model.flash.visible = true; }
        if (event.from && event.to) for (const end of event.pelletEnds?.length ? event.pelletEnds : [event.to]) effects.add(event.from, end, false, .1);
      } else if (event.type === 'enemyShot') {
        const en = enemies.get(event.id ?? event.enemyId); if (en) en.flash.visible = true;
        effects.add(event.from, event.to, true, .12);
      } else if (event.type === 'damage') shake = .85;
      else if (event.type === 'hit') {
        const en = enemies.get(event.id ?? event.enemyId); if (en) en.hit = .12;
        if (settings.particles && event.x != null) for (let i = 0; i < 5; i++) effects.add({ x: event.x, y: event.y || 1, z: event.z }, { x: event.x + (rnd() - .5) * .45, y: (event.y || 1) + rnd() * .35, z: event.z + (rnd() - .5) * .45 }, false, .11);
      }
    }
  }

  function disposeGroup(group, materials = true) {
    const geometries = new Set(); const uniqueMaterials = new Set();
    group.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => uniqueMaterials.add(m)); });
    geometries.forEach(g => g.dispose());
    if (materials) uniqueMaterials.forEach(m => { for (const key of Object.keys(m)) if (m[key]?.isTexture) m[key].dispose(); m.dispose(); });
  }

  applyQuality();
  return {
    canvas,
    update,
    render() { if (!disposed) {applyPendingResolution();renderer.render(menuStageActive?operatorStage.scene:scene,menuStageActive?operatorStage.camera:camera);} },
    resolutionStats(){return {...appliedResolution,changes:resolutionChanges,pending:resolutionDirty};},
    restoreContext(){const room=new RoomEnvironment(),generator=new THREE.PMREMGenerator(renderer);const next=generator.fromScene(room,.06);scene.environment=next.texture;operatorStage.setEnvironment(next.texture);operatorStage.restoreContext();environment.dispose();environment=next;room.dispose();generator.dispose();sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.mapPass?.dispose();sun.shadow.mapPass=null;appliedResolution=null;resize();applyQuality();},
    resize,
    events,
    setSettings,
    setQuality,
    setFov(value) { setSettings({ fov: Number.isFinite(value) ? value : 82 }); },
    getAimDirection() { const p = lastState?.player; if (p) return { x: -Math.sin(p.yaw || 0) * Math.cos(p.pitch || 0), y: Math.sin(p.pitch || 0), z: -Math.cos(p.yaw || 0) * Math.cos(p.pitch || 0) }; camera.getWorldDirection(dir); return { x: dir.x, y: dir.y, z: dir.z }; },
    stats() { return { ...world.stats(), ...operatorStage.stats(), settings: { ...settings }, pixelRatio: renderer.getPixelRatio(), renderWidth: canvas.width, renderHeight: canvas.height, shadowsEnabled: renderer.shadowMap.enabled, shadowMapSize: renderer.shadowMap.enabled ? sun.shadow.mapSize.x : 0, dustVisible: dust.visible, exposure: renderer.toneMappingExposure, colorFilter: canvas.style.filter, weaponVisible: weapon.rig.visible, cameraRoll: camera.rotation.z, weaponX: weapon.rig.position.x, weaponY: weapon.rig.position.y, enemyPoses: [...enemies.entries()].map(([id, model]) => ({ id, task: model.aiTask, weaponPitch: model.gun.rotation.x, headYaw: model.head.rotation.y, bodyYaw: model.root.rotation.y })), adsZoom:lastState?.player?.adsZoom||lastState?.player?.weaponStats?.adsZoom||1.35,adsSeconds:lastState?.player?.adsSeconds||lastState?.player?.weaponStats?.adsSeconds||.19,adsTargetFov:settings.fov-aimFovReduction(settings.fov,lastState?.player,settings.adsZoom),teammateLoadouts:[...teammates.entries()].map(([id,model])=>({id,weaponId:model.weaponId,variant:model.weaponVariant,buildKey:model.weaponBuildKey,attachments:model.weaponAttachments,equipment:model.equipment})),teammates: teammates.size, teammateWeapons: [...teammates.values()].map(model => model.weaponId), drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, fps: Math.round(fps), quality, frameMs: Math.round(frameDt * 10000) / 10, cameraPitch: camera.rotation.x, cameraYaw: camera.rotation.y, cameraY: camera.position.y, fov: camera.fov, sprintBlend: weapon.sprintBlend, moveBlend: weapon.moveBlend, weaponPitch: weapon.rig.rotation.x, weaponRoll: weapon.rig.rotation.z, bobAmplitude: weapon.bobAmplitude, headBobAmplitude: weapon.bobAmplitude * settings.headBob, weaponBobAmplitude: weapon.bobAmplitude * settings.weaponSway, ...weapon.stats(), ...lootField.stats(), ...containerField.stats() }; },
    dispose() { if (disposed) return; disposed = true; operatorStage.dispose();weapon.dispose();teammates.forEach(model=>model.dispose?.());disposeGroup(scene); environment.dispose(); renderer.dispose(); canvas.style.filter = ''; },
  };
}
