# OBS Presentation Dock

Custom Dock lokal untuk mengunggah PDF/PPT/PPTX, melihat preview/thumbnail, dan mengontrol slide yang tampil sebagai Browser Source di OBS.

## Fitur
- Upload PDF, PPT, dan PPTX (PPT/PPTX dikonversi menjadi PDF).
- Preview slide aktif dan thumbnail semua slide.
- Previous, Next, lompat ke nomor slide, shortcut panah kiri/kanan.
- Dock dan Browser Source tersinkron secara lokal melalui Socket.IO.

## Persyaratan
- Windows 10/11
- OBS Studio dengan Browser Source (biasanya sudah tersedia)
- Node.js LTS: https://nodejs.org
- LibreOffice untuk mengonversi `.ppt`/`.pptx` menjadi PDF: https://www.libreoffice.org/download/download-libreoffice/

PDF tidak memerlukan LibreOffice. File PowerPoint dikonversi ke PDF sehingga animasi/transisi PowerPoint asli tidak dipertahankan.

## Instalasi
1. Ekstrak folder proyek ke lokasi tetap, misalnya `C:\OBS-Presentation-Dock`.
2. Install Node.js LTS dan LibreOffice. Setelah install, tutup/buka kembali terminal atau OBS bila perlu.
3. Menjalankan server:
   - Mode Biasa (dengan jendela Command Prompt): Dobel-klik `START-WINDOWS.bat`.
   - Mode Senyap (tanpa jendela terminal di taskbar): Dobel-klik `START-SILENT.vbs`.
   - Untuk mematikan server yang berjalan di background: Dobel-klik `STOP-SERVER.bat`.
4. Dock berjalan di `http://127.0.0.1:3210/dock.html`.
5. Di OBS, buka **Docks → Custom Browser Docks** (nama menu bisa sedikit berbeda).
6. Isi nama `Presentation Dock`, URL `http://127.0.0.1:3210/dock.html`, lalu klik Apply.
7. Di scene yang ingin menampilkan slide, tambah **Sources → + → Browser**. Beri nama `Presentation Output`.
8. Set URL menjadi `http://127.0.0.1:3210/output.html`, Width `1920`, Height `1080`, lalu klik OK.
9. Buka dock, pilih file PDF/PPT/PPTX, klik **Upload & tampilkan**. Kontrol slide dari dock; Browser Source menampilkan slide aktif.

## Catatan
- Server hanya bind ke `127.0.0.1` (komputer lokal), bukan jaringan publik.
- Maksimum upload 250 MB.
- Kalau PPT/PPTX gagal dikonversi, pastikan LibreOffice terpasang. Pada instalasi tertentu, perintah `soffice` perlu tersedia di PATH; restart server setelah menginstal.
- Browser Source harus tetap aktif di scene yang dipakai. Jika ingin output transparan, versi ini belum mengimplementasikan transparansi.
- Jangan tutup jendela server selama presentasi berlangsung.
