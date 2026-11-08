/**
 * HànyǔFlow — js/ai.js
 * Fitur 1: AI Chat Tutor (Mode AI di tab Voice Chat)
 * Fitur 3: Pengaturan AI (BYOK — Bring Your Own Key)
 *
 * Tidak ada key yang di-hardcode di sini.
 * Key hanya diisi pengguna lewat UI dan disimpan di localStorage.
 */

/* ═══════════════════════════════════════════════════════════════
   KONFIGURASI AI — ubah di sini, bukan di fungsi lain
   ═══════════════════════════════════════════════════════════════ */

/** Jumlah giliran percakapan (user+bot pasangan) yang dikirim ke AI */
const MAX_HISTORY_TURNS = 8;

/** Timeout request AI dalam milidetik (60 detik agar aman untuk generate dialog panjang) */
const AI_TIMEOUT_MS = 60000;

/** Delay exponential backoff untuk error 429 (dalam ms) */
const AI_RETRY_DELAYS = [2000, 4000];

/**
 * Preset provider AI yang kompatibel OpenAI.
 * PENTING: URL endpoint dan nama model BISA BERUBAH.
 * Verifikasi selalu di dokumentasi resmi provider sebelum dipakai.
 */
const AI_PROVIDERS = {
  groq: {
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    docsURL: 'https://console.groq.com/docs/openai'
  },
  gemini: {
    label: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.5-flash-lite',
    docsURL: 'https://ai.google.dev/gemini-api/docs/openai'
  },
  openrouter: {
    label: 'OpenRouter (gratis)',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    docsURL: 'https://openrouter.ai/docs/quickstart'
  },
  cerebras: {
    label: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    model: 'llama-3.3-70b',
    docsURL: 'https://inference-docs.cerebras.ai/api-reference/chat-completions'
  },
  custom: {
    label: 'Kustom / Proxy',
    baseURL: '',
    model: '',
    docsURL: ''
  }
};

/**
 * System prompt tutor — mudah diedit.
 * Vocab dari LESSONS akan disuntikkan secara dinamis sebelum dikirim.
 */
const AI_SYSTEM_PROMPT_TEMPLATE = `Kamu adalah tutor Mandarin untuk pemula HSK 1. Pelajar adalah penutur bahasa Indonesia.

ATURAN WAJIB:
1. Hanya gunakan kosakata dan tata bahasa HSK 1. Daftar kata yang diizinkan disuntikkan di bawah.
2. Setiap balasan HARUS dalam format JSON berikut PERSIS — tidak boleh ada teks di luar JSON:
   {"zh":"...","pinyin":"...","id":"...","correction":"...","hint":"..."}
   - "zh": kalimat Mandarinmu (1–2 kalimat pendek)
   - "pinyin": pinyin kalimatmu
   - "id": terjemahan Indonesia
   - "correction": (opsional) koreksi singkat dalam bahasa Indonesia jika jawaban pelajar salah. Kosong jika benar.
   - "hint": (opsional) petunjuk jawaban berikutnya dalam bahasa Indonesia. Boleh kosong.
3. Ajukan SATU pertanyaan sederhana per giliran agar pelajar bisa menjawab.
4. Jangan keluar dari peran tutor Mandarin HSK 1. Jangan membahas topik di luar belajar Mandarin.
5. Balasan MAKSIMAL 1–2 kalimat pendek dalam bahasa Mandarin.
6. Jika ada correction, mulai dengan koreksi dulu, lalu lanjutkan percakapan.

CATATAN PINYIN: Pinyin yang kamu hasilkan bisa mengandung kesalahan. Pelajar disarankan memverifikasi pinyin sebelum menghafal.

KOSAKATA YANG DIIZINKAN (dari materi HSK 1 Pertemuan 1–15):
{VOCAB_LIST}

Topik percakapan saat ini: {TOPIC}`;

/** Topik bebas tambahan di luar skenario yang sudah ada */
const AI_FREE_TOPICS = [
  { name: 'Diri Sendiri', sub: 'Topik bebas', prompt: 'Percakapan santai tentang diri sendiri (nama, asal, umur)' },
  { name: 'Hobi & Kegiatan', sub: 'Topik bebas', prompt: 'Hal yang disukai dan kegiatan sehari-hari' },
  { name: 'Makanan & Minuman', sub: 'Topik bebas', prompt: 'Makanan dan minuman favorit' },
  { name: 'Angka & Harga', sub: 'Topik bebas', prompt: 'Berlatih menyebut angka, harga, dan jumlah' },
  { name: 'Hari & Waktu Bebas', sub: 'Topik bebas', prompt: 'Percakapan tentang hari, jam, dan rencana' }
];

/* ═══════════════════════════════════════════════════════════════
   STATE AI CHAT
   ═══════════════════════════════════════════════════════════════ */

/** Riwayat pesan untuk dikirim ke AI [{role, content}] */
let aiHistory = [];

/** Mode aktif: 'scenario' atau 'ai' */
let chatMode = 'scenario';

/** Topik AI yang dipilih (dari scenarios atau AI_FREE_TOPICS) */
let aiCurrentTopic = null;

/** AbortController untuk request yang sedang berjalan */
let aiAbortCtrl = null;

/** Set karakter Mandarin yang diizinkan (dari LESSONS) */
let ALLOWED_CHARS = new Set();

/* ═══════════════════════════════════════════════════════════════
   UTILS
   ═══════════════════════════════════════════════════════════════ */

