const express = require('express');
const cors    = require('cors');
const axios   = require('axios');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;

// ════════════════════════════════════════════════════════════
//  /api/proxy-audio?url=<encoded_url>
//  Proxy download MP3 dari uguu.se / CDN manapun
//  Browser tidak bisa fetch langsung karena CORS uguu.se
//  Vercel bisa karena server-to-server tidak kena CORS
// ════════════════════════════════════════════════════════════
app.get('/api/proxy-audio', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url || !url.startsWith('http')) {
      return res.status(400).json({ status: false, message: 'Parameter url diperlukan' });
    }

    // Validasi hanya boleh dari domain audio yang dikenal
    const allowed = ['uguu.se', 'd.uguu.se', 'cdn.uguu.se', 'catbox.moe', 'files.catbox.moe'];
    const domain  = new URL(url).hostname;
    if (!allowed.some(d => domain.endsWith(d))) {
      return res.status(403).json({ status: false, message: 'Domain tidak diizinkan: ' + domain });
    }

    console.log('[proxy-audio] downloading:', url);

    const audioRes = await axios.get(url, {
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'audio/mpeg, audio/*, */*',
      },
    });

    // Forward headers ke browser
    res.setHeader('Content-Type',        audioRes.headers['content-type'] || 'audio/mpeg');
    res.setHeader('Content-Length',      audioRes.headers['content-length'] || '');
    res.setHeader('Accept-Ranges',       'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');

    audioRes.data.pipe(res);

  } catch (err) {
    console.error('[proxy-audio]', err.message);
    res.status(500).json({ status: false, message: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'pagaska-music-backend', timestamp: new Date().toISOString() });
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => console.log(`✅ Pagaska Music Backend: port ${PORT}`));
}
