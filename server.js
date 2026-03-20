const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;

// ════════════════════════════════════════════════════════════
//  SPOTIFY CREDENTIALS
// ════════════════════════════════════════════════════════════
const SPOTIFY_CLIENT_ID     = "f235a7370f4442f7a062738fdd310dfa";
const SPOTIFY_CLIENT_SECRET = "0cf4d6c4e1344f45bdd8b3d4a5f3cad5";

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
  _spotifyTokenExp = Date.now() + (res.data.expires_in - 60) * 1000;
  return _spotifyToken;
}

async function searchSpotify(query) {
  const token = await getSpotifyToken();
  const res   = await axios.get('https://api.spotify.com/v1/search', {
    params:  { q: query, type: 'track', limit: 1 },
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000,
  });

  const items = res.data?.tracks?.items;
  if (!items || items.length === 0) throw new Error('Lagu tidak ditemukan di Spotify');
  return items[0];
}

// ════════════════════════════════════════════════════════════
//  FAA DOWNLOADER — dengan browser headers agar tidak 403
// ════════════════════════════════════════════════════════════
const FAA_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Origin':          'https://api-faa.my.id',
  'Referer':         'https://api-faa.my.id/',
};

async function faaDownload(query) {
  const res = await axios.get('https://api-faa.my.id/faa/spotify-play', {
    params:  { query },
    headers: FAA_HEADERS,
    timeout: 25000,
  });

  const d = res.data;

  // Log response untuk debugging (hapus setelah konfirmasi berjalan)
  console.log('[FAA response]', JSON.stringify(d).substring(0, 300));

  if (!d?.status) throw new Error(d?.message || 'FAA API: status false');

  const url =
    d?.download?.url       ||
    d?.result?.download    ||
    d?.result?.downloadUrl ||
    d?.result?.url         ||
    d?.downloadUrl         ||
    d?.download            ||
    d?.url                 ||
    d?.data?.url;

  if (!url) throw new Error('FAA API: download URL tidak ditemukan. Response: ' + JSON.stringify(d).substring(0, 200));
  return url;
}

// ════════════════════════════════════════════════════════════
//  ENDPOINT UTAMA
// ════════════════════════════════════════════════════════════
app.get('/api/soundcloud-play', async (req, res) => {
  try {
    const q = (req.query.q || req.query.query || '').trim();
    if (!q) {
      return res.status(400).json({ status: false, message: 'Parameter q diperlukan' });
    }

    // 1. Metadata dari Spotify
    const track = await searchSpotify(q);

    const title    = track.name;
    const artist   = track.artists.map(a => a.name).join(', ');
    const album    = track.album?.name || '';
    const cover    = track.album?.images?.[0]?.url || '';
    const spotUrl  = track.external_urls?.spotify || '';
    const duration = formatDuration(Math.floor((track.duration_ms || 0) / 1000));
    const year     = track.album?.release_date?.slice(0, 4) || '–';

    // 2. Audio via FAA
    const audioUrl = await faaDownload(`${title} ${artist}`);

    return res.json({
      status: true,
      info: {
        title,
        artist,
        album,
        duration,
        thumbnail:      cover,
        soundcloud_url: spotUrl,
        year,
      },
      download: {
        url:    audioUrl,
        format: 'mp3',
      },
      source: 'spotify+faa',
    });

  } catch (err) {
    console.error('[/api/soundcloud-play]', err.message);
    // Kirim pesan error yang lebih detail ke frontend untuk debugging
    return res.status(500).json({
      status:  false,
      message: err.message,
      detail:  err.response?.data || null,
    });
  }
});

// ── Debug endpoint: cek FAA API langsung ──────────────────────
app.get('/api/test-faa', async (req, res) => {
  const q = (req.query.q || 'shape of you ed sheeran').trim();
  try {
    const r = await axios.get('https://api-faa.my.id/faa/spotify-play', {
      params:  { query: q },
      headers: FAA_HEADERS,
      timeout: 25000,
    });
    res.json({ status: true, faaResponse: r.data, faaStatus: r.status });
  } catch (err) {
    res.json({
      status:      false,
      message:     err.message,
      httpStatus:  err.response?.status,
      faaResponse: err.response?.data,
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'pagaska-music-backend', source: 'spotify+faa', timestamp: new Date().toISOString() });
});

function formatDuration(totalSeconds) {
  if (!totalSeconds || isNaN(totalSeconds)) return '0:00';
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Pagaska Music Backend: port ${PORT}`);
  });
}
