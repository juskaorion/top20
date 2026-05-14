require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const ftp = require('basic-ftp');
const { execSync } = require('child_process');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNELS = [process.env.CHANNEL_ID_1, process.env.CHANNEL_ID_2, process.env.CHANNEL_ID_3];

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN;
const SPOTIFY_PLAYLIST_ID = '3trehlc2tS8pIoJqMxK6l3';

// === PISTEYTYKSEN ASETUKSET ===
const SCORE_CONFIG = {
    BASE_SCORE: 600,            // Kaikkien uusien biisien aloituspistemäärä
    PLAY_POINTS: 2.2,           // Pisteet per yksi kuuntelu (Play-napin painallus)
    DISCORD: {
        REACTION_POINTS: 7.5,   // Pisteet per Discord-reaktio
        COMMENT_POINTS: 12.5,   // Pisteet per Discord-kommentti (threadissa)
        THUMB_POINTS: 5.5,      // Pisteet per nettisivun peukku
        AGE_PENALTY_PER_DAY: 2.5 // Miinuspisteet per päivä (ikäsakko)
    },
    SPOTIFY: {
        THUMB_POINTS: 11.0,     // Pisteet per nettisivun peukku (Tupla-arvo)
        AGE_PENALTY_PER_DAY: 3.75, // Miinuspisteet per päivä (Kovempi ikäsakko)
        MAX_POSITION_BONUS: 20  // Listaykkösen saama bonus (laskee 1p per sija alaspäin)
    }
};
// ==============================

async function extractAudioInfos(message) {
    const results = [];
    const text = message.content;
    let embedTitle = null;

    if (message.embeds && message.embeds.length > 0 && message.embeds[0].title) {
        embedTitle = message.embeds[0].title;
    }

    message.attachments.forEach(att => {
        const isAudio = att.contentType && (att.contentType.startsWith('audio/') || att.name.endsWith('.mp3') || att.name.endsWith('.wav'));
        if (isAudio) {
            results.push({ type: 'discord_attachment', url: att.url, title: att.name });
        }
    });

    const dropboxRegex = /(https?:\/\/www\.dropbox\.com\/(?:scl\/fi|s)\/[^\s]+)/gi;
    let dbMatch;
    while ((dbMatch = dropboxRegex.exec(text)) !== null) {
        const urlStr = dbMatch[1];
        if (!urlStr.includes('/sh/') && !urlStr.includes('/folder/')) {
            try {
                let urlObj = new URL(urlStr);
                urlObj.searchParams.set('raw', '1');
                let pathname = urlObj.pathname;
                let filename = decodeURIComponent(pathname.substring(pathname.lastIndexOf('/') + 1));
                results.push({ type: 'dropbox_link', url: urlObj.toString(), title: filename });
            } catch (e) { 
                results.push({ type: 'dropbox_link', url: urlStr, title: embedTitle || 'Dropbox Audio' }); 
            }
        }
    }

    const driveRegex = /(https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+))/gi;
    let driveMatch;
    while ((driveMatch = driveRegex.exec(text)) !== null) {
        if (!driveMatch[0].includes('/folders/')) {
            let driveTitle = embedTitle;
            try {
                const response = await fetch(driveMatch[0]);
                const html = await response.text();
                const titleMatch = html.match(/<title>(.*?) - Google Drive<\/title>/i);
                
                if (titleMatch && titleMatch[1]) {
                    const fetchedTitle = titleMatch[1].replace(/&amp;/g, '&');
                    if (!fetchedTitle.toLowerCase().includes('sign in')) {
                        driveTitle = fetchedTitle;
                    }
                }
            } catch (err) {
                console.error("Google Drive otsikon haku epäonnistui:", err.message);
            }
            results.push({ type: 'drive_file', url: driveMatch[1], title: driveTitle || 'Google Drive Audio' });
        }
    }

    const scRegex = /(https?:\/\/soundcloud\.com\/[^\s]+)/gi;
    let scMatch;
    while ((scMatch = scRegex.exec(text)) !== null) {
        results.push({ type: 'soundcloud_link', url: scMatch[1], title: embedTitle || 'SoundCloud Audio' });
    }

    const ytRegex = /(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]+|https?:\/\/youtu\.be\/[a-zA-Z0-9_-]+)/gi;
    let ytMatch;
    while ((ytMatch = ytRegex.exec(text)) !== null) {
        results.push({ type: 'youtube_link', url: ytMatch[1], title: embedTitle || 'YouTube Audio' });
    }

    return results;
}

