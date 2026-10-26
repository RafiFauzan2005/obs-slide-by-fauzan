import * as pdfjsLib from '/pdfjs/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
const socket = io(); let pdf=null, slide=1, rendering=false, pending=null;
async function load() { pdf = await pdfjsLib.getDocument({url:`/current.pdf?t=${Date.now()}`}).promise; document.getElementById('empty')?.remove(); await render(slide); }
async function render(n) {
 if (!pdf) { pending=n; return; }
 if (rendering) { pending=n; return; }
 rendering=true;
 try {
  slide=Math.max(1,Math.min(pdf.numPages,n)); const page=await pdf.getPage(slide);
  const box={w:window.innerWidth,h:window.innerHeight}; const base=page.getViewport({scale:1}); const scale=Math.min(box.w/base.width,box.h/base.height);
  const viewport=page.getViewport({scale}); const canvas=document.querySelector('canvas')||document.body.appendChild(document.createElement('canvas'));
  const dpr=window.devicePixelRatio||1; canvas.width=Math.floor(viewport.width*dpr); canvas.height=Math.floor(viewport.height*dpr); canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;
  await page.render({canvasContext:canvas.getContext('2d'),viewport:page.getViewport({scale:scale*dpr})}).promise;
 } catch(e) { console.error(e); }
 finally { rendering=false; if(pending!==null){const p=pending;pending=null;render(p);} }
}
socket.on('presentation-loaded', async state=>{if(state.ready){try{await load();}catch(e){console.error(e)}}});
socket.on('slide-changed', state=>{if(state.ready)render(state.slide)});
window.addEventListener('resize',()=>render(slide));
