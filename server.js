const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;

// ════════════════════════════════════════════════════════════
//  SPOTIFY CREDENTIALS — hanya untuk ambil metadata
//  (judul, artis, cover, durasi, URL Spotify)
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

// Search metadata saja — tidak download dari Spotify
async function searchSpotify(query) {
  try {
    const token = await getSpotifyToken();
    const res   = await axios.get('https://api.spotify.com/v1/search', {
      params:  { q: query, type: 'track', limit: 1 },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    const items = res.data?.tracks?.items;
    if (!items || items.length === 0) return null;
    return items[0];
  } catch (err) {
    console.warn('[Spotify search failed]', err.message);
    return null; // Tidak fatal — metadata boleh kosong, audio tetap jalan
  }
}

// ════════════════════════════════════════════════════════════
//  FAA DOWNLOADER
//  URL  : https://api-faa.my.id/faa/spotify-play
//  Param: ?q=<judul+artis>   ← pakai "q" bukan "query"
// ════════════════════════════════════════════════════════════
const FAA_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer':         'https://api-faa.my.id/',
};

async function faaDownload(q) {
  const res = await axios.get('https://api-faa.my.id/faa/spotify-play', {
    params:  { q },           // ← parameter yang benar adalah "q"
    headers: FAA_HEADERS,
    timeout: 25000,
  });

  const d = res.data;
  console.log('[FAA response]', JSON.stringify(d).substring(0, 400));

  if (!d?.status) throw new Error(d?.message || 'FAA API: status false');

  // Support berbagai shape response FAA
  const url =
    d?.download?.url       ||
    d?.result?.download    ||
    d?.result?.downloadUrl ||
    d?.result?.url         ||
    d?.downloadUrl         ||
    d?.download            ||
    d?.url                 ||
    d?.data?.url;

  if (!url) throw new Error('FAA: download URL tidak ada. Response: ' + JSON.stringify(d).substring(0, 200));
  return { url, faaData: d };
}

// ════════════════════════════════════════════════════════════
//  ENDPOINT UTAMA
//  GET /api/soundcloud-play?q=<query>
// ════════════════════════════════════════════════════════════
app.get('/api/soundcloud-play', async (req, res) => {
  try {
    const q = (req.query.q || req.query.query || '').trim();
    if (!q) return res.status(400).json({ status: false, message: 'Parameter q diperlukan' });

    // 1. FAA — ambil audio (ini yang utama, tidak boleh gagal)
    const { url: audioUrl, faaData } = await faaDownload(q);

    // 2. Spotify — ambil metadata (opsional, boleh gagal)
    const track = await searchSpotify(q);

    // 3. Gabungkan: utamakan data FAA kalau ada, fallback ke Spotify
    const title    = faaData?.title    || faaData?.info?.title    || track?.name                                  || q;
    const artist   = faaData?.artist   || faaData?.info?.artist   || track?.artists?.map(a => a.name).join(', ') || '–';
    const album    = faaData?.album    || faaData?.info?.album    || track?.album?.name                           || '';
    const cover    = faaData?.thumbnail|| faaData?.info?.thumbnail|| track?.album?.images?.[0]?.url              || '';
    const spotUrl  = faaData?.spotify_url || faaData?.info?.spotify_url || track?.external_urls?.spotify         || '';
    const duration = faaData?.duration || faaData?.info?.duration ||
      (track ? formatDuration(Math.floor((track.duration_ms || 0) / 1000)) : '0:00');
    const year     = faaData?.year     || faaData?.info?.year     || track?.album?.release_date?.slice(0, 4)     || '–';

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
      source: 'faa+spotify',
    });

  } catch (err) {
    console.error('[/api/soundcloud-play]', err.message);
    return res.status(500).json({
      status:  false,
      message: err.message,
      detail:  err.response?.data || null,
    });
  }
});

// ── Debug: cek FAA response mentah ───────────────────────────
app.get('/api/test-faa', async (req, res) => {
  const q = (req.query.q || 'love me not').trim();
  try {
    const r = await axios.get('https://api-faa.my.id/faa/spotify-play', {
      params:  { q },
      headers: FAA_HEADERS,
      timeout: 25000,
    });
    res.json({ status: true, q, faaStatus: r.status, faaResponse: r.data });
  } catch (err) {
    res.json({ status: false, q, message: err.message, httpStatus: err.response?.status, faaResponse: err.response?.data });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'pagaska-music-backend', source: 'faa+spotify', timestamp: new Date().toISOString() });
});

function formatDuration(totalSeconds) {
  if (!totalSeconds || isNaN(totalSeconds)) return '0:00';
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => console.log(`✅ Pagaska Music Backend: port ${PORT}`));
}