/**
 * Escape HTML untuk mencegah XSS.
 * Gunakan ini sebelum memasukkan string ke innerHTML.
 */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Baca konfigurasi AI dari localStorage.
 * @returns {{provider, baseURL, model, apiKey}}
 */
function loadAICfg() {
  try {
    const cfg = JSON.parse(localStorage.getItem('hanyuflow-ai-cfg') || '{}');
    // Auto-fix model yang sudah tidak valid → ganti ke gemini-3.5-flash-lite yang terbukti bekerja
    const INVALID_GEMINI_MODELS = [
      'gemini-2.0-flash-lite', 'gemini-2.0-flash', 'gemini-2.5-flash-lite',
      'gemini-3.0-flash', 'gemini-3.8-flash', 'gemini-1.5-flash', 'gemini-1.5-pro',
      'gemini 3.0 flash', 'gemini 3.5 flash lite', 'gemini 3.8 flash'
    ];
    if (cfg.provider === 'gemini' && INVALID_GEMINI_MODELS.includes(cfg.model)) {
      cfg.model = 'gemini-3.5-flash-lite';
      saveAICfg(cfg);
    }
    return cfg;
  } catch {
    return {};
  }
}

/**
 * Simpan konfigurasi AI ke localStorage.
 * Key tidak pernah ditampilkan di console atau log.
 */
function saveAICfg(cfg) {
  localStorage.setItem('hanyuflow-ai-cfg', JSON.stringify(cfg));
}

/**
 * Bangun daftar kata yang diizinkan dari LESSONS.
 * Dipanggil saat inisialisasi.
 */
function buildAllowedChars() {
  ALLOWED_CHARS = new Set();
  if (typeof LESSONS === 'undefined') return;
  LESSONS.forEach(lesson => {
    lesson.vocab.forEach(([hz]) => {
      [...hz].forEach(ch => ALLOWED_CHARS.add(ch));
    });
  });
  // Tambahkan karakter umum yang sering muncul
  '的了是在有我你他她们我们你们这那什么吗呢吧啊也都和一二三四五六七八九十百千万元块钱'.split('').forEach(ch => ALLOWED_CHARS.add(ch));
}

/**
 * Periksa apakah teks zh mengandung karakter di luar materi.
 * @param {string} zh
 * @returns {string[]} karakter yang tidak diizinkan
 */
function findOutOfScopeChars(zh) {
  const result = [];
  [...zh].forEach(ch => {
    // Skip punctuation dan spasi
    if (/[\u3000-\u303f\uff00-\uffef\s，。？！、…·《》「」『』【】〔〕〖〗〈〉""]/.test(ch)) return;
    if (ch.charCodeAt(0) < 0x4E00) return; // bukan CJK
    if (!ALLOWED_CHARS.has(ch)) result.push(ch);
  });
  return [...new Set(result)];
}

/**
 * Bangun vocab list string dari LESSONS untuk disuntikkan ke system prompt.
 */
function buildVocabList() {
  if (typeof LESSONS === 'undefined') return '(data tidak tersedia)';
  const words = [];
  LESSONS.forEach(lesson => {
    lesson.vocab.forEach(([hz, py, id]) => {
      words.push(`${hz}(${py}=${id})`);
    });
  });
  return words.join(', ');
}

/* ═══════════════════════════════════════════════════════════════
   AI ADAPTOR — Request ke provider OpenAI-compat
   ═══════════════════════════════════════════════════════════════ */

/**
 * Kirim request ke AI provider.
 * @param {Array} messages - [{role, content}]
 * @param {AbortSignal} signal - untuk timeout
 * @returns {Promise<string>} teks balasan dari model
 */
async function callAIRaw(messages, signal, maxTokens = 400) {
  const cfg = loadAICfg();
  if (!cfg.apiKey || !cfg.baseURL || !cfg.model) {
    throw new Error('NO_CONFIG');
  }

  const url = cfg.baseURL.replace(/\/$/, '') + '/chat/completions';

  const body = JSON.stringify({
    model: cfg.model,
    messages,
    temperature: 0.7,
    max_tokens: maxTokens
  });

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + cfg.apiKey
  };

  // Hanya tambahkan header ini jika provider adalah OpenRouter
  if (cfg.provider === 'openrouter') {
    headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = 'HanyuFlow';
  }

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('TIMEOUT');
    throw new Error('NETWORK');
  }

  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) throw new Error('AUTH');
    if (resp.status === 429) throw new Error('RATELIMIT');
    throw new Error('HTTP_' + resp.status);
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new Error('EMPTY');
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('EMPTY');
  return text;
}

/**
 * Pesan error ramah dalam bahasa Indonesia.
 * Key TIDAK PERNAH muncul di pesan ini.
 */
function friendlyError(code) {
  const map = {
    NO_CONFIG: 'AI belum dikonfigurasi. Buka ⚙ Pengaturan, isi provider dan API key terlebih dahulu.',
    AUTH: 'API key tidak valid atau tidak punya akses ke model ini. Periksa key dan nama model di ⚙ Pengaturan.',
    RATELIMIT: 'Batas permintaan tercapai (rate limit). Coba lagi sebentar atau ganti provider.',
    TIMEOUT: 'Permintaan terlalu lama (> 60 detik). Periksa koneksi internet atau coba provider lain.',
    NETWORK: 'Gagal terhubung ke server AI. Mungkin ada masalah koneksi, CORS, atau URL tidak benar.',
    EMPTY: 'AI tidak memberikan jawaban yang dapat dibaca. Coba kirim ulang.',
    PARSE: 'Format jawaban AI tidak terbaca. Sudah dicoba meminta ulang namun tetap gagal.',
  };
  return map[code] || `Terjadi kesalahan tidak terduga (${code}). Coba lagi atau ganti provider.`;
}

