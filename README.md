# HànyǔFlow — Mandarin HSK 1 Voice & Hanzi Lab + AI Tutor

Aplikasi web statis interaktif untuk belajar Mandarin level HSK 1 dengan fitur Voice Chat, AI Chat Tutor cerdas (BYOK), Generator Dialog Listening, Tone Lab, Hanzi Writing Lab, dan Simulasi HSK 1.

---

## 🌟 Fitur Utama

1. **15 Pertemuan Modul HSK 1**: Kosakata, kalimat, dialog, tata bahasa, dan goresan dasar dari materi Modul Pertemuan 1–15.
2. **Voice Chat Mandarin**:
   - **Mode Skenario (tanpa AI)**: Latihan percakapan skenario terstruktur bawaan modul.
   - **Mode AI Tutor (BYOK)**: Berbicara bebas dalam cakupan HSK 1 dengan tutor AI.
   - **Fitur Listening-First**: Audio balasan bot langsung diputar otomatis melalui TTS, teks Hanzi, pinyin, dan arti tersembunyi default (tersedia tombol 🔊 Ulangi, 🐢 Pelan, 👁 Tampilkan teks).
   - **Pemeriksaan Kosakata Otomatis**: Mendeteksi jika AI menghasilkan kata di luar materi dengan opsi tombol minta versi lebih sederhana.
3. **🎧 Generator Dialog Listening (AI)**:
   - Membuat dialog baru berdasarkan tema bebas atau pilihan cepat dengan batasan materi pertemuan tertentu (1–15).
   - Menghasilkan dialog dua orang (A & B) + 3 soal latihan listening pilihan ganda per dialog.
   - Pemutar dialog interaktif baris per baris dengan dua profil suara/pitch berbeda.
   - Opsi *Masuk ke Latihan HSK* agar soal hasil generate dapat ikut diuji di simulasi.
   - Manajemen dialog lengkap: Simpan lokal di browser, **Export JSON**, dan **Import JSON**.
4. **发音 Pronunciation & Tone Lab**:
   - Phrase check pengucapan frasa target via Speech Recognition.
   - Tone Pitch Contour Detector eksperimental 4 nada via mikrofon AudioContext.
5. **汉字 Hanzi Writing Lab**:
   - Animasi urutan goresan stroke dan kuis interaktif menulis Hanzi via Hanzi Writer CDN.
6. **HSK 1 Practice**:
   - 40 soal standar (20 listening + 20 reading) sesuai format HSK Level 1 resmi (passing benchmark 120/200).
7. **Jadwal Belajar Mingguan**:
   - Perencana mingguan terstruktur (English, Mandarin, Laptop Lab).

---

## 🤖 Panduan Menggunakan AI (BYOK - Bring Your Own Key)

HànyǔFlow berjalan 100% di browser tanpa backend server. Anda dapat menghubungkan API key Anda sendiri dari penyedia model AI yang kompatibel dengan OpenAI API.

### 1. Cara Mendapatkan API Key Gratis

