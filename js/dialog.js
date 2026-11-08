/**
 * HànyǔFlow — js/dialog.js
 * Fitur 2: Generator Dialog Listening + Pemutar + Export/Import
 *
 * Format output dialog kompatibel dengan LESSONS[].dialogs:
 *   [["A","汉字","Pīnyīn","Arti Indonesia"], ...]
 *
 * Format soal kompatibel dengan MOCK:
 *   {type:"listen", speak:"...", q:"...", opts:[...], a:0, why:"..."}
 */

/* ═══════════════════════════════════════════════════════════════
   STATE DIALOG GENERATOR
   ═══════════════════════════════════════════════════════════════ */

/** Daftar dialog yang sudah digenerate (tersimpan di localStorage) */
let aiDialogs = [];

/** Soal listening tambahan dari dialog AI (bergabung ke simulasi HSK) */
let mockExtra = [];

/** State pemutar dialog */
const player = {
  dialogId: null,
  lines: [],
  idx: 0,
  playing: false,
  hideText: false,
  rate: null, // null = default CFG.TTS_RATE_NORMAL
  timer: null
};

/** Topik cepat yang bisa dipilih di form */
const QUICK_THEMES = [
  '🛒 Belanja', '⏰ Waktu & jam', '🌤 Cuaca', '👨‍👩‍👧 Keluarga',
  '🚌 Transportasi', '👤 Diri sendiri', '🍜 Makanan', '🏫 Sekolah'
];

/* ═══════════════════════════════════════════════════════════════
   UTILS
   ═══════════════════════════════════════════════════════════════ */

