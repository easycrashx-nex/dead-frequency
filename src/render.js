import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CONTAINER_TYPES } from './loot-catalog.js';
import { WEAPONS, getWeapon } from './weapons.js';

// The renderer is deliberately a view adapter. No simulation objects are mutated.
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;

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
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), material);
  sky.renderOrder = -10; scene.add(sky);
  return sky;
}

function label(parent, text, subtitle, position, size, rotation = 0) {
  const material = new THREE.MeshStandardMaterial({ map: signTexture(text, subtitle), roughness: .92, metalness: .06 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material);
  mesh.position.set(...position); mesh.rotation.y = rotation; parent.add(mesh);
  return mesh;
}

function makeInteriorBuilder(b, mats) {
  const material = (color, emissive = color, intensity = .08, map) => new THREE.MeshStandardMaterial({ color, roughness: .86, metalness: .06, emissive, emissiveIntensity: intensity, ...(map ? { map } : {}) });
  const wall = material('#d4d5c1', '#c4d4c0', .14, canvasTexture(512, 512, ctx => {
    ctx.drawImage(mats.pale.map.image, 0, 0, 512, 512);
    const shade = ctx.createLinearGradient(0, 0, 0, 512);
    shade.addColorStop(0, 'rgba(18,32,24,.22)'); shade.addColorStop(.21, 'rgba(18,32,24,0)');
    shade.addColorStop(.72, 'rgba(18,32,24,0)'); shade.addColorStop(1, 'rgba(18,32,24,.27)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, 512, 512);
  }));
  const ceiling = material('#acb7a6', '#bac8af', .16, mats.concrete.map);
  const cabinet = material('#789088', '#788d80', .07, mats.metal.map);
  const paper = material('#d9d3b8', '#d9d3b8', .13);
  const light = material('#fff3c9', '#fff0b8', 2.2);
  const screenMap = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#142e2b'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#36554b';
    for (let x = 0; x < w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.fillStyle = '#96caaa'; ctx.font = '700 26px Bahnschrift, Arial'; ctx.fillText('NORD / TERMINAL 06', 24, 40);
    ctx.strokeStyle = '#a1e1c0'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(24, 170);
    for (let x = 24; x < 487; x += 14) ctx.lineTo(x, 150 + Math.sin(x * .063) * 13 + (x > 180 && x < 230 ? -53 : 0)); ctx.stroke();
    ctx.font = '18px monospace'; ctx.fillText('NETZ AKTIV       SIGNAL 87%', 24, 225);
  });
  const screen = material('#c3efc6', '#8dc9ac', .62, screenMap);
  const entrance = material('#e6ead4', '#a2d7c0', .32, signTexture('EINGANG', 'OFFEN / DURCHGANG', '#d5f4da', '#23423c'));
  const exit = material('#e6ead4', '#a2d7c0', .32, signTexture('AUSGANG', 'ZUR SPERRZONE', '#d5f4da', '#23423c'));
  const themeNames = { guardhouse: 'WERKSCHUTZ / ZUTRITTSKONTROLLE', warehouse: 'FRACHT / KOMMISSIONIERUNG', 'rail-office': 'FAHRDIENST / GLEISÜBERSICHT', 'customs-office': 'ZOLL / WARENEINGANG', workshop: 'INSTANDHALTUNG / SERVICE 03' };

  function floorMaterial(room) {
    // Static contact shading provides readable furniture weight and room edges
    // without per-room shadow lights or work during the render loop.
    return material('#b9c0af', '#b0baa2', .07, canvasTexture(512, 512, (ctx, width, height) => {
      const rand = seeded(room.w * 37 + room.d * 13);
      ctx.fillStyle = '#788472'; ctx.fillRect(0, 0, width, height);
      for (let i = 0; i < 8000; i++) { ctx.fillStyle = `rgba(${rand() > .5 ? '225,228,205' : '24,36,27'},${rand() * .045})`; ctx.fillRect(rand() * width, rand() * height, 1 + rand() * 3, 1 + rand() * 3); }
      for (const axis of [0, 1]) {
        const shade = ctx.createLinearGradient(0, 0, axis ? 0 : width, axis ? height : 0);
        shade.addColorStop(0, 'rgba(16,28,22,.4)'); shade.addColorStop(.11, 'rgba(16,28,22,0)');
        shade.addColorStop(.89, 'rgba(16,28,22,0)'); shade.addColorStop(1, 'rgba(16,28,22,.4)');
        ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height);
      }
      for (const s of room.solids.filter(s => s.kind === 'fixture')) {
        const x = ((s.x - room.x) / (room.w - .68) + .5) * width, z = ((s.z - room.z) / (room.d - .68) + .5) * height;
        const w = s.w / (room.w - .68) * width, d = s.d / (room.d - .68) * height;
        ctx.shadowColor = 'rgba(15,25,20,.7)'; ctx.shadowBlur = 9; ctx.fillStyle = '#263a2a'; ctx.fillRect(x - w / 2, z - d / 2, w, d);
      }
      ctx.shadowBlur = 0;
    }));
  }

  function board(room) {
    return material('#e2e2cb', '#bdd8c0', .18, canvasTexture(1024, 576, (ctx, w, h) => {
      ctx.fillStyle = '#233b38'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#b97942'; ctx.fillRect(0, 0, 16, h);
      ctx.fillStyle = '#dce4cd'; ctx.font = '700 63px Bahnschrift, Arial'; ctx.fillText(room.name, 56, 93);
      ctx.fillStyle = '#9db4a4'; ctx.font = '23px Bahnschrift, Arial'; ctx.fillText(themeNames[room.type] || 'BETRIEBSBEREICH', 59, 139);
      ctx.strokeStyle = '#4a6156'; ctx.lineWidth = 2; ctx.strokeRect(54, 176, 916, 331);
      if (room.type === 'rail-office') {
        for (let i = 0; i < 5; i++) {
          const y = 221 + i * 57; ctx.strokeStyle = ['#b38250', '#9ab4a1', '#719c99'][i % 3]; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.moveTo(109, y); ctx.lineTo(360, y); ctx.lineTo(423, y + 17); ctx.lineTo(898, y + 17); ctx.stroke();
          for (const x of [180, 310, 565, 738, 860]) { ctx.fillStyle = '#d4dabb'; ctx.beginPath(); ctx.arc(x, y + (x > 400 ? 17 : 0), 6, 0, TAU); ctx.fill(); }
          ctx.font = '20px monospace'; ctx.fillText(`0${i + 1}`, 70, y + 6);
        }
      } else if (room.type === 'workshop') {
        ctx.strokeStyle = '#92bba5'; ctx.lineWidth = 4; ctx.strokeRect(222, 235, 435, 175); ctx.strokeRect(285, 204, 251, 245);
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(282 + i * 101, 322, 41, 0, TAU); ctx.stroke(); }
        ctx.lineWidth = 2; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(723, 231 + i * 39); ctx.lineTo(909, 231 + i * 39); ctx.stroke(); }
        ctx.font = '21px monospace'; ctx.fillText('AGGREGAT 04 / 380 V', 230, 479);
      } else {
        for (let i = 0; i < 3; i++) {
          const x = 85 + i * 292; ctx.fillStyle = '#354e44'; ctx.fillRect(x, 205, 257, 265);
          ctx.fillStyle = '#d4d5b7'; ctx.font = '700 49px Bahnschrift, Arial'; ctx.fillText(room.type === 'guardhouse' ? `CAM 0${i + 1}` : room.type === 'warehouse' ? `BAY 0${i + 1}` : `AKTE ${24 + i}`, x + 19, 262);
          ctx.fillStyle = '#809b82'; for (let line = 0; line < 6; line++) ctx.fillRect(x + 21, 296 + line * 24, 159 - line % 3 * 31, 5);
          if (room.type === 'guardhouse') { ctx.strokeStyle = '#bbc6a4'; ctx.strokeRect(x + 137, 336, 85, 101); }
        }
      }
      ctx.fillStyle = '#b57d4e'; ctx.font = '20px monospace'; ctx.fillText('NORDWERK KÜSTE / BETRIEBSSTAND 06:40', 59, 545);
    }));
  }

  function fixture(room, solid) {
    const { x, y, z, w, h, d, style } = solid;
    // The complete base volume remains visible: desks are pedestal units and
    // racks are packed cabinets, matching their authoritative solid collider.
    b.box(style === 'machine' ? mats.blue : cabinet, [x, y, z], [w, h, d]);
    if (style !== 'workbench') b.box(mats.edge, [x, y + h / 2 + .029, z], [w + .008, .06, d + .008]);
    const alongX = w >= d, sign = alongX ? (z < room.z ? 1 : -1) : (x < room.x ? 1 : -1);
    const yaw = alongX ? (sign > 0 ? 0 : Math.PI) : (sign > 0 ? Math.PI / 2 : -Math.PI / 2);
    const width = alongX ? w : d, depth = alongX ? d : w;
    const local = (mat, px, py, pz, size) => b.box(mat, [x + Math.cos(yaw) * px + Math.sin(yaw) * pz, py, z - Math.sin(yaw) * px + Math.cos(yaw) * pz], size, [0, yaw, 0]);
    const top = y + h / 2;
    if (style === 'shelf') {
      for (let shelf = .12; shelf < h; shelf += .74) {
        local(mats.darkMetal, 0, shelf, depth / 2 + .012, [width, .085, .055]);
        for (let slot = -width / 2 + .39; slot < width / 2 - .2; slot += .78) {
          const tone = Math.round((slot + width) * 10) % 2 ? mats.paint : mats.rust;
          local(tone, slot, Math.min(shelf + .34, top - .2), depth / 2 + .022, [.61, .48, .025]);
          local(paper, slot, Math.min(shelf + .35, top - .2), depth / 2 + .038, [.21, .13, .009]);
        }
      }
      for (const s of [-1, 1]) local(mats.orange, s * (width / 2 - .045), y, depth / 2 + .06, [.09, h, .09]);
    } else {
      const sections = Math.max(1, Math.floor(width / .74));
      for (let i = 0; i < sections; i++) {
        const px = (i + .5) * width / sections - width / 2;
        local(mats.darkMetal, px + width / sections / 2 - .028, y, depth / 2 + .009, [.025, h - .15, .018]);
        for (let drawer = .28; drawer < h - .12; drawer += style === 'cabinet' ? .66 : .32) {
          local(mats.edge, px, drawer, depth / 2 + .037, [Math.min(.21, width / sections * .5), .036, .058]);
          local(mats.darkMetal, px, drawer - .13, depth / 2 + .012, [width / sections - .08, .018, .016]);
        }
        if (style === 'cabinet') local(paper, px, h - .38, depth / 2 + .027, [Math.min(.21, width / sections * .52), .09, .012]);
      }
    }
    if (style === 'desk' || style === 'counter') {
      // Top-mounted details stay within the blocked furniture footprint.
      local(mats.black, -.2, top + .03, -.12, [.54, .06, .31]);
      local(mats.edge, -.2, top + .16, -.18, [.045, .26, .045]);
      local(mats.black, -.2, top + .41, -.19, [.69, .44, .055]);
      local(screen, -.2, top + .41, -.157, [.59, .34, .012]);
      local(mats.black, -.2, top + .029, .22, [.57, .035, .18]);
      local(paper, Math.min(width * .31, 1.1), top + .025, .03, [.29, .025, .37]);
      if (room.type === 'guardhouse') {
        local(mats.darkMetal, width * .27, top + .16, -.13, [.31, .3, .25]);
        local(mats.black, width * .27, top + .45, -.2, [.019, .36, .019]);
      }
    } else if (style === 'workbench') {
      local(mats.paint, 0, top + .039, 0, [width + .008, .08, depth + .008]);
      local(mats.darkMetal, -width * .22, top + .15, -.13, [.43, .29, .32]);
      local(mats.edge, -width * .22, top + .31, -.13, [.49, .075, .19]);
      for (let i = 0; i < 4; i++) local(i % 2 ? mats.orange : mats.edge, width * .17 + i * .11, top + .04, .12, [.045, .04, .29]);
      local(mats.rust, width * .29, top + .14, -depth * .27, [.44, .28, .28]);
    } else if (style === 'machine') {
      local(mats.darkMetal, 0, y + .3, depth / 2 + .012, [width * .7, h * .43, .045]);
      local(mats.orange, 0, h - .23, depth / 2 + .032, [width * .8, .22, .04]);
      local(screen, width * .24, h - .63, depth / 2 + .052, [.32, .24, .025]);
      for (let i = 0; i < 6; i++) local(mats.edge, -width * .22 + i * .09, .66, depth / 2 + .045, [.034, .25, .025]);
    }
  }

  return room => {
    const { x, z, w, d, h, ceilingHeight } = room;
    for (const s of room.solids) {
      if (s.kind === 'fixture') { fixture(room, s); continue; }
      b.box(s.kind === 'ceiling' ? mats.concrete : wall, [s.x, s.y, s.z], [s.w, s.h, s.d]);
      if (s.kind === 'ceiling') {
        b.box(ceiling, [x, ceilingHeight - .014, z], [w - .71, .016, d - .71]);
      } else {
        // Every wall stripe is clipped to one real wall segment. In particular,
        // no decorative facade band or panel crosses an open doorway.
        const bottom = Math.max(.05, s.y - s.h / 2), top = Math.min(1.15, s.y + s.h / 2);
        const alongX = s.w > s.d, sign = alongX ? (s.z < z ? 1 : -1) : (s.x < x ? 1 : -1);
        if (top > bottom) {
          const pos = alongX ? [s.x, (top + bottom) / 2, s.z + sign * (s.d / 2 + .005)] : [s.x + sign * (s.w / 2 + .005), (top + bottom) / 2, s.z];
          b.box(mats.blue, pos, alongX ? [s.w, top - bottom, .01] : [.01, top - bottom, s.d]);
          pos[1] = .085; b.box(mats.darkMetal, pos, alongX ? [s.w, .13, .018] : [.018, .13, s.d]);
        }
      }
    }
    b.box(floorMaterial(room), [x, 0, z], [w - .68, .02, d - .68]);
    for (let line = -w / 2 + 1.8; line < w / 2 - .5; line += 2.3) b.box(mats.darkConcrete, [x + line, .012, z], [.018, .003, d - .74]);
    for (let line = -d / 2 + 1.8; line < d / 2 - .5; line += 2.3) b.box(mats.darkConcrete, [x, .012, z + line], [w - .74, .003, .018]);
    for (let pz = -d / 2 + 2; pz < d / 2 - .6; pz += 4) {
      b.box(mats.darkMetal, [x, ceilingHeight - .045, z + pz], [w - .7, .09, .11]);
      for (const side of w > 10 ? [-1, 1] : [0]) {
        const px = x + side * w * .27;
        b.box(mats.darkMetal, [px, ceilingHeight - .12, z + pz], [1.7, .12, .3]);
        b.box(light, [px, ceilingHeight - .187, z + pz], [1.5, .014, .21]);
      }
    }
    const roomBoard = board(room);
    b.box(mats.darkMetal, [x - w / 2 + .39, 2.12, z - d * .18], [.08, 1.63, Math.min(3.15, d * .37)]);
    b.box(roomBoard, [x - w / 2 + .438, 2.12, z - d * .18], [Math.min(3.01, d * .35), 1.49, .012], [0, Math.PI / 2, 0]);
    // Conduit, safety cabinet and notice sheets are flush wall details, well
    // outside the middle route and clear of both doorway openings.
    b.box(mats.edge, [x + w / 2 - .39, 2.75, z], [.03, .035, d - .8]);
    b.box(mats.orange, [x + w / 2 - .395, 1.4, z + d * .26], [.055, .62, .4]);
    b.box(paper, [x + w / 2 - .43, 1.4, z + d * .26], [.016, .4, .25]);
    const nameMat = material('#eee4c5', '#c3d3ad', .12, signTexture(room.name, themeNames[room.type]));
    for (const door of room.doors) {
      const yaw = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 }[door.side];
      const pos = (px, py, pz) => [door.x + Math.cos(yaw) * px + Math.sin(yaw) * pz, py, door.z - Math.sin(yaw) * px + Math.cos(yaw) * pz];
      const box = (mat, px, py, pz, size) => b.box(mat, pos(px, py, pz), size, [0, yaw, 0]);
      for (const side of [-1, 1]) {
        box(mats.darkMetal, side * (door.width / 2 + .083), door.height / 2, -.13, [.15, door.height, .51]);
        box(mats.orange, side * (door.width / 2 + .085), door.height / 2, .137, [.1, door.height - .08, .035]);
        for (let y = .15; y < 1.2; y += .22) box(mats.black, side * (door.width / 2 + .085), y, .158, [.105, .085, .012]);
        box(mats.glow, side * (door.width / 2 + .085), 2.56, .16, [.052, .32, .02]);
      }
      box(mats.darkMetal, 0, door.height + .078, -.13, [door.width + .3, .14, .51]);
      box(entrance, 0, door.height + .235, .054, [1.85, .28, .014]);
      box(exit, 0, door.height + .235, -.385, [1.85, .28, .014]);
      // Signs use boxes so their reverse also remains legible in a two-sided
      // opening; the inside EXIT face is oriented into the room.
      box(mats.darkMetal, 0, door.height + .47, .2, [door.width + .35, .1, .7]);
      box(light, 0, door.height + .411, .38, [1.45, .015, .2]);
      for (const side of [-1, 1]) box(mats.paint, side * (door.width / 2 - .28), .018, .72, [.075, .006, 1.35]);
      box(nameMat, 0, Math.max(door.height + .96, ceilingHeight + .68), .12, [Math.min(w - .8, 4.3), .69, .018]);
    }
    // The inaccessible upper volume keeps the existing industrial skyline.
    b.box(mats.darkMetal, [x, h + .02, z], [w + .18, .16, d + .18]);
    for (let wy = ceilingHeight + 1.65; wy < h - .75; wy += 2.35) {
      for (let wx = -w / 2 + 1.7; wx < w / 2 - 1; wx += 3.15) for (const sign of [-1, 1]) {
        b.box(mats.darkMetal, [x + wx, wy, z + sign * (d / 2 + .028)], [1.8, 1.03, .056]);
        b.box(mats.glass, [x + wx, wy, z + sign * (d / 2 + .063)], [1.61, .84, .017]);
        b.box(mats.edge, [x + wx, wy, z + sign * (d / 2 + .077)], [.035, .87, .022]);
      }
    }
    b.box(mats.darkConcrete, [x + w * .2, h + .31, z - d * .18], [Math.min(2.5, w * .27), .62, Math.min(2, d * .27)]);
    b.cylinder(mats.darkMetal, [x + w * .2, h + .68, z - d * .18], .39, .13, .39, [0, 0, 0], 16);
  };
}

