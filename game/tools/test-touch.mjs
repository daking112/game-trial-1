import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:800,height:600}, hasTouch:true, isMobile:true });
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://127.0.0.1:5173',{waitUntil:'domcontentloaded'});
await p.waitForFunction(()=>window.__game?.ready===true,{timeout:60000});
const out = await p.evaluate(async ()=>{
  const g=window.__game, cam=g.engine.camera;
  const el=g.engine.renderer.domElement;
  const dist=()=>Math.hypot(cam.position.x, cam.position.y, cam.position.z);
  const fire=(type,id,x,y)=>el.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',clientX:x,clientY:y,button:0,bubbles:true}));
  const settle=()=>{ for(let i=0;i<90;i++) g.engine.stepLogic(1/60); };

  const before=dist();
  // Two fingers, pinched inward -> should zoom out (distance grows).
  fire('pointerdown',1,300,300); fire('pointerdown',2,500,300);
  fire('pointermove',1,360,300); fire('pointermove',2,440,300);
  settle();
  const afterPinch=dist();
  fire('pointerup',1,360,300); fire('pointerup',2,440,300);

  // Single finger drag -> should orbit (azimuth changes, distance stable).
  const camX0=cam.position.x;
  fire('pointerdown',3,400,300);
  fire('pointermove',3,520,300);
  settle();
  fire('pointerup',3,520,300);
  return { before:+before.toFixed(2), afterPinch:+afterPinch.toFixed(2),
           orbitMovedX: Math.abs(cam.position.x-camX0)>0.5, touchAction: el.style.touchAction };
});
console.log(JSON.stringify(out,null,2));
console.log('errors:', errs.length?errs.slice(0,3):'none');
await b.close();
