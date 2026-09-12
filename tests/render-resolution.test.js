import test from 'node:test';
import assert from 'node:assert/strict';
import {renderResolution,applyRenderResolution,MAX_RENDER_PIXELS} from '../src/render-resolution.js';
test('4K and high-DPI supersampling remain within the framebuffer memory and driver limits',()=>{
  for(const [width,height,dpi] of [[3840,2160,2],[7680,4320,3],[1800,3200,2],[2356,1431,1.5]]){
    const size=renderResolution({width,height,devicePixelRatio:dpi,renderScale:1.5,maxDimension:4096});
    assert.ok(size.pixelWidth*size.pixelHeight<=MAX_RENDER_PIXELS);assert.ok(size.pixelWidth<=4096&&size.pixelHeight<=4096);assert.ok(size.limited);
    assert.ok(Math.abs(size.pixelWidth/size.pixelHeight-width/height)<.003);
  }
  assert.equal(renderResolution({width:3840,height:2160,maxDimension:2048}).pixelWidth,2048);
});
test('ordinary resolutions preserve user supersampling and sanitize invalid dimensions',()=>{
  assert.equal(renderResolution({width:1280,height:720,renderScale:1.5}).pixelWidth,1920);
  for(const value of [NaN,Infinity,-10,0]){const size=renderResolution({width:value,height:value,devicePixelRatio:value,renderScale:value});assert.ok(Number.isFinite(size.ratio));assert.ok(size.pixelWidth>=1&&size.pixelHeight>=1);}
});
test('resolution changes allocate once and unchanged settings allocate no framebuffer',()=>{
  const calls=[],renderer={setDrawingBufferSize:(...args)=>calls.push(args)};
  const old=renderResolution({width:1440,height:900});let applied=applyRenderResolution(renderer,old);
  applied=applyRenderResolution(renderer,old,applied);assert.equal(calls.length,1);
  const next=renderResolution({width:3840,height:2160,renderScale:1.5});applied=applyRenderResolution(renderer,next,applied);
  assert.equal(calls.length,2);assert.equal(applied,next);assert.deepEqual(calls[1],[next.width,next.height,next.ratio]);
});
