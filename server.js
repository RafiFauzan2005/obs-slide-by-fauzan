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

// Pastikan folder uploads tersedia
fs.mkdirSync(UPLOADS, { recursive: true });

let state = {
  ready: false,
  fileName: '',
  total: 0,
  slide: 1,
  transition: 'fade',
  duration: 300,
  updatedAt: Date.now()
};

// Inisialisasi state jika current.pdf sudah ada dari sesi sebelumnya
if (fs.existsSync(CURRENT_PDF)) {
  try {
    const stat = fs.statSync(CURRENT_PDF);
    if (stat.size > 0) {
      state.ready = true;
      state.fileName = 'current.pdf';
    }
  } catch (_) {}
}

const upload = multer({
  dest: UPLOADS,
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.pdf', '.ppt', '.pptx'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Format file tidak didukung. Hanya file PDF, PPT, dan PPTX yang diperbolehkan.'));
    }
  }
});

// Mutex / antrean untuk upload bersamaan agar tidak saling menimpa
let uploadMutex = Promise.resolve();
function withUploadLock(taskFn) {
  const run = uploadMutex.then(taskFn, taskFn);
  uploadMutex = run.catch(() => {});
  return run;
}

/**
 * Pembersihan file/folder dengan mekanisme retry dan logging informatif untuk mencegah crash EPERM di Windows
 */
async function safeRemove(targetPath, maxRetries = 5, baseDelay = 150) {
  if (!targetPath) return;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (!fs.existsSync(targetPath)) return;
      await fs.promises.rm(targetPath, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100
      });
      return;
    } catch (err) {
      const isLockError = ['EPERM', 'EBUSY', 'EACCES'].includes(err.code);
      if (isLockError && attempt < maxRetries) {
        console.warn(`[Cleanup] File/folder terkunci (${err.code}), percobaan ${attempt}/${maxRetries} untuk ${targetPath}. Menunggu ${baseDelay * attempt}ms...`);
        await new Promise(resolve => setTimeout(resolve, baseDelay * attempt));
      } else {
        console.error(`[Cleanup Warning] Gagal membersihkan ${targetPath} (percobaan ${attempt}/${maxRetries}): ${err.message}`);
        if (attempt === maxRetries) break;
      }
    }
  }
}

/**
 * Validasi signature awal dan ukuran file PDF, PPT, dan PPTX
 */
function validatePresentationFile(filePath, ext) {
  if (!fs.existsSync(filePath)) {
    throw new Error('File tidak ditemukan.');
  }
  const stat = fs.statSync(filePath);
  if (stat.size === 0) {
    throw new Error('File presentasi kosong (0 byte).');
  }
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(8);
  try {
    fs.readSync(fd, buffer, 0, 8, 0);
  } finally {
    fs.closeSync(fd);
  }

  if (ext === '.pdf') {
    if (!buffer.toString('utf8', 0, 5).startsWith('%PDF-')) {
      throw new Error('File bukan PDF yang valid (header %PDF- tidak ditemukan).');
    }
  } else if (ext === '.pptx') {
    // ZIP magic bytes: PK\x03\x04
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4B || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
      throw new Error('File bukan PPTX yang valid (header ZIP/PPTX tidak valid).');
    }
  } else if (ext === '.ppt') {
    // OLE Compound Document: \xD0\xCF\x11\xE0
    if (buffer[0] !== 0xD0 || buffer[1] !== 0xCF || buffer[2] !== 0x11 || buffer[3] !== 0xE0) {
      throw new Error('File bukan PPT yang valid (header OLE2 Compound Document tidak valid).');
    }
  }
  return stat.size;
}

function validatePdfFile(filePath) {
  return validatePresentationFile(filePath, '.pdf');
}

/**
 * Daftar kandidat executable LibreOffice (lokasi standar Windows, variabel lingkungan, dan PATH)
 */
