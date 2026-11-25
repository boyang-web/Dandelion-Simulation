import { createTrailGarden } from './trail-garden.js';
import { ROUTE, WALK_MARKER, trailLegs, trailBend } from './wind-route.js';
import { createWindHabitat } from './wind-habitat.js';
import * as THREE from 'three';
import { buildTreeGeometry, createTreeMaterial } from './tree-assets.js';
import { buildWindmillAsset } from './windmill-asset.js';

/* ------------------------------------------------------------------ */
/*  Journey assets · real landmarks for the five acts                  */
/*                                                                     */
/*  These sit exactly on the anchor coordinates and replace the M1     */
/*  rings with real silhouettes: an old tree, a windmill, a dry spring, */
/*  a vine arch and a north-ridge sundial.                             */
/* ------------------------------------------------------------------ */

const UP = new THREE.Vector3(0, 1, 0);

function groundAt(world, x, z) {
  return world.heightAt ? world.heightAt(x, z) : 0;
}

function terrainNormal(world, x, z) {
  const e = 0.7;
  const hx = (world.heightAt(x + e, z) - world.heightAt(x - e, z)) / (2 * e);
  const hz = (world.heightAt(x, z + e) - world.heightAt(x, z - e)) / (2 * e);
  return new THREE.Vector3(-hx, 1, -hz).normalize();
}

function tube(points, radius, material) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 20, radius, 6, false), material);
}

/* ------------------------------------------------------------------ */
/*  old tree                                                           */
/* ------------------------------------------------------------------ */

