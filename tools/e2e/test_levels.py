"""Check the nursery and flight gates with the game's seed and movement physics.

The opening uses keyboard and canvas inputs. A stepped animation clock skips travel time
between checks and avoids repeatedly rendering the valley on a software GPU.
"""
from test_light import Chrome, start_server
from wind_puzzle import send_tree_seed

def main():
    server, port = start_server()
    chrome = None
    try:
        chrome = Chrome(900, 600, light=True, nice=15).start()
        chrome.connect_existing()
        chrome.ws.settimeout(90)
        chrome.navigate(f'http://127.0.0.1:{port}/game.html?reset=1&quality=low&post=0', wait_until_ready=False)
        chrome.wait_for("window.__dandy?.store.ui.ready", timeout=40)
        chrome.eval("""(()=>{const d=window.__dandy;
          window.draw=d.renderer.render.bind(d.renderer);window.drawFlies=d.fireflyRenderer.render.bind(d.fireflyRenderer);
          d.renderer.render=()=>{};d.fireflyRenderer.render=()=>{};})()""")
        send_tree_seed(chrome)
        chrome.eval("""(()=>{
          const d=window.__dandy;
          d.renderer.render=window.draw; d.fireflyRenderer.render=window.drawFlies;
          d.player.snapTo(-9,-6);
          d.requestPhoto();
        })()""")
        chrome.wait_for("window.__dandy.abilities.hasPostcard('tree')",timeout=35)
        chrome.eval("""(()=>{
          const raf=window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame=fn=>{
            if(fn.name==='animate'){window.gameFrame=fn;return 0;}
            return raf(fn);
          };
        })()""")
        chrome.wait_for("!!window.gameFrame")
        chrome.ws.settimeout(100)
        result = chrome.eval("""(()=>{
          const d=window.__dandy, p=d.player, levels=d.world.levels;
          d.renderer.render=()=>{}; d.fireflyRenderer.render=()=>{};
          let clock=performance.now();
          Object.defineProperty(performance,'now',{value:()=>clock});
          const tick=(n=1)=>{for(let i=0;i<n;i++){clock+=1000/30;gameFrame();}};
          const require=(condition,msg)=>{if(!condition)throw Error(msg);};
          const plantAt=(x,z,y=d.world.heightAt(x,z))=>d.field.spawnAt(p.root.position.clone().set(x,y,z));
          function travel(x,z,limit=400){
            for(let i=0;i<limit;i++){
              const dx=x-p.root.position.x,dz=z-p.root.position.z,dist=Math.hypot(dx,dz);
              if(dist<.2){p.setMoveInput(0,0);return;}
              const yaw=d.orbit.yaw;
              p.setMoveInput((dx*Math.cos(yaw)-dz*Math.sin(yaw))/dist,(-dx*Math.sin(yaw)-dz*Math.cos(yaw))/dist);
              tick();
            }
            throw Error('blocked on approach to '+x+','+z+' at '+p.root.position.toArray());
          }
          const mill=d.journey.habitat.eyes.windmill;
          function millPass(eye){
            const {x,z}=eye.position;
            const len=Math.hypot(x+104,z+30),nx=(x+104)/len,nz=(z+30)/len;
            plantAt(x+nx*2,z+nz*2);tick(65);
            for(let j=0;j<3 && !eye.userData.lit;j++){
              p.snapTo(x+nx*4.7,z+nz*4.7);travel(x+nx*1.2,z+nz*1.2);tick(100);
            }
          }
          millPass(mill[1]);
          require(mill[1].userData.total===0,'out-of-order bell received seeds');
          mill.forEach(millPass);
          require(d.abilities.has('multiPlant'),'three bells: '+JSON.stringify(mill.map(e=>[e.userData.total,e.userData.lit]))+' camera='+d.abilities.hasPostcard('tree'));

          const nursery=d.journey.habitat.eyes.updraft[0], beds=levels.beds;
          function pass(f){
            const dir=nursery.position.clone().sub(f.basePosition);dir.y=0;dir.normalize();
            p.snapTo(f.basePosition.x-dir.x*2.7,f.basePosition.z-dir.z*2.7);
            travel(f.basePosition.x+dir.x*.7,f.basePosition.z+dir.z*.7);tick(125);
          }
          const flowers=[plantAt(beds[0].x,beds[0].z)];
          tick(65);pass(flowers[0]);
          require(nursery.userData.total===0 && !d.abilities.has('lift'),'one plant opened nursery');
          flowers.push(plantAt(beds[1].x,beds[1].z),plantAt(beds[2].x,beds[2].z));
          tick(65);pass(flowers[0]);pass(flowers[1]);
          require(nursery.userData.total===8 && !d.abilities.has('lift'),'two sources did not contribute exactly eight');
          pass(flowers[2]);
          require(d.abilities.has('lift') && nursery.userData.total===12,'third source did not unlock flight');
          // A run is optional and the personal record survives a slower replay.
          const runArcade=()=>{
            p.snapTo(-70,-51);tick(2);d.toggleTrial();
            for(let j=0;j<4;j++){p.snapTo(-65+j*6,-54-j*3.7);tick(3);}
          };
          runArcade();
          require(d.abilities.state.settings['best-arcade']>0,'optional stone arcade did not finish');
          const blocked=d.world.levels.blocked(-104,-30,d.world.heightAt(-104,-30)+.64);
          require(blocked,'mill missing its collider');
          p.snapTo(levels.islands[0].x-7,levels.islands[0].z+2);tick(2);d.toggleTrial();
          for(const [index,island] of levels.islands.entries()){
            const approach=island.x-island.r-2;
            p.snapTo(approach,island.z);
            p.setLiftHeld(true);
            for(let i=0;i<400 && p.root.position.y<island.top+1.6;i++)tick();
            require(p.root.position.y>island.top+.7,'could not climb above island');
            travel(island.x,island.z);
            p.setLiftHeld(false);tick(150);
            require(!p.airborne && Math.abs(p.root.position.y-island.top-.64)<.15,'island has no supporting floor');
            require(d.abilities.state.settings.islandStep===index+1,'landing not recorded');
          }
          require(d.abilities.state.settings['best-cloud']>0,'air course did not record');
          const top=levels.islands[2], shrine=d.journey.habitat.eyes.skyGarden[0];
          d.orbit.pitch=.66;tick(3);
          const target=p.root.position.clone().set(top.x-2,top.top,top.z).project(d.camera);
          for(const type of ['pointerdown','pointerup']){
            d.renderer.domElement.dispatchEvent(new PointerEvent(type,{pointerId:33,pointerType:'mouse',
              isPrimary:true,button:0,clientX:(target.x+1)*innerWidth/2,clientY:(1-target.y)*innerHeight/2,bubbles:true}));
          }
          require(d.field.plants.some(f=>Math.abs(f.basePosition.y-top.top)<.1),'normal planting missed island deck');
          travel(top.x-3.4,top.z);tick(70);
          travel(top.x,top.z);tick(110);
          if(!d.anchors.isSolved('skyGarden')){travel(top.x-3.4,top.z);travel(top.x,top.z);tick(130);}
          require(d.anchors.isSolved('skyGarden') && shrine.userData.total===12,'summit delivery failed');
          travel(top.x+top.r+2,top.z);tick(170);
          require(p.root.position.y<top.top-3,'stepping off did not drop the player');
          const spring=d.journey.habitat.eyes.spring;
          function deliver(eye,lift=false){
            const {x,z}=eye.position;
            const pos=plantAt(x,z+2) || d.field.plants.find(f=>Math.hypot(f.basePosition.x-x,f.basePosition.z-z-2)<.8);
            tick(65);
            for(let round=0;round<4 && !eye.userData.lit;round++){
              p.snapTo(x,z+4.6);
              if(lift){p.setLiftHeld(true);tick(18);}
              travel(x,z+1.0);
              p.setLiftHeld(false);tick(110);
            }
          }
          deliver(spring[0]);deliver(spring[1],true);
          require(d.abilities.has('restore'),'spring not restored');
          const dial=d.journey.habitat.eyes.sundial[0];
          deliver(dial);
          require(dial.userData.total===0,'finale accepted fewer than four live flowers');
          for(const [dx,dz] of [[3,0],[-3,0],[0,-3]])plantAt(dial.position.x+dx,dial.position.z+dz);
          deliver(dial);
          require(d.abilities.has('time'),'four-plant finale did not grant time');
          d.sky.set(.45);d.sky.nudge('ArrowRight');tick(2);
          require(d.store.ui.journeyEnd.visible,'no ending after sundial alignment');
          return 'PASS tree photo, ordered bells, single-plant rejection, distinct live sources, 12 seed crossings, mill collision, three landings, summit delivery, edge fall, both timed courses, spring, four-plant finale and ending';
        })()""")
        print(result)
    finally:
        if chrome: chrome.close()
        server.terminate()

if __name__ == '__main__':
    main()