/**
 * Kirim ke AI dengan retry untuk 429.
 * @param {Array} messages
 * @param {number} [maxTokens=400] - batas token output
 * @returns {Promise<string>}
 */
async function callAIWithRetry(messages, maxTokens = 400) {
  // Batal request sebelumnya jika ada
  if (aiAbortCtrl) aiAbortCtrl.abort();
  aiAbortCtrl = new AbortController();
  const signal = aiAbortCtrl.signal;

  const timeoutId = setTimeout(() => aiAbortCtrl.abort(), AI_TIMEOUT_MS);

  try {
    for (let attempt = 0; attempt <= AI_RETRY_DELAYS.length; attempt++) {
      try {
        const result = await callAIRaw(messages, signal, maxTokens);
        return result;
      } catch (err) {
        if (err.message === 'RATELIMIT' && attempt < AI_RETRY_DELAYS.length) {
          const delay = AI_RETRY_DELAYS[attempt];
          showAIChatStatus(`⏳ Batas permintaan tercapai. Menunggu ${delay / 1000} detik…`);
          await new Promise(res => setTimeout(res, delay));
          continue;
        }
        throw err;
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ═══════════════════════════════════════════════════════════════
   PARSER BALASAN AI
   ═══════════════════════════════════════════════════════════════ */

/**
 * Parse JSON dari balasan AI secara toleran.
 * Tahan terhadap: code fence ```json, teks ekstra, JSON rusak ringan.
 * @param {string} text
 * @returns {{zh, pinyin, id, correction?, hint?} | null}
 */
function parseAIReply(text) {
  if (!text) return null;

  // 1. Coba strip code fence ```json...```
  let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // 2. Coba parse langsung
  try {
    const obj = JSON.parse(clean);
    if (obj?.zh) return obj;
  } catch {}

  // 3. Cari objek JSON pertama dengan regex
  const match = clean.match(/\{[\s\S]*?\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj?.zh) return obj;
    } catch {}
  }

  // 4. Cari objek JSON yang lebih panjang (mungkin nested)
  const bigMatch = clean.match(/\{[\s\S]+\}/);
  if (bigMatch) {
    try {
      const obj = JSON.parse(bigMatch[0]);
      if (obj?.zh) return obj;
    } catch {}
  }

  return null;
}

/* ═══════════════════════════════════════════════════════════════
   AI CHAT UI
   ═══════════════════════════════════════════════════════════════ */

/**
 * Tampilkan status singkat di area feedback chat.
 */
function showAIChatStatus(msg) {
  const el = document.getElementById('chatFeedback');
  if (el) {
    el.innerHTML = '<b>Status:</b> ' + escapeHtml(msg);
  }
}

/**
 * Tambahkan bubble AI ke chatbox dengan fitur listening-first.
 * @param {{zh, pinyin, id, correction?, hint?}} parsed
 */
function addAIBubble(parsed) {
  const box = document.getElementById('chatBox');
  if (!box) return;

  const bubble = document.createElement('div');
  bubble.className = 'bubble bot ai-bubble';

  // Cek karakter di luar materi
  const oosChars = findOutOfScopeChars(parsed.zh || '');
  const hasOOS = oosChars.length > 0;

  // Buat elemen teks (tersembunyi secara default = listening-first)
  const textDiv = document.createElement('div');
  textDiv.className = 'ai-text hidden';

  const zhSpan = document.createElement('span');
  zhSpan.className = 'zh';
  zhSpan.textContent = parsed.zh || '';

  const piSpan = document.createElement('span');
  piSpan.className = 'pi';
  piSpan.textContent = parsed.pinyin || '';

  const idSpan = document.createElement('span');
  idSpan.className = 'id';
  idSpan.textContent = parsed.id || '';

  const noteSpan = document.createElement('small');
  noteSpan.className = 'ai-note';
  noteSpan.textContent = '⚠ Periksa pinyin sebelum dihafal.';

  textDiv.appendChild(zhSpan);
  textDiv.appendChild(piSpan);
  textDiv.appendChild(idSpan);
  textDiv.appendChild(noteSpan);

  // Badge karakter di luar materi
  if (hasOOS) {
    const oosBadge = document.createElement('div');
    oosBadge.className = 'oos-badge';
    oosBadge.textContent = '⚠ Kata di luar materi: ' + oosChars.join(', ');
    textDiv.appendChild(oosBadge);
  }

  // Kontrol listening-first
  const ctrlDiv = document.createElement('div');
  ctrlDiv.className = 'ai-ctrl';

  // Tombol Ulangi TTS
  const btnRepeat = document.createElement('button');
  btnRepeat.className = 'btn soft ai-btn';
  btnRepeat.setAttribute('aria-label', 'Ulangi audio');
  btnRepeat.textContent = '🔊 Ulangi';
  btnRepeat.onclick = () => speakZh(parsed.zh, CFG.TTS_RATE_NORMAL);

  // Tombol Pelan
  const btnSlow = document.createElement('button');
  btnSlow.className = 'btn outline ai-btn';
  btnSlow.setAttribute('aria-label', 'Putar pelan');
  btnSlow.textContent = '🐢 Pelan';
  btnSlow.onclick = () => speakZh(parsed.zh, CFG.TTS_RATE_SLOW);

  // Tombol Tampilkan/Sembunyikan teks
  const btnShow = document.createElement('button');
  btnShow.className = 'btn outline ai-btn';
  btnShow.setAttribute('aria-label', 'Tampilkan atau sembunyikan teks');
  btnShow.textContent = '👁 Tampilkan';
  btnShow.setAttribute('aria-pressed', 'false');
  btnShow.onclick = () => {
    const hidden = textDiv.classList.toggle('hidden');
    btnShow.textContent = hidden ? '👁 Tampilkan' : '🙈 Sembunyikan';
    btnShow.setAttribute('aria-pressed', String(!hidden));
  };

  ctrlDiv.appendChild(btnRepeat);
  ctrlDiv.appendChild(btnSlow);
  ctrlDiv.appendChild(btnShow);

  // Tombol "Minta versi lebih sederhana" jika ada OOS
  if (hasOOS) {
    const btnSimpler = document.createElement('button');
    btnSimpler.className = 'btn outline ai-btn';
    btnSimpler.setAttribute('aria-label', 'Minta versi kalimat yang lebih sederhana');
    btnSimpler.textContent = '✂ Minta versi lebih sederhana';
    btnSimpler.onclick = () => sendAIMessage('__SIMPLIFY__');
    ctrlDiv.appendChild(btnSimpler);
  }

  // Correction dan hint
  if (parsed.correction) {
    const corrDiv = document.createElement('div');
    corrDiv.className = 'ai-correction';
    corrDiv.textContent = '📝 ' + parsed.correction;
    bubble.appendChild(corrDiv);
  }

  bubble.appendChild(ctrlDiv);
  bubble.appendChild(textDiv);

  if (parsed.hint) {
    const hintDiv = document.createElement('div');
    hintDiv.className = 'ai-hint';
    hintDiv.textContent = '💡 ' + parsed.hint;
    bubble.appendChild(hintDiv);
  }

  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;

  // Auto-play TTS (listening-first)
  speakZh(parsed.zh, CFG.TTS_RATE_NORMAL);
}

/**
 * Tambahkan bubble user ke chatbox (teks aman via textContent).
 */
function addUserBubble(text) {
  const box = document.getElementById('chatBox');
  if (!box) return;

  const bubble = document.createElement('div');
  bubble.className = 'bubble user';

  const zhSpan = document.createElement('span');
  zhSpan.className = 'zh';
  zhSpan.textContent = text; // textContent — aman dari XSS

  const idSpan = document.createElement('span');
  idSpan.className = 'id';
  idSpan.textContent = 'Jawabanmu';

  bubble.appendChild(zhSpan);
  bubble.appendChild(idSpan);
  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;
}

/**
 * Tambahkan bubble loading/thinking.
 */
function addLoadingBubble() {
  const box = document.getElementById('chatBox');
  if (!box) return null;

  const bubble = document.createElement('div');
  bubble.className = 'bubble bot ai-loading';

  const span = document.createElement('span');
  span.textContent = '⌛ AI sedang mengetik…';
  bubble.appendChild(span);

  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;
  return bubble;
}

/**
 * Tambahkan bubble error (ramah, tanpa key).
 */
function addErrorBubble(msg) {
  const box = document.getElementById('chatBox');
  if (!box) return;

  const bubble = document.createElement('div');
  bubble.className = 'bubble bot ai-error';

  const span = document.createElement('span');
  span.textContent = '⚠ ' + msg;
  bubble.appendChild(span);

  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;
}

/* ═══════════════════════════════════════════════════════════════
   AI CHAT LOGIC
   ═══════════════════════════════════════════════════════════════ */

/**
 * Kirim pesan ke AI dan tampilkan balasan.
 * @param {string} userText - pesan user (atau '__SIMPLIFY__' untuk minta versi lebih sederhana)
 */
async function sendAIMessage(userText) {
  const cfg = loadAICfg();
  if (!cfg.apiKey || !cfg.baseURL || !cfg.model) {
    addErrorBubble(friendlyError('NO_CONFIG'));
    // Fallback ke skenario
    fallbackToScenario('AI belum dikonfigurasi. Mode skenario diaktifkan.');
    return;
  }

  // Buat pesan user untuk history
  const userContent = userText === '__SIMPLIFY__'
    ? 'Tolong ulangi kalimat terakhirmu dengan kata-kata HSK 1 yang lebih dasar. Tetap dalam format JSON yang sama.'
    : userText;

  // Tampilkan bubble user (kecuali untuk __SIMPLIFY__)
  if (userText !== '__SIMPLIFY__') {
    addUserBubble(userText);
    // Update progress
    if (typeof P !== 'undefined') {
      P.speak = (P.speak || 0) + 1;
      if (typeof saveP === 'function') saveP();
    }
  }

  // Tambah ke history
  aiHistory.push({ role: 'user', content: userContent });

  // Potong history sesuai MAX_HISTORY_TURNS
  const maxItems = MAX_HISTORY_TURNS * 2;
  if (aiHistory.length > maxItems) {
    aiHistory = aiHistory.slice(aiHistory.length - maxItems);
  }

  // Bangun messages untuk dikirim
  const topic = aiCurrentTopic?.name || 'Percakapan HSK 1 umum';
  const systemPrompt = AI_SYSTEM_PROMPT_TEMPLATE
    .replace('{VOCAB_LIST}', buildVocabList())
    .replace('{TOPIC}', topic);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...aiHistory
  ];

  // Tampilkan loading
  const loadingBubble = addLoadingBubble();

  try {
    showAIChatStatus('Mengirim ke AI…');
    const rawText = await callAIWithRetry(messages);

    // Hapus loading
    if (loadingBubble) loadingBubble.remove();

    // Parse JSON
    let parsed = parseAIReply(rawText);

    if (!parsed) {
      // Retry sekali dengan instruksi ulang
      showAIChatStatus('Format tidak terbaca, meminta ulang…');
      const retryMessages = [
        ...messages,
        { role: 'assistant', content: rawText },
        { role: 'user', content: 'Format JSON-mu tidak terbaca. Tolong kirim ulang HANYA objek JSON: {"zh":"...","pinyin":"...","id":"...","correction":"...","hint":"..."}' }
      ];
      try {
        const retryRaw = await callAIWithRetry(retryMessages);
        parsed = parseAIReply(retryRaw);
      } catch {}
    }

    if (!parsed) {
      addErrorBubble(friendlyError('PARSE'));
      showAIChatStatus('Gagal memproses balasan AI.');
      return;
    }

    // Tambah balasan AI ke history
    aiHistory.push({ role: 'assistant', content: JSON.stringify(parsed) });

    // Render bubble AI
    addAIBubble(parsed);
    showAIChatStatus('✓ Siap. Jawab dengan mikrofon atau ketik.');

  } catch (err) {
    if (loadingBubble) loadingBubble.remove();

    const code = err.message || 'UNKNOWN';
    const msg = friendlyError(code);
    addErrorBubble(msg);
    showAIChatStatus('Error: ' + code);

    // Jika NO_CONFIG, fallback ke skenario
    if (code === 'NO_CONFIG') {
      fallbackToScenario('AI belum dikonfigurasi. Mode skenario diaktifkan.');
    }
  }
}

/**
 * Fallback ke mode skenario dengan pesan yang jelas.
 */
function fallbackToScenario(reason) {
  chatMode = 'scenario';
  updateChatModeUI();
  if (typeof toast === 'function') toast('↩ ' + reason);
  showAIChatStatus(reason);
}

/**
 * Mulai percakapan AI baru.
 */
function startNewAIConversation() {
  aiHistory = [];
  const box = document.getElementById('chatBox');
  if (box) box.innerHTML = '';
  showAIChatStatus('Percakapan baru dimulai. Pilih topik di kiri atau ketik/bicara untuk memulai.');

  // Kirim greeting awal dari AI
  if (aiCurrentTopic) {
    const greeting = aiCurrentTopic.start
      ? `Mulai percakapan dengan topik "${aiCurrentTopic.name}". Ucapkan salam pembuka sesuai topik tersebut dalam format JSON.`
      : `Mulai percakapan dengan topik "${aiCurrentTopic.prompt || aiCurrentTopic.name}". Ucapkan salam pembuka dalam format JSON.`;
    // Inject sebagai "user" untuk trigger AI
    sendAITrigger(greeting);
  } else {
    sendAITrigger('Ucapkan salam pembuka dalam bahasa Mandarin HSK 1 dan tanyakan kabar pelajar dalam format JSON.');
  }
}

/**
 * Trigger AI tanpa menampilkan bubble user (untuk inisialisasi percakapan).
 */
async function sendAITrigger(instruction) {
  const cfg = loadAICfg();
  if (!cfg.apiKey || !cfg.baseURL || !cfg.model) {
    addErrorBubble('Isi API key di ⚙ Pengaturan untuk memulai AI Chat.');
    return;
  }

  const topic = aiCurrentTopic?.name || 'Percakapan HSK 1 umum';
  const systemPrompt = AI_SYSTEM_PROMPT_TEMPLATE
    .replace('{VOCAB_LIST}', buildVocabList())
    .replace('{TOPIC}', topic);

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: instruction }
  ];

  const loadingBubble = addLoadingBubble();
  try {
    const rawText = await callAIWithRetry(messages);
    if (loadingBubble) loadingBubble.remove();
    const parsed = parseAIReply(rawText);
    if (parsed) {
      aiHistory.push({ role: 'assistant', content: JSON.stringify(parsed) });
      addAIBubble(parsed);
      showAIChatStatus('✓ Siap. Jawab dengan mikrofon atau ketik.');
    } else {
      addErrorBubble('Tidak bisa memulai percakapan. Coba klik "Percakapan Baru" lagi.');
      if (loadingBubble) loadingBubble.remove();
    }
  } catch (err) {
    if (loadingBubble) loadingBubble.remove();
    addErrorBubble(friendlyError(err.message));
  }
}

