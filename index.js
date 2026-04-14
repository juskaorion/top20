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

function extractAudioInfo(message) {
    const text = message.content;
    let embedTitle = null;
    if (message.embeds && message.embeds.length > 0 && message.embeds[0].title) {
        embedTitle = message.embeds[0].title;
    }

    const audioAttachment = message.attachments.find(att => 
        att.contentType && (att.contentType.startsWith('audio/') || att.name.endsWith('.mp3') || att.name.endsWith('.wav'))
    );
    if (audioAttachment) return { type: 'discord_attachment', url: audioAttachment.url, title: audioAttachment.name };

    const dropboxMatch = text.match(/(https?:\/\/www\.dropbox\.com\/(?:scl\/fi|s)\/[^\s]+)/i);
    if (dropboxMatch && !text.includes('/sh/') && !text.includes('/folder/')) {
        try {
            let urlObj = new URL(dropboxMatch[1]);
            urlObj.searchParams.set('raw', '1');
            let pathname = urlObj.pathname;
            let filename = decodeURIComponent(pathname.substring(pathname.lastIndexOf('/') + 1));
            return { type: 'dropbox_link', url: urlObj.toString(), title: filename };
        } catch (e) { return { type: 'dropbox_link', url: dropboxMatch[1], title: embedTitle || 'Dropbox Audio' }; }
    }

    const driveFileMatch = text.match(/(https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+))/i);
    if (driveFileMatch && !text.includes('/folders/')) return { type: 'drive_file', url: driveFileMatch[1], title: embedTitle || 'Google Drive Audio' };

    const soundcloudMatch = text.match(/(https?:\/\/soundcloud\.com\/[^\s]+)/i);
    if (soundcloudMatch) {
        return { type: 'soundcloud_link', url: soundcloudMatch[1], title: embedTitle || 'SoundCloud Audio' };
    }

    const youtubeMatch = text.match(/(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]+|https?:\/\/youtu\.be\/[a-zA-Z0-9_-]+)/i);
    if (youtubeMatch) {
        return { type: 'youtube_link', url: youtubeMatch[1], title: embedTitle || 'YouTube Audio' };
    }

    return null;
}

function cleanTitle(title, messageContent) {
    if (!title || title === 'Dropbox Audio' || title === 'Google Drive Audio' || title === 'SoundCloud Audio' || title === 'YouTube Audio') {
        const firstLine = messageContent.split('\n')[0].replace(/(https?:\/\/[^\s]+)/g, '').trim();
        return firstLine || "Nimetön biisi";
    }
    let cleaned = title.replace(/\.(mp3|wav|ogg|flac|m4a|aac)(\?.*)?$/i, '').replace(/_-_/g, ' - ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned;
}

function calculateScore(postedAt, reactionCount, commentCount) {
    const now = new Date();
    const ageInDays = (now - postedAt) / (1000 * 60 * 60 * 24);
    
    const baseScore = 500;
    const reactionPoints = reactionCount * 7.5; 
    const commentPoints = commentCount * 12.5;  
    const agePenalty = ageInDays * 2.5;         
    
    return Math.max(0, baseScore + reactionPoints + commentPoints - agePenalty);
}

client.once('ready', async () => {
    let allValidSongs = [];
    for (const channelId of CHANNELS) {
        if (!channelId) continue;
        try {
            const channel = await client.channels.fetch(channelId);
            const messages = await channel.messages.fetch({ limit: 100 });
            for (const [id, message] of messages) {
                const audioInfo = extractAudioInfo(message);
                if (audioInfo) {
                    let reactionCount = 0;
                    let reactionsList = [];
                    message.reactions.cache.forEach(r => { 
                        reactionCount += r.count; 
                        reactionsList.push({ name: r.emoji.name, url: r.emoji.imageURL ? r.emoji.imageURL() : null, count: r.count });
                    });

                    // VAIN KOMMENTTIEN MÄÄRÄ LASKETAAN (Yksityisyyden suoja)
                    let commentCount = 0;
                    if (message.hasThread) {
                        try {
                            const thread = await message.thread.fetch();
                            commentCount = thread.messageCount; 
                            if (commentCount > 0) commentCount = Math.max(0, commentCount - 1);
                        } catch (e) {}
                    }
                    
                    allValidSongs.push({
                        id: message.id,
                        song_title: cleanTitle(audioInfo.title, message.content),
                        author: message.author.username,
                        author_avatar: message.author.displayAvatarURL({ size: 128 }),
                        message_text: message.content.replace(/(https?:\/\/[^\s]+)/g, '').trim(),
                        audio_type: audioInfo.type,
                        audio_url: audioInfo.url,
                        discord_url: message.url,
                        posted_at: message.createdAt.toISOString(),
                        score: parseFloat(calculateScore(message.createdAt, reactionCount, commentCount).toFixed(1)),
                        stats: { reactions: reactionCount, comments: commentCount },
                        reactions: reactionsList
                    });
                }
            }
        } catch (error) { console.error(error); }
    }
    
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

    // Tallennetaan biisin aiempi sijoitus uutta listaa varten
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
                    // YT-DLP PURKU (SoundCloud & YouTube)
                    if (song.audio_type === 'soundcloud_link' || song.audio_type === 'youtube_link') {
                        console.log(`-> Puretaan raakastriimi (yt-dlp)...`);
                        // Haetaan kesto
                        const durationStr = execSync(`yt-dlp --print duration "${downloadUrl}"`).toString().trim();
                        const duration = parseFloat(durationStr);
                        if (!isNaN(duration) && duration > 60) startTime = Math.max(0, (duration / 2) - 30);
                        
                        // Haetaan varsinainen raaka-audion URL-osoite ffmpegiä varten
                        downloadUrl = execSync(`yt-dlp -g -f "bestaudio" "${downloadUrl}"`).toString().trim().split('\n')[0];
                    } else {
                        // FFPROBE (Discord & Dropbox & Drive)
                        try {
                            const durationStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${downloadUrl}"`).toString().trim();
                            const duration = parseFloat(durationStr);
                            if (!isNaN(duration) && duration > 60) startTime = Math.max(0, (duration / 2) - 30);
                        } catch (probeErr) {}
                    }

                    // LEIKKAUS JA LATAUS FFMPEGILLÄ
                    execSync(`ffmpeg -y -i "${downloadUrl}" -ss ${startTime.toFixed(2)} -t 60 -c:a libmp3lame -b:a 128k "${outputPath}"`, { stdio: 'ignore' });
                    await ftpClient.uploadFrom(outputPath, outputFilename);
                    
                    song.audio_url = `${ftpWebUrl}/${outputFilename}?v=${Date.now()}`;
                    song.audio_type = "secure_clip";
                    fs.unlinkSync(outputPath);
                    console.log(`-> Valmis!`);
                } catch (err) { 
                    console.error(`-> Virhe sijalla ${song.rank}: Kappaleen lataus tai leikkaus epäonnistui.`); 
                }
            }
        } catch (err) { console.error("FTP Virhe:", err); }
        ftpClient.close();
    }

    fs.writeFileSync('top20_songs.json', JSON.stringify({ last_updated: new Date().toISOString(), top_songs: top20 }, null, 2));
    console.log('Päivitys valmis! Kommentit suojattu.');
    client.destroy();
});

client.login(TOKEN);