| Provider | Endpoint Base URL | Rekomendasi Model | Kuota Gratis & Batasan | Link Registrasi |
|---|---|---|---|---|
| **Groq** | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | Sangat cepat; ~100 req/menit gratis | [console.groq.com](https://console.groq.com) |
| **Google Gemini** | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-3.5-flash-lite` | Kueri harian melimpah gratis di Google AI Studio | [aistudio.google.com](https://aistudio.google.com) |
| **OpenRouter** | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.1-8b-instruct:free` | Model gratis berakhiran `:free` | [openrouter.ai](https://openrouter.ai) |
| **Cerebras** | `https://api.cerebras.ai/v1` | `llama-3.3-70b` | Inferensi ultra-cepat; paket free tier | [cloud.cerebras.ai](https://cloud.cerebras.ai) |

> ⚠️ **Catatan Batasan Gratis & Wilayah:**
> - Provider AI bisa memberlakukan pembatasan wilayah (geo-restriction). Pastikan negara/wilayah Anda didukung oleh provider terkait.
> - URL endpoint dan ketersediaan nama model dapat diperbarui sewaktu-waktu oleh penyedia. Verifikasi selalu di dokumentasi resmi masing-masing provider.

### 2. Cara Mengisi di Web
1. Buka tab **⚙ Pengaturan** di navbar.
2. Pilih preset **Provider** (misal Groq atau Google Gemini). Base URL dan nama model akan terisi otomatis. Anda juga dapat memilih *Kustom / Proxy* jika menggunakan proxy sendiri.
3. Tempelkan **API Key** Anda ke kolom API Key.
4. Klik tombol **💾 Simpan**, lalu klik **🔌 Tes Koneksi** untuk memastikan koneksi berhasil.
5. Selesai! Buka tab **Voice Chat** dan aktifkan mode **🤖 AI Tutor**, atau buka tab **🎧 Dialog AI** untuk membuat dialog listening baru.

### 3. Peringatan Keamanan API Key
- API Key Anda disimpan **hanya di localStorage peramban (browser) perangkat ini**.
- Key **TIDAK PERNAH** dikirimkan ke server kami atau pihak ketiga selain endpoint provider AI yang Anda tentukan.
- ⚠️ **JANGAN masukkan API key di komputer umum, warnet, atau laptop pinjaman.**
- Sediakan tombol **🗑 Hapus** di panel pengaturan untuk menghapus key dari penyimpanan browser kapan saja.

---

## 🛡️ (Opsional) Mode Proxy Cloudflare Worker

Jika Anda ingin menyembunyikan API Key dari browser atau berbagi aplikasi dengan teman/keluarga tanpa membocorkan key Anda:
1. Kode template worker telah disediakan di `docs/cloudflare-worker-example.js`.
2. Deploy kode tersebut ke [Cloudflare Workers](https://workers.cloudflare.com) (gratis 100.000 req/hari).
3. Simpan key Anda di Cloudflare Secret (`AI_API_KEY` dan `AI_BASE_URL`).
4. Pada HànyǔFlow di menu **⚙ Pengaturan**, pilih provider *Kustom / Proxy* dan masukkan URL Worker Anda sebagai Base URL.

---

## 🚀 Cara Deploy ke GitHub Pages

Proyek ini adalah web statis murni tanpa build step (`npm run build`, bundler, dsb.).
1. Pastikan struktur file di root repo Anda:
   ```text
   ├── index.html
   ├── js/
   │   ├── ai.js
   │   └── dialog.js
   ├── docs/
   │   └── cloudflare-worker-example.js
   └── README.md
   ```
2. Upload atau push ke branch `main` repositori GitHub Anda.
3. Buka GitHub repository: **Settings** → **Pages** → **Build and deployment**.
4. Sumber (Source): **Deploy from a branch**.
5. Branch: pilih `main` dan folder `/ (root)`, lalu klik **Save**.
6. Situs akan aktif dalam beberapa menit di `https://<username>.github.io/<repo-name>/`.

---

## 🔊 Persyaratan Sistem & Audio

- **Browser**: Disarankan **Google Chrome** atau **Microsoft Edge** versi modern (mendukung Web Speech API SpeechSynthesis dan SpeechRecognition).
- **Koneksi HTTPS**: Fitur mikrofon browser (SpeechRecognition) membutuhkan origin yang aman (HTTPS atau localhost).
- **Paket Suara Mandarin (TTS zh-CN)**:
  - Jika audio Mandarin tidak bersuara di Windows:
    1. Buka **Windows Settings** (`Win + I`) → **Time & Language** → **Language & Region**.
    2. Tambah bahasa **Chinese (Simplified, China) / 中文(简体，中国)**.
    3. Masuk ke **Language options** → unduh paket **Speech / Text-to-speech**.

---

## ⚠️ Batasan & Catatan Edukasi

- **Pinyin AI**: Model AI terkadang menghasilkan nada pinyin yang kurang akurat pada kata heteronim (*duoyinzi*). Verifikasi selalu dengan materi modul atau kamus standar sebelum dihafal.
- **Pronunciation & Tone Lab**: Speech recognition dan deteksi pitch adalah perkiraan peramban untuk umpan balik latihan mandiri, bukan pengganti penutur asli atau alat analisis fonetik profesional.

---

## 📚 Sumber & Disclaimer
- Sumber Materi Modul: Modul HSK 1 Pertemuan 1–15 — Haoyou Educator (materi milik pengguna).
- Acuan Standar: Chinese Test Service HSK Level 1 (https://www.chinesetest.cn/HSK/1).
- Library Pihak Ketiga: Hanzi Writer (https://hanziwriter.org/docs.html).
- **HànyǔFlow** adalah media belajar non-resmi dan tidak terafiliasi dengan Chinese Test International atau Haoyou Educator.
