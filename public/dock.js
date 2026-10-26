import * as pdfjsLib from '/pdfjs/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
const $ = id => document.getElementById(id);
const socket = io();
let pdf = null, currentSlide = 1, total = 0, fileName = '';
const status = (msg, error=false) => { $('status').textContent = msg; $('status').style.color = error ? '#fca5a5' : ''; };
$('file').addEventListener('change', () => { $('filename').textContent = $('file').files[0]?.name || 'Belum ada file dipilih'; });
$('upload').addEventListener('click', async () => {
 const file = $('file').files[0]; if (!file) return status('Pilih file PDF/PPT/PPTX dulu.', true);
 const button = $('upload'); button.disabled = true; status('Mengunggah dan memproses file…');
 try {
  const form = new FormData(); form.append('presentation', file);
  const response = await fetch('/api/upload', { method:'POST', body:form });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Upload gagal');
  await loadPdf(data.state.fileName); status('Presentasi siap ditampilkan.');
 } catch (e) { status(e.message, true); } finally { button.disabled = false; }
});
async function loadPdf(name) {
 pdf = await pdfjsLib.getDocument({ url: `/current.pdf?t=${Date.now()}` }).promise;
 total = pdf.numPages; currentSlide = 1; fileName = name || 'Presentasi';
 $('fileLabel').textContent = fileName; $('jumpNumber').max = total;
 await renderThumbs(); await showSlide(1);
 socket.emit('dock-ready', { total });
}
async function renderPage(pageNo, canvas, maxWidth) {
 const page = await pdf.getPage(pageNo); const base = page.getViewport({scale:1});
 const scale = maxWidth / base.width; const viewport = page.getViewport({scale});
 canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
 await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
}
async function renderThumbs() {
 const wrap = $('thumbs'); wrap.replaceChildren();
 for (let n=1;n<=total;n++) {
  const btn = document.createElement('button'); btn.className = 'thumb' + (n===currentSlide?' active':''); btn.title = `Slide ${n}`;
  const canvas = document.createElement('canvas'); const label = document.createElement('span'); label.textContent = n;
  btn.append(canvas,label); btn.addEventListener('click',()=>go(n)); wrap.append(btn);
  renderPage(n,canvas,260).catch(()=>{});
 }
}
async function showSlide(n) {
 if (!pdf) return;
 currentSlide = Math.max(1, Math.min(total, n));
 const old = $('preview').querySelector('canvas'); if (old) old.remove(); else $('preview').textContent='';
 const canvas = document.createElement('canvas'); $('preview').append(canvas);
 await renderPage(currentSlide,canvas,1200);
 $('slideLabel').textContent = `Slide ${currentSlide} / ${total}`; $('jumpNumber').value=currentSlide;
 [...$('thumbs').children].forEach((el,i)=>el.classList.toggle('active',i+1===currentSlide));
}
async function go(n) {
 if (!total) return;
 const target = Math.max(1,Math.min(total,Number(n)||1));
 try { const r=await fetch('/api/slide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slide:target})}); const d=await r.json(); if(!r.ok) throw new Error(d.error); currentSlide=d.state.slide; await showSlide(currentSlide); } catch(e) { status(e.message,true); }
}
$('prev').addEventListener('click',()=>go(currentSlide-1)); $('next').addEventListener('click',()=>go(currentSlide+1));
$('jump').addEventListener('click',()=>go($('jumpNumber').value)); $('jumpNumber').addEventListener('keydown',e=>{if(e.key==='Enter')go(e.target.value)});
window.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))return;if(e.key==='ArrowRight')go(currentSlide+1);if(e.key==='ArrowLeft')go(currentSlide-1)});
socket.on('presentation-loaded', async state => { if(state.ready && (!pdf || state.fileName!==fileName)) { try { await loadPdf(state.fileName); } catch(e) { status('Tidak bisa membaca PDF hasil konversi: '+e.message,true); } } });
socket.on('slide-changed', async state => { if(state.ready && state.slide && state.slide!==currentSlide && pdf) await showSlide(state.slide); });
