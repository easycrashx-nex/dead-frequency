import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('../qa-soak');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[],samples=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto('http://127.0.0.1:5195/?qa=1');await page.waitForFunction(()=>window.__DF);
  await page.locator('#start-raid').click();await page.waitForFunction(()=>document.pointerLockElement);
  await page.evaluate(()=>{const d=window.__DF;d.game.teleport(-57,57);d.state.player.yaw=-Math.PI/4;d.state.player.pitch=-.02;d.syncLook();});
  await page.waitForTimeout(1500);
  const initial=await page.evaluate(()=>({time:window.__DF.state.raid.timeLeft,...window.__DF.stats()}));
  await page.evaluate(()=>{window.__frameTimes=[];let previous=performance.now();const sample=now=>{window.__frameTimes.push(now-previous);previous=now;if(window.__frameTimes.length<10000)requestAnimationFrame(sample);};requestAnimationFrame(sample);});
  const start=performance.now();
  for(let i=0;i<12;i++){
    await page.waitForTimeout(5000);
    const sample=await page.evaluate(()=>({phase:window.__DF.state.phase,time:window.__DF.state.raid.timeLeft,enemies:window.__DF.state.enemies.filter(e=>!e.dead).length,...window.__DF.stats()}));
    assert.equal(sample.phase,'raid');assert.equal(sample.enemies,11);samples.push(sample);
    if((i+1)%4===0)console.log(`Soak: ${(i+1)*5} seconds, ${sample.geometries} geometries, ${sample.textures} textures`);
  }
  const elapsed=(performance.now()-start)/1000,advanced=initial.time-samples.at(-1).time;
  assert.ok(Math.abs(elapsed-advanced)<2,`Simulation ${advanced}s versus wall ${elapsed}s`);
  assert.ok(samples.at(-1).geometries<=samples[0].geometries+4);assert.equal(samples.at(-1).textures,samples[0].textures);assert.deepEqual(errors,[]);
  const frameTimes=await page.evaluate(()=>window.__frameTimes.filter(v=>v>0).sort((a,b)=>a-b));
  const mean=frameTimes.reduce((a,b)=>a+b,0)/frameTimes.length;
  await page.screenshot({path:path.join(out,'60-seconds.png')});
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({elapsed,simulationSeconds:advanced,renderer:'Chromium headless, D3D11, 1440x900, high',meanFps:1000/mean,p95FrameMs:frameTimes[Math.floor(frameTimes.length*.95)],samples,errors},null,2));
  console.log('PASS 60-second 1x active raid, 11 live bots, stable GPU resources, no errors');
}catch(error){await fs.writeFile(path.join(out,'result.json'),JSON.stringify({samples,errors,failure:String(error.stack)},null,2));throw error;}
finally{await browser.close();}