function cleanTitle(title, messageContent) {
    if (!title || title === 'Dropbox Audio' || title === 'Google Drive Audio' || title === 'SoundCloud Audio' || title === 'YouTube Audio') {
        const firstLine = messageContent.split('\n')[0].replace(/(https?:\/\/[^\s]+)/g, '').trim();
        return firstLine || "Nimetön biisi";
    }
    
    let cleaned = title;
    try { cleaned = decodeURIComponent(title); } catch (e) {}

    cleaned = cleaned
        .replace(/\.(mp3|wav|ogg|flac|m4a|aac)(\?.*)?$/i, '')
        .replace(/_-_/g, ' - ')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned.includes('(') && !cleaned.includes(')')) {
        const remixRegex = /(.*)\s+((?:[a-zA-Z0-9\säöåÄÖÅ]+)\s+(?:mashup|remix|edit|flip|bootleg|vip|mix))$/i;
        const match = cleaned.match(remixRegex);
        if (match) {
            cleaned = `${match[1].trim()} (${match[2].trim()})`;
        }
    }

    return cleaned;
}

function calculateScore(postedAt, reactionCount, commentCount, webThumbsCount = 0, playCount = 0, source = 'discord', positionBonus = 0) {
    const now = new Date();
    const ageInDays = (now - postedAt) / (1000 * 60 * 60 * 24);
    const baseScore = SCORE_CONFIG.BASE_SCORE; 
    
    let reactionPoints = 0;
    let commentPoints = 0;
    let webThumbPoints = 0;
    let agePenalty = 0;
    
    const playPoints = playCount * SCORE_CONFIG.PLAY_POINTS;

    if (source === 'discord') {
        reactionPoints = reactionCount * SCORE_CONFIG.DISCORD.REACTION_POINTS; 
        commentPoints = commentCount * SCORE_CONFIG.DISCORD.COMMENT_POINTS;  
        webThumbPoints = webThumbsCount * SCORE_CONFIG.DISCORD.THUMB_POINTS; 
        agePenalty = ageInDays * SCORE_CONFIG.DISCORD.AGE_PENALTY_PER_DAY;          
    } else if (source === 'spotify') {
        webThumbPoints = webThumbsCount * SCORE_CONFIG.SPOTIFY.THUMB_POINTS; 
        agePenalty = ageInDays * SCORE_CONFIG.SPOTIFY.AGE_PENALTY_PER_DAY;          
    }
    
    return Math.max(0, baseScore + reactionPoints + commentPoints + webThumbPoints + playPoints + positionBonus - agePenalty);
}

async function getSpotifyTracks(wpThumbs, wpPlays) {
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

        console.log("Haetaan Spotifyn soittolista (/items)...");
        const playlistRes = await fetch(`https://api.spotify.com/v1/playlists/${SPOTIFY_PLAYLIST_ID}/items?limit=20`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const playlistData = await playlistRes.json();

        if (!playlistRes.ok) {
            console.error("Spotify Playlist Error:", playlistData);
            return spotifySongs;
        }

        if (playlistData.items && playlistData.items.length > 0) {
            playlistData.items.forEach((item, index) => {
                const track = item.item || item.track; // TÄMÄ ON KORJATTU 2026-versiota varten
                if (!track || track.type !== 'track') return; 

                const addedAt = new Date(item.added_at);
                const artistName = track.artists.map(a => a.name).join(', ');
                const songTitle = `${artistName} - ${track.name}`;
                const uniqueId = `spotify-${track.id}`;
                
                const webThumbsCount = wpThumbs[uniqueId] || 0;
                const playCount = wpPlays[uniqueId] || 0;
                const positionBonus = Math.max(0, SCORE_CONFIG.SPOTIFY.MAX_POSITION_BONUS - index); 
                
                const score = parseFloat(calculateScore(addedAt, 0, 0, webThumbsCount, playCount, 'spotify', positionBonus).toFixed(1));

                spotifySongs.push({
                    id: uniqueId,
                    song_title: songTitle,
                    author: artistName,
                    author_avatar: track.album.images.length > 0 ? track.album.images[0].url : 'https://www.djorion.fi/wp-content/uploads/default-avatar.png',
                    message_text: '',
                    audio_type: track.preview_url ? 'spotify_preview' : 'spotify_link',
                    audio_url: track.preview_url || track.external_urls?.spotify || '',
                    discord_url: track.external_urls?.spotify || '',
                    posted_at: addedAt.toISOString(),
                    score: score,
                    web_thumbs: webThumbsCount,
                    stats: { reactions: 0, comments: 0, thumbs: webThumbsCount, plays: playCount }
                });
            });
            console.log(`Löydettiin ${spotifySongs.length} biisiä Spotifysta.`);
        } else {
            console.log("Spotify palautti tyhjän listan:", playlistData);
        }
    } catch (e) {
        console.error("Virhe Spotify-biisien haussa:", e);
    }
    return spotifySongs;
}