/* ═══════════════════════════════════════════════════════════════
   MODE TOGGLE UI
   ═══════════════════════════════════════════════════════════════ */

/**
 * Update tampilan UI sesuai mode chat yang aktif.
 */
function updateChatModeUI() {
  const scenarioMode = document.getElementById('scenarioModeBtn');
  const aiMode = document.getElementById('aiModeBtn');
  const scenarioPanel = document.getElementById('scenarioPanel');
  const aiPanel = document.getElementById('aiPanel');
  const chatInputRow = document.getElementById('chatInputRow');

  if (!scenarioMode || !aiMode) return;

  const isAI = chatMode === 'ai';

  scenarioMode.classList.toggle('active', !isAI);
  aiMode.classList.toggle('active', isAI);
  scenarioMode.setAttribute('aria-pressed', String(!isAI));
  aiMode.setAttribute('aria-pressed', String(isAI));

  if (scenarioPanel) scenarioPanel.classList.toggle('hidden', isAI);
  if (aiPanel) aiPanel.classList.toggle('hidden', !isAI);

  // Update placeholder input
  const input = document.getElementById('chatInput');
  if (input) {
    input.placeholder = isAI
      ? 'Ketik jawaban Mandarin atau gunakan mikrofon…'
      : 'Speak Mandarin or type Hanzi/pinyin…';
  }
}

