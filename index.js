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

// MUUTOS: Funktiosta tehtiin asynkroninen (async), jotta nettisivun hakeminen onnistuu
async function extractAudioInfos(message) {
    const results = [];
    const text = message.content;
    let embedTitle = null;

    if (message.embeds && message.embeds.length > 0 && message.embeds[0].title) {
        embedTitle = message.embeds[0].title;
    }

    // 1. Etsi KAIKKI Discord-liitetiedostot (.forEach loopilla .find sijaan)
    message.attachments.forEach(att => {
        const isAudio = att.contentType && (att.contentType.startsWith('audio/') || att.name.endsWith('.mp3') || att.name.endsWith('.wav'));
        if (isAudio) {
            results.push({ type: 'discord_attachment', url: att.url, title: att.name });
        }
    });

    // 2. Etsi KAIKKI Dropbox-linkit tekstistä (Regex g-lipulla ja while-loopilla)
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

    // 3. Etsi KAIKKI Google Drive -linkit
    const driveRegex = /(https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+))/gi;
    let driveMatch;
    while ((driveMatch = driveRegex.exec(text)) !== null) {
        if (!driveMatch[0].includes('/folders/')) {
            let driveTitle = embedTitle;

            // MUUTOS: Yritetään hakea tarkka tiedostonimi suoraan Google Driven julkisen sivun HTML:stä
            try {
                const response = await fetch(driveMatch[0]);
                const html = await response.text();
                const titleMatch = html.match(/<title>(.*?) - Google Drive<\/title>/i);
                
                if (titleMatch && titleMatch[1]) {
                    const fetchedTitle = titleMatch[1].replace(/&amp;/g, '&'); // Korjataan mahdolliset HTML entiteetit
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

    // 4. Etsi KAIKKI SoundCloud -linkit
    const scRegex = /(https?:\/\/soundcloud\.com\/[^\s]+)/gi;
    let scMatch;
    while ((scMatch = scRegex.exec(text)) !== null) {
        results.push({ type: 'soundcloud_link', url: scMatch[1], title: embedTitle || 'SoundCloud Audio' });
    }

    // 5. Etsi KAIKKI YouTube -linkit
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
    
    // Varmistetaan ettei URL-enkoodaus pilaa merkkejä (esim. %28 -> '(' )
    let cleaned = title;
    try { cleaned = decodeURIComponent(title); } catch (e) {}

    cleaned = cleaned
        .replace(/\.(mp3|wav|ogg|flac|m4a|aac)(\?.*)?$/i, '')
        .replace(/_-_/g, ' - ')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // MUUTOS 2: Palautetaan sulut, jos Discord muutti ne alaviivoiksi ja poistimme ne.
    // Tunnistetaan yleiset remix-päätteet ja kääritään ne sulkuihin, jos sulkuja ei ole.
    if (!cleaned.includes('(') && !cleaned.includes(')')) {
        const remixRegex = /(.*)\s+((?:[a-zA-Z0-9\säöåÄÖÅ]+)\s+(?:mashup|remix|edit|flip|bootleg|vip|mix))$/i;
        const match = cleaned.match(remixRegex);
        if (match) {
            cleaned = `${match[1].trim()} (${match[2].trim()})`;
        }
    }

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
                // MUUTOS: Lisätty await, koska extractAudioInfos on nyt asynkroninen
                const audioInfos = await extractAudioInfos(message);
                
                if (audioInfos.length > 0) {
                    // Pisteet lasketaan vain kerran per viesti, jotta APIa ei kuormiteta turhaan
                    let reactionCount = 0;
                    let reactionsList = [];
                    message.reactions.cache.forEach(r => { 
                        reactionCount += r.count; 
                        reactionsList.push({ name: r.emoji.name, url: r.emoji.imageURL ? r.emoji.imageURL() : null, count: r.count });
                    });

                    let commentCount = 0;
                    if (message.hasThread) {
                        try {
                            const thread = await message.thread.fetch();
                            commentCount = thread.messageCount; 
                            if (commentCount > 0) commentCount = Math.max(0, commentCount - 1);
                        } catch (e) {}
                    }
                    
                    const score = parseFloat(calculateScore(message.createdAt, reactionCount, commentCount).toFixed(1));

                    // Käydään läpi kaikki viestistä löytyneet audiot
                    audioInfos.forEach((audioInfo, index) => {
                        // Ensimmäinen biisi saa alkuperäisen message.id:n (pitää vanhan sijoitushistorian yllä).
                        // Seuraavat saavat loppuliitteen (esim. -1, -2), jotta ID:t pysyvät uniikkeina.
                        const uniqueId = index === 0 ? message.id : `${message.id}-${index}`;

                        allValidSongs.push({
                            id: uniqueId,
                            song_title: cleanTitle(audioInfo.title, message.content),
                            author: message.author.username,
                            author_avatar: message.author.displayAvatarURL({ size: 128 }),
                            message_text: message.content.replace(/(https?:\/\/[^\s]+)/g, '').trim(),
                            audio_type: audioInfo.type,
                            audio_url: audioInfo.url,
                            discord_url: message.url,
                            posted_at: message.createdAt.toISOString(),
                            score: score,
                            stats: { reactions: reactionCount, comments: commentCount },
                            reactions: reactionsList
                        });
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
                    } else {
                        try {
                            const durationStr = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${downloadUrl}"`).toString().trim();
                            const duration = parseFloat(durationStr);
                            if (!isNaN(duration) && duration > 60) startTime = Math.max(0, (duration / 2) - 30);
                        } catch (probeErr) {}
                    }

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