function getLibreOfficeCandidates() {
  const candidates = [];
  const seen = new Set();

  function addCandidate(binPath) {
    if (!binPath) return;
    const normalized = path.normalize(binPath);
    if (!seen.has(normalized.toLowerCase())) {
      seen.add(normalized.toLowerCase());
      candidates.push(normalized);
    }
  }

  if (process.platform === 'win32') {
    // 1. Lokasi instalasi Windows yang umum
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || '';

    const defaultWindowsPaths = [
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files\\LibreOffice\\program\\soffice.com',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com',
      path.join(programFiles, 'LibreOffice', 'program', 'soffice.exe'),
      path.join(programFiles, 'LibreOffice', 'program', 'soffice.com'),
      path.join(programFilesX86, 'LibreOffice', 'program', 'soffice.exe'),
      path.join(programFilesX86, 'LibreOffice', 'program', 'soffice.com'),
      path.join(localAppData, 'Programs', 'LibreOffice', 'program', 'soffice.exe'),
      path.join(localAppData, 'Programs', 'LibreOffice', 'program', 'soffice.com')
    ];

    // Prioritaskan yang benar-benar ada di disk
    for (const p of defaultWindowsPaths) {
      if (fs.existsSync(p)) {
        addCandidate(p);
      }
    }

    // 2. Kandidat dari PATH
    addCandidate('soffice.com');
    addCandidate('soffice.exe');
    addCandidate('soffice');
    addCandidate('libreoffice');
  } else {
    // Linux / macOS
    addCandidate('libreoffice');
    addCandidate('soffice');
    addCandidate('/usr/bin/libreoffice');
    addCandidate('/usr/bin/soffice');
    addCandidate('/Applications/LibreOffice.app/Contents/MacOS/soffice');
  }

  return candidates;
}

/**
 * Konversi file PPT/PPTX menjadi PDF menggunakan LibreOffice
 */
async function convertPptToPdf(inputPath, tempDir, baseName) {
  const candidates = getLibreOfficeCandidates();
  if (candidates.length === 0) {
    throw new Error('Tidak ada kandidat executable LibreOffice yang dapat digunakan.');
  }

  const logs = [];
  let convertedPdfPath = null;

  for (const bin of candidates) {
    try {
      // Gunakan child_process.execFile dengan argumen terpisah agar aman terhadap spasi dan karakter khusus di Windows
      const args = ['--headless', '--convert-to', 'pdf', '--outdir', tempDir, inputPath];
      const result = await execFileAsync(bin, args, {
        timeout: 120000,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024
      });

      // Periksa apakah file PDF hasil konversi terbentuk
      const expectedPdf = path.join(tempDir, `${baseName}.pdf`);
      if (fs.existsSync(expectedPdf) && fs.statSync(expectedPdf).size > 0) {
        convertedPdfPath = expectedPdf;
        break;
      }

      // Jika nama file berbeda (misal ada case conversion oleh LibreOffice), cari file .pdf apa pun di tempDir
      const foundPdf = fs.readdirSync(tempDir).find(f => f.toLowerCase().endsWith('.pdf'));
      if (foundPdf) {
        const candidatePdf = path.join(tempDir, foundPdf);
        if (fs.statSync(candidatePdf).size > 0) {
          convertedPdfPath = candidatePdf;
          break;
        }
      }

      logs.push(`[${bin}] Selesai tetapi file PDF hasil tidak ditemukan. Stdout: ${(result.stdout || '').trim() || '-'}, Stderr: ${(result.stderr || '').trim() || '-'}`);
    } catch (err) {
      const errMsg = err.message || '';
      const stderr = (err.stderr || '').trim();
      const stdout = (err.stdout || '').trim();
      logs.push(`[${bin}] Gagal (${err.code || 'ERR'}): ${errMsg}${stderr ? ' | Stderr: ' + stderr : ''}${stdout ? ' | Stdout: ' + stdout : ''}`);
    }
  }

  if (!convertedPdfPath) {
    const details = logs.join('\n');
    throw new Error(
      `Konversi PPT/PPTX ke PDF gagal. Pastikan LibreOffice terpasang dengan benar di komputer Anda.\n` +
      `Detail percobaan executable:\n${details}`
    );
  }

  // Validasi file PDF hasil konversi
  validatePdfFile(convertedPdfPath);
  return convertedPdfPath;
}