/**
 * Ganti mode chat.
 */
function setChatMode(mode) {
  chatMode = mode;
  updateChatModeUI();

  if (mode === 'ai') {
    const cfg = loadAICfg();
    if (!cfg.apiKey || !cfg.baseURL || !cfg.model) {
      showAIChatStatus('Isi API key di ⚙ Pengaturan terlebih dahulu, lalu kembali ke sini.');
    } else {
      showAIChatStatus('Mode AI aktif. Pilih topik atau langsung bicara/ketik.');
    }
  }
}

/**
 * Pilih topik AI dari skenario yang ada atau topik bebas.
 */
function selectAITopic(topicObj) {
  aiCurrentTopic = topicObj;

  // Update UI highlight
  document.querySelectorAll('.ai-topic-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.topicName === topicObj.name);
  });

  // Mulai percakapan baru dengan topik ini
  startNewAIConversation();
}

/**
 * Render daftar topik AI di sidebar.
 */
function renderAITopics() {
  const panel = document.getElementById('aiPanel');
  if (!panel) return;

  // Gabungkan skenario + topik bebas
  const allTopics = [
    ...(typeof scenarios !== 'undefined' ? scenarios : []),
    ...AI_FREE_TOPICS
  ];

  let html = '<h3>Topik Percakapan</h3>';

  html += '<div class="ai-topic-list">';
  allTopics.forEach((t, i) => {
    html += `<button class="scenario ai-topic-btn" 
      data-topic-name="${escapeHtml(t.name)}"
      data-topic-idx="${i}"
      aria-label="Pilih topik: ${escapeHtml(t.name)}"
      onclick="selectAITopic(allAITopics[${i}])">
      <b>${escapeHtml(t.name)}</b>
      <small>${escapeHtml(t.sub || '')}</small>
    </button>`;
  });
  html += '</div>';

  html += `<div style="margin-top:10px">
    <button class="btn redBtn" style="width:100%" 
      aria-label="Mulai percakapan AI baru"
      onclick="startNewAIConversation()">🔄 Percakapan Baru</button>
  </div>`;

  panel.innerHTML = html;

  // Expose ke global untuk onclick handler
  window.allAITopics = allTopics;
}