function buildWorld(scene, layout, mats) {
  const group = new THREE.Group(); scene.add(group);
  const b = makeBatch(group); const rand = seeded(334);
  const size = layout.size || 120; const half = size / 2;
  mats.road.map.repeat.setScalar((size + 25) / 4.8);
  b.box(mats.road, [0, -.14, 0], [size + 25, .25, size + 25]);
  // Expansion joints and old apron markings make scale and movement legible.
  for (let x = -half; x <= half; x += 12) b.box(mats.darkConcrete, [x, -.009, 0], [.035, .015, size]);
  for (let z = -half; z <= half; z += 12) b.box(mats.darkConcrete, [0, -.008, z], [size, .016, .035]);
  const obstacles = layout.obstacles || [];
  const interiors = new Map((layout.interiors || []).map(room => [room.id, room]));
  const buildInterior = interiors.size ? makeInteriorBuilder(b, mats) : null;
  function clear(x, z, margin = 1.3) { return !obstacles.some(o => Math.abs(x - o.x) < o.w / 2 + margin && Math.abs(z - o.z) < o.d / 2 + margin); }
  for (let z = -half + 4; z < half - 3; z += 6) {
    if (clear(0, z)) b.box(mats.paint, [0, .008, z], [.14, .014, 2.5]);
    if (clear(17, z)) b.box(mats.paint, [17, .009, z], [.1, .014, 3.2]);
    if (clear(-17, z)) b.box(mats.paint, [-17, .009, z], [.1, .014, 3.2]);
  }
  if (size > 180) {
    // A connected service-road grid and district-specific ground details keep
    // the expanded playable zone legible without adding collision obstacles.
    for (const lane of [-64, 64]) {
      for (let point = -half + 5; point < half - 5; point += 5) {
        if (clear(lane, point, 2)) b.box(mats.paint, [lane, .012, point], [.14, .018, 2.1]);
        if (clear(point, lane, 2)) b.box(mats.paint, [point, .012, lane], [2.1, .018, .14]);
        for (const side of [-1, 1]) {
          if (clear(lane + side * 5, point, .6)) b.box(mats.darkConcrete, [lane + side * 5, .004, point], [.07, .007, 4.6]);
          if (clear(point, lane + side * 5, .6)) b.box(mats.darkConcrete, [point, .004, lane + side * 5], [4.6, .007, .07]);
        }
      }
    }
    for (const poi of layout.pois || []) {
      if (Math.abs(poi.x) < 60 && Math.abs(poi.z) < 60) continue;
      for (let ox = -10; ox <= 10; ox += 2) {
        if (clear(poi.x + ox, poi.z + 7, .3)) b.box(mats.paint, [poi.x + ox, .014, poi.z + 7], [.15, .018, 3.5]);
      }
    }
    for (const track of [-87, -77, -63]) {
      for (const side of [-1, 1]) b.box(mats.edge, [-108, .029, track + side * .74], [78, .055, .055]);
      for (let x = -146; x < -70; x += 1.1) b.box(mats.darkMetal, [x, .018, track], [.18, .03, 2]);
    }
    for (const train of obstacles.filter(o => o.id.startsWith('rail-car'))) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        b.cylinder(mats.black, [train.x + sx * (train.w * .34), .37, train.z + sz * (train.d / 2 + .03)], .36, .17, .36, [Math.PI / 2, 0, 0], 12);
        b.cylinder(mats.edge, [train.x + sx * (train.w * .34), .37, train.z + sz * (train.d / 2 + .13)], .15, .035, .15, [Math.PI / 2, 0, 0], 10);
      }
    }
    const processTanks = obstacles.filter(o => o.kind === 'tank' && /water-|refinery-/.test(o.id));
    for (const tank of processTanks) {
      const r = Math.min(tank.w, tank.d) * .47;
      for (let a = 0; a < TAU; a += TAU / 16) {
        const next = a + TAU / 16;
        const x = tank.x + Math.cos(a) * r, z = tank.z + Math.sin(a) * r;
        b.beam(mats.orange, [x, tank.h + .3, z], [x, tank.h + 1.1, z], .03);
        b.beam(mats.edge, [x, tank.h + 1.1, z], [tank.x + Math.cos(next) * r, tank.h + 1.1, tank.z + Math.sin(next) * r], .026);
      }
      if (tank.id.startsWith('water-')) b.cylinder(mats.blue, [tank.x, tank.h + .16, tank.z], r * .92, .15, r * .84, [0, 0, 0], 24);
      if (tank.h > 20) {
        b.cylinder(mats.rust, [tank.x, tank.h + 3.7, tank.z], .37, 7, .22);
        b.cylinder(mats.orange, [tank.x, tank.h + 7.2, tank.z], .32, .23, .32);
      }
    }
    // Exterior tree line marks the wooded western exit beyond the true fence.
    for (let i = 0; i < 35; i++) {
      const x = -half - 6 - rand() * 23, z = 65 + rand() * 110, h = 6 + rand() * 6;
      b.cylinder(mats.rust, [x, h * .32, z], .2, h * .64, .1, [0, 0, 0], 6);
      b.cylinder(mats.leaf, [x, h * .72, z], 2.4, h * .58, 0, [0, 0, 0], 7);
      b.cylinder(mats.leaf, [x, h * .53, z], 2.9, h * .53, .3, [0, 0, 0], 7);
    }
  }
  const containerMaterials = new Map();
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i]; const { x, z, w, d, h } = o;
    if (o.color && !containerMaterials.has(o.color)) containerMaterials.set(o.color, new THREE.MeshStandardMaterial({ color: o.color, roughness: .82, metalness: .26 }));
    const containerColor = o.color ? containerMaterials.get(o.color) : [mats.orange, mats.blue, mats.metal][i % 3];
    if (o.kind === 'container') {
      b.box(containerColor, [x, h / 2, z], [w, h, d]);
      const longZ = d >= w;
      const len = longZ ? d : w;
      for (let n = -len / 2 + .2; n < len / 2; n += .44) {
        if (longZ) {
          b.box(containerColor, [x - w / 2 - .025, h / 2, z + n], [.05, h - .22, .095]);
          b.box(containerColor, [x + w / 2 + .025, h / 2, z + n], [.05, h - .22, .095]);
        } else {
          b.box(containerColor, [x + n, h / 2, z - d / 2 - .025], [.095, h - .22, .05]);
          b.box(containerColor, [x + n, h / 2, z + d / 2 + .025], [.095, h - .22, .05]);
        }
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(mats.edge, [x + sx * (w / 2 - .06), h / 2, z + sz * (d / 2 - .06)], [.12, h + .03, .12]);
      for (const y of [.08, h - .07]) {
        b.box(mats.darkMetal, [x, y, z - d / 2 - .035], [w, .12, .09]);
        b.box(mats.darkMetal, [x, y, z + d / 2 + .035], [w, .12, .09]);
      }
      const front = z + d / 2 + .055;
      b.box(mats.darkMetal, [x, h / 2, front], [.035, h - .2, .035]);
      for (const s of [-1, 1]) {
        b.cylinder(mats.edge, [x + s * w * .25, h / 2, front + .025], .027, h - .3, .027, [0, 0, 0], 6);
        b.box(mats.darkMetal, [x + s * w * .25, h * .4, front + .05], [.22, .045, .06]);
      }
      if (i % 2 === 0) label(group, `NORD ${String(i + 12).padStart(3, '0')}`, 'FREIGHT // 24.000 KG', [x, h * .69, front + .025], [Math.min(w * .7, 2), .7]);
      b.box(mats.rust, [x + w * .28, h + .008, z], [w * .22, .015, d * .87]);
    } else if (interiors.has(o.id)) {
      buildInterior(interiors.get(o.id));
    } else if (o.kind === 'building') {
      b.box(i % 3 === 0 ? mats.darkConcrete : mats.concrete, [x, h / 2, z], [w, h, d]);
      b.box(mats.darkMetal, [x, h - .05, z], [w + .35, .24, d + .35]);
      b.box(mats.pale, [x, .36, z + d / 2 + .018], [w, .72, .05]);
      for (let y = 1.6; y < h - .6; y += 1.7) {
        b.box(mats.darkConcrete, [x, y, z + d / 2 + .025], [w, .025, .035]);
        b.box(mats.darkConcrete, [x - w / 2 - .025, y, z], [.035, .025, d]);
        b.box(mats.darkConcrete, [x + w / 2 + .025, y, z], [.035, .025, d]);
      }
      for (let px = -w / 2 + 4; px < w / 2 - 1; px += 4.2) b.box(mats.pale, [x + px, h / 2, z + d / 2 + .024], [.11, h - .3, .08]);
      b.box(mats.orange, [x, h - .43, z + d / 2 + .03], [w, .085, .04]);
      for (const sx of [-1, 1]) b.box(mats.pale, [x + sx * (w / 2 - .18), h / 2, z + d / 2 + .055], [.32, h, .12]);
      for (let wx = -w / 2 + 1.5; wx < w / 2 - .8; wx += 2.3) {
        const wy = Math.min(h - 1.2, 3.7);
        if (wy > 1.4) {
          b.box(mats.darkMetal, [x + wx, wy, z + d / 2 + .06], [1.67, 1.35, .12]);
          b.box(mats.glass, [x + wx, wy, z + d / 2 + .13], [1.44, 1.09, .025]);
          b.box(mats.edge, [x + wx, wy, z + d / 2 + .15], [.05, 1.12, .035]);
          b.box(mats.edge, [x + wx, wy, z + d / 2 + .15], [1.44, .035, .035]);
          b.box(mats.pale, [x + wx, wy - .73, z + d / 2 + .13], [1.92, .1, .28]);
        }
      }
      for (const sx of [-1, 1]) for (let wz = -d / 2 + 2; wz < d / 2 - 1; wz += 3.1) {
        const wy = Math.min(h - 1.2, 3.8); if (wy < 1.4) continue;
        b.box(mats.darkMetal, [x + sx * (w / 2 + .045), wy, z + wz], [.08, 1.2, 2.25]);
        b.box(mats.glass, [x + sx * (w / 2 + .09), wy, z + wz], [.025, 1.02, 2.06]);
        b.box(mats.edge, [x + sx * (w / 2 + .11), wy, z + wz], [.025, 1.02, .045]);
        b.box(mats.pale, [x + sx * (w / 2 + .13), wy - .67, z + wz], [.28, .11, 2.45]);
      }
      const doorW = Math.min(3.5, w * .36); const doorH = Math.min(3.0, h * .68);
      b.box(mats.darkMetal, [x, doorH / 2, z + d / 2 + .055], [doorW + .22, doorH + .12, .11]);
      b.box(mats.metal, [x, doorH / 2, z + d / 2 + .13], [doorW, doorH, .055]);
      for (let dy = .22; dy < doorH; dy += .19) b.box(mats.darkMetal, [x, dy, z + d / 2 + .17], [doorW, .017, .016]);
      b.box(mats.orange, [x, doorH + .25, z + d / 2 + .25], [doorW + .45, .16, .55]);
      b.box(mats.glow, [x, doorH + .18, z + d / 2 + .24], [.9, .045, .13]);
      // Roof plant and parapets stay on authoritative collision buildings.
      b.box(mats.darkConcrete, [x - w * .23, h + .4, z - d * .16], [Math.min(w * .33, 3.2), .8, Math.min(d * .35, 2.7)]);
      for (let f = 0; f < 2; f++) b.cylinder(mats.darkMetal, [x - w * .23 + (f - .5) * .9, h + .88, z - d * .16], .39, .14, .39, [0, 0, 0], 16);
      b.cylinder(mats.metal, [x + w * .27, h + .7, z - d * .25], .27, 1.4);
      b.cylinder(mats.darkMetal, [x + w * .27, h + 1.43, z - d * .25], .45, .11);
      for (const sx of [-1, 1]) b.box(mats.pale, [x + sx * w / 2, h + .2, z], [.14, .4, d]);
      for (const sz of [-1, 1]) b.box(mats.pale, [x, h + .2, z + sz * d / 2], [w, .4, .14]);
      const nearestPoi = (layout.pois || []).reduce((nearest, poi) => !nearest || Math.hypot(poi.x - x, poi.z - z) < Math.hypot(nearest.x - x, nearest.z - z) ? poi : nearest, null);
      const text = nearestPoi?.name?.toUpperCase() || ['NORDWERK', 'SEKTOR 04', 'TECHNIK', 'LAGER 07'][i % 4];
      if (h > 4.2) label(group, text, `KÜSTENANLAGE // ${String(i + 1).padStart(2, '0')}`, [x, h - .85, z + d / 2 + .09], [Math.min(w - 1, 5.2), 1.55]);
      // Conduit and service ladder.
      const lx = x + w / 2 + .085;
      for (const zoff of [-.32, .32]) b.cylinder(mats.rust, [lx, h / 2, z + zoff], .035, h);
      for (let y = .35; y < h; y += .37) b.box(mats.metal, [lx + .03, y, z], [.1, .038, .72]);
    } else if (o.kind === 'tank') {
      const radius = Math.min(w, d) / 2;
      // Square plinth matches the tank collision volume and prevents misleading corners.
      b.box(mats.darkConcrete, [x, .23, z], [w, .46, d]);
      b.cylinder(mats.pale, [x, h / 2 + .1, z], radius * .96, h - .2, radius * .96, [0, 0, 0], 24);
      b.cylinder(mats.metal, [x, h + .05, z], radius * .97, .19, radius * .9, [0, 0, 0], 24);
      for (const y of [.65, h * .5, h - .3]) b.cylinder(mats.darkMetal, [x, y, z], radius * .981, .065, radius * .981, [0, 0, 0], 24);
      b.box(mats.orange, [x, h * .5, z + radius * .965], [radius * .8, .55, .05]);
      b.cylinder(mats.darkMetal, [x, h + .43, z], .25, .68);
      b.cylinder(mats.edge, [x, h + .8, z], .39, .12);
      const tz = z + radius * .93;
      for (const ox of [-.3, .3]) b.cylinder(mats.darkMetal, [x + ox, h / 2, tz], .035, h);
      for (let y = .35; y < h; y += .36) b.box(mats.edge, [x, y, tz + .06], [.7, .04, .08]);
    } else if (o.kind === 'barrier') {
      b.box(mats.darkConcrete, [x, h * .3, z], [w, h * .6, d]);
      b.box(mats.pale, [x, h * .77, z], [w, h * .46, d * .68]);
      for (let bx = -w / 2 + .22; bx < w / 2; bx += .72) {
        b.box(mats.orange, [x + bx, h * .81, z + d * .348], [.28, h * .26, .025], [0, 0, -.24]);
        b.box(mats.orange, [x + bx, h * .81, z - d * .348], [.28, h * .26, .025], [0, 0, -.24]);
      }
      for (const sx of [-1, 1]) b.box(mats.darkMetal, [x + sx * w * .35, h + .04, z], [.13, .08, d * .35]);
    } else {
      b.box(mats.metal, [x, h / 2, z], [w, h, d]);
      b.box(mats.darkMetal, [x, h - .02, z], [w + .05, .08, d + .05]);
      for (const sx of [-1, 1]) {
        b.box(mats.darkMetal, [x + sx * w * .31, h / 2, z], [.085, h + .04, d + .04]);
        b.box(mats.edge, [x + sx * w * .31, h * .55, z + d / 2 + .035], [.13, .2, .06]);
      }
      b.box(mats.orange, [x, h * .6, z + d / 2 + .027], [w * .27, h * .27, .025]);
    }
  }
  // Perimeter architecture beyond play space, with distant cranes and coastal industry.
  for (const side of [-1, 1]) {
    for (let z = -half; z <= half; z += 5) {
      b.box(mats.darkMetal, [side * (half + 1), 1.6, z], [.1, 3.2, .1]);
      b.beam(mats.metal, [side * (half + 1), 3.1, z], [side * (half + 1), 3.35, z + 1], .025);
    }
    for (const y of [.3, 1.25, 2.2, 2.9]) b.box(mats.metal, [side * (half + 1), y, 0], [.025, .025, size]);
    for (let x = -half; x <= half; x += 5) b.box(mats.darkMetal, [x, 1.6, side * (half + 1)], [.1, 3.2, .1]);
    for (const y of [.3, 1.25, 2.2, 2.9]) b.box(mats.metal, [0, y, side * (half + 1)], [size, .025, .025]);
  }
  for (let i = 0; i < 36; i++) {
    const angle = (i / 36) * TAU;
    // The gameplay border is square. A fixed-radius skyline ring would put
    // decorative, non-colliding buildings inside the large map's corners.
    const radius = (half + 24) / Math.max(Math.abs(Math.sin(angle)), Math.abs(Math.cos(angle))) + rand() * 50;
    const x = Math.sin(angle) * radius; const z = Math.cos(angle) * radius; const h = 5 + rand() * 17;
    b.box(mats.darkConcrete, [x, h / 2 - 1, z], [6 + rand() * 15, h, 7 + rand() * 12]);
    if (i % 4 === 0) {
      b.cylinder(mats.darkConcrete, [x + 5, h, z], 1.25, h * 1.7, .85);
      b.cylinder(mats.rust, [x + 5, h * 1.72, z], 1.02, 1.9, .93);
    }
  }
  for (let i = 0; i < 3; i++) {
    const x = -half - 18 - i * 19; const z = -half - 12 + i * 18;
    b.box(mats.darkMetal, [x, 15, z], [1.1, 30, 1.1]);
    b.box(mats.orange, [x - 7, 30, z], [33, 1, 1]);
    b.beam(mats.darkMetal, [x, 36, z], [x - 23, 30, z], .1);
    b.beam(mats.darkMetal, [x, 36, z], [x + 9, 30, z], .1);
    b.beam(mats.darkMetal, [x - 20, 30, z], [x - 20, 13, z], .025);
    b.box(mats.orange, [x + 8, 29, z], [4, 3, 2.5]);
  }
  // Overhead services add industrial layering while leaving every route unobstructed.
  for (const z of [-11.8, -12.45]) {
    b.beam(mats.metal, [-14, 7.2, z], [24.8, 7.2, z], .19);
    for (let x = -12; x < 25; x += 3.5) b.cylinder(mats.darkMetal, [x, 7.2, z], .224, .11, .224, [0, 0, Math.PI / 2], 10);
  }
  b.box(mats.darkMetal, [-13.95, 6.85, -12.1], [.14, .18, 1.5]);
  b.box(mats.darkMetal, [24.9, 6.85, -12.1], [.14, .18, 1.5]);
  // Relay landmark: a narrow lattice structure around the console, visible from every route.
  const relay = layout.relay || { x: 0, z: -20 };
  const tx = relay.x; const tz = relay.z;
  const towerH = 22;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.beam(mats.darkMetal, [tx + sx * 1.2, 0, tz + sz * 1.2], [tx + sx * .32, towerH, tz + sz * .32], .12);
  }
  for (let y = 2; y < towerH; y += 3) {
    const r = 1.2 - y / towerH * .88; const rr = 1.2 - (y + 3) / towerH * .88;
    for (const sign of [-1, 1]) {
      b.beam(mats.metal, [tx - r, y, tz + sign * r], [tx + rr, Math.min(y + 3, towerH), tz + sign * rr], .035);
      b.beam(mats.metal, [tx + sign * r, y, tz - r], [tx + sign * rr, Math.min(y + 3, towerH), tz + rr], .035);
      b.box(mats.orange, [tx, y, tz + sign * r], [r * 2, .075, .075]);
    }
  }
  b.cylinder(mats.edge, [tx, towerH + 2.5, tz], .07, 5);
  b.box(mats.orange, [tx, towerH - 1, tz], [2.5, .11, 2.5]);
  for (const s of [-1, 1]) {
    b.box(mats.pale, [tx + s * .85, towerH - 3.1, tz], [.32, 2.7, .24]);
    b.cylinder(mats.pale, [tx + s * .63, towerH - 6, tz], .7, .18, .62, [0, 0, Math.PI / 2], 16);
  }
  b.box(mats.darkMetal, [tx, .65, tz], [.9, 1.3, .65]);
  b.box(mats.orange, [tx, 1.2, tz + .34], [.78, .5, .055]);
  b.box(mats.glow, [tx, 1.27, tz + .379], [.48, .18, .025]);
  label(group, 'RELAIS 06', 'SIGNAL // AUTORISIERUNG', [tx, 2, tz + .15], [1.8, .67]);
  // Lamps sit just outside obstacle edges; poles are thin visual details.
  for (let i = 0; i < obstacles.length; i += 5) {
    const o = obstacles[i]; const x = o.x - o.w / 2 - .2; const z = o.z - o.d / 2 - .2;
    b.cylinder(mats.darkMetal, [x, 3.8, z], .07, 7.6);
    b.box(mats.darkMetal, [x + .5, 7.57, z], [1.1, .07, .07]);
    b.box(mats.darkMetal, [x + .9, 7.5, z], [.63, .12, .25]);
    b.box(mats.glow, [x + .9, 7.427, z], [.52, .025, .17]);
  }
  // Small asphalt fissures and scrub stay low enough never to imply collision.
  for (let i = 0; i < Math.min(1300, 210 * size * size / 14400); i++) {
    const x = (rand() - .5) * size; const z = (rand() - .5) * size;
    if (!clear(x, z, .25)) continue;
    if (i % 3 === 0) b.box(mats.darkConcrete, [x, .003, z], [.022, .006, .6 + rand() * 2], [0, rand() * TAU, 0]);
    if (Math.abs(x) > half - 10 || Math.abs(z) > half - 10 || i % 7 === 0) {
      for (let j = 0; j < 3; j++) b.box(mats.leaf, [x + (rand() - .5) * .25, .08 + rand() * .07, z + (rand() - .5) * .25], [.025, .2 + rand() * .18, .2], [0, rand() * TAU, rand() * .5 - .25]);
    }
  }
  b.finish();
  const relayLamp = new THREE.Mesh(new THREE.SphereGeometry(.13, 8, 6), new THREE.MeshBasicMaterial({ color: '#ef8150' }));
  relayLamp.position.set(tx, towerH + 5.1, tz); group.add(relayLamp);
  const exfils = (layout.extractions || []).map(ex => {
    const root = new THREE.Group(); root.position.set(ex.x, .04, ex.z); group.add(root);
    const material = new THREE.MeshBasicMaterial({ color: '#a4e4c8', transparent: true, opacity: .55, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry((ex.radius || 4) - .12, ex.radius || 4, 64), material);
    ring.rotation.x = -Math.PI / 2; root.add(ring);
    const eb = makeBatch(root);
    for (let a = 0; a < TAU; a += Math.PI / 4) {
      const x = Math.sin(a) * (ex.radius || 4); const z = Math.cos(a) * (ex.radius || 4);
      eb.box(mats.darkMetal, [x, .04, z], [.32, .09, .32]); eb.box(mats.glow, [x, .094, z], [.16, .02, .16]);
    }
    eb.finish(false);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, 18, 6), new THREE.MeshBasicMaterial({ color: '#a3e3c7', transparent: true, opacity: .24, depthWrite: false }));
    beam.position.y = 9; root.add(beam);
    return { root, ring, beam, material };
  });
  return { group, exfils, relayLamp };
}

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

