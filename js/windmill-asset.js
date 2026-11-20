import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Windmill asset                                                     */
/*                                                                     */
/*  Brick tower, stone plinth, timber gallery, domed cap, lattice      */
/*  sails, tail pole. Returns a group with a rotor you can spin.       */
/* ------------------------------------------------------------------ */

function brickTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#c8b9a2';
  ctx.fillRect(0, 0, 256, 256);

  const bw = 64;
  const bh = 32;
  for (let row = 0; row < 8; row++) {
    const offset = (row % 2) * (bw / 2);
    for (let x = -bw; x < 256 + bw; x += bw) {
      const bx = x + offset;
      const by = row * bh;
      const t = Math.random();
      const r = 118 + Math.floor(t * 34);
      const g = 76 + Math.floor(t * 26);
      const b = 58 + Math.floor(t * 20);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(bx + 2, by + 2, bw - 4, bh - 4);

      ctx.fillStyle = 'rgba(255, 235, 210, 0.08)';
      ctx.fillRect(bx + 2, by + 2, bw - 4, 3);
      ctx.fillStyle = 'rgba(30, 18, 14, 0.12)';
      ctx.fillRect(bx + 2, by + bh - 5, bw - 4, 3);
    }
  }

  // soot / weathering
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    ctx.fillStyle = `rgba(40, 28, 22, ${0.02 + Math.random() * 0.05})`;
    ctx.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3.2, 4.6);
  tex.anisotropy = 4;
  return tex;
}

function sailTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 512);

  ctx.fillStyle = '#5b4a35';
  ctx.fillRect(4, 0, 10, 512);
  ctx.fillRect(242, 0, 10, 512);

  for (let i = 0; i < 11; i++) {
    const y = 8 + i * 45;
    ctx.fillRect(10, y, 236, 8);
  }

  ctx.fillStyle = 'rgba(255, 238, 200, 0.10)';
  ctx.fillRect(4, 0, 10, 512);
  ctx.fillRect(242, 0, 10, 512);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function beamBetween(a, b, thickness, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(thickness, len, thickness),
    material
  );
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.normalize()
  );
  return mesh;
}

export function buildWindmillAsset() {
  const group = new THREE.Group();
  const materials = {};

  const stoneMat = new THREE.MeshStandardMaterial({
    color: '#8b8576',
    roughness: 0.96
  });
  const woodMat = new THREE.MeshStandardMaterial({
    color: '#6a573d',
    roughness: 0.92
  });
  const darkWood = new THREE.MeshStandardMaterial({
    color: '#43382b',
    roughness: 0.95
  });
  const capMat = new THREE.MeshStandardMaterial({
    color: '#3f3b31',
    roughness: 0.9
  });
  const brickMat = new THREE.MeshStandardMaterial({
    map: brickTexture(),
    roughness: 0.94
  });
  const sailMat = new THREE.MeshStandardMaterial({
    map: sailTexture(),
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    roughness: 0.9
  });

  materials.stone = stoneMat;
  materials.wood = woodMat;
  materials.dark = darkWood;
  materials.cap = capMat;
  materials.brick = brickMat;
  materials.sail = sailMat;

  /* plinth */
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.6, 8), stoneMat);
  plinth.position.y = 0.3;
  group.add(plinth);

  /* tower */
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 1.48, 6.7, 8), brickMat);
  tower.position.y = 0.6 + 3.35;
  group.add(tower);

  /* gallery deck and railing */
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.78, 1.78, 0.14, 8), woodMat);
  deck.position.y = 3.15;
  group.add(deck);

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.92, 0.06), woodMat);
    post.position.set(Math.cos(a) * 1.68, 3.67, Math.sin(a) * 1.68);
    group.add(post);
  }
  const topRail = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.06, 8), woodMat);
  topRail.position.y = 4.12;
  group.add(topRail);

  /* door and small windows */
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.35, 0.08), darkWood);
  door.position.set(0, 1.2, 1.43);
  group.add(door);

  const arch = new THREE.Mesh(
    new THREE.CircleGeometry(0.39, 14, 0, Math.PI),
    darkWood
  );
  arch.position.set(0, 1.87, 1.475);
  group.add(arch);

  for (let i = 0; i < 2; i++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.06), darkWood);
    win.position.set(0, 4.35 + i * 1.15, 1.12 - i * 0.12);
    group.add(win);
  }

  /* cap */
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(1.08, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2),
    capMat
  );
  cap.scale.y = 0.62;
  cap.position.y = 7.18;
  group.add(cap);

  const finial = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 6), darkWood);
  finial.position.y = 8.05;
  group.add(finial);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), darkWood);
  ball.position.y = 8.32;
  group.add(ball);

  /* rotor */
  const rotor = new THREE.Group();
  rotor.position.set(0, 7.1, 2.15);
  group.add(rotor);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.3, 8), woodMat);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.set(0, 7.1, 1.5);
  group.add(shaft);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.55, 10), woodMat);
  hub.rotation.x = Math.PI / 2;
  rotor.add(hub);

  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i / 4) * Math.PI * 2 + Math.PI / 4;

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.13, 4.4, 0.13), woodMat);
    stock.position.y = 2.2;
    arm.add(stock);

    const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 3.6), sailMat);
    sail.position.set(0.5, 2.15, 0.02);
    arm.add(sail);

    rotor.add(arm);
  }

  /* tail pole and small tail wheel */
  const tailTop = new THREE.Vector3(0, 7.35, -1.2);
  const tailBottom = new THREE.Vector3(0, 0.4, -3.0);
  group.add(beamBetween(new THREE.Vector3(0, 7.18, -0.95), tailTop, 0.12, woodMat));
  group.add(beamBetween(tailTop, tailBottom, 0.14, woodMat));

  const tailWheel = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.055, 8, 18), darkWood);
  tailWheel.rotation.y = Math.PI / 2;
  tailWheel.position.copy(tailBottom);
  group.add(tailWheel);

  /* shadows */
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  return {
    group,
    rotor,
    materials,
    height: 11.4
  };
}