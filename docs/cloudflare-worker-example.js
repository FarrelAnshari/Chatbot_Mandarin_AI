/**
 * HànyǔFlow — docs/cloudflare-worker-example.js
 * (OPSIONAL) Contoh Cloudflare Worker sebagai proxy AI
 *
 * Gunakan ini jika kamu tidak ingin API key tersimpan di browser,
 * atau ingin berbagi aplikasi dengan orang lain tanpa mengekspos key.
 *
 * CARA DEPLOY:
 * 1. Buat akun Cloudflare (gratis): https://cloudflare.com
 * 2. Buka https://workers.cloudflare.com
 * 3. Buat Worker baru → paste kode ini
 * 4. Di Pengaturan Worker, tambahkan Secret:
 *    - Nama: AI_API_KEY (isi API key kamu)
 *    - Nama: AI_BASE_URL (isi base URL provider, mis. https://api.groq.com/openai/v1)
 * 5. Deploy Worker → catat URL Worker kamu (mis. https://hanyuflow-proxy.username.workers.dev)
 * 6. Di HànyǔFlow → ⚙ Pengaturan → Provider → "Kustom / Proxy"
 *    Base URL: https://hanyuflow-proxy.username.workers.dev
 *    Model: (isi model yang kamu pakai)
 *    API Key: (kosongkan atau isi string sembarang — tidak dipakai)
 *
 * CATATAN KEAMANAN:
 * - Worker ini meneruskan request ke provider AI menggunakan key yang tersimpan di Cloudflare Secret.
 * - Siapapun yang tahu URL Worker bisa menggunakannya. Tambahkan autentikasi jika perlu.
 * - Jangan commit file ini dengan API key yang sudah diisi.
 * - Cloudflare Workers gratis: 100.000 request/hari.
 */

export default {
  async fetch(request, env) {
    // ── CORS untuk GitHub Pages ──────────────────────────────────
    const allowedOrigins = [
      'https://USERNAME.github.io', // Ganti USERNAME dengan username GitHub kamu
      'http://localhost:5500',       // Untuk development lokal
      'http://127.0.0.1:5500'
    ];

    const origin = request.headers.get('Origin') || '';
    const corsHeaders = {
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };

    if (allowedOrigins.includes(origin)) {
      corsHeaders['Access-Control-Allow-Origin'] = origin;
    }

    // Handle preflight OPTIONS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Hanya terima POST ke /chat/completions
    const url = new URL(request.url);
    if (request.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
      return new Response('Not found', { status: 404, headers: corsHeaders });
    }

    // Ambil body dari request
    let body;
    try {
      body = await request.text();
    } catch {
      return new Response('Bad request', { status: 400, headers: corsHeaders });
    }

    // Ambil konfigurasi dari Cloudflare Secrets
    const apiKey = env.AI_API_KEY;
    const baseURL = (env.AI_BASE_URL || '').replace(/\/$/, '');

    if (!apiKey || !baseURL) {
      return new Response(
        JSON.stringify({ error: 'Worker belum dikonfigurasi. Tambahkan AI_API_KEY dan AI_BASE_URL sebagai Cloudflare Secret.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Teruskan ke provider AI
    let providerResp;
    try {
      providerResp = await fetch(baseURL + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
        },
        body
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Gagal terhubung ke provider AI: ' + err.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Teruskan respons ke client
    const respHeaders = new Headers(corsHeaders);
    respHeaders.set('Content-Type', 'application/json');

    return new Response(providerResp.body, {
      status: providerResp.status,
      headers: respHeaders
    });
  }
};