function createOldTree(scene, world, loader) {
  const group = new THREE.Group();
  const { x, z } = ROUTE.oldTree;
  group.position.set(x, groundAt(world, x, z), z);
  scene.add(group);

  const material = createTreeMaterial();
  const trunk = new THREE.Mesh(buildTreeGeometry(11, 0), material);
  group.add(trunk);
  const painting = new THREE.Mesh(new THREE.PlaneGeometry(15, 10),
    new THREE.MeshBasicMaterial({ transparent: true, alphaTest: .18, side: THREE.DoubleSide }));
  painting.geometry.translate(-2.7, 4.9, 0);
  painting.visible = false;
  group.add(painting);
  loader.load(new URL('../../assets/wind-oak.webp', import.meta.url).href, map => {
    map.colorSpace = THREE.SRGBColorSpace;
    painting.material.map = map;
    painting.material.needsUpdate = true;
    painting.visible = true;
    trunk.visible = false;
  });

  // Buttress roots rise out of the turf and taper back into the hillside.
  const bark = new THREE.MeshStandardMaterial({ color: '#695743', roughness: 1 });
  const roots = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), bark, 8);
  const rootPose = new THREE.Object3D();
  for (let i = 0; i < roots.count; i++) {
    const angle = i * 2.4;
    const reach = 2.1 + .6 * Math.sin(i);
    const rx = reach * Math.cos(angle), rz = reach * Math.sin(angle);
    const start = new THREE.Vector3(.3 * Math.cos(angle), .85, .3 * Math.sin(angle));
    const end = new THREE.Vector3(rx, groundAt(world, x + rx, z + rz) - group.position.y, rz);
    const direction = end.clone().sub(start);
    rootPose.position.copy(start).lerp(end, .5);
    rootPose.scale.set(.48, direction.length(), .35);
    rootPose.quaternion.setFromUnitVectors(UP, direction.normalize());
    rootPose.updateMatrix();
    roots.setMatrixAt(i, rootPose.matrix);
  }
  group.add(roots);

  // A flower ring that opens after the first dandelion wakes the tree.
  const bloomGeometry = new THREE.IcosahedronGeometry(0.075, 0);
  const bloomMaterial = new THREE.MeshBasicMaterial({
    color: '#ffe1a0',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false
  });
  const blooms = new THREE.InstancedMesh(bloomGeometry, bloomMaterial, 42);
  blooms.frustumCulled = false;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * Math.PI * 2 + Math.random() * 0.12;
    const r = 1.2 + Math.random() * 2.2;
    dummy.position.set(Math.cos(a) * r, 0.12 + Math.random() * 0.1, Math.sin(a) * r);
    dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    dummy.scale.setScalar(0.6 + Math.random() * 0.8);
    dummy.updateMatrix();
    blooms.setMatrixAt(i, dummy.matrix);
  }
  blooms.instanceMatrix.needsUpdate = true;
  group.add(blooms);

  // The first delivery releases a visible stream from the boughs toward the mill.
  const silk = document.createElement('canvas');
  silk.width = silk.height = 64;
  const pen = silk.getContext('2d');
  pen.strokeStyle = '#fffbe0';
  pen.lineWidth = 2.4;
  pen.beginPath();
  pen.moveTo(35,52); pen.lineTo(30,29);
  for (let i = 0; i <= 14; i++) {
    const a = Math.PI + i * Math.PI / 14;
    pen.moveTo(30,30);
    pen.quadraticCurveTo(30+Math.cos(a)*12,21+Math.sin(a)*7,30+Math.cos(a)*26,22+Math.sin(a)*16);
  }
  pen.stroke();
  const positions = new Float32Array(72 * 3);
  const driftGeo = new THREE.BufferGeometry();
  driftGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const drift = new THREE.Points(driftGeo, new THREE.PointsMaterial({
    size: .52, map: new THREE.CanvasTexture(silk), transparent: true, depthWrite: false, color: '#fff0cb'
  }));
  drift.visible = false;
  drift.frustumCulled = false;
  group.add(drift);
  let releaseAge = Infinity;
  let awake = 0;
  return {
    group,
    material,
    trees: [trunk, painting],
    blooms,
    get awake() { return awake; },
    setAwake(progress, animate = true) {
      if (animate && progress > awake) releaseAge = 0;
      awake = THREE.MathUtils.clamp(progress, 0, 1);
      const s = 0.001 + awake * 0.999;
      blooms.scale.setScalar(s);
      bloomMaterial.opacity = awake * 0.9;
    },
    update(t, wind, dt) {
      releaseAge += dt;
      drift.visible = releaseAge < 7;
      if (drift.visible) {
        for (let i = 0; i < positions.length / 3; i++) {
          const travel = Math.max(0, releaseAge - (i % 9) * .15);
          positions[i*3] = Math.sin(i * 7.1) * 3 - travel * 1.8;
          positions[i*3+1] = 4 + Math.cos(i) + Math.sin(t + i)*.4 + travel*.32;
          positions[i*3+2] = Math.cos(i*3.1)*2 - travel * 2;
        }
        drift.geometry.attributes.position.needsUpdate = true;
        drift.material.opacity = Math.min(1, (7-releaseAge)/1.6);
      }

      const camera = wind.camera;
      painting.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z);
      painting.material.color.setScalar(1 - .72 * material.uniforms.uNight.value);

      material.uniforms.uTime.value = t;
      const breeze = wind ? wind.breezePower : 0.2;
      const player = wind ? wind.playerStrength : 0;
      material.uniforms.uWindStrength.value = Math.min(1, breeze + player * 0.8);
      if (wind) {
        material.uniforms.uWindDir.value.set(wind.dir.x, wind.dir.z).normalize();
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/*  windmill + sockets + updraft                                       */
/* ------------------------------------------------------------------ */

function createWindmill(scene, world) {
  const { x, z } = ROUTE.windmill;
  const ground = groundAt(world, x, z);
  const asset = buildWindmillAsset();
  asset.group.position.set(x, ground, z);
  asset.group.scale.setScalar(0.85);
  asset.group.rotation.y = 0.18;
  scene.add(asset.group);

  const updraftGroup = new THREE.Group();
  const updraftX = ROUTE.updraft.x;
  const updraftZ = ROUTE.updraft.z;
  updraftGroup.position.set(updraftX, groundAt(world, updraftX, updraftZ), updraftZ);
  const specks=new Float32Array(72*3);
  for(let i=0;i<72;i++)specks.set([i/72,(i*.618)%1,(i*.414)%1],3*i);
  const drift=new THREE.BufferGeometry();
  drift.setAttribute('position',new THREE.BufferAttribute(specks,3));
  const breeze=new THREE.ShaderMaterial({
    uniforms:{time:{value:0}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`uniform float time;varying float fade;
      void main(){float h=fract(position.x+time*.14);float a=h*6.+position.y*6.28;
      vec3 p=vec3(cos(a)*(1.+position.z),h*7.,sin(a)*(1.+position.z));
      vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;
      gl_PointSize=clamp(62./-v.z,1.8,9.);fade=sin(h*3.14159);}`,
    fragmentShader:`varying float fade;void main(){float d=length(gl_PointCoord-.5)*2.;
      gl_FragColor=vec4(.71,.95,.88,fade*max(0.,1.-d));}`
  });
  const current=new THREE.Points(drift,breeze);
  current.frustumCulled=false;
  updraftGroup.add(current);
  updraftGroup.visible = false;
  scene.add(updraftGroup);

  let speed = 0;
  let target = 0;
  let turning = false;


  return {
    group: asset.group,
    rotor: asset.rotor,
    updraftGroup,
    get turning() { return turning; },
    setTurning(on) {
      turning = !!on;
      target = turning ? 1.25 : 0;
      updraftGroup.visible = turning;
    },
    setPrimed(count) {
      if (!turning) target = count * .32;
    },
    update(dt, elapsed) {
      speed += (target - speed) * (1 - Math.exp(-3.2 * dt));
      if (this.rotor) this.rotor.rotation.z += speed * dt;
      breeze.uniforms.time.value=elapsed;

    }
  };
}

/* ------------------------------------------------------------------ */
/*  dry spring + vine arch                                             */
/* ------------------------------------------------------------------ */

function createDrySpring(scene, world) {
  const group = new THREE.Group();
  const { x, z } = ROUTE.spring;
  const ground = groundAt(world, x, z);
  group.position.set(x, ground, z);
  scene.add(group);

  const dry = new THREE.Mesh(
    new THREE.CircleGeometry(2.6, 40),
    new THREE.MeshBasicMaterial({
      color: '#6f5a3e',
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false
    })
  );
  dry.rotation.x = -Math.PI / 2;
  dry.position.y = 0.025;
  group.add(dry);

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(2.05, 40),
    new THREE.MeshBasicMaterial({
      color: '#87c5cd',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.045;
  group.add(water);

  const stoneMaterial = new THREE.MeshStandardMaterial({ color: '#7d7565', roughness: 0.95 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 2.75;
    const stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.3 + Math.random() * 0.18, 0),
      stoneMaterial
    );
    stone.position.set(Math.cos(a) * r, 0.15, Math.sin(a) * r);
    stone.rotation.set(Math.random() * 2, Math.random() * 2, Math.random() * 2);
    group.add(stone);
  }

  const withered = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.05, 0.9, 6),
    new THREE.MeshStandardMaterial({ color: '#6f6044', roughness: 1 })
  );
  stem.position.y = 0.45;
  stem.rotation.z = 0.18;
  withered.add(stem);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 8),
    new THREE.MeshStandardMaterial({ color: '#66573c', roughness: 1 })
  );
  head.position.set(0.16, 0.9, 0);
  withered.add(head);
  group.add(withered);

  const flowerMaterial = new THREE.MeshBasicMaterial({
    color: '#ffe4a5',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false
  });
  const flowers = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.075, 0),
    flowerMaterial,
    44
  );
  flowers.frustumCulled = false;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2 + Math.random() * 0.2;
    const r = 1.2 + Math.random() * 1.5;
    dummy.position.set(Math.cos(a) * r, 0.14, Math.sin(a) * r);
    dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    dummy.scale.setScalar(0.6 + Math.random() * 0.7);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
  }
  flowers.instanceMatrix.needsUpdate = true;
  flowers.scale.setScalar(0.001);
  group.add(flowers);

  // A vine arch a short walk toward the ridge; it grows when the spring is restored.
  const vineGroup = new THREE.Group();
  vineGroup.position.set(x, groundAt(world, x, z + 7), z + 7);
  const vineMaterial = new THREE.MeshStandardMaterial({ color: '#526b38', roughness: 0.9 });
  const left = tube([
    new THREE.Vector3(-2.8, 0, 0),
    new THREE.Vector3(-2.2, 1.5, 0),
    new THREE.Vector3(-1.2, 2.7, 0)
  ], 0.09, vineMaterial);
  const right = tube([
    new THREE.Vector3(2.8, 0, 0),
    new THREE.Vector3(2.2, 1.5, 0),
    new THREE.Vector3(1.2, 2.7, 0)
  ], 0.09, vineMaterial);
  const top = tube([
    new THREE.Vector3(-1.2, 2.7, 0),
    new THREE.Vector3(0, 3.4, 0),
    new THREE.Vector3(1.2, 2.7, 0)
  ], 0.09, vineMaterial);
  vineGroup.add(left, right, top);
  vineGroup.scale.setScalar(0.001);
  scene.add(vineGroup);

  const streamShape = new THREE.BufferGeometry();
  const bed = [], tex = [], indices = [];
  for (let j = 0; j <= 36; j++) {
    const f = j / 36;
    const centerX = x + Math.sin(f * 5.3) * 1.15;
    const wz = z + 1.6 + f * 7;
    for (const bank of [-1, 1]) {
      const wx = centerX + bank * (.5 + .19 * Math.cos(f * 8));
      bed.push(wx, groundAt(world, wx, wz) + .11, wz);
      tex.push((bank + 1)/2, f);
    }
    if (j) { const k = j*2; indices.push(k-2,k,k-1,k-1,k,k+1); }
  }
  streamShape.setAttribute('position',new THREE.Float32BufferAttribute(bed,3));
  streamShape.setAttribute('uv',new THREE.Float32BufferAttribute(tex,2));
  streamShape.setIndex(indices);
  const streamMaterial = new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, side:THREE.DoubleSide,
    uniforms:{ t:{value:0}, reach:{value:0} },
    vertexShader:`varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec2 v;uniform float t,reach;
      void main(){float ripple=pow(.5+.5*sin(v.y*90.-t*3.+sin(v.x*15.)),8.);
        float wet=(1.-smoothstep(reach-.06,reach,v.y))*smoothstep(0.,.18,1.-abs(2.*v.x-1.));
        gl_FragColor=vec4(mix(vec3(.19,.48,.45),vec3(.71,.87,.78),ripple*.56),wet*.86);}`
  });
  const stream = new THREE.Mesh(streamShape,streamMaterial);
  scene.add(stream);
  let restored = 0;

  return {
    group,
    water,
    update(t, dt) {
      streamMaterial.uniforms.t.value = t;
      const u = streamMaterial.uniforms.reach;
      u.value = Math.min(restored, u.value + dt * .32);
      stream.visible = u.value > .005;
    },
    flowers,
    withered,
    vineGroup,
    get restored() { return restored; },
    setRestored(progress) {
      restored = THREE.MathUtils.clamp(progress, 0, 1);
      water.material.opacity = restored * 0.72;
      dry.material.opacity = 0.9 * (1 - restored * 0.75);
      flowers.scale.setScalar(0.001 + restored * 0.999);
      flowerMaterial.opacity = restored * 0.9;
      vineGroup.scale.setScalar(0.001 + restored * 0.999);
      withered.scale.setScalar(Math.max(0.001, 1 - restored));
    }
  };
}

