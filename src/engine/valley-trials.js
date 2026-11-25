import * as THREE from 'three';

// Optional courses use the same posts and decks as the main journey.
export function createValleyTrials(scene, world, abilities, report) {
  const gates = Array.from({length:4}, (_,i) => {
    const x=-65+i*6,z=-54-i*3.7;
    return {x,z,y:world.heightAt(x,z)};
  });
  const decks=world.levels.islands;
  const courses=[
    {id:'arcade',name:'石廊穿梭',ability:'multiPlant',x:-70,z:-51,
      goals:gates.map((g,i)=>({...g, label:'穿过第'+(i+1)+'道门梁'}))},
    {id:'cloud',name:'云台接力',ability:'lift',x:decks[0].x-7,z:decks[0].z+2,
      goals:decks.map((d,i)=>({x:d.x,z:d.z,y:d.top,label:'落在第'+(i+1)+'座岩台'}))}
  ];
  const cloth=new THREE.MeshStandardMaterial({color:'#df9b64',side:THREE.DoubleSide});
  const wood=new THREE.MeshStandardMaterial({color:'#775b42'});
  const flag=new THREE.Shape();
  flag.moveTo(0,0);flag.lineTo(1.3,-.28);flag.lineTo(.1,-.84);flag.closePath();
  const banner=new THREE.ShapeGeometry(flag);
  for(const course of courses){
    const y=world.heightAt(course.x,course.z);
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.06,.1,2.7,7),wood);
    pole.position.set(course.x,y+1.35,course.z);
    scene.add(pole);
    const pennant=new THREE.Mesh(banner,cloth);
    pennant.position.set(course.x,y+2.6,course.z);
    scene.add(pennant);
  }
  let active=null, nearby=null, step=0, start=0;
  const clock=s=>s.toFixed(1)+' 秒';
  function toggle(t){
    if(active){active=null;report('试炼已结束 · 可以回旗杆重试');return;}
    if(nearby){active=nearby;step=0;start=t;report(active.name+' · 出发');}
  }
  function update(t,player,ui){
    const p=player.root.position;
    nearby=courses.find(c=>abilities.has(c.ability) && Math.hypot(p.x-c.x,p.z-c.z)<5) || null;
    ui.trialAction=active?'退出试炼':nearby?'挑战 · '+nearby.name:'';
    if(!active){
      const best=nearby && abilities.state.settings['best-'+nearby.id];
      ui.trialStatus=best?'个人最快 '+clock(best):'';
      return;
    }
    const goal=active.goals[step];
    const distance=Math.hypot(p.x-goal.x,p.z-goal.z);
    if(distance < (active.id==='arcade'?1.7:3) && !player.airborne && Math.abs(p.y-goal.y-.64)<.45){
      step++;
      if(step===active.goals.length){
        const duration=t-start, key='best-'+active.id;
        const best=abilities.state.settings[key];
        if(!best || duration<best){abilities.state.settings[key]=duration;abilities.save();}
        report(active.name+'完成 · '+clock(duration)+' · 最快 '+clock(abilities.state.settings[key]));
        active=null;ui.trialAction='';ui.trialStatus='';return;
      }
      report('路标 '+step+'/'+active.goals.length);
    }
    const next=active.goals[step];
    ui.trialStatus=next.label+' · '+Math.round(Math.hypot(p.x-next.x,p.z-next.z))+' 米 · '+clock(t-start);
  }
  return {update,toggle};
}
