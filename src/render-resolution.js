// Bound color/depth/MSAA buffers independently of Windows DPI and render scale.
// A slider must never request a framebuffer larger than the driver or budget.
export const MAX_RENDER_PIXELS = 3840 * 2160;
export const MAX_RENDER_EDGE = 4096;
const finite = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
export function renderResolution({width,height,devicePixelRatio=1,quality='high',renderScale=1,maxDimension=MAX_RENDER_EDGE}) {
  width=Math.max(1,Math.round(finite(width,1)));height=Math.max(1,Math.round(finite(height,1)));
  const scale=Math.min(1.5,Math.max(.5,finite(renderScale,1)));
  const requestedRatio=Math.min(finite(devicePixelRatio,1),quality==='high'?1.5:quality==='medium'?1.15:.85)*scale;
  const edge=Math.min(MAX_RENDER_EDGE,finite(maxDimension,MAX_RENDER_EDGE));
  const ratio=Math.min(requestedRatio,edge/width,edge/height,Math.sqrt(MAX_RENDER_PIXELS/(width*height)));
  return {width,height,ratio,requestedRatio,pixelWidth:Math.max(1,Math.floor(width*ratio)),pixelHeight:Math.max(1,Math.floor(height*ratio)),limited:ratio<requestedRatio-.0001};
}

export function applyRenderResolution(renderer,next,previous) {
  if(previous?.width===next.width&&previous?.height===next.height&&previous?.ratio===next.ratio)return previous;
  // Atomic size + ratio avoids setPixelRatio allocating at the OLD window size.
  renderer.setDrawingBufferSize(next.width,next.height,next.ratio);
  return next;
}