/* ------------------------------------------------------------------ */
/*  sundial                                                           */
/* ------------------------------------------------------------------ */

function createSundial(scene, world) {
  const group = new THREE.Group();
  const { x, z } = ROUTE.sundial;
  const ground = groundAt(world, x, z);
  group.position.set(x, ground, z);
  group.quaternion.setFromUnitVectors(UP, terrainNormal(world, x, z));
  scene.add(group);

  const stone = new THREE.MeshStandardMaterial({ color: '#8d8778', roughness: 0.95 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.55, 0.28, 20), stone);
  base.position.y = 0.14;
  group.add(base);

  const dial = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.1, 32), stone);
  dial.position.y = 0.32;
  group.add(dial);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 2.3),
    new THREE.MeshBasicMaterial({
      color: '#1d1a14',
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      toneMapped: false
    })
  );
  shadow.geometry.rotateX(-Math.PI / 2);
  shadow.geometry.translate(0, 0, 1.15);
  shadow.position.y = 0.385;
  shadow.renderOrder = 3;
  group.add(shadow);

  const notch = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.04, 0.85),
    new THREE.MeshBasicMaterial({
      color: '#ffd98c',
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      toneMapped: false
    })
  );
  notch.position.set(0, 0.39, 1.45);
  group.add(notch);

  const gnomon = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 1.25, 4),
    new THREE.MeshStandardMaterial({ color: '#625b4c', roughness: 0.8 })
  );
  gnomon.position.y = 0.95;
  gnomon.rotation.z = 0.28;
  group.add(gnomon);

  let glow = 0;

  return {
    group,
    shadow,
    notch,
    update(sunDir, time) {
      if (sunDir) {
        const angle = Math.atan2(-sunDir.x, -sunDir.z);
        shadow.rotation.y += (angle - shadow.rotation.y) * 0.35;
      }
      const near = Math.max(0, 1 - Math.abs(time - 0.49) / 0.045);
      glow += (near - glow) * 0.2;
      notch.material.opacity = 0.22 + glow * 0.65;
      notch.scale.setScalar(1 + glow * 0.25);
    }
  };
}

