import * as THREE from 'three';
import {makeWeaponModel, disposeWeaponModel, weaponBuildKey} from './weapon-model.js';

// One editor preview, rendered only when its build, size or rotation changes.
// It shares the exact first-person geometry factory and creates no frame loop.
export function createWeaponPreview(container, initialBuild = {}) {
  const renderer = new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18;
  const canvas = renderer.domElement; canvas.className = 'weapon-preview-canvas';
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;';
  canvas.setAttribute('aria-label', 'Dreidimensionale Vorschau der Waffe mit montierten Aufsätzen');
  container.append(canvas);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(31, 1, .01, 20);
  const pivot = new THREE.Group(); scene.add(pivot);
  scene.add(new THREE.HemisphereLight('#e4eff7','#4e675b',2.6));
  const keyLight = new THREE.DirectionalLight('#ffe2b7',4.2); keyLight.position.set(-2,3,3); scene.add(keyLight);
  const rim = new THREE.DirectionalLight('#77bedf',2.3); rim.position.set(3,1,-2); scene.add(rim);
  const front = new THREE.DirectionalLight('#f2f8ff',1.25); front.position.set(0,-1,4); scene.add(front);
  let model, key = '', disposed = false, yaw = -Math.PI / 2 + .23, pitch = .08, distance = 2;
  let width=0,height=0;
  const bounds = new THREE.Box3(), center = new THREE.Vector3(), size = new THREE.Vector3();

  function draw() {
    if (disposed || !model || !width || !height) return;
    pivot.rotation.set(pitch,yaw,0);
    camera.position.set(0,.04,distance); camera.lookAt(0,0,0);
    renderer.render(scene,camera);
  }
  function resize() {
    if (disposed) return;
    width=Math.max(1,container.clientWidth);height=Math.max(1,container.clientHeight);
    renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
    if(model){const vertical=Math.max(size.y,.34),horizontal=Math.max(size.z,size.x);distance=Math.max(vertical/Math.tan(31*Math.PI/360),horizontal/Math.tan(31*Math.PI/360)/camera.aspect)*.7;}
    draw();
  }
  function update(build = {}) {
    if(disposed)return;
    const next=weaponBuildKey(build.weapon,build.attachments);
    if(next===key)return;
    if(model){pivot.remove(model.root);disposeWeaponModel(model);}
    model=makeWeaponModel(build.weapon,false,build.attachments);key=next;
    bounds.setFromObject(model.root);bounds.getCenter(center);bounds.getSize(size);
    model.root.position.sub(center);pivot.add(model.root);resize();
  }
  function setRotation(nextYaw=-Math.PI/2+.23,nextPitch=.08){
    yaw=Number.isFinite(nextYaw)?nextYaw:yaw;pitch=THREE.MathUtils.clamp(Number.isFinite(nextPitch)?nextPitch:pitch,-.65,.65);draw();
  }
  const observer=new ResizeObserver(resize);observer.observe(container);update(initialBuild);
  return {
    update,resize,setRotation,
    rotate(deltaYaw,deltaPitch=0){setRotation(yaw+deltaYaw,pitch+deltaPitch);},
    reset(){setRotation();},
    stats(){return {weaponId:model?.id,buildKey:key,attachments:{...model?.attachments},drawCalls:renderer.info.render.calls,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,disposed,yaw,pitch};},
    dispose(){if(disposed)return;disposed=true;observer.disconnect();if(model)disposeWeaponModel(model);model=null;renderer.dispose();renderer.forceContextLoss();canvas.remove();},
  };
}