/* ═══════════════════════════════════════════════════════════════
   OVERRIDE sendChat DAN listenChat UNTUK MODE AI
   ═══════════════════════════════════════════════════════════════ */

/**
 * sendChat versi baru — delegasi ke AI atau skenario tergantung mode.
 * Override fungsi sendChat dari index.html.
 */
window.sendChat = function sendChat() {
  const input = document.getElementById('chatInput');
  const t = (input?.value || '').trim();
  if (!t) return;
  if (input) input.value = '';

  if (chatMode === 'ai') {
    sendAIMessage(t);
  } else {
    // Mode skenario — logic asli
    sendChatScenario(t);
  }
};

/**
 * listenChat versi baru — delegasi ke AI atau skenario.
 */
window.listenChat = function listenChat() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    if (typeof toast === 'function') toast('Gunakan Chrome/Edge atau ketik jawaban.');
    return;
  }

  const r = new SR();
  r.lang = 'zh-CN';
  r.interimResults = false;

  const micBtn = document.getElementById('chatMic');
  if (micBtn) micBtn.classList.add('listening');

  r.onresult = e => {
    const text = e.results[0][0].transcript;
    const input = document.getElementById('chatInput');
    if (input) input.value = text;
    window.sendChat();
  };

  r.onend = () => {
    if (micBtn) micBtn.classList.remove('listening');
  };

  r.onerror = e => {
    if (micBtn) micBtn.classList.remove('listening');
    if (typeof toast === 'function') toast('Mic: ' + e.error);
  };

  r.start();
};

/* ═══════════════════════════════════════════════════════════════
   FITUR 3: PENGATURAN AI
   ═══════════════════════════════════════════════════════════════ */

/**
 * Render panel pengaturan AI.
 */
