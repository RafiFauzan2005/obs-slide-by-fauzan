import * as pdfjsLib from '/pdfjs/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';
const $ = id => document.getElementById(id);
const socket = io();
let pdf = null, currentSlide = 1, total = 0, fileName = '';
const status = (msg, error=false) => { $('status').textContent = msg; $('status').style.color = error ? '#fca5a5' : ''; };
$('file').addEventListener('change', () => { $('filename').textContent = $('file').files[0]?.name || 'Belum ada file dipilih'; });
$('upload').addEventListener('click', async () => {
 const file = $('file').files[0]; if (!file) return status('Pilih file PDF/PPT/PPTX dulu', true);
 const button = $('upload'); button.disabled = true; status('Mengunggah dan memproses file…');
 try {
  const form = new FormData(); form.append('presentation', file);
  const response = await fetch('/api/upload', { method:'POST', body:form });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Upload gagal');
  await loadPdf(data.state.fileName); status('Presentasi siap ditampilkan');
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
 const preview = $('preview');
 const oldCanvases = Array.from(preview.querySelectorAll('canvas'));
 const canvas = document.createElement('canvas');
 const useAnim = $('animToggle')?.checked ?? true;

 if (useAnim && oldCanvases.length > 0) {
  const dur = getDuration();
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.opacity = '0';
  canvas.style.transition = `opacity ${dur}ms ease-in-out`;
  canvas.style.zIndex = '2';
  oldCanvases.forEach(c => { c.style.zIndex = '1'; });
  preview.style.position = 'relative';
  preview.append(canvas);
  await renderPage(currentSlide, canvas, 1200);
  requestAnimationFrame(() => {
   requestAnimationFrame(() => {
    canvas.style.opacity = '1';
    setTimeout(() => {
     oldCanvases.forEach(c => c.remove());
    }, dur + 40);
   });
  });
 } else {
  oldCanvases.forEach(c => c.remove());
  if (preview.firstChild && preview.firstChild.tagName !== 'CANVAS') {
   preview.textContent = '';
  }
  preview.append(canvas);
  await renderPage(currentSlide, canvas, 1200);
 }

 $('slideLabel').textContent = `Slide ${currentSlide} / ${total}`;
 $('jumpNumber').value = currentSlide;
 [...$('thumbs').children].forEach((el,i)=>el.classList.toggle('active',i+1===currentSlide));
}
async function go(n) {
 if (!total) return;
 const target = Math.max(1,Math.min(total,Number(n)||1));
 const transition = $('animToggle')?.checked ? 'fade' : 'none';
 const duration = getDuration();
 try {
  const r=await fetch('/api/slide',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({slide:target, transition, duration})
  });
  const d=await r.json();
  if(!r.ok) throw new Error(d.error);
  currentSlide=d.state.slide;
  await showSlide(currentSlide);
 } catch(e) {
  status(e.message,true);
 }
}
$('prev').addEventListener('click',()=>go(currentSlide-1));
$('next').addEventListener('click',()=>go(currentSlide+1));
$('jump').addEventListener('click',()=>go($('jumpNumber').value));
$('jumpNumber').addEventListener('keydown',e=>{if(e.key==='Enter')go(e.target.value)});
window.addEventListener('keydown',e=>{
 if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))return;
 if(e.key==='ArrowRight')go(currentSlide+1);
 if(e.key==='ArrowLeft')go(currentSlide-1);
});

function getDuration() {
 const val = Number($('animDuration')?.value);
 return Math.max(50, Math.min(5000, Number.isFinite(val) && val > 0 ? val : 300));
}

function updateDurationUi() {
 const isEnabled = $('animToggle')?.checked ?? true;
 const box = $('animDurationBox');
 if (box) box.classList.toggle('disabled', !isEnabled);
}

const savedAnim = localStorage.getItem('obs_slide_anim');
if (savedAnim !== null && $('animToggle')) {
 $('animToggle').checked = (savedAnim === 'fade');
}
const savedDur = localStorage.getItem('obs_slide_duration');
if (savedDur && $('animDuration')) {
 $('animDuration').value = Number(savedDur) || 300;
}
updateDurationUi();

async function syncTransitionSettings() {
 const transition = $('animToggle')?.checked ? 'fade' : 'none';
 const duration = getDuration();
 localStorage.setItem('obs_slide_anim', transition);
 localStorage.setItem('obs_slide_duration', duration);
 socket.emit('set-transition', { transition, duration });
 try {
  await fetch('/api/transition', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ transition, duration })
  });
 } catch(err) {}
}

$('animToggle')?.addEventListener('change', () => {
 updateDurationUi();
 syncTransitionSettings();
});

$('animDuration')?.addEventListener('change', () => {
 if ($('animDuration')) $('animDuration').value = getDuration();
 syncTransitionSettings();
});

socket.on('presentation-loaded', async state => {
 if (state.transition && $('animToggle')) $('animToggle').checked = (state.transition === 'fade');
 if (state.duration && $('animDuration')) $('animDuration').value = state.duration;
 updateDurationUi();
 if(state.ready && (!pdf || state.fileName!==fileName)) {
  try {
   await loadPdf(state.fileName);
  } catch(e) {
   status('Tidak bisa membaca PDF hasil konversi: '+e.message,true);
  }
 }
});
socket.on('slide-changed', async state => {
 if (state.transition && $('animToggle')) $('animToggle').checked = (state.transition === 'fade');
 if (state.duration && $('animDuration')) $('animDuration').value = state.duration;
 updateDurationUi();
 if(state.ready && state.slide && state.slide!==currentSlide && pdf) await showSlide(state.slide);
});
socket.on('transition-changed', state => {
 if (state.transition && $('animToggle')) $('animToggle').checked = (state.transition === 'fade');
 if (state.duration && $('animDuration')) $('animDuration').value = state.duration;
 updateDurationUi();
});
