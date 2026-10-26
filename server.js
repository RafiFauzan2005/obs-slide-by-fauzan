const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const multer = require('multer');
const { Server } = require('socket.io');

const execFileAsync = promisify(execFile);
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT || 3210);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(ROOT, 'uploads');
const CURRENT_PDF = path.join(UPLOADS, 'current.pdf');
fs.mkdirSync(UPLOADS, { recursive: true });

let state = { ready: false, fileName: '', total: 0, slide: 1, updatedAt: Date.now() };
const upload = multer({
  dest: UPLOADS,
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.pdf', '.ppt', '.pptx'].includes(ext));
  }
});

app.use(express.json({ limit: '1mb' }));
app.use('/pdfjs', express.static(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build')));
app.use(express.static(PUBLIC));
app.get('/api/state', (_req, res) => res.json(state));
app.get('/current.pdf', (_req, res) => {
  if (!state.ready || !fs.existsSync(CURRENT_PDF)) return res.status(404).send('Belum ada presentasi. Upload PDF/PPT terlebih dahulu.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(CURRENT_PDF);
});

app.post('/api/upload', upload.single('presentation'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Pilih file PDF, PPT, atau PPTX.' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  const safeName = path.basename(req.file.originalname).replace(/[\\/:*?"<>|]/g, '_');
  try {
    if (ext === '.pdf') {
      fs.copyFileSync(req.file.path, CURRENT_PDF);
    } else {
      const tempDir = path.join(os.tmpdir(), `obs-ppt-${crypto.randomUUID()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      const inputPath = path.join(tempDir, safeName);
      fs.copyFileSync(req.file.path, inputPath);
      let converted = false;
      const candidates = process.platform === 'win32'
        ? ['soffice.exe', 'soffice', 'libreoffice']
        : ['libreoffice', 'soffice'];
      let lastError;
      for (const bin of candidates) {
        try {
          await execFileAsync(bin, ['--headless', '--convert-to', 'pdf', '--outdir', tempDir, inputPath], { timeout: 120000, windowsHide: true });
          converted = fs.existsSync(path.join(tempDir, path.parse(safeName).name + '.pdf'));
          if (converted) break;
        } catch (e) { lastError = e; }
      }
      if (!converted) throw new Error('Konversi PPT gagal. Pastikan LibreOffice terpasang dan perintah soffice tersedia. ' + (lastError?.message || ''));
      fs.copyFileSync(path.join(tempDir, path.parse(safeName).name + '.pdf'), CURRENT_PDF);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    state = { ready: true, fileName: safeName, total: 0, slide: 1, updatedAt: Date.now() };
    io.emit('presentation-loaded', state);
    res.json({ ok: true, state });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Gagal memproses file.' });
  } finally {
    fs.rmSync(req.file.path, { force: true });
  }
});

app.post('/api/slide', (req, res) => {
  const slide = Number.parseInt(req.body?.slide, 10);
  if (!state.ready) return res.status(409).json({ error: 'Belum ada presentasi.' });
  if (!Number.isInteger(slide) || slide < 1) return res.status(400).json({ error: 'Nomor slide tidak valid.' });
  state.slide = state.total ? Math.min(slide, state.total) : slide;
  state.updatedAt = Date.now();
  io.emit('slide-changed', state);
  res.json({ ok: true, state });
});

io.on('connection', socket => {
  socket.emit('presentation-loaded', state);
  socket.emit('slide-changed', state);
  socket.on('dock-ready', payload => {
    const total = Number.parseInt(payload?.total, 10);
    if (state.ready && Number.isInteger(total) && total > 0) {
      state.total = total;
      state.slide = Math.min(state.slide, total);
      io.emit('presentation-loaded', state);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`OBS Presentation Dock running: http://127.0.0.1:${PORT}/dock.html`);
  console.log(`OBS Browser Source URL: http://127.0.0.1:${PORT}/output.html`);
});