function renderSettings() {
  const container = document.getElementById('settingsContent');
  if (!container) return;

  const cfg = loadAICfg();
  const selectedProvider = cfg.provider || 'groq';

  let providerOptions = '';
  Object.entries(AI_PROVIDERS).forEach(([key, p]) => {
    providerOptions += `<option value="${key}" ${selectedProvider === key ? 'selected' : ''}>${escapeHtml(p.label)}</option>`;
  });

  container.innerHTML = `
    <div class="card" style="max-width:640px">
      <h3>🤖 Konfigurasi AI Provider</h3>
      
      <div class="settings-warning">
        ⚠ <strong>Peringatan keamanan:</strong> API key tersimpan di browser ini saja (localStorage). 
        <strong>Jangan gunakan di komputer umum / lab / warnet.</strong>
        Key tidak dikirim ke server mana pun selain provider AI yang kamu pilih.
      </div>

      <div class="form-group">
        <label for="settingProvider">Provider AI</label>
        <select id="settingProvider" aria-label="Pilih provider AI" onchange="onProviderChange(this.value)">
          ${providerOptions}
        </select>
        <small id="settingDocsLink" class="settings-docs"></small>
      </div>

      <div class="form-group">
        <label for="settingBaseURL">Base URL <span class="muted-label">(endpoint OpenAI-compat)</span></label>
        <input type="url" id="settingBaseURL" 
          value="${escapeHtml(cfg.baseURL || AI_PROVIDERS[selectedProvider]?.baseURL || '')}"
          placeholder="https://api.groq.com/openai/v1"
          aria-label="Base URL provider AI" />
        <small class="settings-note">⚠ URL dan model dapat berubah sewaktu-waktu. 
          Verifikasi di dokumentasi resmi provider sebelum dipakai.</small>
      </div>

      <div class="form-group">
        <label for="settingModel">Nama Model</label>
        <input type="text" id="settingModel" 
          value="${escapeHtml(cfg.model || AI_PROVIDERS[selectedProvider]?.model || '')}"
          placeholder="llama-3.3-70b-versatile"
          aria-label="Nama model AI" />
        <small>Nama model bisa diubah sesuai model yang tersedia di provider.</small>
      </div>

      <div class="form-group">
        <label for="settingKey">API Key</label>
        <div class="key-input-row">
          <input type="password" id="settingKey" 
            value="${escapeHtml(cfg.apiKey || '')}"
            placeholder="Masukkan API key kamu"
            autocomplete="off"
            aria-label="API key untuk provider AI" />
          <button class="btn outline" onclick="toggleKeyVisibility()" aria-label="Tampilkan atau sembunyikan API key">👁</button>
          <button class="btn outline" onclick="clearAPIKey()" aria-label="Hapus API key">🗑 Hapus</button>
        </div>
        <small style="color:var(--bad)">⚠ Jangan bagikan key ini kepada siapa pun.</small>
      </div>

      <div class="form-group">
        <label for="settingVoiceA">Suara TTS — Pembicara A</label>
        <div style="display:flex;gap:8px;align-items:center">
          <select id="settingVoiceA" aria-label="Pilih suara TTS untuk pembicara A" style="flex:1"></select>
          <button class="btn soft" onclick="testVoice('A')" aria-label="Tes suara A">🔊 Tes</button>
        </div>
      </div>

      <div class="form-group">
        <label for="settingVoiceB">Suara TTS — Pembicara B</label>
        <div style="display:flex;gap:8px;align-items:center">
          <select id="settingVoiceB" aria-label="Pilih suara TTS untuk pembicara B" style="flex:1"></select>
          <button class="btn soft" onclick="testVoice('B')" aria-label="Tes suara B">🔊 Tes</button>
        </div>
        <div id="voiceWarning" class="settings-warning hidden">
          ⚠ Tidak ada suara Mandarin terdeteksi. 
          Di Windows: <strong>Settings → Time & Language → Language & Region → Tambah bahasa "Chinese (Simplified)" 
          → klik bahasa → Options → Speech → Download.</strong>
        </div>
      </div>

      <div class="actions" style="margin-top:16px">
        <button class="btn primary" onclick="saveSettings()" aria-label="Simpan pengaturan AI">💾 Simpan</button>
        <button class="btn soft" onclick="testConnection()" aria-label="Tes koneksi ke provider AI">🔌 Tes Koneksi</button>
      </div>
      
      <div id="settingTestResult" style="margin-top:12px;padding:10px;border-radius:12px;display:none"></div>
    </div>

    <div class="card" style="max-width:640px;margin-top:14px">
      <h3>📖 Cara Mendapatkan API Key Gratis</h3>
      <div class="provider-guide">
        <div class="guide-item">
          <b>Groq</b> — Paling cepat untuk model Llama<br>
          <small>1. Daftar di <a href="https://console.groq.com" target="_blank" rel="noopener">console.groq.com</a><br>
          2. API Keys → Create API Key<br>
          3. Batas gratis: ~100 req/menit (Llama 3.3), tersedia di sebagian besar wilayah<br>
          4. Model: <code>llama-3.3-70b-versatile</code></small>
        </div>
        <div class="guide-item">
          <b>Google Gemini</b><br>
          <small>1. Buka <a href="https://aistudio.google.com" target="_blank" rel="noopener">aistudio.google.com</a> → Get API key<br>
          2. Batas gratis: kueri harian melimpah di Google AI Studio<br>
          3. Model: <code>gemini-3.5-flash-lite</code></small>
        </div>
        <div class="guide-item">
          <b>OpenRouter</b> — Banyak pilihan model gratis<br>
          <small>1. Daftar di <a href="https://openrouter.ai" target="_blank" rel="noopener">openrouter.ai</a><br>
          2. Keys → Create key<br>
          3. Pilih model yang berakhiran <code>:free</code><br>
          4. Batas gratis bervariasi per model (cek di situs)</small>
        </div>
        <div class="guide-item">
          <b>Cerebras</b> — Inferensi sangat cepat<br>
          <small>1. Daftar di <a href="https://cloud.cerebras.ai" target="_blank" rel="noopener">cloud.cerebras.ai</a><br>
          2. API Keys → New Key<br>
          3. Model: <code>llama-3.3-70b</code></small>
        </div>
      </div>
    </div>`;

  // Update docs link
  onProviderChange(selectedProvider);

  // Populate voice selectors
  populateVoiceSelectors();
}

/**
 * Update Base URL dan model saat provider berubah.
 */
function onProviderChange(providerKey) {
  const p = AI_PROVIDERS[providerKey];
  if (!p) return;

  const urlEl = document.getElementById('settingBaseURL');
  const modelEl = document.getElementById('settingModel');
  const docsEl = document.getElementById('settingDocsLink');

  if (urlEl && p.baseURL) urlEl.value = p.baseURL;
  if (modelEl && p.model) modelEl.value = p.model;
  if (docsEl && p.docsURL) {
    docsEl.innerHTML = `📄 Docs: <a href="${escapeHtml(p.docsURL)}" target="_blank" rel="noopener">${escapeHtml(p.docsURL)}</a>`;
  }
}

