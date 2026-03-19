const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({limit: '50mb'}));

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) return cachedToken;
  
  const r = await axios.post('https://api.spotidownloader.com/session', {}, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
      'content-type': 'application/json',
      'origin': 'https://spotidownloader.com',
      'referer': 'https://spotidownloader.com/'
    },
    timeout: 10000
  });
  
  if (r.data?.token) {
    cachedToken = r.data.token;
    tokenExpiry = now + (4 * 60 * 1000);
    return cachedToken;
  }
  throw new Error('Token tidak ditemukan');
}

async function searchSpotify(query, bearer) {
  const r = await axios.post('https://api.spotidownloader.com/search', 
    { query },
    {
      headers: {
        'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
        'content-type': 'application/json',
        'authorization': `Bearer ${bearer}`,
        'origin': 'https://spotidownloader.com',
        'referer': 'https://spotidownloader.com/'
      },
      timeout: 15000
    }
  );
  return r.data;
}

async function getDownloadLink(id, bearer) {
  const r = await axios.post('https://api.spotidownloader.com/download',
    { id },
    {
      headers: {
        'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
        'content-type': 'application/json',
        'authorization': `Bearer ${bearer}`,
        'origin': 'https://spotidownloader.com',
        'referer': 'https://spotidownloader.com/'
      },
      timeout: 15000
    }
  );
  return r.data;
}

async function downloadAudio(url, bearer) {
  const r = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: {
      'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
      'authorization': `Bearer ${bearer}`,
      'origin': 'https://spotidownloader.com',
      'referer': 'https://spotifydown.com/'
    },
    timeout: 60000,
    maxContentLength: 100 * 1024 * 1024
  });
  return Buffer.from(r.data);
}

app.get('/api/spotify-play', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ status: false, message: 'Query diperlukan' });
    
    const token = await getToken();
    let trackId = null;
    let trackInfo = null;
    
    const spotifyUrlMatch = q.match(/spotify\.com\/track\/([a-zA-Z0-9]{22})/i);
    if (spotifyUrlMatch) {
      trackId = spotifyUrlMatch[1];
    } else if (/^[a-zA-Z0-9]{22}$/.test(q)) {
      trackId = q;
    }
    
    if (!trackId) {
      const searchResults = await searchSpotify(q, token);
      if (!searchResults?.tracks?.length) {
        return res.status(404).json({ status: false, message: 'Lagu tidak ditemukan' });
      }
      trackInfo = searchResults.tracks[0];
      trackId = trackInfo.id;
    }
    
    const downloadInfo = await getDownloadLink(trackId, token);
    if (!downloadInfo?.link) {
      return res.status(500).json({ status: false, message: 'Gagal mendapatkan link download' });
    }
    
    const audioBuffer = await downloadAudio(downloadInfo.link, token);
    
    res.json({
      status: true,
      info: {
        title: trackInfo?.title || downloadInfo.title,
        artist: trackInfo?.artist || downloadInfo.artist,
        album: trackInfo?.album || downloadInfo.album || '',
        duration: trackInfo?.duration || downloadInfo.duration || '0:00',
        thumbnail: trackInfo?.thumbnail || downloadInfo.thumbnail || '',
        spotify_url: `https://open.spotify.com/track/${trackId}`,
        release_date: trackInfo?.release_date || new Date().getFullYear().toString()
      },
      download: {
        url: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
        format: 'mp3',
        size: audioBuffer.length
      }
    });
    
  } catch (error) {
    res.status(500).json({ status: false, message: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
