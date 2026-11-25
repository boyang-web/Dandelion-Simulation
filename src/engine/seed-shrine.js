import * as THREE from 'three';

const TAU=Math.PI*2;

// Petals share a folded surface. The mouth stays open for arriving seeds.
function petalGeometry() {
  const positions=[], indices=[];
  for(let row=0;row<=10;row++){
    const t=row/10,w=.37*Math.pow(Math.sin(Math.PI*t),.68)+.018;
    for(const side of [-1,0,1]) positions.push(side*w,-.56+t*1.12,
      .16+t*t*.58 + (1-Math.abs(side))*.13*Math.sin(Math.PI*t));
    if(row) for(let i=0;i<2;i++){
      const k=row*3+i;
      indices.push(k-3,k-2,k,k-2,k+1,k);
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setIndex(indices);g.computeVertexNormals();return g;
}
const petal=petalGeometry();
const tones={oldTree:'#e9bf69',windmill:'#d49f57',updraft:'#8dd7c6',skyGarden:'#c0a6ec',spring:'#88cbe4',sundial:'#ffc870'};

export function createShrine(id) {
  const core=new THREE.Mesh(new THREE.IcosahedronGeometry(.19,1),
    new THREE.MeshBasicMaterial({color:tones[id]}));
  const data=core.userData;
  data.total=0;data.bloom=-1;data.pulse=0;
  const enamel=new THREE.MeshStandardMaterial({color:tones[id],emissive:tones[id],
    emissiveIntensity:.14,roughness:.45,metalness:.22,side:THREE.DoubleSide});
  const petals=[];
  for(let i=0;i<7;i++){
    const hinge=new THREE.Group();
    hinge.rotation.y=i*TAU/7;
    const blade=new THREE.Mesh(petal,enamel);
    hinge.add(blade);core.add(hinge);petals.push(blade);
  }
  const randoms=new Float32Array(64*3);
  for(let i=0;i<64;i++) randoms.set([i/64,(i*.618034)%1,(i*.414214)%1],i*3);
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(randoms,3));
  const light=new THREE.ShaderMaterial({
    uniforms:{age:{value:0},tint:{value:new THREE.Color(tones[id])}},
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    vertexShader:`uniform float age; varying float glow;
    void main(){float t=clamp((age-position.y*.32)/1.6,0.,1.);
      float a=position.x*6.283+t*2.7;float r=.3+sin(t*2.)*(1.+2.5*position.z);
      vec3 p=vec3(cos(a)*r, t*(2.+position.y*3.),sin(a)*r);
      vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;
      gl_PointSize=clamp(82./max(1.,-v.z),2.,13.);glow=sin(t*3.14159);}`,
    fragmentShader:`uniform vec3 tint;varying float glow;
    void main(){float d=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(tint,glow*pow(max(0.,1.-d),1.6));}`
  });
  const motes=new THREE.Points(geo,light);motes.frustumCulled=false;core.add(motes);
  // Three tapered sheets of light rise in sequence behind the seed head.
  const strip=new THREE.PlaneGeometry(1,1,1,36);
  const veils=[];
  for(let i=0;i<3;i++){
    const mat=new THREE.ShaderMaterial({
      uniforms:{phase:{value:i*TAU/3},age:{value:0},tint:{value:new THREE.Color(tones[id])}},
      transparent:true,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:`varying vec2 tex;uniform float phase,age;
      void main(){tex=uv;float h=uv.y;float a=phase+h*4.7+age*.9;
        float r=.24+sin(h*2.5)*(.85+age*.35)+(uv.x-.5)*.32*sin(h*3.14);
        vec3 p=vec3(cos(a)*r,h*4.2-.35,sin(a)*r);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
      fragmentShader:`varying vec2 tex;uniform float age;uniform vec3 tint;
      void main(){float wave=pow(max(0.,1.-abs(tex.y-age*.65+.1)*2.8),2.);
        float silk=sin(tex.x*3.14159)*wave*sin(tex.y*3.14159);
        gl_FragColor=vec4(mix(tint,vec3(1.),.4*wave),silk*.8);}`
    });
    const ribbon=new THREE.Mesh(strip,mat);
    ribbon.frustumCulled=false;ribbon.visible=false;core.add(ribbon);veils.push(ribbon);
  }
  data.update=(t,dt,fraction)=>{
    data.pulse=Math.max(0,data.pulse-dt*2);
    if(data.bloom>=0)data.bloom+=dt;
    const open=data.bloom>=0?Math.min(1,data.bloom):fraction*.55;
    petals.forEach((blade,i)=>{blade.rotation.x=.12+open*.95+.045*Math.sin(t*2+i);});
    enamel.emissiveIntensity=.18+fraction*.45+data.pulse*1.4;
    motes.visible=data.bloom>=0 && data.bloom<2;
    light.uniforms.age.value=data.bloom;
    for(const ribbon of veils){
      ribbon.visible=motes.visible;
      ribbon.material.uniforms.age.value=data.bloom;
    }
  };
  return core;
}