/* ------------------------------------------------------------------ */
/*  assembly                                                           */
/* ------------------------------------------------------------------ */

function addFootpath(scene, world) {
  const points = [], uv = [], faces = [];
  for (const { start, length, dx, dz } of trailLegs) {
    const rows = Math.ceil(length * 2);
    for (let row = 0; row <= rows; row++) {
      const f = row / rows, bend = trailBend(f);
      const width = 1.65 + .18 * Math.sin(row * .7);
      const base = points.length / 3;
      for (const side of [-1, 0, 1]) {
        const off = bend + side * width;
        const x = start.x + dx * length * f - dz * off;
        const z = start.z + dz * length * f + dx * off;
        points.push(x, groundAt(world, x, z) + .055, z);
        uv.push((side + 1) / 2, f * length);
      }
      if (row) for (let k = 0; k < 2; k++) {
        const j = base + k;
        faces.push(j-3,j,j-2,j-2,j,j+1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(faces);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec2 v; void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 v;
    float hash(vec2 p){return fract(sin(dot(p,vec2(31.7,17.3)))*43758.5);}
    float grain(vec2 p){vec2 i=floor(p), f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
    void main(){vec2 p=v*vec2(3.,1.);float n=grain(p*3.);float edge=abs(v.x-.5)*2.;
      float alpha=1.-smoothstep(.56,1.,edge+.16*(n-.5));
      vec3 c=mix(vec3(.24,.20,.115),vec3(.51,.41,.245),.65*n+.35*grain(p*21.));
      gl_FragColor=vec4(c*.72,alpha*.90);
      #include <colorspace_fragment>
    }`
  });
  scene.add(new THREE.Mesh(geo, mat));
}

// Follow the contours between landmarks. Keep the centre of the trail open
// for planting, with flowers at the tree, split rails at the mill and cairns uphill.
function dressTrail(scene, world) {
  addFootpath(scene, world);
  const stones = [], timber = [];
  const pose = new THREE.Object3D();
  function place(batch, x, z, height, sx, sy, sz, yaw, roll = 0) {
    pose.position.set(x, groundAt(world, x, z) + height, z);
    pose.rotation.set(0, yaw, roll);
    pose.scale.set(sx, sy, sz);
    pose.updateMatrix();
    batch.push(pose.matrix.clone());
  }
  // Twin cairns frame the walking checkpoint from both approaches.
  for (const side of [-1, 1]) {
    const x = WALK_MARKER.x + side * 2.1, z = WALK_MARKER.z - side * 2.1;
    place(stones, x, z, .34, 1.3, .85, 1.2, side);
    place(stones, x, z, .95, .92, .62, .82, -side);
    place(stones, x, z, 1.44, .58, .48, .5, side);
  }
  for (const { start: { x, z }, end, length, dx, dz } of trailLegs) {
    const nx = -dz, nz = dx;
    for (let d = 4; d < length - 5; d += 2.4) {
      const bend = trailBend(d / length);
      const cx = x + dx * d + nx * bend;
      const cz = z + dz * d + nz * bend;
      place(stones, cx + nx * 1.3, cz + nz * 1.3, .025, .45, .11, .38, d);
      if (Math.round((d - 4) / 2.4) % 5 !== 0) continue;
      const px = cx + nx * 3.6, pz = cz + nz * 3.6;
      if (end === ROUTE.windmill) {
        const yaw = Math.atan2(dx, dz);
        for (const sign of [-1, 1]) {
          place(timber, px + sign * dx, pz + sign * dz,
            .7, .18, 1.6, .18, yaw);
        }
        place(timber, px, pz, 1.0, .13, .16, 2.4, yaw);
      } else {
        for (let n = 0; n < (end === ROUTE.spring ? 4 : 2); n++) {
          place(stones, px, pz, .2 + n * .36, .87 - n * .14, .32, .69 - n * .1, d + n);
        }
      }
    }
  }
  function add(geometry, color, matrices) {
    const mesh = new THREE.InstancedMesh(geometry,
      new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }), matrices.length);
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    scene.add(mesh);
  }
  add(new THREE.IcosahedronGeometry(1, 0), '#b9ab94', stones);
  add(new THREE.BoxGeometry(), '#816548', timber);
}

export function createJourneyAssets({ scene, world, onTexturesReady }) {
  const manager = new THREE.LoadingManager(onTexturesReady);
  const loader = new THREE.TextureLoader(manager);
  dressTrail(scene, world);
  const updateGarden = createTrailGarden(scene, world, loader);
  const habitat = createWindHabitat(scene, world, loader);
  const oldTree = createOldTree(scene, world, loader);
  const windmill = createWindmill(scene, world);
  const spring = createDrySpring(scene, world);
  const sundial = createSundial(scene, world);

  return {
    habitat,
    oldTree,
    windmill,
    spring,
    sundial,
    onAnchorSolved(id, animate = true) {
      if (id === 'oldTree') oldTree.setAwake(1, animate);
      if (id === 'windmill') {
        windmill.setTurning(true);

      }
      if (id === 'spring') spring.setRestored(1);
      if (id === 'sundial') {
        // The shadow stays where the player aligned it.
        sundial.notch.material.color.set('#ffe6a8');
      }
    },
    update(t, dt, wind, sky) {
      updateGarden(t, sky.lightState?.night || 0);
      habitat.update(t, sky.lightState?.night || 0);
      oldTree.update(t, wind, dt);
      windmill.update(dt, t);
      spring.update(t, dt);
      sundial.update(sky.lightState?.sunDir, sky.time);

      const ls = sky.lightState;
      if (ls) {
        const u = oldTree.material.uniforms;
        if (ls.color) u.uSunColor.value.copy(ls.color);
        if (ls.sunDir) u.uSunDir.value.copy(ls.sunDir);
        u.uSunStrength.value = ls.sunStrength ?? 1;
        if (ls.haze) u.uHaze.value.copy(ls.haze);
        u.uNight.value = ls.night || 0;
        u.uHazeAmount.value = 1;
      }
    }
  };
}