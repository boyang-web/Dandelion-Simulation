import * as THREE from 'three';
import { ROUTE } from './wind-route.js';

const ISLANDS = [[30,-72,6,4.4],[49,-44,12,4.8],[ROUTE.skyGarden.x,ROUTE.skyGarden.z,19,5.8]];
const BEDS = [[-4,2],[4,2],[0,-4.6]];
export const SEED_GOALS = {oldTree:5, windmill:9, updraft:12, skyGarden:12, spring:10, sundial:18};

// The same dimensions drive the meshes, movement contacts and picking.
export function createValleyLevels(scene, world) {
  const solids = [];
  const islands = [];
  const rock = new THREE.MeshStandardMaterial({color:'#8e8073',flatShading:true,roughness:.96});
  const cliff = new THREE.MeshStandardMaterial({color:'#d5c9b5',emissive:'#84817a',emissiveIntensity:.24,roughness:.98});
  // Sample the exposed sandstone band of the island painting on real rock faces.
  new THREE.TextureLoader().load(new URL('../../assets/wind-island.webp',import.meta.url).href,map=>{
    map.colorSpace=THREE.SRGBColorSpace;
    map.offset.set(.27,.36);map.repeat.set(.42,.17);
    cliff.map=map;cliff.emissiveMap=map;cliff.needsUpdate=true;
  });
  const moss = new THREE.MeshStandardMaterial({color:'#869860',roughness:1});
  const wood = new THREE.MeshStandardMaterial({color:'#806244',roughness:.95});
  function addMesh(geometry,material,x,y,z) {
    const mesh = new THREE.Mesh(geometry,material);
    mesh.position.set(x,y,z);
    scene.add(mesh);
    return mesh;
  }
  function pillar(x,z,r,h,material) {
    const y=world.heightAt(x,z);
    addMesh(new THREE.CylinderGeometry(r*.88,r,h,9),material,x,y+h/2,z);
    solids.push({x,z,r,low:y-.2,high:y+h});
  }
  for (const [x,z,h,r] of ISLANDS) {
    const top = world.heightAt(x,z)+h;
    const cap = addMesh(new THREE.CylinderGeometry(r,r*.96,.55,32),moss,x,top-.275,z);
    addMesh(new THREE.CylinderGeometry(r*.96,r*.61,2.3,32),cliff,x,top-1.7,z);
    addMesh(new THREE.ConeGeometry(r*.62,2.6,16),cliff,x,top-4.1,z).rotation.z=Math.PI;
    const beacon = addMesh(new THREE.OctahedronGeometry(.46),
      new THREE.MeshBasicMaterial({color:'#e3c67e'}),x-2.2,top+1.4,z-1);
    addMesh(new THREE.CylinderGeometry(.52,.7,.8,6),rock,x-2.2,top+.4,z-1);
    // Broken strata and trailing roots follow each ledge, leaving the turf clear.
    for (let j=0;j<12;j++){
      const a=j*Math.PI/6, width=.48+.32*Math.sin(j*2.7)**2;
      const flank=addMesh(new THREE.DodecahedronGeometry(width),cliff,x+Math.cos(a)*r*.86,
        top-1.2-.55*Math.sin(j*1.7),z+Math.sin(a)*r*.86);
      flank.scale.set(1.4,.8,1);
      if(j%3===0){
        const rx=x+Math.cos(a)*r*.88,rz=z+Math.sin(a)*r*.88;
        const vine=new THREE.CatmullRomCurve3([
          new THREE.Vector3(rx,top-.15,rz),new THREE.Vector3(rx+.3,top-1.2,rz+.18),
          new THREE.Vector3(rx-.2,top-2.6,rz+.1),new THREE.Vector3(rx+.28,top-3.6,rz-.15)]);
        scene.add(new THREE.Mesh(new THREE.TubeGeometry(vine,12,.065,5,false),moss));
      }
    }
    islands.push({x,z,r,top,cap,beacon});
  }
  for (const [id,r,h] of [['oldTree',1,4],['windmill',1.5,6]]) {
    const {x,z}=ROUTE[id], y=world.heightAt(x,z);
    solids.push({x,z,r,low:y-.4,high:y+h});
  }
  // A ruined arcade on the road to the nursery gives the roll a slalom.
  for (let i=0;i<4;i++) {
    const x=-65+i*6,z=-54-i*3.7;
    for (const side of [-1,1]) pillar(x+side*2.8,z,.64,3.2,rock);
    addMesh(new THREE.BoxGeometry(6.7,.58,1.15),wood,x,world.heightAt(x,z)+3.36,z);
    solids.push({x,z,hx:3.35,hz:.58,low:world.heightAt(x,z)+3.07,high:world.heightAt(x,z)+3.65});
  }
  const beds=BEDS.map(([dx,dz],index)=>{
    const x=ROUTE.updraft.x+dx,z=ROUTE.updraft.z+dz,y=world.heightAt(x,z);
    const soil=addMesh(new THREE.CylinderGeometry(1.6,1.8,.24,6),
      new THREE.MeshStandardMaterial({color:'#795a3e',emissive:'#261700'}),x,y+.09,z);
    for (let j=0;j<3;j++) {
      const a=j*2.095+.3;
      addMesh(new THREE.OctahedronGeometry(.24),rock,x+Math.cos(a)*1.5,y+.24,z+Math.sin(a)*1.5);
    }
    const marker=new THREE.MeshBasicMaterial({color:'#efc17c'});
    for(let n=0;n<=index;n++){
      addMesh(new THREE.BoxGeometry(.1,.72,.16),marker,x+.22*(n-index/2),y+.78,z-1.48);
    }
    return {x,z,soil};
  });
  function islandAt(x,z) { return islands.find(i=>Math.hypot(x-i.x,z-i.z)<i.r-.18); }
  function floor(x,z,feet) {
    const island=islandAt(x,z);
    return island && feet>=island.top-.14 ? island.top : world.heightAt(x,z);
  }
  function undersideAt(i,x,z) {
    const f=Math.min(1,Math.max(0,Math.hypot(i.x-x,i.z-z)-.42)/i.r);
    if(f<=.62) return i.top-5.4+2.6*f/.62;
    if(f<=.96) return i.top-2.85+2.3*(f-.62)/.34;
    return i.top-.55;
  }
  function blocked(x,z,center) {
    const inside=solids.some(s=>center+.5>s.low && center-.48<s.high &&
      (s.r ? Math.hypot(x-s.x,z-s.z)<s.r+.43 : Math.abs(x-s.x)<s.hx+.43 && Math.abs(z-s.z)<s.hz+.43));
    if (inside) return true;
    return islands.some(i=>Math.hypot(x-i.x,z-i.z)<i.r+.15 &&
      center+.4>undersideAt(i,x,z) && center-.64<i.top-.15);
  }
  function ceiling(x,z,center) {
    let limit=Infinity;
    for (const i of islands) {
      if(Math.hypot(x-i.x,z-i.z)>i.r+.15) continue;
      const bottom=undersideAt(i,x,z);
      if(center<bottom) limit=Math.min(limit,bottom-.42);
    }
    for (const s of solids) if(s.hx && Math.abs(x-s.x)<s.hx+.43 && Math.abs(z-s.z)<s.hz+.43 && center<s.low) limit=Math.min(limit,s.low-.5);
    return limit;
  }
  return {solids,islands,beds,islandAt,floor,blocked,ceiling};
}