client.once('ready', async () => {
    let allValidSongs = [];
    let wpThumbs = {};
    let wpPlays = {}; // Uusi säiliö kuunteluille
    
    try {
        console.log("Haetaan verkkosivun peukut ja kuuntelut...");
        const [thumbsRes, playsRes] = await Promise.all([
            fetch('https://www.djorion.fi/wp-json/top20/v1/thumbs'),
            fetch('https://www.djorion.fi/wp-json/top20/v1/plays')
        ]);
        
        if (thumbsRes.ok) wpThumbs = await thumbsRes.json();
        if (playsRes.ok) wpPlays = await playsRes.json();
    } catch (e) {
        console.error("Virhe haettaessa WordPress-dataa:", e);
    }

    for (const channelId of CHANNELS) {
        if (!channelId) continue;
        try {
            const channel = await client.channels.fetch(channelId);
            const messages = await channel.messages.fetch({ limit: 100 });
            
            for (const [id, message] of messages) {
                const audioInfos = await extractAudioInfos(message);
                
                if (audioInfos.length > 0) {
                    let reactionCount = 0;
                    message.reactions.cache.forEach(r => { reactionCount += r.count; });

                    let commentCount = 0;
                    if (message.hasThread) {
                        try {
                            const thread = await message.thread.fetch();
                            commentCount = thread.messageCount; 
                            if (commentCount > 0) commentCount = Math.max(0, commentCount - 1);
                        } catch (e) {}
                    }
                    
                    audioInfos.forEach((audioInfo, index) => {
                        const uniqueId = index === 0 ? message.id : `${message.id}-${index}`;
                        const webThumbsCount = wpThumbs[uniqueId] || 0;
                        const playCount = wpPlays[uniqueId] || 0;
                        
                        const score = parseFloat(calculateScore(message.createdAt, reactionCount, commentCount, webThumbsCount, playCount, 'discord').toFixed(1));

                        let titleCleaned = cleanTitle(audioInfo.title, message.content);
                        let parsedArtist = message.author.username;
                        let parsedTitle = titleCleaned;

                        if (titleCleaned.includes(' - ')) {
                            const parts = titleCleaned.split(' - ');
                            parsedArtist = parts[0].trim();
                            parsedTitle = titleCleaned; 
                        } else {
                            parsedTitle = `${parsedArtist} - ${titleCleaned}`;
                        }

                        allValidSongs.push({
                            id: uniqueId,
                            song_title: parsedTitle,
                            author: parsedArtist,
                            author_avatar: message.author.displayAvatarURL({ size: 128 }),
                            message_text: message.content.replace(/(https?:\/\/[^\s]+)/g, '').trim(),
                            audio_type: audioInfo.type,
                            audio_url: audioInfo.url,
                            discord_url: message.url,
                            posted_at: message.createdAt.toISOString(),
                            score: score,
                            web_thumbs: webThumbsCount, 
                            stats: { reactions: reactionCount, comments: commentCount, thumbs: webThumbsCount, plays: playCount }
                        });
                    });
                }
            }
        } catch (error) { console.error(error); }
    }
    
    const spotifySongs = await getSpotifyTracks(wpThumbs, wpPlays);
    allValidSongs.push(...spotifySongs);

    allValidSongs.sort((a, b) => b.score - a.score);
    const top20 = allValidSongs.slice(0, 20).map((s, i) => ({ ...s, rank: i + 1 }));

    let previousDataById = {};
    let previousDataByRank = {};
    try {
        if (fs.existsSync('top20_songs.json')) {
            const prevJson = JSON.parse(fs.readFileSync('top20_songs.json', 'utf8'));
            if (prevJson && prevJson.top_songs) { 
                prevJson.top_songs.forEach(s => { 
                    previousDataByRank[s.rank] = s; 
                    previousDataById[s.id] = s;
                }); 
            }
        }
    } catch (e) {}

    top20.forEach(song => {
        const prev = previousDataById[song.id];
        song.previous_rank = prev ? prev.rank : null;
    });

    const ftpHost = process.env.FTP_HOST;
    const ftpUser = process.env.FTP_USER;
    const ftpPass = process.env.FTP_PASS;
    const ftpDir = process.env.FTP_DIR || "public_html/top20"; 
    const ftpWebUrl = process.env.FTP_WEB_URL || "https://www.djorion.fi/top20";

    if (ftpHost && ftpUser && ftpPass) {
        console.log("\n==== AUDIOKLIPIT JA FTP-SIIRTO ====");
        const ftpClient = new ftp.Client();
        try {
            await ftpClient.access({ host: ftpHost, user: ftpUser, password: ftpPass, secure: false });
            await ftpClient.ensureDir(ftpDir);

            for (let song of top20) {
                const prevSong = previousDataByRank[song.rank];
                if (prevSong && prevSong.id === song.id && prevSong.audio_url.startsWith(ftpWebUrl)) {
                    song.audio_url = prevSong.audio_url;
                    song.audio_type = "secure_clip";
                    continue;
                }

                console.log(`[PROSESSOIDAAN] Sija ${song.rank}: ${song.song_title}`);
                const outputFilename = `rank_${song.rank}.mp3`;
                const outputPath = `/tmp/${outputFilename}`;
                let downloadUrl = song.audio_url;
                let startTime = 0;
                
                if (downloadUrl.includes('drive.google.com/file/d/')) {
                    const match = downloadUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
                    if (match) downloadUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`;
                }

                try {
                    if (song.audio_type === 'soundcloud_link' || song.audio_type === 'youtube_link') {
                        console.log(`-> Puretaan raakastriimi (yt-dlp)...`);
                        const durationStr = execSync(`yt-dlp --print duration "${downloadUrl}"`).toString().trim();
                        const duration = parseFloat(durationStr);
                        if (!isNaN(duration) && duration > 60) startTime = Math.max(0, (duration / 2) - 30);
                        
                        downloadUrl = execSync(`yt-dlp -g -f "bestaudio" "${downloadUrl}"`).toString().trim().split('\n')[0];
                    } else if (song.audio_type !== 'spotify_link' && song.audio_type !== 'spotify_preview') {
                        try {
                            const durationStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${downloadUrl}"`).toString().trim();
                            const duration = parseFloat(durationStr);
                            if (!isNaN(duration) && duration > 60) startTime = Math.max(0, (duration / 2) - 30);
                        } catch (probeErr) {}
                    }

                    if (song.audio_type !== 'spotify_link') {
                        execSync(`ffmpeg -y -i "${downloadUrl}" -ss ${startTime.toFixed(2)} -t 60 -c:a libmp3lame -b:a 128k "${outputPath}"`, { stdio: 'ignore' });
                        await ftpClient.uploadFrom(outputPath, outputFilename);
                        
                        song.audio_url = `${ftpWebUrl}/${outputFilename}?v=${Date.now()}`;
                        song.audio_type = "secure_clip";
                        fs.unlinkSync(outputPath);
                        console.log(`-> Valmis!`);
                    }
                } catch (err) { 
                    console.error(`-> Virhe sijalla ${song.rank}: Kappaleen lataus tai leikkaus epäonnistui.`); 
                }
            }
        } catch (err) { console.error("FTP Virhe:", err); }
        ftpClient.close();
    }

    fs.writeFileSync('top20_songs.json', JSON.stringify({ last_updated: new Date().toISOString(), top_songs: top20 }, null, 2));
    console.log('Päivitys valmis!');
    client.destroy();
});

client.login(TOKEN);