app.use(express.json({ limit: '1mb' }));
app.use('/pdfjs', express.static(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build')));
app.use(express.static(PUBLIC));

app.get('/api/state', (_req, res) => res.json(state));

app.get('/current.pdf', (_req, res) => {
  if (!state.ready || !fs.existsSync(CURRENT_PDF)) {
    return res.status(404).send('Belum ada presentasi. Upload PDF/PPT terlebih dahulu.');
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(CURRENT_PDF);
});

app.post('/api/upload', (req, res) => {
  upload.single('presentation')(req, res, async err => {
    if (err) {
      return res.status(400).json({ error: err.message || 'File upload ditolak.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Pilih file PDF, PPT, atau PPTX terlebih dahulu.' });
    }

    // Jalankan dalam lock agar upload bersamaan antre secara aman
    await withUploadLock(async () => {
      const originalName = req.file.originalname || 'presentation';
      const ext = path.extname(originalName).toLowerCase();
      const rawBase = path.basename(originalName, ext);
      // Sanitasi nama file untuk menangani spasi, tanda kurung, dan karakter khusus di Windows
      const safeBase = rawBase.replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim() || 'presentation';
      const safeFileName = `${safeBase}${ext}`;

      let tempDir = null;
      let stagedPdfPath = null;

      try {
        // Validasi tipe dan struktur file yang diunggah
        validatePresentationFile(req.file.path, ext);

        if (ext === '.pdf') {
          stagedPdfPath = path.join(UPLOADS, `staged-${crypto.randomUUID()}.pdf`);
          fs.copyFileSync(req.file.path, stagedPdfPath);
        } else if (['.ppt', '.pptx'].includes(ext)) {
          // Buat folder kerja sementara unik
          tempDir = path.join(os.tmpdir(), `obs-ppt-${crypto.randomUUID()}`);
          fs.mkdirSync(tempDir, { recursive: true });

          const safeInputFile = path.join(tempDir, `${safeBase}${ext}`);
          fs.copyFileSync(req.file.path, safeInputFile);

          // Konversi menggunakan LibreOffice
          const convertedPdf = await convertPptToPdf(safeInputFile, tempDir, safeBase);

          // Salin ke file staging sementara di uploads
          stagedPdfPath = path.join(UPLOADS, `staged-${crypto.randomUUID()}.pdf`);
          fs.copyFileSync(convertedPdf, stagedPdfPath);
        } else {
          throw new Error('Format file tidak didukung.');
        }

        // Validasi final staging PDF sebelum mengganti CURRENT_PDF
        validatePdfFile(stagedPdfPath);

        // Timpa CURRENT_PDF secara aman setelah staging terverifikasi
        fs.copyFileSync(stagedPdfPath, CURRENT_PDF);

        // Hanya perbarui state setelah file benar-benar siap
        state = {
          ready: true,
          fileName: safeFileName,
          total: 0,
          slide: 1,
          transition: state.transition || 'fade',
          duration: state.duration || 300,
          updatedAt: Date.now()
        };

        io.emit('presentation-loaded', state);
        return res.json({ ok: true, state });
      } catch (conversionErr) {
        console.error('[Upload Error]', conversionErr.message);
        // Jangan ubah state dan jangan kirim event presentation-loaded jika gagal
        return res.status(500).json({
          error: conversionErr.message || 'Gagal memproses dan mengonversi file presentasi.'
        });
      } finally {
        // Pembersihan file sementara melalui mekanisme safeRemove dengan retry agar aman dari EPERM di Windows
        if (stagedPdfPath) {
          await safeRemove(stagedPdfPath);
        }
        if (tempDir) {
          await safeRemove(tempDir);
        }
        if (req.file && req.file.path) {
          await safeRemove(req.file.path);
        }
      }
    });
  });
});

app.post('/api/transition', (req, res) => {
  if (req.body?.transition !== undefined) state.transition = req.body.transition;
  if (req.body?.duration !== undefined) state.duration = Number(req.body.duration) || 300;
  state.updatedAt = Date.now();
  io.emit('transition-changed', state);
  res.json({ ok: true, state });
});

app.post('/api/slide', (req, res) => {
  const slide = Number.parseInt(req.body?.slide, 10);
  if (!state.ready) return res.status(409).json({ error: 'Belum ada presentasi.' });
  if (!Number.isInteger(slide) || slide < 1) return res.status(400).json({ error: 'Nomor slide tidak valid.' });
  state.slide = state.total ? Math.min(slide, state.total) : slide;
  if (req.body?.transition !== undefined) state.transition = req.body.transition;
  if (req.body?.duration !== undefined) state.duration = Number(req.body.duration) || 300;
  state.updatedAt = Date.now();
  io.emit('slide-changed', state);
  res.json({ ok: true, state });
});

io.on('connection', socket => {
  socket.emit('presentation-loaded', state);
  socket.emit('slide-changed', state);
  socket.on('set-transition', payload => {
    if (payload?.transition !== undefined) state.transition = payload.transition;
    if (payload?.duration !== undefined) state.duration = Number(payload.duration) || 300;
    state.updatedAt = Date.now();
    io.emit('transition-changed', state);
  });
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
