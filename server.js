const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const FormData = require('form-data');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;

// ════════════════════════════════════════════════════════════
//  /api/proxy-audio?url=<encoded_url>
//  Proxy download MP3 (untuk audio playback langsung)
// ════════════════════════════════════════════════════════════
app.get('/api/proxy-audio', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url || !url.startsWith('http')) {
      return res.status(400).json({ status: false, message: 'Parameter url diperlukan' });
    }
    const allowed = ['uguu.se','d.uguu.se','cdn.uguu.se','catbox.moe','files.catbox.moe',
                     'anabot.my.id','api.deline.web.id','api.apocalypse.web.id',
                     'mymp3.xyz','savenow.to','p.savenow.to'];
    const domain = new URL(url).hostname;
    if (!allowed.some(d => domain.endsWith(d))) {
      return res.status(403).json({ status: false, message: 'Domain tidak diizinkan: ' + domain });
    }
    const audioRes = await axios.get(url, {
      responseType: 'stream',
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'audio/mpeg, audio/*, */*',
        'Referer': 'https://savenow.to/',
      },
    });
    res.setHeader('Content-Type', audioRes.headers['content-type'] || 'audio/mpeg');
    res.setHeader('Content-Length', audioRes.headers['content-length'] || '');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    audioRes.data.pipe(res);
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  /api/yt-search?q=<query>
//  Proxy YouTube search via Anabot (bypass CORS)
// ════════════════════════════════════════════════════════════
app.get('/api/yt-search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ success: false, message: 'q required' });

    // Coba Anabot dulu
    try {
      const r = await axios.get(
        `https://anabot.my.id/api/search/ytSearch?query=${encodeURIComponent(q)}&apikey=freeApikey`,
        { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      return res.json({ success: true, source: 'anabot', data: r.data });
    } catch (e) {
      console.warn('[yt-search] Anabot failed:', e.message);
    }

    // Fallback: Deline
    const r2 = await axios.get(
      `https://api.deline.web.id/search/youtube?q=${encodeURIComponent(q)}`,
      { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    res.json({ success: true, source: 'deline', data: r2.data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  /api/yt-dl?url=<youtube_url>
//  Proxy YouTube MP3 download via Anabot (bypass CORS)
// ════════════════════════════════════════════════════════════
app.get('/api/yt-dl', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ success: false, message: 'url required' });

    // Coba Anabot dulu
    try {
      const r = await axios.get(
        `https://anabot.my.id/api/download/ytmp3?url=${encodeURIComponent(url)}&apikey=freeApikey`,
        { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      return res.json({ success: true, source: 'anabot', data: r.data });
    } catch (e) {
      console.warn('[yt-dl] Anabot failed:', e.message);
    }

    // Fallback: Savenow/Herza (polling)
    const videoId = url.match(/[?&v=|youtu\.be\/]([a-zA-Z0-9_-]{11})/)?.[1];
    if (!videoId) return res.status(400).json({ success: false, message: 'Invalid YouTube URL' });

    const init = await axios.get(
      `https://p.savenow.to/ajax/download.php?copyright=0&format=mp3&url=${encodeURIComponent('https://www.youtube.com/watch?v='+videoId)}&api=dfcb6d76f2f6a9894gjkege8a4ab232222`,
      { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://savenow.to/' } }
    );
    if (!init.data.success) throw new Error('Savenow init failed');

    let dlUrl = null;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const prog = await axios.get(init.data.progress_url, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://savenow.to/' }
      });
      if (prog.data.success === 1 && prog.data.download_url) {
        dlUrl = prog.data.download_url;
        break;
      }
    }
    if (!dlUrl) throw new Error('Savenow polling timeout');

    res.json({
      success: true, source: 'savenow',
      data: { data: { result: { success: true, urls: dlUrl,
        metadata: { title: init.data.info?.title || videoId,
                    thumbnail: init.data.info?.image || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }
      }}}
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  /api/apple-search?q=<query>
//  Proxy Apple Music search via Apocalypse + Deline
// ════════════════════════════════════════════════════════════
app.get('/api/apple-search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ success: false });

    try {
      const r = await axios.get(
        `https://api.apocalypse.web.id/search/applemusic?q=${encodeURIComponent(q)}`,
        { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      return res.json({ success: true, source: 'apocalypse', data: r.data });
    } catch (e) {
      console.warn('[apple-search] Apocalypse failed:', e.message);
    }

    const r2 = await axios.get(
      `https://api.deline.web.id/search/applemusic?q=${encodeURIComponent(q)}`,
      { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    res.json({ success: true, source: 'deline', data: r2.data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  /api/apple-dl?url=<apple_music_url>
//  Proxy Apple Music download via Apocalypse
// ════════════════════════════════════════════════════════════
app.get('/api/apple-dl', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ success: false });
    const r = await axios.get(
      `https://api.apocalypse.web.id/download/applemusic?url=${encodeURIComponent(url)}&quality=320`,
      { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    res.json({ success: true, data: r.data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  /api/faa?q=<query>
//  Proxy FAA Spotify (bypass CORS)
// ════════════════════════════════════════════════════════════
app.get('/api/faa', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ status: false });
    const r = await axios.get(
      `https://api-faa.my.id/faa/spotify-play?q=${encodeURIComponent(q)}`,
      { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  /api/catbox-upload
//  Upload audio ke catbox.moe dari server (bypass CORS)
//  Body: { audioUrl: string, filename: string }
// ════════════════════════════════════════════════════════════
app.post('/api/catbox-upload', async (req, res) => {
  try {
    const { audioUrl, filename } = req.body;
    if (!audioUrl) return res.status(400).json({ success: false, message: 'audioUrl required' });

    // Download audio dulu dari sumber asli
    const audioRes = await axios.get(audioUrl, {
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: 200 * 1024 * 1024, // 200MB max
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://savenow.to/',
      },
    });

    const contentType = audioRes.headers['content-type'] || 'audio/mpeg';
    const ext = contentType.includes('mp4') ? 'mp4'
              : contentType.includes('ogg') ? 'ogg'
              : 'mp3';
    const fname = (filename || 'audio').replace(/[^a-zA-Z0-9\-_.]/g, '-').slice(0, 60) + '.' + ext;

    // Upload ke catbox
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('userhash', '');
    form.append('fileToUpload', Buffer.from(audioRes.data), {
      filename: fname,
      contentType: contentType,
    });

    const catRes = await axios.post('https://catbox.moe/user/api.php', form, {
      headers: { ...form.getHeaders() },
      timeout: 120000,
      maxContentLength: 200 * 1024 * 1024,
    });

    const catUrl = catRes.data?.trim();
    if (!catUrl || !catUrl.startsWith('https://files.catbox.moe/')) {
      throw new Error('Catbox response tidak valid: ' + String(catUrl).slice(0, 100));
    }

    res.json({ success: true, catboxUrl: catUrl });
  } catch (err) {
    console.error('[catbox-upload]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  /api/health
// ════════════════════════════════════════════════════════════
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'pagaska-music-backend', timestamp: new Date().toISOString() });
});

module.exports = app;
if (require.main === module) {
  app.listen(PORT, () => console.log(`✅ Pagaska Music Backend: port ${PORT}`));
}