/** Escape HTML sederhana (duplikat dari ai.js agar dialog.js berdiri sendiri) */
function dlEscapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ID unik sederhana */
function genId() {
  return 'dlg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

/** Format tanggal sederhana */
function fmtDate(ts) {
  return new Date(ts).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/* ═══════════════════════════════════════════════════════════════
   LOCALSTORAGE
   ═══════════════════════════════════════════════════════════════ */

function loadAIDialogs() {
  try {
    aiDialogs = JSON.parse(localStorage.getItem('hanyuflow-ai-dialogs') || '[]');
  } catch {
    aiDialogs = [];
  }
}

function saveAIDialogs() {
  localStorage.setItem('hanyuflow-ai-dialogs', JSON.stringify(aiDialogs));
}

function loadMockExtra() {
  try {
    mockExtra = JSON.parse(localStorage.getItem('hanyuflow-mock-extra') || '[]');
  } catch {
    mockExtra = [];
  }
}

function saveMockExtra() {
  localStorage.setItem('hanyuflow-mock-extra', JSON.stringify(mockExtra));
}

/* ═══════════════════════════════════════════════════════════════
   PROMPT GENERATOR DIALOG
   ═══════════════════════════════════════════════════════════════ */

/**
 * Bangun system prompt untuk generator dialog.
 */
function buildDialogSystemPrompt(maxLesson) {
  if (typeof LESSONS === 'undefined') return '';

  // Kumpulkan vocab hanya sampai pertemuan maxLesson
  const allowedVocab = [];
  for (let i = 0; i < Math.min(maxLesson, LESSONS.length); i++) {
    LESSONS[i].vocab.forEach(([hz, py, id]) => {
      allowedVocab.push(`${hz}(${py}=${id})`);
    });
  }

  return `Kamu adalah generator dialog bahasa Mandarin untuk pemula HSK 1.

KOSAKATA YANG DIIZINKAN (hanya dari Pertemuan 1 sampai ${maxLesson}):
${allowedVocab.join(', ')}

ATURAN WAJIB:
1. Hanya gunakan kosakata dari daftar di atas plus angka dan partikel dasar HSK 1.
2. Setiap dialog harus alami, pendek (4–8 baris), dan sesuai topik.
3. Pembicara hanya A dan B, bergantian.
4. Output HARUS berupa JSON valid persis seperti format berikut — TIDAK ada teks di luar JSON:

{
  "dialogs": [
    {
      "lines": [["A","汉字","Pīnyīn","Arti Indonesia"], ["B","汉字","Pīnyīn","Arti Indonesia"], ...],
      "questions": [
        {"type":"listen","speak":"kalimat yang didengar","q":"Pertanyaan dalam bahasa Indonesia?","opts":["A. ...","B. ...","C. ...","D. ..."],"a":0,"why":"Penjelasan singkat dalam bahasa Indonesia."},
        {"type":"listen","speak":"...","q":"...","opts":["A.","B.","C.","D."],"a":0,"why":"..."},
        {"type":"listen","speak":"...","q":"...","opts":["A.","B.","C.","D."],"a":0,"why":"..."}
      ]
    }
  ]
}

CATATAN:
- "lines" adalah array baris dialog: [pembicara, hanzi, pinyin, arti Indonesia]
- Setiap dialog punya tepat 3 "questions" berformat listening
- "a" adalah indeks jawaban benar (0=A, 1=B, 2=C, 3=D)
- "speak" adalah kalimat yang diucapkan TTS saat latihan listening
- Pinyin mungkin mengandung kesalahan kecil — pelajar disarankan memverifikasi
- Jangan tambahkan teks penjelasan di luar struktur JSON`;
}

/**
 * Bangun user prompt untuk generator dialog.
 */
function buildDialogUserPrompt(theme, count) {
  return `Buat ${count} dialog(s) dengan topik: "${theme}". 
Setiap dialog harus natural, sesuai situasi nyata, dan menggunakan hanya kosakata yang diizinkan.
Sertakan tepat 3 soal listening per dialog.
Output: JSON valid sesuai format yang sudah ditentukan.`;
}

/* ═══════════════════════════════════════════════════════════════
   PARSER OUTPUT AI DIALOG
   ═══════════════════════════════════════════════════════════════ */

/**
 * Parse output AI dialog secara toleran.
 * @param {string} text
 * @returns {{dialogs: Array} | null}
 */
function parseDialogOutput(text) {
  if (!text) return null;

  // Strip code fence
  let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  function normalizeKeys(obj) {
    if (!obj) return null;
    let dlgs = obj.dialogs || obj.dialog || (Array.isArray(obj) ? obj : null);
    if (!dlgs) return null;
    if (!Array.isArray(dlgs)) dlgs = [dlgs];

    const normalized = dlgs.map(d => {
      let lines = d.lines || d.dialog || d.conversation || [];
      if (Array.isArray(lines)) {
        lines = lines.map(line => {
          if (Array.isArray(line)) return line;
          if (typeof line === 'object') {
            return [
              line.speaker || line.role || 'A',
              line.chinese || line.zh || line.hanzi || line.text || '',
              line.pinyin || line.py || '',
              line.indonesian || line.meaning || line.id || line.translation || line.english || ''
            ];
          }
          return ['A', String(line), '', ''];
        });
      }
      return {
        lines: lines,
        questions: d.questions || d.soal || []
      };
    });

    return { dialogs: normalized };
  }

  // 1. Coba parse langsung
  try {
    const obj = JSON.parse(clean);
    const res = normalizeKeys(obj);
    if (res?.dialogs?.length > 0) return res;
  } catch {}

  // 2. Cari blok {...} atau [...]
  const matchObj = clean.match(/\{[\s\S]+\}/);
  if (matchObj) {
    try {
      const obj = JSON.parse(matchObj[0]);
      const res = normalizeKeys(obj);
      if (res?.dialogs?.length > 0) return res;
    } catch {}
  }

  const matchArr = clean.match(/\[[\s\S]+\]/);
  if (matchArr) {
    try {
      const obj = JSON.parse(matchArr[0]);
      const res = normalizeKeys(obj);
      if (res?.dialogs?.length > 0) return res;
    } catch {}
  }

  return null;
}

/**
 * Validasi dan normalisasi dialog yang di-parse.
 * Memastikan kompatibilitas dengan format LESSONS[].dialogs.
 */
function validateDialogData(parsed) {
  if (!parsed?.dialogs || !Array.isArray(parsed.dialogs)) return null;

  return parsed.dialogs.map(d => {
    // Normalisasi lines
    const lines = (d.lines || []).filter(line =>
      Array.isArray(line) && line.length >= 2
    ).map(line => {
      // Pastikan format [speaker, zh, pinyin, id]
      return [
        String(line[0] || 'A'),
        String(line[1] || ''),
        String(line[2] || ''),
        String(line[3] || '')
      ];
    });

    // Normalisasi questions
    const questions = (d.questions || []).slice(0, 3).map(q => ({
      type: 'listen',
      speak: String(q.speak || ''),
      q: String(q.q || 'Apa yang diucapkan?'),
      opts: Array.isArray(q.opts) ? q.opts.slice(0, 4).map(String) : ['A', 'B', 'C', 'D'],
      a: Number(q.a ?? 0),
      why: String(q.why || '')
    }));

    return { lines, questions };
  }).filter(d => d.lines.length > 0);
}

/* ═══════════════════════════════════════════════════════════════
   GENERATOR UI
   ═══════════════════════════════════════════════════════════════ */

/**
 * Render halaman Dialog AI.
 */
function renderDialogAIPage() {
  const container = document.getElementById('dialogaiContent');
  if (!container) return;

  // Baris pilihan cepat tema
  const quickBtns = QUICK_THEMES.map(t =>
    `<button class="btn soft quick-theme" 
      aria-label="Pilih tema ${dlEscapeHtml(t)}"
      onclick="setQuickTheme(this, '${dlEscapeHtml(t)}')">${dlEscapeHtml(t)}</button>`
  ).join('');

  // Opsi batas pertemuan
  let lessonOpts = '';
  const maxL = typeof LESSONS !== 'undefined' ? LESSONS.length : 15;
  for (let i = 1; i <= maxL; i++) {
    lessonOpts += `<option value="${i}" ${i === maxL ? 'selected' : ''}>Sampai Pertemuan ${i}</option>`;
  }

  container.innerHTML = `
    <div class="grid">
      <!-- Form Generator -->
      <div class="card s12">
        <h3>✨ Generator Dialog AI</h3>
        <p style="color:var(--muted);margin-bottom:12px">
          AI akan membuat dialog Mandarin HSK 1 baru + soal listening. 
          Pastikan API key sudah diisi di <button class="btn-link" onclick="showView('settings')">⚙ Pengaturan</button>.
        </p>

        <div class="form-group">
          <label>Pilih tema cepat:</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
            ${quickBtns}
          </div>
        </div>

        <div class="form-group" style="margin-top:12px">
          <label for="dlgTheme">Tema (bisa tulis bebas):</label>
          <input type="text" id="dlgTheme" placeholder="mis. perkenalan di kampus, pesan makanan..." 
            aria-label="Tema dialog yang akan digenerate"
            style="width:100%;padding:10px;border:1px solid var(--line);border-radius:11px;margin-top:6px" />
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
          <div class="form-group">
            <label for="dlgCount">Jumlah dialog:</label>
            <select id="dlgCount" aria-label="Jumlah dialog yang digenerate"
              style="width:100%;padding:10px;border:1px solid var(--line);border-radius:11px;margin-top:6px">
              <option value="1">1 dialog</option>
              <option value="2" selected>2 dialog</option>
              <option value="3">3 dialog</option>
              <option value="4">4 dialog</option>
              <option value="5">5 dialog</option>
            </select>
          </div>
          <div class="form-group">
            <label for="dlgLesson">Batas materi:</label>
            <select id="dlgLesson" aria-label="Batas pertemuan materi untuk kosakata"
              style="width:100%;padding:10px;border:1px solid var(--line);border-radius:11px;margin-top:6px">
              ${lessonOpts}
            </select>
          </div>
        </div>

        <div class="actions" style="margin-top:14px">
          <button class="btn primary" id="btnGenerate" onclick="generateDialogs()" 
            aria-label="Generate dialog AI">✨ Generate Dialog</button>
        </div>

        <div id="dlgStatus" style="margin-top:10px;display:none;padding:10px;border-radius:12px;background:#fff4d5;border:1px solid #ead09a"></div>
      </div>

      <!-- Daftar Dialog Tersimpan -->
      <div class="card s12">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3>📚 Dialog AI Tersimpan</h3>
          <div style="display:flex;gap:8px">
            <button class="btn soft" onclick="exportDialogs()" aria-label="Export dialog ke file JSON">📤 Export</button>
            <label class="btn outline" style="cursor:pointer" aria-label="Import dialog dari file JSON">
              📥 Import
              <input type="file" accept=".json" style="display:none" onchange="importDialogs(event)">
            </label>
          </div>
        </div>
        <div id="dlgList"></div>
      </div>
    </div>`;

  renderDialogList();
}

/**
 * Set tema dari pilihan cepat.
 */
function setQuickTheme(btn, theme) {
  document.querySelectorAll('.quick-theme').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const input = document.getElementById('dlgTheme');
  if (input) input.value = theme;
}

/* ═══════════════════════════════════════════════════════════════
   GENERATE DIALOG
   ═══════════════════════════════════════════════════════════════ */

/**
 * Generate dialog dari AI.
 */
async function generateDialogs() {
  const theme = document.getElementById('dlgTheme')?.value?.trim();
  const count = parseInt(document.getElementById('dlgCount')?.value || '2');
  const maxLesson = parseInt(document.getElementById('dlgLesson')?.value || '15');

  if (!theme) {
    alert('Masukkan tema dialog terlebih dahulu.');
    return;
  }

  const statusEl = document.getElementById('dlgStatus');
  const btnEl = document.getElementById('btnGenerate');

  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.textContent = '⌛ Menghubungi AI untuk membuat dialog…';
  }
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = '⌛ Generating…';
  }

  try {
    // Panggil AI
    const messages = [
      { role: 'system', content: buildDialogSystemPrompt(maxLesson) },
      { role: 'user', content: buildDialogUserPrompt(theme, count) }
    ];

    const rawText = await callAIWithRetry(messages, 2000);

    // Parse output
    let parsed = parseDialogOutput(rawText);

    if (!parsed) {
      // Retry sekali
      if (statusEl) statusEl.textContent = '⌛ Format tidak terbaca, meminta ulang…';
      const retryMessages = [
        ...messages,
        { role: 'assistant', content: rawText },
        { role: 'user', content: 'Format JSON tidak valid. Kirim ulang HANYA objek JSON sesuai format yang diminta, tanpa teks tambahan.' }
      ];
      const retryRaw = await callAIWithRetry(retryMessages, 2000);
      parsed = parseDialogOutput(retryRaw);
    }

    if (!parsed) {
      if (statusEl) {
        statusEl.style.background = '#f8e8e2';
        statusEl.textContent = '❌ Gagal memproses output AI. Coba lagi atau ubah tema.';
      }
      return;
    }

    // Validasi dan normalisasi
    const validDialogs = validateDialogData(parsed);
    if (!validDialogs || validDialogs.length === 0) {
      if (statusEl) {
        statusEl.style.background = '#f8e8e2';
        statusEl.textContent = '❌ Output AI tidak menghasilkan dialog yang valid.';
      }
      return;
    }

    // Simpan ke localStorage
    const entry = {
      id: genId(),
      createdAt: Date.now(),
      theme,
      maxLesson,
      dialogs: validDialogs,
      source: 'ai-generated'
    };

    aiDialogs.unshift(entry); // terbaru di atas
    saveAIDialogs();

    if (statusEl) {
      statusEl.style.background = '#e4f1e9';
      statusEl.textContent = `✅ ${validDialogs.length} dialog berhasil dibuat dan tersimpan!`;
    }

    // Refresh daftar
    renderDialogList();

    // Scroll ke daftar
    document.getElementById('dlgList')?.scrollIntoView({ behavior: 'smooth' });

  } catch (err) {
    const msg = typeof friendlyError === 'function' ? friendlyError(err.message) : err.message;
    if (statusEl) {
      statusEl.style.background = '#f8e8e2';
      statusEl.textContent = '❌ ' + msg;
    }
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = '✨ Generate Dialog';
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   DAFTAR DIALOG
   ═══════════════════════════════════════════════════════════════ */

/**
 * Render daftar dialog tersimpan.
 */
function renderDialogList() {
  const listEl = document.getElementById('dlgList');
  if (!listEl) return;

  if (aiDialogs.length === 0) {
    listEl.innerHTML = `<p style="color:var(--muted);text-align:center;padding:20px">
      Belum ada dialog AI. Generate dialog pertamamu di atas!
    </p>`;
    return;
  }

  listEl.innerHTML = aiDialogs.map((entry, idx) => `
    <div class="dlg-entry card" style="margin-bottom:10px" id="dlge-${dlEscapeHtml(entry.id)}">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>
          <b>${dlEscapeHtml(entry.theme)}</b>
          <span class="badge" style="margin-left:8px">${entry.dialogs.length} dialog</span>
          <span class="badge gold" style="margin-left:4px">s/d P${entry.maxLesson}</span>
          <div style="font-size:.73rem;color:var(--muted);margin-top:3px">${fmtDate(entry.createdAt)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn soft" onclick="openDialogEntry('${dlEscapeHtml(entry.id)}')"
            aria-label="Putar dialog ${dlEscapeHtml(entry.theme)}">▶ Putar</button>
          <button class="btn outline" onclick="addToMock('${dlEscapeHtml(entry.id)}')"
            aria-label="Tambah soal ke simulasi HSK">➕ ke HSK</button>
          <button class="btn outline" style="color:var(--bad)" 
            onclick="deleteDialogEntry('${dlEscapeHtml(entry.id)}')"
            aria-label="Hapus dialog ini">🗑</button>
        </div>
      </div>
      <div id="dlgplayer-${dlEscapeHtml(entry.id)}" class="hidden" style="margin-top:14px"></div>
    </div>
  `).join('');
}

/**
 * Hapus dialog entry.
 */
function deleteDialogEntry(id) {
  if (!confirm('Hapus dialog ini?')) return;
  aiDialogs = aiDialogs.filter(d => d.id !== id);
  saveAIDialogs();
  renderDialogList();
  if (typeof toast === 'function') toast('Dialog dihapus.');
}

/* ═══════════════════════════════════════════════════════════════
   PEMUTAR DIALOG
   ═══════════════════════════════════════════════════════════════ */

/**
 * Buka dan render pemutar untuk satu dialog entry.
 */
function openDialogEntry(id) {
  const entry = aiDialogs.find(d => d.id === id);
  if (!entry) return;

  const playerEl = document.getElementById('dlgplayer-' + id);
  if (!playerEl) return;

  if (!playerEl.classList.contains('hidden')) {
    playerEl.classList.add('hidden');
    return;
  }
  playerEl.classList.remove('hidden');

  renderDialogPlayer(playerEl, entry);
}

/**
 * Render pemutar dialog lengkap.
 */
function renderDialogPlayer(container, entry) {
  let html = '';

  entry.dialogs.forEach((dlg, dlgIdx) => {
    const dialogId = entry.id + '_' + dlgIdx;

    // Render baris dialog
    const linesHtml = dlg.lines.map((line, lineIdx) => {
      const [speaker, zh, pinyin, meaning] = line;
      const isA = speaker === 'A';
      return `
        <div class="dialog-line ${isA ? 'dlg-a' : 'dlg-b'}" id="dline-${dialogId}-${lineIdx}">
          <span class="dlg-speaker">${dlEscapeHtml(speaker)}</span>
          <div class="dlg-content">
            <div class="dlg-zh">${dlEscapeHtml(zh)}
              <button class="speaker" onclick="speakDialogLine('${dialogId}',${lineIdx})"
                aria-label="Putar baris ini">🔊</button>
            </div>
            <div class="dlg-pi dlg-text-hidden">${dlEscapeHtml(pinyin)}</div>
            <div class="dlg-id dlg-text-hidden">${dlEscapeHtml(meaning)}</div>
          </div>
        </div>`;
    }).join('');

    // Render soal listening
    const qHtml = dlg.questions.map((q, qi) => {
      const optsHtml = q.opts.map((o, oi) =>
        `<button class="opt" id="qopt-${dialogId}-${qi}-${oi}"
          onclick="answerDialogQ('${dialogId}',${dlgIdx},'${entry.id}',${qi},${oi})"
          aria-label="Pilih jawaban ${String.fromCharCode(65 + oi)}: ${dlEscapeHtml(o)}">
          ${String.fromCharCode(65 + oi)}. ${dlEscapeHtml(o)}
        </button>`
      ).join('');

      return `
        <div class="dlg-q" id="dlgq-${dialogId}-${qi}">
          <div style="font-size:.85rem;font-weight:700;margin-bottom:7px">
            🎧 Soal ${qi + 1}: ${dlEscapeHtml(q.q)}
            <button class="speaker" onclick="speakZh('${dlEscapeHtml(q.speak)}')"
              aria-label="Putar audio soal">🔊</button>
          </div>
          <div class="opts">${optsHtml}</div>
          <div class="review hidden" id="dlgrev-${dialogId}-${qi}"></div>
        </div>`;
    }).join('');

    html += `
      <div class="dlg-block" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span class="badge">Dialog ${dlgIdx + 1}</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn soft" onclick="playAllLines('${dialogId}')"
              aria-label="Putar semua baris dialog">▶ Play semua</button>
            <button class="btn outline" onclick="stopPlayer('${dialogId}')"
              aria-label="Hentikan pemutaran">⏹ Stop</button>
            <button class="btn outline" onclick="toggleDialogText('${dialogId}')"
              id="btnToggleText-${dialogId}"
              aria-label="Sembunyikan atau tampilkan teks dialog"
              aria-pressed="false">🙈 Sembunyikan teks</button>
            <button class="btn outline" onclick="slowDownPlayer('${dialogId}')"
              aria-label="Aktifkan mode pelan">🐢 Pelan</button>
          </div>
        </div>

        <div class="ai-pinyin-note">
          ⚠ Pinyin dihasilkan AI — verifikasi sebelum menghafal.
        </div>

        <div id="dlglines-${dialogId}">
          ${linesHtml}
        </div>

        <div style="margin-top:14px">
          <div style="font-weight:700;margin-bottom:8px;color:var(--jade2)">🎧 Latihan Listening</div>
          <p style="font-size:.8rem;color:var(--muted);margin-bottom:10px">
            Putar dialog dulu (sembunyikan teks), lalu jawab soal di bawah ini.
          </p>
          ${qHtml}
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════════
   PEMUTAR TTS
   ═══════════════════════════════════════════════════════════════ */

/** State per dialog player */
const playerStates = {};

/**
 * Dapatkan atau inisialisasi state player untuk dialog tertentu.
 */
function getPlayerState(dialogId) {
  if (!playerStates[dialogId]) {
    playerStates[dialogId] = {
      playing: false,
      slow: false,
      lineIdx: 0,
      timer: null,
      textHidden: false
    };
  }
  return playerStates[dialogId];
}

/**
 * Putar satu baris dialog dengan suara A/B berbeda.
 */
function speakDialogLine(dialogId, lineIdx) {
  // Cari data baris
  const [entryId, dlgIdxStr] = dialogId.split('_');
  const dlgIdx = parseInt(dlgIdxStr);
  const entry = aiDialogs.find(d => d.id === entryId);
  if (!entry || !entry.dialogs[dlgIdx]) return;

  const line = entry.dialogs[dlgIdx].lines[lineIdx];
  if (!line) return;

  const [speaker, zh] = line;
  const state = getPlayerState(dialogId);
  const rate = state.slow ? CFG.TTS_RATE_SLOW : CFG.TTS_RATE_NORMAL;

  speechSynthesis.cancel();

  const cfg = typeof loadAICfg === 'function' ? loadAICfg() : {};
  const voices = speechSynthesis.getVoices();

  const utt = new SpeechSynthesisUtterance(zh);
  utt.lang = 'zh-CN';
  utt.rate = rate;

  // Pilih suara berbeda untuk A dan B
  if (speaker === 'A' && cfg.voiceA) {
    const v = voices.find(v => v.name === cfg.voiceA);
    if (v) utt.voice = v;
    utt.pitch = CFG.TTS_PITCH_A;
  } else if (speaker === 'B' && cfg.voiceB) {
    const v = voices.find(v => v.name === cfg.voiceB);
    if (v) utt.voice = v;
    utt.pitch = CFG.TTS_PITCH_B;
  } else {
    // Fallback: bedakan pitch saja
    utt.pitch = speaker === 'A' ? CFG.TTS_PITCH_A : CFG.TTS_PITCH_B;
  }

  speechSynthesis.speak(utt);

  // Highlight baris yang sedang diputar
  highlightLine(dialogId, lineIdx);
}

/**
 * Highlight baris yang sedang diputar.
 */
function highlightLine(dialogId, lineIdx) {
  // Hapus highlight sebelumnya
  document.querySelectorAll(`[id^="dline-${dialogId}-"]`).forEach(el => {
    el.classList.remove('dlg-playing');
  });

  const lineEl = document.getElementById(`dline-${dialogId}-${lineIdx}`);
  if (lineEl) lineEl.classList.add('dlg-playing');
}

/**
 * Putar semua baris dialog satu per satu.
 */
function playAllLines(dialogId) {
  const [entryId, dlgIdxStr] = dialogId.split('_');
  const dlgIdx = parseInt(dlgIdxStr);
  const entry = aiDialogs.find(d => d.id === entryId);
  if (!entry || !entry.dialogs[dlgIdx]) return;

  const lines = entry.dialogs[dlgIdx].lines;
  const state = getPlayerState(dialogId);

  state.playing = true;
  state.lineIdx = 0;

  function playNext() {
    if (!state.playing || state.lineIdx >= lines.length) {
      state.playing = false;
      // Hapus semua highlight
      document.querySelectorAll(`[id^="dline-${dialogId}-"]`).forEach(el => {
        el.classList.remove('dlg-playing');
      });
      return;
    }

    const idx = state.lineIdx;
    speakDialogLine(dialogId, idx);
    state.lineIdx++;

    // Estimasi durasi: ~200ms per karakter + 500ms jeda
    const lineText = lines[idx][1] || '';
    const durationMs = Math.max(1200, lineText.length * 350) + 500;

    state.timer = setTimeout(playNext, durationMs);
  }

  playNext();
}

/**
 * Hentikan pemutaran.
 */
function stopPlayer(dialogId) {
  const state = getPlayerState(dialogId);
  state.playing = false;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  speechSynthesis.cancel();

  // Hapus highlight
  document.querySelectorAll(`[id^="dline-${dialogId}-"]`).forEach(el => {
    el.classList.remove('dlg-playing');
  });
}

/**
 * Toggle mode pelan.
 */
function slowDownPlayer(dialogId) {
  const state = getPlayerState(dialogId);
  state.slow = !state.slow;

  // Update tombol
  const btn = document.querySelector(`button[onclick="slowDownPlayer('${dialogId}')"]`);
  if (btn) {
    btn.textContent = state.slow ? '🐢 Pelan (aktif)' : '🐢 Pelan';
    btn.classList.toggle('active', state.slow);
  }
}

/**
 * Toggle tampilkan/sembunyikan teks dialog.
 */
function toggleDialogText(dialogId) {
  const state = getPlayerState(dialogId);
  state.textHidden = !state.textHidden;

  const linesContainer = document.getElementById('dlglines-' + dialogId);
  if (linesContainer) {
    const textEls = linesContainer.querySelectorAll('.dlg-pi, .dlg-id');
    textEls.forEach(el => {
      el.classList.toggle('dlg-text-hidden', state.textHidden);
    });

    // Tampilkan/sembunyikan zh juga?
    const zhEls = linesContainer.querySelectorAll('.dlg-zh');
    zhEls.forEach(el => {
      el.classList.toggle('dlg-zh-hidden', state.textHidden);
    });
  }

  const btn = document.getElementById('btnToggleText-' + dialogId);
  if (btn) {
    btn.textContent = state.textHidden ? '👁 Tampilkan teks' : '🙈 Sembunyikan teks';
    btn.setAttribute('aria-pressed', String(state.textHidden));
  }
}

/* ═══════════════════════════════════════════════════════════════
   SOAL LISTENING
   ═══════════════════════════════════════════════════════════════ */

/**
 * Jawab soal listening dialog.
 */
function answerDialogQ(dialogId, dlgIdx, entryId, qIdx, answerIdx) {
  const entry = aiDialogs.find(d => d.id === entryId);
  if (!entry || !entry.dialogs[dlgIdx]) return;

  const q = entry.dialogs[dlgIdx].questions[qIdx];
  if (!q) return;

  const isCorrect = answerIdx === q.a;

  // Update tampilan opsi
  q.opts.forEach((_, i) => {
    const optEl = document.getElementById(`qopt-${dialogId}-${qIdx}-${i}`);
    if (!optEl) return;
    optEl.classList.remove('selected', 'correct', 'wrong');
    if (i === answerIdx) optEl.classList.add('selected', isCorrect ? 'correct' : 'wrong');
    if (i === q.a && !isCorrect) optEl.classList.add('correct');
  });

  // Tampilkan review
  const revEl = document.getElementById(`dlgrev-${dialogId}-${qIdx}`);
  if (revEl) {
    revEl.classList.remove('hidden', 'ok', 'bad');
    revEl.classList.add(isCorrect ? 'ok' : 'bad');
    revEl.textContent = (isCorrect ? '✅ Benar! ' : '❌ Kurang tepat. ') + q.why;
  }
}

/* ═══════════════════════════════════════════════════════════════
   TAMBAHKAN SOAL KE MOCK HSK
   ═══════════════════════════════════════════════════════════════ */

/**
 * Tambahkan soal dari dialog ke simulasi HSK.
 */
function addToMock(entryId) {
  const entry = aiDialogs.find(d => d.id === entryId);
  if (!entry) return;

  const newQuestions = [];
  entry.dialogs.forEach(dlg => {
    dlg.questions.forEach(q => {
      newQuestions.push({ ...q, _fromAI: true, _theme: entry.theme });
    });
  });

  // Hindari duplikat berdasarkan speak+q
  const existing = new Set(mockExtra.map(q => q.speak + '|' + q.q));
  const toAdd = newQuestions.filter(q => !existing.has(q.speak + '|' + q.q));

  if (toAdd.length === 0) {
    if (typeof toast === 'function') toast('Soal dari dialog ini sudah ada di simulasi.');
    return;
  }

  mockExtra.push(...toAdd);
  saveMockExtra();

  if (typeof toast === 'function') toast(`${toAdd.length} soal ditambahkan ke Latihan HSK!`);
}

/* ═══════════════════════════════════════════════════════════════
   EXPORT / IMPORT
   ═══════════════════════════════════════════════════════════════ */

/**
 * Export semua dialog ke file JSON.
 */
function exportDialogs() {
  if (aiDialogs.length === 0) {
    alert('Belum ada dialog untuk diekspor.');
    return;
  }

  const data = JSON.stringify({ version: 1, dialogs: aiDialogs }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'hanyuflow-dialogs-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);

  if (typeof toast === 'function') toast('Dialog diekspor!');
}

/**
 * Import dialog dari file JSON.
 */
function importDialogs(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      let imported = [];

      if (Array.isArray(data)) {
        imported = data;
      } else if (data?.dialogs && Array.isArray(data.dialogs)) {
        imported = data.dialogs;
      } else {
        alert('Format file tidak dikenali. Pastikan file adalah hasil export HànyǔFlow.');
        return;
      }

      // Validasi ringan
      const valid = imported.filter(d =>
        d.id && d.theme && Array.isArray(d.dialogs)
      );

      if (valid.length === 0) {
        alert('Tidak ada dialog valid ditemukan dalam file.');
        return;
      }

      // Hindari duplikat berdasarkan ID
      const existingIds = new Set(aiDialogs.map(d => d.id));
      const toAdd = valid.filter(d => !existingIds.has(d.id));

      aiDialogs = [...toAdd, ...aiDialogs];
      saveAIDialogs();
      renderDialogList();

      if (typeof toast === 'function') toast(`${toAdd.length} dialog diimpor!`);
    } catch {
      alert('Gagal membaca file. Pastikan file adalah JSON yang valid.');
    }
  };
  reader.readAsText(file);

  // Reset input file
  event.target.value = '';
}

/* ═══════════════════════════════════════════════════════════════
   INTEGRASI DENGAN MOCK HSK (startMock override)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Override startMock untuk menggabungkan soal ekstra dari dialog AI.
 * Dipanggil setelah inisialisasi.
 */
function patchStartMock() {
  if (typeof window._origStartMock === 'undefined' && typeof startMock === 'function') {
    window._origStartMock = window.startMock;
    window.startMock = function startMock() {
      // Gabungkan MOCK asli + soal dari dialog AI jika ada
      if (mockExtra.length > 0) {
        window.MOCK_COMBINED = [...(typeof MOCK !== 'undefined' ? MOCK : []), ...mockExtra];
      } else {
        window.MOCK_COMBINED = typeof MOCK !== 'undefined' ? MOCK : [];
      }

      // Panggil startMock asli
      window._origStartMock();
    };
  }
}

/* ═══════════════════════════════════════════════════════════════
   INISIALISASI
   ═══════════════════════════════════════════════════════════════ */

function initDialogAI() {
  loadAIDialogs();
  loadMockExtra();
  renderDialogAIPage();
  patchStartMock();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDialogAI);
} else {
  setTimeout(initDialogAI, 150);
}

