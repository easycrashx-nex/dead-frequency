// Recovery cannot depend on the game's frame loop: that loop may have failed.
// Every new controller must first be released before A / Cross can restart.
export function createRecoveryInput({
  onConfirm,
  getGamepads=()=>navigator.getGamepads?.()||[],
  requestFrame=callback=>requestAnimationFrame(callback),
  cancelFrame=id=>cancelAnimationFrame(id),
  isEnabled=()=>true,
}={}) {
  const controllers=new Map();
  let disposed=false,frameId;
  function frame(){
    if(disposed)return;
    let pads=[];
    try{pads=getGamepads();}catch{/* A temporarily unavailable device is neutralized. */}
    const present=new Set();
    let confirm=false;
    if(!isEnabled())controllers.clear();
    else for(const pad of pads||[]){
      if(!pad||pad.connected===false||pad.mapping!=='standard')continue;
      const key=`${pad.index}:${pad.id}`,previous=controllers.get(key)||{armed:false,down:false};
      const down=!!pad.buttons?.[0]?.pressed||pad.buttons?.[0]?.value>.5;
      const neutral=Array.from(pad.axes||[]).every(value=>Number.isFinite(value)&&Math.abs(value)<=.2)
        &&Array.from(pad.buttons||[]).every(button=>!button?.pressed&&!(button?.value>.2));
      present.add(key);
      if(neutral)previous.armed=true;
      if(previous.armed&&down&&!previous.down){confirm=true;previous.armed=false;}
      previous.down=down;controllers.set(key,previous);
    }
    for(const key of controllers.keys())if(!present.has(key))controllers.delete(key);
    frameId=requestFrame(frame);
    if(confirm)onConfirm?.();
  }
  frameId=requestFrame(frame);
  return {dispose(){if(disposed)return;disposed=true;cancelFrame(frameId);controllers.clear();}};
}