// Eight authored silhouettes share a grip coordinate, not a stretched receiver.
// Parts are batched by material; only mechanisms have separate transforms.
function makeWeaponModel(id, remote = false) {
  const specification = getWeapon(id) || getWeapon('VX-9');
  const root = new THREE.Group(); root.name = `weapon-${specification.id}`;
  const batch = makeBatch(root), b = { ...batch, box: (...args) => batch.bevel(...args) };
  const mat = (color, metalness = .6, roughness = .46) => new THREE.MeshStandardMaterial({ color, metalness, roughness });
  const black = mat('#1f292b', .72, .36), steel = mat('#76858a', .86, .3), rubber = mat('#25302d', .04, .9);
  const colors = { smg: '#56636c', assault: '#667462', bullpup: '#ad9c78', shotgun: '#885239', marksman: '#637567', sniper: '#aaa18a', machinegun: '#6d7251', revolver: '#c0bfb1' };
  const body = mat(colors[specification.model], specification.model === 'revolver' ? .88 : .5);
  const brass = mat('#bfa061', .8, .35), wood = mat('#76503b', .06, .74);
  const model = { root, id: specification.id, model: specification.model, muzzleZ: -.97, sightHeight: .2, lens: 'reflex', support: [0, 0, 0], mag: null, pump: null, bolt: null, drum: null, cover: null, cartridges: null };
  const cylinder = (m, p, radius, length, segments = 12) => b.cylinder(m, p, radius, length, radius, [Math.PI / 2, 0, 0], segments);
  function part(name, position, draw) {
    const group = new THREE.Group(); group.name = name; group.position.set(...position); group.userData.rest = [...position]; root.add(group);
    const pb = makeBatch(group); draw({ ...pb, box: (...args) => pb.bevel(...args) }); pb.finish(false); return group;
  }
  function grip(material = rubber) {
    b.box(material, [0, -.136, -.094], [.085, .2, .105], [.24, 0, 0]);
    b.box(black, [0, -.123, -.193], [.09, .019, .13]); b.box(black, [0, -.089, -.255], [.085, .064, .018]);
    if (!remote) for (let y = -.205; y < -.1; y += .025) b.box(black, [-.044, y, -.094], [.009, .009, .079], [.24, 0, 0]);
  }
  function stock(material = body, rear = .23) {
    cylinder(steel, [0, .012, .04], .024, .15); b.box(material, [0, -.022, rear - .075], [.1, .16, .2]);
    b.box(rubber, [0, -.029, rear + .035], [.12, .19, .028]);
  }
  function barrel(end, radius = .023, start = -.53) {
    cylinder(steel, [0, .026, (end + start) / 2], radius, start - end);
    cylinder(black, [0, .026, end + .023], radius * 1.5, .075);
    cylinder(rubber, [0, .026, end - .017], radius * .73, .006); model.muzzleZ = end - .04;
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
    const width = wide ? .075 : .061;
    b.box(black, [0, .129, z], [width * 2, .037, .077]);
    for (const side of [-1, 1]) b.box(black, [side * width, .199, z], [.019, .12, .059], [0, 0, side * .1]);
    b.box(black, [0, .263, z], [width * 2, .015, .059]);
    b.box(body, [.091, .164, z], [.035, .046, .064]); model.lensZ = z;
  }
  function scope(length, radius, z) {
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
    model.mag = part('magazine', position, pb => {
      pb.box(material, [0, -size[1] / 2, 0], size, [curve, 0, 0]);
      pb.box(black, [0, -size[1], size[1] * Math.sin(curve) / -2], [size[0] + .013, .023, size[2] + .02]);
      if (!remote) for (const side of [-1, 1]) for (let z = -size[2] * .3; z < size[2] * .4; z += .04) pb.box(steel, [side * (size[0] / 2 + .003), -size[1] * .5, z], [.005, size[1] * .67, .01], [curve, 0, 0]);
    });
  }
  switch (specification.model) {
    case 'smg':
      b.box(body, [0, .004, -.233], [.137, .148, .34]); b.box(black, [0, -.06, -.19], [.126, .08, .26]);
      b.box(rubber, [0, .002, -.455], [.121, .13, .14]); vents(-.4, -.53, .121); grip();
      barrel(-.66, .022, -.48); cylinder(black, [0, .026, -.591], .036, .068);
      for (const x of [-.043, .043]) b.box(steel, [x, .015, .066], [.018, .022, .24]);
      b.box(rubber, [0, -.026, .195], [.1, .17, .03]); b.box(black, [0, .052, -.04], [.135, .045, .068]);
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
      cylinder(black, [0, .026, -1.123], .044, .26); cylinder(rubber, [0, .026, -1.257], .027, .006); model.muzzleZ = -1.28;
      rail(-.47, .014); scope(.29, .075, -.255); magazine([0, -.078, -.319], [.099, .158, .16], steel);
      for (const side of [-1, 1]) b.box(black, [side * .091, -.027, -.656], [.023, .036, .238], [0, side * .1, 0]); break;
    case 'sniper':
      b.box(body, [0, -.045, -.28], [.157, .151, .71]); cylinder(steel, [0, .036, -.198], .056, .38);
      grip(rubber); stock(body, .34); b.box(body, [0, .079, .205], [.127, .073, .2]);
      b.box(black, [0, -.053, .141], [.106, .029, .15]); b.box(steel, [0, -.105, .286], [.09, .019, .041]);
      barrel(-1.37, .03, -.47); cylinder(black, [0, .026, -1.307], .049, .15); model.muzzleZ = -1.41;
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
      cylinder(body, [0, .022, -.423], .042, .295); b.box(body, [0, .064, -.448], [.053, .043, .305]);
      cylinder(black, [0, .022, -.578], .026, .019); cylinder(rubber, [0, .022, -.59], .018, .005); model.muzzleZ = -.611;
      b.box(body, [0, -.03, -.437], [.059, .059, .258]);
      model.drum = part('revolver-cylinder', [0, .013, -.21], pb => {
        pb.cylinder(black, [0, 0, 0], .081, .145, .081, [Math.PI / 2, 0, 0], 18);
        for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3, x = Math.sin(a) * .057, y = Math.cos(a) * .057;
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
      for (const x of [-.023, .023]) b.box(black, [x, .11, -.081], [.014, .033, .044]); b.box(black, [0, .094, -.55], [.014, .045, .033]); b.box(brass, [0, .117, -.557], [.007, .008, .009]);
      for (const side of [-1, 1]) { b.cylinder(steel, [side * .057, -.155, -.071], .012, .004, .012, [0, 0, Math.PI / 2], 10); }
      break;
  }
  if (!remote && specification.model !== 'revolver') {
    b.box(steel, [.083, .026, -.151], [.014, .038, .09]); b.box(black, [.093, .026, -.15], [.008, .019, .061]);
    for (const z of [-.064, -.333]) b.cylinder(steel, [-.087, -.023, z], .01, .005, .01, [0, 0, Math.PI / 2], 8);
    b.box(brass, [-.081, .04, -.067], [.007, .025, .057]);
  }
  b.finish(false);
  root.traverse(o => { if (o.isMesh) { o.castShadow = remote; o.receiveShadow = remote; } });
  return model;
}

function makeEnemy(kind = 'scav', teammate = false) {
  const root = new THREE.Group(); const torso = new THREE.Group(); torso.position.y = 1.12; root.add(torso);
  const heavy = /heavy|guard|elite/i.test(kind); const fabric = teammate ? '#4d6971' : heavy ? '#485653' : '#626655';
  coloredPart(torso, (b, c) => {
    b.box(c(fabric), [0, .06, 0], [.49, .62, .3]);
    b.box(c('#303f3b'), [0, .11, -.185], [.43, .43, .12]);
    b.box(c('#36433d'), [0, .14, .19], [.44, .49, .15]);
    b.box(c(teammate ? '#8cc8db' : '#b1834e'), [-.23, .13, -.065], [.06, .54, .37]);
    b.box(c('#777961'), [.23, .13, -.06], [.065, .54, .35]);
    for (let i = 0; i < 3; i++) b.box(c('#72735a'), [(i - 1) * .13, -.11, -.258], [.105, .22, .08]);
    b.box(c('#242e2b'), [0, -.28, 0], [.49, .085, .34]);
    b.box(c(teammate ? '#8edcf4' : '#be7744'), [0, .27, -.249], [.08, .055, .015]);
    b.box(c('#57634f'), [0, .14, .3], [.4, .43, .14]);
  });
  const head = new THREE.Group(); head.position.y = 1.63; root.add(head);
  coloredPart(head, (b, c) => {
    b.sphere(c('#38423e'), [0, .02, 0], [.185, .215, .18]);
    b.sphere(c('#53604f'), [0, .105, .02], [.205, .19, .205]);
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
      if (s === 1 || teammate) b.box(c(teammate ? '#7fd6f5' : '#ab6c3e'), [s * .145, -.06, -.02], [.016, .095, .13]);
    }); arms.push(pivot);
  }
  const gun = new THREE.Group(); gun.position.set(.13, 1.13, teammate ? -.29 : -.42); root.add(gun);
  const weaponModels = teammate ? new Map(WEAPONS.map(specification => {
    const model = makeWeaponModel(specification.id, true); gun.add(model.root); model.root.visible = false; return [specification.id, model];
  })) : null;
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
    coloredPart(torso, (b, c) => b.box(c('#79c9e2'), [0, .28, .375], [.22, .065, .015]));
  }
  const operator = { root, head, torso, legs, arms, gun, flash, marker, death: 0, lastX: 0, lastZ: 0, stride: 0, hit: 0, shotTime: 0, move: 0, crouch: 0, weaponId: null };
  operator.selectWeapon = id => {
    if (!weaponModels) return;
    const active = weaponModels.get(id) || weaponModels.get('VX-9'); if (operator.weaponId === active.id) return;
    weaponModels.forEach(model => { model.root.visible = model === active; }); operator.weaponId = active.id;
    flash.position.z = active.muzzleZ;
    arms[0].position.x = -.23; arms[0].scale.z = active.model === 'revolver' ? 1.18 : 1.85;
    arms[0].rotation.y = active.model === 'revolver' ? -.67 : -.42;
  };
  return operator;
}

