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
            if (!filename.includes('.')) {
                filename = embedTitle || 'Dropbox Audio';
            }
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
    
    let cleaned = title;
    cleaned = cleaned.replace(/\.(mp3|wav|ogg|flac|m4a|aac)(\?.*)?$/i, '');
    cleaned = cleaned.replace(/_-_/g, ' - ');
    cleaned = cleaned.replace(/_/g, ' ');
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    return cleaned;
}

// UUSI LASKURI (Kaikki pisteet sulavat ajan myötä)
function calculateScore(postedAt, reactionCount, commentCount) {
    const now = new Date();
    const ageInDays = (now - postedAt) / (1000 * 60 * 60 * 24);
    
    const baseScore = 100;
    const activityScore = (reactionCount * 5) + (commentCount * 10);
    const agePenalty = ageInDays * 5;
    
    return Math.max(0, baseScore + activityScore - agePenalty);
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
                        reactionsList.push({ name: r.emoji.name, url: r.emoji.url, count: r.count });
                    });

                    let comments = [];
                    if (message.hasThread) {
                        try {
                            const tMsgs = await message.thread.messages.fetch({ limit: 20 });
                            tMsgs.forEach(tm => { if (!tm.author.bot && tm.content.trim()) comments.push({ author: tm.author.username, text: tm.content, timestamp: tm.createdAt.toISOString() }); });
                        } catch (e) {}
                    }
                    
                    allValidSongs.push({
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

    // FTP-Leikkuri
    const ftpHost = process.env.FTP_HOST;
    const ftpUser = process.env.FTP_USER;
    const ftpPass = process.env.FTP_PASS;
    const ftpDir = process.env.FTP_DIR || "public_html/top20-audio"; 
    const ftpWebUrl = process.env.FTP_WEB_URL || "https://www.djorion.fi/top20-audio";

    if (ftpHost && ftpUser && ftpPass) {
        console.log("\n==== ALOITETAAN AUDIOKLIPPIEN LEIKKAUS JA FTP-SIIRTO ====");
        const ftpClient = new ftp.Client();
        
        try {
            await ftpClient.access({ host: ftpHost, user: ftpUser, password: ftpPass, secure: false });
            await ftpClient.ensureDir(ftpDir);

            for (let song of top20) {
                const outputFilename = `rank_${song.rank}.mp3`;
                const outputPath = `/tmp/${outputFilename}`;
                let downloadUrl = song.audio_url;
                
                // Drive URLien konvertointi
                if (downloadUrl.includes('drive.google.com/file/d/')) {
                    const match = downloadUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
                    if (match) downloadUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`;
                }

                try {
                    // 1. Selvitetään biisin pituus ffprobe:lla
                    let startTime = 0;
                    try {
                        const durationStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${downloadUrl}"`).toString().trim();
                        const duration = parseFloat(durationStr);
                        
                        if (!isNaN(duration) && duration > 0) {
                            if (duration > 60) {
                                // Etsitään keskikohta ja siirrytään siitä 30s taaksepäin = 60s klippi täydellisesti keskeltä
                                startTime = Math.max(0, (duration / 2) - 30);
                            }
                        }
                    } catch (probeErr) {
                        console.log(`-> Pituuden haku epäonnistui, käytetään oletusta (0s).`);
                    }

                    console.log(`Leikataan (aloituskohta: ${startTime.toFixed(1)}s): Rank ${song.rank} - ${song.song_title}`);
                    
                    // 2. Leikataan 60 sekuntia lasketusta aloituskohdasta
                    execSync(`ffmpeg -y -i "${downloadUrl}" -ss ${startTime.toFixed(2)} -t 60 -c:a libmp3lame -b:a 128k "${outputPath}"`, { stdio: 'ignore' });
                    await ftpClient.uploadFrom(outputPath, outputFilename);
                    
                    song.audio_url = `${ftpWebUrl}/${outputFilename}?t=${Date.now()}`;
                    song.audio_type = "secure_clip";
                    fs.unlinkSync(outputPath);
                } catch (err) {
                    console.error(`-> FFMPEG virhe sijalle ${song.rank}. Biisi jätetään leikkaamatta.`);
                    // Lista ei hajoa, alkuperäinen url jää JSONiin jos prosessointi kaatuu
                }
            }
        } catch (err) {
            console.error("FTP Yhteysvirhe:", err);
        }
        ftpClient.close();
        console.log("==== AUDIOKLIPPIEN SIIRTO VALMIS ====\n");
    } else {
        console.log("-> FTP-tunnuksia ei asetettu. Ohitetaan klippien generointi ja käytetään alkuperäisiä linkkejä.");
    }

    fs.writeFileSync('top20_songs.json', JSON.stringify({ last_updated: new Date().toISOString(), top_songs: top20 }, null, 2));
    console.log('JSON päivitetty onnistuneesti!');
    client.destroy();
});

client.login(TOKEN);
