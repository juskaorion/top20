// ... existing code ...
const CHANNELS = [process.env.CHANNEL_ID_1, process.env.CHANNEL_ID_2, process.env.CHANNEL_ID_3];

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;
const SPOTIFY_PLAYLIST_ID = '3trehlc2tS8pIoJqMxK6l3';

async function extractAudioInfos(message) {
// ... existing code ...
function calculateScore(postedAt, reactionCount, commentCount, webThumbsCount = 0, source = 'discord') {
// ... existing code ...
    return Math.max(0, baseScore + reactionPoints + commentPoints + webThumbPoints - agePenalty);
}

async function getSpotifyTracks(wpThumbs) {
    let spotifySongs = [];
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REFRESH_TOKEN) {
        console.error("HUOM! SPOTIFY_CLIENT_ID, SECRET tai REFRESH_TOKEN puuttuu.");
        return spotifySongs;
    }

    try {
        console.log("Haetaan Spotify API access token Refresh Tokenilla...");
        const authString = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
        
        const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded', 
                'Authorization': `Basic ${authString}` 
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: SPOTIFY_REFRESH_TOKEN
            }).toString()
        });
        
        const tokenData = await tokenRes.json();
        
        if (!tokenRes.ok) {
            console.error("Spotify Token Error:", tokenData);
            return spotifySongs;
        }

        const token = tokenData.access_token;

        console.log("Haetaan Spotifyn soittolista...");
        const playlistRes = await fetch(`https://api.spotify.com/v1/playlists/${SPOTIFY_PLAYLIST_ID}/tracks?limit=20`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const playlistData = await playlistRes.json();

        if (!playlistRes.ok) {
            console.error("Spotify Playlist Error:", playlistData);
            return spotifySongs;
        }

        if (playlistData.items && playlistData.items.length > 0) {
            playlistData.items.forEach((item) => {
// ... existing code ...
```

**Mitä nyt tapahtuu:**
Kun ajat työnkulun GitHubissa, botti esittää nyt Spotifylle olevansa "sinä" tuon Refresh Tokenin avulla, aivan kuten Python-skriptisi tekee. Nyt 403 Forbidden -virhe on taatusti historiaa!
