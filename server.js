const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;

// ════════════════════════════════════════════════════════════
//  SPOTIFY CREDENTIALS — hanya untuk metadata tambahan
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
        Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
  _spotifyToken    = res.data.access_token;
  _spotifyTokenExp = Date.now() + (res.data.expires_in - 60) * 1000;
  return _spotifyToken;
}

async function searchSpotify(query) {
  try {
    const token = await getSpotifyToken();
    const res   = await axios.get('https://api.spotify.com/v1/search', {
      params:  { q: query, type: 'track', limit: 1 },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
    const items = res.data?.tracks?.items;
    return items?.length ? items[0] : null;
  } catch (err) {
    console.warn('[Spotify search failed]', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════
//  FAA API
//  Response structure:
//  {
//    status: true,
//    creator: "Faa",
//    info: {
//      title, artist, album, release_date, duration,
//      spotify_url, thumbnail
//    },
//    download: {
//      source: "Uguu",
//      url: "https://d.uguu.se/xxx.mp3"
//    },
//    uploaded_at: "..."
//  }
// ════════════════════════════════════════════════════════════
async function faaDownload(q) {
  // Pakai axios dengan headers lengkap mirip browser untuk bypass Cloudflare
  const res = await axios.get('https://api-faa.my.id/faa/spotify-play', {
    params: { q },
    headers: {
      'User-Agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':                    'application/json, text/plain, */*',
      'Accept-Language':           'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding':           'gzip, deflate, br',
      'Referer':                   'https://api-faa.my.id/',
      'Origin':                    'https://api-faa.my.id',
      'sec-ch-ua':                 '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile':          '?0',
      'sec-ch-ua-platform':        '"Windows"',
      'sec-fetch-dest':            'empty',
      'sec-fetch-mode':            'cors',
      'sec-fetch-site':            'same-origin',
      'Cache-Control':             'no-cache',
      'Pragma':                    'no-cache',
    },
    timeout: 25000,
    // Penting: jangan ikuti redirect otomatis, biarkan axios handle
    maxRedirects: 5,
  });

  const d = res.data;
  console.log('[FAA response]', JSON.stringify(d).substring(0, 400));

  if (!d?.status) throw new Error(d?.message || 'FAA API: status false');

  // Ambil dari struktur yang sudah diketahui: d.download.url
  const audioUrl = d?.download?.url;
  if (!audioUrl) throw new Error('FAA: download.url tidak ada dalam response');

  return {
    audioUrl,
    title:       d.info?.title       || '',
    artist:      d.info?.artist      || '',
    album:       d.info?.album       || '',
    duration:    d.info?.duration    || '0:00',
    thumbnail:   d.info?.thumbnail   || '',
    spotifyUrl:  d.info?.spotify_url || '',
    year:        d.info?.release_date?.slice(0, 4) || '–',
  };
}

// ════════════════════════════════════════════════════════════
//  ENDPOINT UTAMA
//  GET /api/soundcloud-play?q=<query>
// ════════════════════════════════════════════════════════════
app.get('/api/soundcloud-play', async (req, res) => {
  try {
    const q = (req.query.q || req.query.query || '').trim();
    if (!q) return res.status(400).json({ status: false, message: 'Parameter q diperlukan' });

    // 1. FAA — audio + info utama
    const faa = await faaDownload(q);

    // 2. Spotify — metadata tambahan (opsional, boleh gagal)
    //    Dipakai kalau FAA tidak return cover/info lengkap
    const track = (!faa.thumbnail || !faa.spotifyUrl) ? await searchSpotify(q) : null;

    const title      = faa.title      || track?.name                                  || q;
    const artist     = faa.artist     || track?.artists?.map(a => a.name).join(', ') || '–';
    const album      = faa.album      || track?.album?.name                           || '';
    const duration   = faa.duration   || formatDuration(Math.floor((track?.duration_ms || 0) / 1000));
    const thumbnail  = faa.thumbnail  || track?.album?.images?.[0]?.url              || '';
    const spotifyUrl = faa.spotifyUrl || track?.external_urls?.spotify               || '';
    const year       = faa.year       || track?.album?.release_date?.slice(0, 4)     || '–';

    return res.json({
      status: true,
      info: {
        title,
        artist,
        album,
        duration,
        thumbnail,
        soundcloud_url: spotifyUrl,   // field name lama dipertahankan
        year,
      },
      download: {
        url:    faa.audioUrl,
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

// ── Debug endpoint ────────────────────────────────────────────
app.get('/api/test-faa', async (req, res) => {
  const q = (req.query.q || 'love me not').trim();
  try {
    const r = await axios.get('https://api-faa.my.id/faa/spotify-play', {
      params: { q },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':     'application/json, text/plain, */*',
        'Referer':    'https://api-faa.my.id/',
        'Origin':     'https://api-faa.my.id',
      },
      timeout: 25000,
    });
    res.json({ status: true, q, faaStatus: r.status, faaResponse: r.data });
  } catch (err) {
    res.json({
      status:      false,
      q,
      message:     err.message,
      httpStatus:  err.response?.status,
      // Potong kalau HTML Cloudflare
      faaResponse: typeof err.response?.data === 'string'
        ? err.response.data.substring(0, 300)
        : err.response?.data,
    });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'pagaska-music-backend', source: 'faa+spotify', timestamp: new Date().toISOString() });
});

function formatDuration(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => console.log(`✅ Pagaska Music Backend: port ${PORT}`));
}
