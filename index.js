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

    return null;
}

function cleanTitle(title, messageContent) {
    if (!title || title === 'Dropbox Audio' || title === 'Google Drive Audio') {
        const firstLine = messageContent.split('\n')[0].replace(/(https?:\/\/[^\s]+)/g, '').trim();
        return firstLine || "Nimetön biisi";
    }
    let cleaned = title.replace(/\.(mp3|wav|ogg|flac|m4a|aac)(\?.*)?$/i, '').replace(/_-_/g, ' - ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned;
}

// UUSI PISTEYTYS: 500 alkupistettä, emojit +3pv (7.5p), kommentit +5pv (12.5p)
function calculateScore(postedAt, reactionCount, commentCount) {
    const now = new Date();
    const ageInDays = (now - postedAt) / (1000 * 60 * 60 * 24);
    
    const baseScore = 500;
    const reactionPoints = reactionCount * 7.5; // Vastaa 3 päivän elinaikaa per emoji
    const commentPoints = commentCount * 12.5;  // Vastaa 5 päivän elinaikaa per kommentti
    const agePenalty = ageInDays * 2.5;         // Sulaminen 2.5 pistettä päivässä
    
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

                    let comments = [];
                    if (message.hasThread) {
                        try {
                            const tMsgs = await message.thread.messages.fetch({ limit: 20 });
                            tMsgs.forEach(tm => { if (!tm.author.bot && tm.content.trim()) comments.push({ author: tm.author.username, text: tm.content, timestamp: tm.createdAt.toISOString() }); });
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
                        posted_at: message.createdAt.toISOString(),
                        score: parseFloat(calculateScore(message.createdAt, reactionCount, comments.length).toFixed(1)),
                        stats: { reactions: reactionCount, comments: comments.length },
                        reactions: reactionsList,
                        comments: comments
                    });
                }
            }
        } catch (error) { console.error(error); }
    }
    
    allValidSongs.sort((a, b) => b.score - a.score);
    const top20 = allValidSongs.slice(0, 20).map((s, i) => ({ ...s, rank: i + 1 }));

    let previousDataByRank = {};
    try {
        if (fs.existsSync('top20_songs.json')) {
            const prevJson = JSON.parse(fs.readFileSync('top20_songs.json', 'utf8'));
            if (prevJson && prevJson.top_songs) { prevJson.top_songs.forEach(s => { previousDataByRank[s.rank] = s; }); }
        }
    } catch (e) {}

    const ftpHost = process.env.FTP_HOST;
    const ftpUser = process.env.FTP_USER;
    const ftpPass = process.env.FTP_PASS;
    const ftpDir = process.env.FTP_DIR || "public_html/top20"; 
    const ftpWebUrl = process.env.FTP_WEB_URL || "https://www.djorion.fi/top20";

    if (ftpHost && ftpUser && ftpPass) {
        console.log("\n==== ALOITETAAN AUDIOKLIPPIEN LEIKKAUS JA FTP-SIIRTO ====");
        const ftpClient = new ftp.Client();
        try {
            await ftpClient.access({ host: ftpHost, user: ftpUser, password: ftpPass, secure: false });
            await ftpClient.ensureDir(ftpDir);

            for (let song of top20) {
                const prevSong = previousDataByRank[song.rank];
                if (prevSong && prevSong.id === song.id) {
                    console.log(`[OHITETAAN] Sija ${song.rank} ennallaan: ${song.song_title}`);
                    song.audio_url = prevSong.audio_url;
                    song.audio_type = "secure_clip";
                    continue;
                }

                console.log(`[PROSESSOIDAAN] Sija ${song.rank} muuttunut: ${song.song_title}`);
                const outputFilename = `rank_${song.rank}.mp3`;
                const outputPath = `/tmp/${outputFilename}`;
                let downloadUrl = song.audio_url;
                
                if (downloadUrl.includes('drive.google.com/file/d/')) {
                    const match = downloadUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
                    if (match) downloadUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`;
                }

                try {
                    let startTime = 0;
                    try {
                        const durationStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${downloadUrl}"`).toString().trim();
                        const duration = parseFloat(durationStr);
                        if (!isNaN(duration) && duration > 60) startTime = Math.max(0, (duration / 2) - 30);
                    } catch (probeErr) {}

                    execSync(`ffmpeg -y -i "${downloadUrl}" -ss ${startTime.toFixed(2)} -t 60 -c:a libmp3lame -b:a 128k "${outputPath}"`, { stdio: 'ignore' });
                    await ftpClient.uploadFrom(outputPath, outputFilename);
                    
                    song.audio_url = `${ftpWebUrl}/${outputFilename}?v=${Date.now()}`;
                    song.audio_type = "secure_clip";
                    fs.unlinkSync(outputPath);
                } catch (err) { console.error(`-> Virhe sijalla ${song.rank}`); }
            }
        } catch (err) { console.error("FTP Virhe:", err); }
        ftpClient.close();
    }

    fs.writeFileSync('top20_songs.json', JSON.stringify({ last_updated: new Date().toISOString(), top_songs: top20 }, null, 2));
    console.log('Päivitys valmis!');
    client.destroy();
});

client.login(TOKEN);
