import * as THREE from 'three';
import { trailLegs, trailBend } from './wind-route.js';

export function createTrailGarden(scene, world, loader) {
  const centers = [], variants = [], sizes = [];
  for (const [leg, { start, length, dx, dz }] of trailLegs.entries()) {
    for (let d = 1; d < length; d += 2.3 + .9 * Math.sin(d)) {
      const side = Math.sin(d * 4 + leg) > 0 ? 1 : -1;
      for (let k = 0; k < (Math.cos(d) > .72 ? 2 : 1); k++) {
        const lateral = trailBend(d / length) + side * (2.0 + k * .56);
        const x = start.x + dx * (d + k * .52) - dz * lateral;
        const z = start.z + dz * (d + k * .52) + dx * lateral;
        if (Math.hypot(x,z-1.2) < 3.4 || (x > 0 && z > 0 && Math.abs(x-z)<2.1)) continue;
        centers.push(x, world.heightAt(x,z) - .07, z);
        variants.push((leg + k + Math.floor(d / 7)) % 2);
        sizes.push(1.02 + .50 * Math.cos(d + k) + (leg === 0 ? .28 : 0));
      }
    }
  }
  return createPlantBatch(scene, loader, centers, variants, sizes, new URL('../../assets/trail-flowers.webp', import.meta.url), 2, 1, .89);
}

export function createPlantBatch(scene, loader, centers, variants, sizes, texture, columns, width, cutoff) {
  const base = new THREE.PlaneGeometry(1, 1, 1, 3);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.attributes = { ...base.attributes };
  geometry.setAttribute('center', new THREE.InstancedBufferAttribute(new Float32Array(centers), 3));
  geometry.setAttribute('species', new THREE.InstancedBufferAttribute(new Float32Array(variants), 1));
  geometry.setAttribute('size', new THREE.InstancedBufferAttribute(new Float32Array(sizes), 1));
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { atlas: { value: null }, t: { value: 0 }, daylight: { value: 1 } },
    vertexShader: `attribute vec3 center; attribute float species,size; uniform float t;
      varying vec2 vUv; void main(){
        vec3 right=vec3(viewMatrix[0][0],0.,viewMatrix[2][0]);
        float bend=sin(t*1.45+center.x*.6+center.z*.35)*.065*uv.y*uv.y;
        vec3 p=center+normalize(right)*(position.x+bend)*size*${width.toFixed(3)}+vec3(0.,uv.y*size,0.);
        vUv=vec2((uv.x+species)/${columns.toFixed(1)},uv.y);gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);
      }`,
    fragmentShader: `uniform sampler2D atlas;uniform float daylight;varying vec2 vUv;
      void main(){vec4 c=texture2D(atlas,vUv); if(c.a<${cutoff.toFixed(2)} || (c.a<.97 && min(c.r,min(c.g,c.b))>.78))discard;
      gl_FragColor=vec4(c.rgb*daylight,1.);
      #include <colorspace_fragment>
      }`
  });
  const batch = new THREE.Mesh(geometry,material);
  batch.frustumCulled = false;
  batch.visible = false;
  scene.add(batch);
  loader.load(texture.href, map => {
    map.colorSpace = THREE.SRGBColorSpace;
    material.uniforms.atlas.value = map;
    batch.visible = true;
  });
  return (time, night) => {
    material.uniforms.t.value = time;
    material.uniforms.daylight.value = 1 - night * .75;
  };
}
