import * as pdfjsLib from '/pdfjs/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';

const socket = io();
let pdf = null, slide = 1, rendering = false, pending = null;
let currentTransition = 'fade', transitionDuration = 300;

async function load() {
  pdf = await pdfjsLib.getDocument({ url: `/current.pdf?t=${Date.now()}` }).promise;
  document.getElementById('empty')?.remove();
  const targetSlide = pending ? pending.n : slide;
  pending = null;
  await render(targetSlide, false);
}

async function render(n, animate = true) {
  if (!pdf) {
    pending = { n, animate };
    return;
  }
  if (rendering) {
    pending = { n, animate };
    return;
  }
  rendering = true;

  try {
    slide = Math.max(1, Math.min(pdf.numPages, n));
    const page = await pdf.getPage(slide);
    const box = { w: window.innerWidth, h: window.innerHeight };
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(box.w / base.width, box.h / base.height);
    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;

    const newCanvas = document.createElement('canvas');
    newCanvas.className = 'slide-canvas';
    newCanvas.width = Math.floor(viewport.width * dpr);
    newCanvas.height = Math.floor(viewport.height * dpr);
    newCanvas.style.width = `${viewport.width}px`;
    newCanvas.style.height = `${viewport.height}px`;

    const oldCanvases = Array.from(document.querySelectorAll('canvas.slide-canvas'));
    const shouldFade = animate && currentTransition === 'fade' && oldCanvases.length > 0;

    if (shouldFade) {
      newCanvas.style.opacity = '0';
      newCanvas.style.transition = `opacity ${transitionDuration}ms ease-in-out`;
      newCanvas.style.zIndex = '2';
      oldCanvases.forEach(c => { c.style.zIndex = '1'; });
    } else {
      newCanvas.style.opacity = '1';
    }

    document.body.appendChild(newCanvas);

    await page.render({
      canvasContext: newCanvas.getContext('2d'),
      viewport: page.getViewport({ scale: scale * dpr })
    }).promise;

    if (shouldFade) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          newCanvas.style.opacity = '1';
          setTimeout(() => {
            oldCanvases.forEach(c => c.remove());
          }, transitionDuration + 50);
        });
      });
    } else {
      oldCanvases.forEach(c => c.remove());
    }
  } catch (e) {
    console.error(e);
  } finally {
    rendering = false;
    if (pending !== null) {
      const p = pending;
      pending = null;
      render(p.n, p.animate);
    }
  }
}

socket.on('presentation-loaded', async state => {
  if (state.transition) currentTransition = state.transition;
  if (state.duration) transitionDuration = state.duration;
  if (state.slide) slide = state.slide;
  if (state.ready) {
    try {
      await load();
    } catch (e) {
      console.error(e);
    }
  }
});

socket.on('slide-changed', state => {
  if (state.transition) currentTransition = state.transition;
  if (state.duration) transitionDuration = state.duration;
  if (state.ready) {
    render(state.slide, true);
  }
});

socket.on('transition-changed', state => {
  if (state.transition) currentTransition = state.transition;
  if (state.duration) transitionDuration = state.duration;
});

window.addEventListener('resize', () => render(slide, false));