function makeLegacyWeapon(camera, mats) {
  const rig = new THREE.Group(); camera.add(rig);
  rig.scale.setScalar(.87);
  const gun = new THREE.Group(); rig.add(gun);
  const gunBatch = makeBatch(gun); const b = { ...gunBatch, box: (...args) => gunBatch.bevel(...args) };
  const gunmetal = new THREE.MeshStandardMaterial({ color: '#263632', metalness: .78, roughness: .39 });
  const upper = new THREE.MeshStandardMaterial({ color: '#626f61', metalness: .54, roughness: .5 });
  const polymer = new THREE.MeshStandardMaterial({ color: '#364135', metalness: .08, roughness: .85 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#192924', roughness: .93 });
  const bolt = new THREE.MeshStandardMaterial({ color: '#a5a89a', metalness: .88, roughness: .29 });
  b.box(upper, [0, .005, -.21], [.145, .156, .41]);
  b.box(gunmetal, [0, -.062, -.18], [.13, .09, .25]);
  b.box(upper, [0, .036, -.505], [.13, .12, .23]);
  for (let z = -.405; z > -.62; z -= .039) {
    b.box(gunmetal, [.067, .01, z], [.012, .037, .024]);
    b.box(gunmetal, [-.067, .01, z], [.012, .037, .024]);
    b.box(gunmetal, [0, .102, z], [.137, .017, .021]);
  }
  b.cylinder(gunmetal, [0, .025, -.722], .025, .27, .025, [Math.PI / 2, 0, 0], 12);
  b.cylinder(rubber, [0, .025, -.895], .045, .1, .044, [Math.PI / 2, 0, 0], 12);
  b.cylinder(gunmetal, [0, .025, -.952], .031, .017, .031, [Math.PI / 2, 0, 0], 12);
  for (let z = -.86; z > -.94; z -= .022) b.box(bolt, [.043, .025, z], [.006, .025, .007]);
  b.box(polymer, [0, -.127, -.098], [.081, .175, .09], [.24, 0, 0]);
  b.box(rubber, [0, -.206, -.079], [.091, .022, .11], [.24, 0, 0]);
  b.box(gunmetal, [0, -.117, -.199], [.09, .017, .15]);
  b.box(gunmetal, [0, -.091, -.271], [.085, .067, .02]);
  b.box(bolt, [.078, .016, -.182], [.011, .049, .14]);
  b.box(rubber, [.085, .016, -.18], [.01, .033, .092]);
  b.box(bolt, [.096, .018, -.22], [.044, .018, .017]);
  b.cylinder(polymer, [0, .005, .056], .048, .15, .048, [Math.PI / 2, 0, 0], 10);
  b.box(polymer, [0, -.012, .144], [.11, .16, .21], [.05, 0, 0]);
  b.box(rubber, [0, -.023, .255], [.125, .184, .035]);
  b.box(upper, [0, .089, -.205], [.09, .019, .43]);
  for (let z = -.385; z < .0; z += .037) b.box(gunmetal, [0, .11, z], [.101, .015, .022]);
  // Open reflex sight with real through-view, side housing, and a fine luminous dot.
  b.box(gunmetal, [0, .135, -.275], [.122, .055, .085]);
  b.box(gunmetal, [-.064, .195, -.275], [.026, .11, .073], [0, 0, -.12]);
  b.box(gunmetal, [.064, .195, -.275], [.026, .11, .073], [0, 0, .12]);
  b.box(gunmetal, [0, .256, -.275], [.124, .019, .073]);
  b.box(polymer, [.091, .165, -.272], [.035, .051, .064]);
  b.cylinder(bolt, [.113, .169, -.272], .014, .006, .014, [0, 0, Math.PI / 2], 8);
  // Front gas block and iron post, small wear marks and fasteners.
  b.box(gunmetal, [0, .087, -.64], [.041, .11, .055]);
  b.box(bolt, [0, .141, -.64], [.009, .019, .012]);
  for (const z of [-.055, -.345]) b.cylinder(bolt, [.076, -.022, z], .012, .008, .012, [0, 0, Math.PI / 2], 8);
  b.box(mats.orange, [.074, .045, -.077], [.006, .039, .065]);
  b.box(bolt, [.074, -.012, -.095], [.007, .009, .039]);
  b.finish(false);
  const mag = new THREE.Group(); mag.position.set(0, -.08, -.315); gun.add(mag);
  const mb = makeBatch(mag);
  mb.box(polymer, [0, -.13, .015], [.097, .25, .14], [-.1, 0, 0]);
  mb.box(rubber, [0, -.251, .03], [.11, .025, .17]);
  for (const x of [-.052, .052]) for (const z of [-.025, .035]) mb.box(gunmetal, [x, -.135, z], [.011, .17, .014], [-.1, 0, 0]);
  mb.finish(false);
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
  return { rig, gun, arms, rightArm, leftArm, mag, flash, light, lens, dot, recoil: 0, kick: 0, flashTime: 0, aim: 0, crouch: 0, bob: 0, reloadClock: 0, sprintBlend: 0, moveBlend: 0, bobAmplitude: 0 };
}

function makeWeapon(camera, mats) {
  const weapon = makeLegacyWeapon(camera, mats), original = weapon.gun;
  const assembly = new THREE.Group(); weapon.rig.add(assembly); assembly.add(original);
  for (const part of [weapon.arms, weapon.flash, weapon.light, weapon.lens, weapon.dot]) assembly.add(part);
  weapon.gun = assembly;
  const models = new Map(WEAPONS.map(specification => {
    const model = specification.id === 'AR-4'
      ? { root: original, id: 'AR-4', model: 'assault', mag: weapon.mag, muzzleZ: -.975, sightHeight: .2, lens: 'reflex', lensZ: -.275, support: [0, 0, 0] }
      : makeWeaponModel(specification.id);
    if (model.mag) model.mag.userData.rest ||= model.mag.position.toArray();
    model.root.visible = false; assembly.add(model.root); return [specification.id, model];
  }));
  let active = null, reloadProgress = 0, cycleProgress = 0;
  const smoothPulse = (t, start, end) => t <= start || t >= end ? 0 : Math.sin((t - start) / (end - start) * Math.PI) ** 2;
  weapon.select = id => {
    const next = models.get(id) || models.get('VX-9'); if (active === next) return;
    if (active) active.root.visible = false;
    active = next; active.root.visible = true; weapon.weaponId = active.id; weapon.model = active.model; weapon.sightHeight = active.sightHeight;
    weapon.mag = active.mag; weapon.flash.position.z = active.muzzleZ; weapon.light.position.z = active.muzzleZ + .075;
    weapon.lens.visible = active.lens !== 'iron'; weapon.lens.position.set(0, active.sightHeight, active.lensZ || -.275);
    weapon.lens.scale.setScalar(active.lens === 'scope' ? .7 : 1);
    weapon.dot.position.set(0, active.sightHeight, active.lensZ || -.275);
    weapon.recoil = weapon.kick = weapon.reloadClock = 0;
    weapon.leftArm.position.set(...active.support); weapon.rightArm.position.set(0, 0, 0);
  };
  weapon.animate = (p, dt) => {
    if (!active) return;
    const specification = getWeapon(active.id);
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
      const turn = (specification.magSize - Math.max(0, p.ammo ?? specification.magSize)) * Math.PI / 3;
      active.drum.rotation.z = damp(active.drum.rotation.z, turn, 18, dt);
    }
    if (active.cartridges) {
      active.cartridges.visible = !!p.reload;
      active.cartridges.position.y = -.19 + Math.sin(reloadProgress * Math.PI * 8) ** 2 * .105;
    }
    if (active.model !== 'sniper') weapon.rightArm.position.set(0, 0, 0);
  };
  weapon.stats = () => ({ weaponId: active?.id, weaponModel: active?.model, cachedWeaponModels: models.size, weaponReloadProgress: reloadProgress, weaponCycleProgress: cycleProgress,
    weaponPumpOffset: active?.pump ? active.pump.position.z - active.pump.userData.rest[2] : 0,
    weaponBoltOffset: active?.model === 'sniper' ? active.bolt.position.z - active.bolt.userData.rest[2] : 0,
    weaponDrumOpen: active?.crane ? Math.sin(active.crane.rotation.z) * .128 : 0, weaponDrumRotation: active?.drum?.rotation.z || 0, weaponFeedCover: active?.cover?.rotation.x || 0 });
  weapon.select('VX-9');
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
        object.position.set(item.x, .025, item.z); object.rotation.set(0, 0, 0); object.scale.set(1, 1, 1); object.updateMatrix(); cases.setMatrixAt(index, object.matrix);
        object.position.y = .037; object.rotation.x = -Math.PI / 2; object.updateMatrix(); halos.setMatrixAt(index, object.matrix);
        object.position.y = .69 + Math.sin(elapsed * 2 + item.x) * .07; object.rotation.set(0, elapsed * .5, 0); object.scale.set(1, 1.6, 1); object.updateMatrix(); markers.setMatrixAt(index, object.matrix);
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
    update(containers, dt, visible, paused = false) {
      group.visible = visible; visibleCount = openedCount = emptyCount = 0;
      const present = new Set();
      for (const state of containers || []) {
        const entry = entries.get(state.id); if (!entry) continue;
        present.add(state.id); const { spot, index, meshes, type } = entry;
        if (!paused) entry.open = damp(entry.open, state.opened ? 1 : 0, 10, dt);
        const empty = !!state.searched && !(state.items || []).some(item => !item.taken);
        if (visible) { visibleCount++; if (state.opened) openedCount++; if (empty) emptyCount++; }
        transform.position.set(spot.x, .003, spot.z); transform.rotation.set(0, spot.rotation || 0, 0); transform.scale.set(spot.w, spot.h, spot.d); transform.updateMatrix(); baseMatrix.copy(transform.matrix);
        meshes.body.setMatrixAt(index, baseMatrix); meshes.front.setMatrixAt(index, baseMatrix); meshes.indicator.setMatrixAt(index, baseMatrix);
        meshes.status.setMatrixAt(index, state.searched ? baseMatrix : hiddenMatrix);
        meshes.cargo.setMatrixAt(index, !empty && entry.open > .08 ? baseMatrix : hiddenMatrix);
        indicatorColor.set(empty ? '#4a5750' : state.searched ? '#b6ae76' : type.color); meshes.indicator.setColorAt(index, indicatorColor);
        // Scale the physical lid before rotating it around the northern hinge.
        transform.scale.set(1, 1, 1); transform.updateMatrix();
        hinge.position.set(0, spot.h * .82, -spot.d * .47); hinge.rotation.set(-entry.open * Math.PI * .61, 0, 0); hinge.scale.set(spot.w, spot.h, spot.d); hinge.updateMatrix();
        lidMatrix.multiplyMatrices(transform.matrix, hinge.matrix); meshes.lid.setMatrixAt(index, lidMatrix); meshes.top.setMatrixAt(index, lidMatrix);
      }
      for (const [id, entry] of entries) if (!present.has(id)) for (const mesh of Object.values(entry.meshes)) mesh.setMatrixAt(entry.index, hiddenMatrix);
      for (const meshes of models.values()) for (const mesh of Object.values(meshes)) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    },
  };
}

