// Ladataan tarvittavat kirjastot
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

// Alustetaan Discord-botti
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ]
});

// Asetukset
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNELS = [process.env.CHANNEL_ID_1, process.env.CHANNEL_ID_2];

// Apufunktio: Tunnistaa URL:t ja mediatyypin viestistä
function extractAudioInfo(message) {
    const text = message.content;

    // 1. Tarkistetaan onko suoria tiedostoliitteitä (audio)
    const audioAttachment = message.attachments.find(att => 
        att.contentType && (att.contentType.startsWith('audio/') || att.name.endsWith('.mp3') || att.name.endsWith('.wav'))
    );
    if (audioAttachment) {
        return { type: 'discord_attachment', url: audioAttachment.url, title: audioAttachment.name };
    }

    // 2. Tarkistetaan Dropbox-linkki
    const dropboxMatch = text.match(/(https?:\/\/www\.dropbox\.com\/[^\s]+)/i);
    if (dropboxMatch) {
        let urlStr = dropboxMatch[1];
        try {
            let url = new URL(urlStr);
            // Käytetään raw=1, joka toimii Dropboxissa suoratoistona ja säilyttää rlkeyn
            url.searchParams.set('raw', '1');
            return { type: 'dropbox_link', url: url.toString(), title: 'Dropbox Audio' };
        } catch (e) {
            return { type: 'dropbox_link', url: urlStr, title: 'Dropbox Audio' };
        }
    }

    // 3. Tarkistetaan Google Drive (suorat tiedostot)
    const driveMatch = text.match(/(https?:\/\/drive\.google\.com\/file\/d\/[a-zA-Z0-9_-]+)/i);
    if (driveMatch) {
        return { type: 'drive_file', url: driveMatch[1], title: 'Google Drive Audio' };
    }

    // 4. Tarkistetaan SoundCloud
    const soundcloudMatch = text.match(/(https?:\/\/soundcloud\.com\/[^\s]+)/i);
    if (soundcloudMatch) {
        return { type: 'soundcloud_link', url: soundcloudMatch[1], title: 'SoundCloud Audio' };
    }

    // 5. Tarkistetaan YouTube
    const youtubeMatch = text.match(/(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]+|https?:\/\/youtu\.be\/[a-zA-Z0-9_-]+)/i);
    if (youtubeMatch) {
        return { type: 'youtube_link', url: youtubeMatch[1], title: 'YouTube Audio' };
    }

    return null;
}

// Apufunktio: Sijoitusalgoritmi
function calculateScore(postedAt, reactionCount, commentCount) {
    const now = new Date();
    const ageInMs = now - postedAt;
    const ageInDays = ageInMs / (1000 * 60 * 60 * 24);

    const freshnessScore = Math.max(0, 100 - (ageInDays * 3));
    const activityScore = (reactionCount * 5) + (commentCount * 10);

    return freshnessScore + activityScore;
}

client.once('ready', async () => {
    console.log(`🤖 Botti kirjautunut sisään: ${client.user.tag}`);
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
                    message.reactions.cache.forEach(reaction => { reactionCount += reaction.count; });

                    let comments = [];
                    let commentCount = 0;
                    if (message.hasThread) {
                        try {
                            const threadMessages = await message.thread.messages.fetch({ limit: 20 });
                            threadMessages.forEach(tm => {
                                if (!tm.author.bot && tm.content.trim()) {
                                    comments.push({ author: tm.author.username, text: tm.content, timestamp: tm.createdAt.toISOString() });
                                    commentCount++;
                                }
                            });
                        } catch (e) { /* Threadia ei voitu lukea */ }
                    }

                    const score = calculateScore(message.createdAt, reactionCount, commentCount);
                    let cleanText = message.content.replace(/(https?:\/\/[^\s]+)/g, '').trim();

                    // OTSikon parannus: yritetään poimia nimi urlista tai viestistä
                    let displayTitle = audioInfo.title;
                    if (['Dropbox Audio', 'Google Drive Audio', 'YouTube Audio', 'SoundCloud Audio'].includes(displayTitle)) {
                        try {
                            const urlObj = new URL(audioInfo.url);
                            const pathParts = urlObj.pathname.split('/');
                            const fileName = decodeURIComponent(pathParts[pathParts.length - 1]);
                            if (fileName && fileName.includes('.') && fileName.length > 4) {
                                displayTitle = fileName;
                            } else {
                                displayTitle = cleanText.substring(0, 60) || "Nimetön biisi";
                            }
                        } catch (e) {
                            displayTitle = cleanText.substring(0, 60) || "Nimetön biisi";
                        }
                    }

                    allValidSongs.push({
                        song_title: displayTitle,
                        author: message.author.username,
                        author_avatar: message.author.displayAvatarURL({ size: 128 }),
                        message_text: cleanText,
                        audio_type: audioInfo.type,
                        audio_url: audioInfo.url,
                        posted_at: message.createdAt.toISOString(),
                        score: parseFloat(score.toFixed(2)),
                        stats: { reactions: reactionCount, comments: commentCount },
                        comments: comments
                    });
                }
            }
        } catch (error) { console.error(`Virhe kanavalla ${channelId}:`, error); }
    }

    allValidSongs.sort((a, b) => b.score - a.score);
    const top20 = allValidSongs.slice(0, 20).map((s, i) => ({ ...s, rank: i + 1 }));

    fs.writeFileSync('top20_songs.json', JSON.stringify({ last_updated: new Date().toISOString(), top_songs: top20 }, null, 2));
    console.log('✅ Lista päivitetty!');
    client.destroy();
});

client.login(TOKEN);
