const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;

// ════════════════════════════════════════════════════════════
//  SPOTIFY CREDENTIALS
//  Sama persis seperti yang dipakai bot Telegram pagaska.js
// ════════════════════════════════════════════════════════════
const SPOTIFY_CLIENT_ID     = "f235a7370f4442f7a062738fdd310dfa";
const SPOTIFY_CLIENT_SECRET = "0cf4d6c4e1344f45bdd8b3d4a5f3cad5";

// ── Token cache (supaya tidak hit /api/token setiap request) ──
let _spotifyToken    = null;
let _spotifyTokenExp = 0;

async function getSpotifyToken() {
  if (_spotifyToken && Date.now() < _spotifyTokenExp) return _spotifyToken;

  const res = await axios.post(
    'https://accounts.spotify.com/api/token',
    'grant_type=client_credentials',
    {
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  _spotifyToken    = res.data.access_token;
  _spotifyTokenExp = Date.now() + (res.data.expires_in - 60) * 1000; // minus 60s buffer
  return _spotifyToken;
}

// ── Search Spotify ─────────────────────────────────────────
async function searchSpotify(query) {
  const token = await getSpotifyToken();
  const res   = await axios.get('https://api.spotify.com/v1/search', {
    params: { q: query, type: 'track', limit: 1 },
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000,
  });

  const items = res.data?.tracks?.items;
  if (!items || items.length === 0) throw new Error('Lagu tidak ditemukan di Spotify');
  return items[0];
}

// ── FAA Downloader ─────────────────────────────────────────
//  API: GET https://faa.vex.my.id/api/spotify?query=<judul artis>
//  Response: { status: true, download: { url: "..." }, info: { ... } }
//  Ganti FAA_BASE jika domain berubah
const FAA_BASE = 'https://faa.vex.my.id';

async function faaDownload(query) {
  const res = await axios.get(`${FAA_BASE}/api/spotify`, {
    params: { query },
    timeout: 25000,
  });

  const d = res.data;
  if (!d?.status) throw new Error(d?.message || 'FAA API: status false');

  // Cari download URL — support beberapa variasi response shape
  const url =
    d?.download?.url        ||
    d?.result?.download     ||
    d?.result?.downloadUrl  ||
    d?.downloadUrl          ||
    d?.download             ||
    d?.url                  ||
    d?.data?.url;

  if (!url) throw new Error('FAA API: download URL tidak ditemukan dalam response');
  return { url, info: d.info || {} };
}

// ════════════════════════════════════════════════════════════
//  ENDPOINT UTAMA
//  GET /api/soundcloud-play?q=<query>
//  (nama endpoint tidak diubah agar frontend tidak perlu dimodif)
// ════════════════════════════════════════════════════════════
app.get('/api/soundcloud-play', async (req, res) => {
  try {
    const q = (req.query.q || req.query.query || '').trim();
    if (!q) {
      return res.status(400).json({ status: false, message: 'Parameter q/query diperlukan' });
    }

    // 1. Cari metadata dari Spotify
    const track = await searchSpotify(q);

    const title    = track.name;
    const artist   = track.artists.map(a => a.name).join(', ');
    const album    = track.album?.name || '';
    const cover    = track.album?.images?.[0]?.url || '';
    const spotUrl  = track.external_urls?.spotify || '';
    const durationMs = track.duration_ms || 0;
    const duration = formatDuration(Math.floor(durationMs / 1000));
    const year     = track.album?.release_date?.slice(0, 4) || '–';

    // 2. Download audio via FAA API (query: "judul artis")
    const { url: audioUrl } = await faaDownload(`${title} ${artist}`);

    // 3. Kembalikan response — shape sama seperti sebelumnya agar frontend tidak berubah
    return res.json({
      status: true,
      info: {
        title,
        artist,
        album,
        duration,
        thumbnail: cover,
        soundcloud_url: spotUrl, // field name lama tetap dipertahankan
        year,
      },
      download: {
        url: audioUrl,
        format: 'mp3',
      },
      source: 'spotify+faa',
    });

  } catch (err) {
    console.error('[/api/soundcloud-play]', err.message);
    return res.status(500).json({ status: false, message: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  ENDPOINT BARU: /api/spotify-play
//  Alias yang lebih deskriptif (opsional, untuk bot Telegram)
// ════════════════════════════════════════════════════════════
app.get('/api/spotify-play', async (req, res) => {
  req.url = '/api/soundcloud-play' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?') - 1) : '');
  // Cukup forward ke handler di atas dengan cara sederhana:
  // Re-implement inline agar tidak bergantung pada router trick
  try {
    const q = (req.query.q || req.query.query || '').trim();
    if (!q) {
      return res.status(400).json({ status: false, message: 'Parameter q/query diperlukan' });
    }

    const track    = await searchSpotify(q);
    const title    = track.name;
    const artist   = track.artists.map(a => a.name).join(', ');
    const album    = track.album?.name || '';
    const cover    = track.album?.images?.[0]?.url || '';
    const spotUrl  = track.external_urls?.spotify || '';
    const duration = formatDuration(Math.floor((track.duration_ms || 0) / 1000));
    const year     = track.album?.release_date?.slice(0, 4) || '–';

    const { url: audioUrl } = await faaDownload(`${title} ${artist}`);

    return res.json({
      status: true,
      info: { title, artist, album, duration, thumbnail: cover, soundcloud_url: spotUrl, year },
      download: { url: audioUrl, format: 'mp3' },
      source: 'spotify+faa',
    });
  } catch (err) {
    console.error('[/api/spotify-play]', err.message);
    return res.status(500).json({ status: false, message: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ════════════════════════════════════════════════════════════
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'pagaska-music-backend',
    source: 'spotify+faa',
    timestamp: new Date().toISOString(),
  });
});

// ── Helper ────────────────────────────────────────────────
function formatDuration(totalSeconds) {
  if (!totalSeconds || isNaN(totalSeconds)) return '0:00';
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Export untuk Vercel ───────────────────────────────────
module.exports = app;

// ── Local dev ─────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Pagaska Music Backend running on port ${PORT}`);
    console.log(`   Source: Spotify metadata + FAA downloader`);
  });
}
