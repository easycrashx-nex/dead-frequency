import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {WEAPONS} from '../src/weapons.js';
import {ATTACHMENTS,EQUIPMENT,canAttach} from '../src/loadouts.js';
import {makeWeaponModel,disposeWeaponModel,createWeaponModelPool,weaponBuildKey,makeOperatorEquipment,opticalFieldOfView} from '../src/weapon-model.js';

function inspect(model) {
  model.root.updateMatrixWorld(true);const hash=createHash('sha256');let vertices=0,meshes=0;
  model.root.traverse(node=>{
    if(!node.isMesh)return;meshes++;
    const values=node.geometry.attributes.position.array;vertices+=values.length/3;
    assert.ok(values.every(Number.isFinite));hash.update(Buffer.from(values.buffer,values.byteOffset,values.byteLength));hash.update(node.matrixWorld.elements.join(','));
  });
  const size=new THREE.Box3().setFromObject(model.root).getSize(new THREE.Vector3());
  assert.ok(meshes>0&&meshes<80);assert.ok(vertices>100&&vertices<160000);
  return {signature:hash.digest('hex'),size,vertices,meshes};
}
test('all32 authored weapon models have distinct finite geometry and plausible dimensions',()=>{
  const signatures=new Set();assert.equal(WEAPONS.length,32);
  for(const weapon of WEAPONS){const model=makeWeaponModel(weapon.id),info=inspect(model);assert.ok(info.size.z>.25&&info.size.z<2.7,weapon.id);assert.ok(!signatures.has(info.signature),weapon.id);signatures.add(info.signature);assert.equal(model.id,weapon.id);disposeWeaponModel(model);}
});
test('all36 compatible attachments alter actual geometry and retain their canonical slot IDs',()=>{
  assert.equal(ATTACHMENTS.length,36);
  for(const part of ATTACHMENTS){const weapon=WEAPONS.find(item=>canAttach(item.id,part.id)),build={[part.slot]:part.id};const base=makeWeaponModel(weapon.id),model=makeWeaponModel(weapon.id,false,build);assert.notEqual(inspect(model).signature,inspect(base).signature,part.id);assert.equal(model.attachments[part.slot],part.id);disposeWeaponModel(model);disposeWeaponModel(base);}
});
test('FPS and remote share six-slot builds; malformed and incompatible slots cannot change the model key',()=>{
  const build={optic:'optic-sniper',magazine:'mag-precision',muzzle:'muzzle-heavy-can',grip:'grip-bipod',stock:'stock-heavy',barrel:'barrel-long'};
  const local=makeWeaponModel('DMR-7',false,build),remote=makeWeaponModel('DMR-7',true,build);assert.equal(local.buildKey,remote.buildKey);assert.equal(Object.keys(local.attachments).length,6);inspect(local);inspect(remote);assert.deepEqual(local.attachments,build);
  assert.equal(weaponBuildKey('P9-19',{optic:'optic-sniper',wrong:'x'}),weaponBuildKey('P9-19',{}));disposeWeaponModel(local);disposeWeaponModel(remote);
});
test('pistol, break-action and revolver attachments preserve bounded moving mechanisms',()=>{
  for(const id of ['P9-19','DE-50','DB-2','RV-6'])for(const part of ATTACHMENTS.filter(part=>canAttach(id,part.id))){const model=makeWeaponModel(id,false,{[part.slot]:part.id});inspect(model);assert.ok(model.slide||model.breakAction||model.crane);disposeWeaponModel(model);}
});
test('model pool reuses builds, bounds residency, disposes evicted geometry once and can dispose twice safely',()=>{
  const pool=createWeaponModelPool(false,2),first=pool.get('VX-9');let disposed=0;first.root.children.find(node=>node.isMesh).geometry.addEventListener('dispose',()=>disposed++);
  assert.equal(pool.get('VX-9'),first);pool.get('AR-4');pool.get('DMR-7');assert.equal(pool.size,2);assert.equal(first.disposed,true);assert.equal(disposed,1);pool.dispose();pool.dispose();assert.equal(pool.size,0);assert.equal(disposed,1);
});
test('all24 gear pieces have distinct geometry per slot; conditions do not rebuild the equipment signature',()=>{
  assert.equal(EQUIPMENT.length,24);const signatures=new Map();
  for(const gear of EQUIPMENT){const equipment={[gear.slot]:{catalogId:gear.id}},model=makeOperatorEquipment({...equipment,...(gear.slot==='plate'?{carrier:'carrier-web'}:{})});const signature=inspect(model).signature,key=gear.slot+signature;assert.ok(!signatures.has(key),gear.id);signatures.set(key,true);disposeWeaponModel(model);}
});
test('optical magnification uses a real angular FOV ratio without changing aim angles',()=>{
  assert.ok(Math.abs(opticalFieldOfView(82,1)-82)<1e-10);let previous=82;
  for(const zoom of [1.15,1.35,1.6,2,4,6]){const fov=opticalFieldOfView(82,zoom);assert.ok(fov<previous&&fov>5);assert.ok(Math.abs(Math.tan(82*Math.PI/360)/Math.tan(fov*Math.PI/360)-zoom)<1e-10);previous=fov;}
});
