import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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
  const gun = new THREE.Group(); gun.position.set(.13, 1.13, -.42); root.add(gun);
  coloredPart(gun, (b, c) => {
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
  return { root, head, torso, legs, arms, gun, flash, marker, death: 0, lastX: 0, lastZ: 0, stride: 0, hit: 0, shotTime: 0, move: 0, crouch: 0 };
}

function makeWeapon(camera, mats) {
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
  // Both hands and their attachments share the receiver/handguard transform.
  // The compact VX-9 must not leave its support hand at the AR-4 barrel position.
  const arms = new THREE.Group(); gun.add(arms);
  const armBatch = makeBatch(arms); const ab = { ...armBatch, box: (...args) => armBatch.bevel(...args) };
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
  const wristPosition = [-.075, -.106, -.36];
  const wristRotation = sleeveBetween([-.235, -.31, .025], wristPosition, .09, .064);
  ab.box(gloves, [-.045, -.062, -.46], [.112, .1, .147], [-.12, .08, 0]);
  for (let i = 0; i < 4; i++) ab.box(gloves, [.019, -.045 + i * .012, -.479 + i * .006], [.068, .019, .074], [0, 0, .12]);
  ab.box(gloves, [-.092, -.022, -.441], [.046, .053, .082], [.18, -.25, -.25]);
  ab.finish(false);
  const wrist = new THREE.Group(); wrist.name = 'support-wrist';
  wrist.position.set(...wristPosition); wrist.quaternion.copy(wristRotation); arms.add(wrist);
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
  return { rig, gun, arms, mag, flash, light, lens, dot, recoil: 0, kick: 0, flashTime: 0, aim: 0, crouch: 0, bob: 0, reloadClock: 0, sprintBlend: 0, moveBlend: 0, bobAmplitude: 0 };
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
    if (phase === 'raid' && ['hub', '', 'extracted', 'dead'].includes(lastPhase)) {
      clearEntities();
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
      const y = THREE.MathUtils.lerp(-.315, -.174, weapon.aim) - Math.abs(bobY) * settings.weaponSway + swayY - reload * .13 - healing * .3;
      const z = THREE.MathUtils.lerp(-.49, -.43, weapon.aim) + weapon.recoil * (.011 - weapon.aim * .007);
      weapon.rig.position.x = damp(weapon.rig.position.x, x, 22, dt); weapon.rig.position.y = damp(weapon.rig.position.y, y, 20, dt); weapon.rig.position.z = damp(weapon.rig.position.z, z, 25, dt);
      weapon.rig.rotation.set(weapon.kick * (.015 - weapon.aim * .014) + reload * .16 - weapon.sprintBlend * .2, reload * .38 + swayX * 2, reload * -.47 + weapon.sprintBlend * .16 + Math.cos(weapon.bob) * weaponAmplitude * .35);
      weapon.mag.position.y = -.08 - (isReloading ? Math.sin(Math.min(1, weapon.reloadClock / 1.7) * Math.PI) * .3 : 0);
      weapon.mag.rotation.x = isReloading ? Math.sin(weapon.reloadClock * 3) * .17 : 0;
      weapon.dot.visible = weapon.aim > .3;
      weapon.lens.material.opacity = .055 + weapon.aim * .025;
      weapon.gun.scale.z = p.weapon === 'VX-9' ? .88 : 1;
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
      model.gun.scale.z = member.weapon === 'VX-9' ? .88 : 1;
      model.arms.forEach(arm => { arm.rotation.x = model.gun.rotation.x * .65; });
      model.marker.visible = !dead; model.marker.position.y = 2.15 + Math.sin(elapsed * 2) * .025;
    }
    for (const [id, model] of teammates) if (!teamPresent.has(id)) { scene.remove(model.root); disposeGroup(model.root); teammates.delete(id); }
    lootField.update(state.loot, elapsed, phase !== 'hub');
    effects.update(dt);
  }

  function events(list) {
    for (const event of list || []) {
      if (event.type === 'shot') {
        const impulse = lastState?.player?.weapon === 'AR-4' ? .36 : .26;
        weapon.recoil = Math.min(weapon.recoil + impulse, .65); weapon.kick = Math.min(weapon.kick + impulse, .65); weapon.flashTime = .04;
        camera.getWorldDirection(dir); camera.updateMatrixWorld();
        tmp.set(.13, -.12, -1.05).applyMatrix4(camera.matrixWorld);
        const from = { x: tmp.x, y: tmp.y, z: tmp.z };
        const to = event.to || { x: camera.position.x + dir.x * 65, y: camera.position.y + dir.y * 65, z: camera.position.z + dir.z * 65 };
        effects.add(from, to);
      } else if (event.type === 'teammateShot') {
        const model = teammates.get(event.playerId); if (model) { model.shotTime = .08; model.flash.visible = true; }
        if (event.from && event.to) effects.add(event.from, event.to, false, .1);
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
    stats() { return { settings: { ...settings }, pixelRatio: renderer.getPixelRatio(), renderWidth: canvas.width, renderHeight: canvas.height, shadowsEnabled: renderer.shadowMap.enabled, shadowMapSize: renderer.shadowMap.enabled ? sun.shadow.mapSize.x : 0, dustVisible: dust.visible, exposure: renderer.toneMappingExposure, colorFilter: canvas.style.filter, weaponVisible: weapon.rig.visible, cameraRoll: camera.rotation.z, weaponX: weapon.rig.position.x, weaponY: weapon.rig.position.y, teammates: teammates.size, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, fps: Math.round(fps), quality, frameMs: Math.round(frameDt * 10000) / 10, cameraPitch: camera.rotation.x, cameraYaw: camera.rotation.y, cameraY: camera.position.y, fov: camera.fov, sprintBlend: weapon.sprintBlend, moveBlend: weapon.moveBlend, weaponPitch: weapon.rig.rotation.x, weaponRoll: weapon.rig.rotation.z, bobAmplitude: weapon.bobAmplitude, headBobAmplitude: weapon.bobAmplitude * settings.headBob, weaponBobAmplitude: weapon.bobAmplitude * settings.weaponSway, ...lootField.stats() }; },
    dispose() { if (disposed) return; disposed = true; disposeGroup(scene); environment.dispose(); renderer.dispose(); canvas.style.filter = ''; },
  };
}