export function createRenderer(canvas, layout) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .98;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog('#a5a28c', 74, Math.min(245, (layout.size || 120) + 60));
  const environmentScene = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer); const environment = pmrem.fromScene(environmentScene, .06);
  scene.environment = environment.texture; scene.environmentIntensity = .32; environmentScene.dispose(); pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(82, 1, .035, 600); camera.rotation.order = 'YXZ'; scene.add(camera);
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
  const dir = new THREE.Vector3(); const tmp = new THREE.Vector3(); const hubTarget = new THREE.Vector3();
  let elapsed = 0; let lastState = null; let lastPhase = ''; let fps = 60; let shake = 0; let quality = 'high';
  const settings = { quality: 'high', renderScale: 1, shadows: 'auto', particles: true, brightness: 1, contrast: 1, saturation: 1,
    fov: 82, headBob: 1, weaponSway: 1, screenShake: 1, adsZoom: 1, sprintFov: 4, showWeapon: true };
  let width = 1; let height = 1; let disposed = false; let frameDt = 1 / 60;
  const rnd = seeded(404);
  const dustCount = 135; const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) { dustPositions[i * 3] = (rnd() - .5) * 90; dustPositions[i * 3 + 1] = .5 + rnd() * 10; dustPositions[i * 3 + 2] = (rnd() - .5) * 90; }
  const dustGeometry = new THREE.BufferGeometry(); dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: '#ffe0aa', size: .023, transparent: true, opacity: .36, depthWrite: false })); scene.add(dust);

  function resize() {
    width = Math.max(1, canvas.clientWidth || window.innerWidth); height = Math.max(1, canvas.clientHeight || window.innerHeight);
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  }

  function applyQuality() {
    quality = settings.quality;
    const ratio = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.5 : quality === 'medium' ? 1.15 : .85) * settings.renderScale;
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
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
      camera.fov = settings.fov - weapon.aim * 19 * settings.adsZoom + weapon.sprintBlend * settings.sprintFov;
      camera.updateProjectionMatrix();
    }
    weapon.rig.visible = settings.showWeapon && !!lastState && ['raid', 'paused', 'extracted'].includes(lastState.phase);
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
    teammates.forEach(e => { scene.remove(e.root); disposeGroup(e.root); }); teammates.clear();
    effects.clear();
  }

  function update(state, dt, input = {}) {
    if (disposed || !state) return;
    dt = clamp(dt || 1 / 60, 0, .1); frameDt = dt; elapsed += dt; fps = damp(fps, 1 / Math.max(dt, .001), 2, dt);
    lastState = state;
    const p = state.player || {}; const phase = state.phase; const isRaidView = ['raid', 'paused', 'dead', 'extracted'].includes(phase);
    weapon.select(isRaidView ? p.weapon : state.profile?.selectedWeapon);
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
    weapon.rig.visible = settings.showWeapon && isRaidView && phase !== 'dead';
    if (!isRaidView) {
      const angle = -.38 + Math.sin(elapsed * .037) * .13;
      camera.position.set(25 + Math.sin(angle) * 13, 10.8 + Math.sin(elapsed * .08) * .4, 26 + Math.cos(angle) * 10);
      hubTarget.set(-6, 4.2, -14); camera.lookAt(hubTarget);
      camera.fov = damp(camera.fov, 58, 3, dt); camera.updateProjectionMatrix();
    } else if (phase !== 'paused') {
      const active = phase === 'raid';
      const aim = active && input.aim && !p.sprinting && !p.reload && !p.heal ? 1 : 0;
      weapon.aim = damp(weapon.aim, aim, 13, dt);
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
      const deathOffset = phase === 'dead' ? .92 : 0;
      camera.position.set(p.x || 0, (p.y || 0) + 1.65 - weapon.crouch + bobY * settings.headBob - deathOffset, p.z || 0);
      shake = damp(shake, 0, 9, dt);
      // Parent supplies the single authoritative aim offset to both player state
      // and hitscan. Cosmetic weapon motion must never alter camera pitch/yaw.
      camera.rotation.set(p.pitch || 0, p.yaw || 0, phase === 'dead' ? -.21 : Math.cos(weapon.bob) * amplitude * .2 * settings.headBob + Math.sin(elapsed * 33) * shake * .006 * settings.screenShake, 'YXZ');
      const fov = Number.isFinite(input.fov) ? clamp(input.fov, 65, 110) : settings.fov;
      camera.fov = damp(camera.fov, fov - weapon.aim * 19 * settings.adsZoom + weapon.sprintBlend * settings.sprintFov, 12, dt); camera.updateProjectionMatrix();
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
      weapon.dot.visible = weapon.aim > .3;
      weapon.lens.material.opacity = .055 + weapon.aim * .025;
    }
    sky.position.copy(camera.position);
    // A local, texel-snapped shadow window preserves detail throughout the
    // expanded district instead of stretching a single map over 300 metres.
    const shadowStep = 100 / sun.shadow.mapSize.x;
    const shadowX = Math.round(camera.position.x / shadowStep) * shadowStep;
    const shadowZ = Math.round(camera.position.z / shadowStep) * shadowStep;
    sun.position.set(shadowX - 48, 56, shadowZ - 54); sun.target.position.set(shadowX, 0, shadowZ);
    world.relayLamp.visible = Math.sin(elapsed * 2.4) > .5;
    world.exfils.forEach((ex, i) => { ex.material.opacity = .4 + Math.sin(elapsed * 2 + i) * .12; ex.beam.material.opacity = state.raid?.extractionProgress > 0 ? .4 : .13; });
    dust.rotation.y = elapsed * .003;
    dust.position.set(camera.position.x, 0, camera.position.z);
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
      model.head.rotation.y = Math.sin(elapsed * 1.3 + en.x) * .03;
      model.flash.visible = !en.dead && !!en.attackFlash;
      model.gun.rotation.x = model.flash.visible ? -.08 : 0;
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
      const dead = !!member.dead || member.phase === 'dead' || member.hp <= 0;
      model.death = damp(model.death, dead ? 1 : 0, 6, dt);
      model.crouch = damp(model.crouch, member.crouching ? 1 : 0, 12, dt);
      model.root.position.y = damp(model.root.position.y, (member.y || 0) - model.crouch * .28 + model.death * .19, 16, dt);
      model.root.rotation.set(0, yaw, model.death * -1.5);
      const speed = teleport ? 0 : Math.hypot(model.root.position.x - x, model.root.position.z - z) / Math.max(dt, .001);
      model.move = damp(model.move, dead ? 0 : Math.min(speed / 2.6, 1), 12, dt);
      model.stride += dt * Math.min(speed * 2.8, 12);
      const stride = model.move * .53 * (1 - model.death);
      model.legs[0].rotation.x = Math.sin(model.stride) * stride - model.crouch * .2;
      model.legs[1].rotation.x = -Math.sin(model.stride) * stride - model.crouch * .2;
      model.torso.position.y = 1.12 + Math.cos(model.stride * 2) * stride * .022;
      model.head.rotation.x = damp(model.head.rotation.x, clamp(member.pitch || 0, -.75, .75), 15, dt);
      model.shotTime = Math.max(0, model.shotTime - dt);
      model.flash.visible = !dead && (model.shotTime > 0 || !!member.attackFlash);
      model.gun.rotation.x = damp(model.gun.rotation.x, clamp(member.pitch || 0, -.8, .8) + (member.reload ? .27 : 0), 15, dt);
      model.selectWeapon(member.weapon);
      model.arms.forEach(arm => { arm.rotation.x = model.gun.rotation.x * .65; });
      model.marker.visible = !dead; model.marker.position.y = 2.15 + Math.sin(elapsed * 2) * .025;
    }
    for (const [id, model] of teammates) if (!teamPresent.has(id)) { scene.remove(model.root); disposeGroup(model.root); teammates.delete(id); }
    lootField.update(state.loot, elapsed, phase !== 'hub');
    containerField.update(state.containers, dt, phase !== 'hub', phase === 'paused' && !state.multiplayer);
    effects.update(dt);
  }

  function events(list) {
    for (const event of list || []) {
      if (event.type === 'shot') {
        weapon.select(event.weapon || lastState?.player?.weapon);
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
    render() { if (!disposed) renderer.render(scene, camera); },
    resize,
    events,
    setSettings,
    setQuality,
    setFov(value) { setSettings({ fov: Number.isFinite(value) ? value : 82 }); },
    getAimDirection() { const p = lastState?.player; if (p) return { x: -Math.sin(p.yaw || 0) * Math.cos(p.pitch || 0), y: Math.sin(p.pitch || 0), z: -Math.cos(p.yaw || 0) * Math.cos(p.pitch || 0) }; camera.getWorldDirection(dir); return { x: dir.x, y: dir.y, z: dir.z }; },
    stats() { return { settings: { ...settings }, pixelRatio: renderer.getPixelRatio(), renderWidth: canvas.width, renderHeight: canvas.height, shadowsEnabled: renderer.shadowMap.enabled, shadowMapSize: renderer.shadowMap.enabled ? sun.shadow.mapSize.x : 0, dustVisible: dust.visible, exposure: renderer.toneMappingExposure, colorFilter: canvas.style.filter, weaponVisible: weapon.rig.visible, cameraRoll: camera.rotation.z, weaponX: weapon.rig.position.x, weaponY: weapon.rig.position.y, teammates: teammates.size, teammateWeapons: [...teammates.values()].map(model => model.weaponId), drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, fps: Math.round(fps), quality, frameMs: Math.round(frameDt * 10000) / 10, cameraPitch: camera.rotation.x, cameraYaw: camera.rotation.y, cameraY: camera.position.y, fov: camera.fov, sprintBlend: weapon.sprintBlend, moveBlend: weapon.moveBlend, weaponPitch: weapon.rig.rotation.x, weaponRoll: weapon.rig.rotation.z, bobAmplitude: weapon.bobAmplitude, headBobAmplitude: weapon.bobAmplitude * settings.headBob, weaponBobAmplitude: weapon.bobAmplitude * settings.weaponSway, ...weapon.stats(), ...lootField.stats(), ...containerField.stats() }; },
    dispose() { if (disposed) return; disposed = true; disposeGroup(scene); environment.dispose(); renderer.dispose(); canvas.style.filter = ''; },
  };
}