/**
 * Toggle visibilitas API key.
 */
function toggleKeyVisibility() {
  const input = document.getElementById('settingKey');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

/**
 * Hapus API key dari localStorage.
 */
function clearAPIKey() {
  const cfg = loadAICfg();
  delete cfg.apiKey;
  saveAICfg(cfg);
  const input = document.getElementById('settingKey');
  if (input) {
    input.value = '';
    input.dataset.hasKey = 'false';
  }
  if (typeof toast === 'function') toast('API key dihapus.');
}

/**
 * Simpan semua pengaturan.
 */
function saveSettings() {
  const provider = document.getElementById('settingProvider')?.value || 'custom';
  const baseURL = document.getElementById('settingBaseURL')?.value?.trim() || '';
  const model = document.getElementById('settingModel')?.value?.trim() || '';
  const keyInput = document.getElementById('settingKey');

  const cfg = loadAICfg();
  cfg.provider = provider;
  cfg.baseURL = baseURL;
  cfg.model = model;

  const rawKey = keyInput ? keyInput.value.trim() : '';
  if (rawKey) {
    cfg.apiKey = rawKey;
  }

  // Simpan preferensi suara
  const voiceA = document.getElementById('settingVoiceA')?.value;
  const voiceB = document.getElementById('settingVoiceB')?.value;
  if (voiceA) cfg.voiceA = voiceA;
  if (voiceB) cfg.voiceB = voiceB;

  saveAICfg(cfg);
  if (typeof toast === 'function') toast('Pengaturan tersimpan!');

  // Refresh settings display (mask key)
  renderSettings();
}

/**
 * Tes koneksi ke provider.
 */
async function testConnection() {
  const resultEl = document.getElementById('settingTestResult');
  if (!resultEl) return;

  // Simpan dulu sebelum tes
  saveSettings();

  resultEl.style.display = 'block';
  resultEl.style.background = '#fff4d5';
  resultEl.textContent = '🔌 Menguji koneksi…';

  try {
    const testMessages = [
      { role: 'system', content: 'You are a helpful assistant. Reply very briefly.' },
      { role: 'user', content: 'Reply with ONLY this exact JSON: {"status":"ok"}' }
    ];

    const result = await callAIWithRetry(testMessages);
    resultEl.style.background = '#e4f1e9';
    resultEl.textContent = '✅ Koneksi berhasil! Respons: ' + result.substring(0, 100);
  } catch (err) {
    resultEl.style.background = '#f8e8e2';
    resultEl.textContent = '❌ ' + friendlyError(err.message);
  }
}

/**
 * Populate dropdown pemilih suara TTS.
 */
function populateVoiceSelectors() {
  const selectA = document.getElementById('settingVoiceA');
  const selectB = document.getElementById('settingVoiceB');
  const warning = document.getElementById('voiceWarning');
  if (!selectA || !selectB) return;

  const cfg = loadAICfg();

  function populate() {
    const voices = speechSynthesis.getVoices();
    const zhVoices = voices.filter(v => v.lang.startsWith('zh'));

    if (zhVoices.length === 0) {
      if (warning) warning.classList.remove('hidden');
      selectA.innerHTML = '<option value="">-- Tidak ada suara Mandarin --</option>';
      selectB.innerHTML = '<option value="">-- Tidak ada suara Mandarin --</option>';
      return;
    }

    if (warning) warning.classList.add('hidden');

    const opts = zhVoices.map(v =>
      `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)} (${escapeHtml(v.lang)})</option>`
    ).join('');

    selectA.innerHTML = opts;
    selectB.innerHTML = opts;

    // Restore pilihan tersimpan
    if (cfg.voiceA) selectA.value = cfg.voiceA;
    if (cfg.voiceB && zhVoices.length > 1) {
      selectB.value = cfg.voiceB;
    } else if (zhVoices.length > 1) {
      // Default: pilih suara kedua untuk B
      selectB.value = zhVoices[1].name;
    }
  }

  populate();
  speechSynthesis.onvoiceschanged = populate;
}

/**
 * Tes suara TTS (A atau B).
 */
function testVoice(speaker) {
  const selectEl = document.getElementById('settingVoice' + speaker);
  if (!selectEl || !selectEl.value) return;

  const voices = speechSynthesis.getVoices();
  const voice = voices.find(v => v.name === selectEl.value);
  if (!voice) return;

  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance('你好，我是你的汉语老师。');
  utt.voice = voice;
  utt.lang = 'zh-CN';
  utt.rate = CFG.TTS_RATE_NORMAL;
  speechSynthesis.speak(utt);
}

/**
 * Dapatkan voice object berdasarkan nama yang tersimpan.
 */
function getVoiceByName(name) {
  if (!name) return null;
  return speechSynthesis.getVoices().find(v => v.name === name) || null;
}

/* ═══════════════════════════════════════════════════════════════
   INISIALISASI
   ═══════════════════════════════════════════════════════════════ */

/**
 * Inisialisasi semua fitur AI saat DOM siap.
 */
function initAI() {
  buildAllowedChars();
  renderAITopics();
  renderSettings();
  updateChatModeUI();

  // Set topik AI default ke skenario pertama
  if (typeof scenarios !== 'undefined' && scenarios.length > 0) {
    aiCurrentTopic = scenarios[0];
  }
}

// Jalankan setelah DOM + data tersedia
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAI);
} else {
  // DOM sudah siap
  setTimeout(initAI, 100);
}

