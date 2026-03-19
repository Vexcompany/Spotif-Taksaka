const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json({limit: '50mb'}));

const PORT = process.env.PORT || 3000;

// Config SoundCloud API (dari soundCloud.js Anda)
const SCDL = {
    config: {
        baseUrl: "https://sc.snapfirecdn.com",
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
    },

    download: async (url) => {
        try {
            if (!url) throw new Error("URL SoundCloud diperlukan");

            // Step 1: Get info lagu
            const { data: info } = await axios.post(
                `${SCDL.config.baseUrl}/soundcloud`, 
                { target: url, gsc: "x" }, 
                { headers: SCDL.config.headers, timeout: 15000 }
            );

            if (!info.sound || !info.sound.progressive_url) {
                throw new Error("Gagal mendapatkan info lagu");
            }

            // Step 2: Get direct MP3 link
            const dlUrl = `${SCDL.config.baseUrl}/soundcloud-get-dl?target=${encodeURIComponent(info.sound.progressive_url)}`;
            const { data: dl } = await axios.get(dlUrl, { 
                headers: SCDL.config.headers,
                timeout: 15000 
            });

            return {
                title: info.sound.title,
                artist: info.metadata.username,
                thumb: info.metadata.artwork_url || info.metadata.artwork_url_template?.replace('{width}x{height}', '300x300'),
                duration: info.sound.duration ? Math.floor(info.sound.duration / 1000) : 0,
                download_url: dl.url
            };

        } catch (err) {
            throw new Error(err.message);
        }
    }
};

// Search SoundCloud (dari soundCloudSearchDL.js)
async function searchSoundCloud(query) {
    try {
        const { data } = await axios.get(
            `https://host.optikl.ink/soundcloud/search?query=${encodeURIComponent(query)}`,
            { timeout: 15000 }
        );
        return data;
    } catch (err) {
        throw new Error("Gagal search: " + err.message);
    }
}

// Endpoint: Search + Download
app.get('/api/soundcloud-play', async (req, res) => {
    try {
        const q = req.query.q || req.query.query;
        
        if (!q) {
            return res.status(400).json({ 
                status: false, 
                message: 'Parameter q/query diperlukan' 
            });
        }

        // 1. Search dulu
        const searchResults = await searchSoundCloud(q);
        
        if (!searchResults || searchResults.length === 0) {
            return res.status(404).json({ 
                status: false, 
                message: 'Lagu tidak ditemukan' 
            });
        }

        // Ambil hasil pertama
        const track = searchResults[0];
        
        // 2. Download lagu
        const downloadInfo = await SCDL.download(track.url);

        // Format response sama seperti FAA API (biar frontend tidak perlu banyak ubah)
        res.json({
            status: true,
            info: {
                title: downloadInfo.title,
                artist: downloadInfo.artist,
                album: '', // SoundCloud tidak ada album
                duration: formatDuration(downloadInfo.duration),
                thumbnail: downloadInfo.thumb,
                soundcloud_url: track.url
            },
            download: {
                url: downloadInfo.download_url, // Direct MP3 link
                format: 'mp3',
                size: 0 // Tidak diketahui dari API
            },
            source: 'soundcloud'
        });

    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ 
            status: false, 
            message: error.message 
        });
    }
});

// Helper: Format detik ke mm:ss
function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'soundcloud-downloader',
        timestamp: new Date().toISOString() 
    });
});

// Export untuk Vercel
module.exports = app;

// Local development
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`SoundCloud Proxy running on port ${PORT}`);
    });
}
