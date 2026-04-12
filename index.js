require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNELS = [process.env.CHANNEL_ID_1, process.env.CHANNEL_ID_2];

function extractAudioInfo(message) {
    const text = message.content;
    const audioAttachment = message.attachments.find(att => 
        att.contentType && (att.contentType.startsWith('audio/') || att.name.endsWith('.mp3') || att.name.endsWith('.wav'))
    );
    if (audioAttachment) return { type: 'discord_attachment', url: audioAttachment.url, title: audioAttachment.name };

    const dropboxMatch = text.match(/(https?:\/\/www\.dropbox\.com\/scl\/fi\/[^\s]+)/i);
    if (dropboxMatch && !text.includes('/sh/') && !text.includes('/folder/')) {
        try {
            let url = new URL(dropboxMatch[1]);
            url.searchParams.set('raw', '1');
            return { type: 'dropbox_link', url: url.toString(), title: 'Dropbox Audio' };
        } catch (e) { return { type: 'dropbox_link', url: dropboxMatch[1], title: 'Dropbox Audio' }; }
    }

    const driveFileMatch = text.match(/(https?:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+))/i);
    if (driveFileMatch && !text.includes('/folders/')) return { type: 'drive_file', url: driveFileMatch[1], title: 'Google Drive Audio' };

    const soundcloudMatch = text.match(/(https?:\/\/soundcloud\.com\/[^\s]+)/i);
    if (soundcloudMatch) return { type: 'soundcloud_link', url: soundcloudMatch[1], title: 'SoundCloud Audio' };

    const youtubeMatch = text.match(/(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]+|https?:\/\/youtu\.be\/[a-zA-Z0-9_-]+)/i);
    if (youtubeMatch) return { type: 'youtube_link', url: youtubeMatch[1], title: 'YouTube Audio' };

    return null;
}

function cleanTitle(title) {
    if (!title) return "Nimetön biisi";
    // Poistetaan tiedostopäätteet
    let cleaned = title.replace(/\.(mp3|wav|ogg|flac|m4a|aac)$/i, '');
    // Muutetaan alaviivat ja viivat välilyönneiksi
    cleaned = cleaned.replace(/[_-]/g, ' ');
    // Jos koko teksti on ISOILLA, muutetaan se siistimmäksi
    if (cleaned === cleaned.toUpperCase()) {
        cleaned = cleaned.toLowerCase().split(' ').map(s => s.charAt(0).toUpperCase() + s.substring(1)).join(' ');
    }
    return cleaned.trim();
}

function calculateScore(postedAt, reactionCount, commentCount) {
    const now = new Date();
    const ageInDays = (now - postedAt) / (1000 * 60 * 60 * 24);
    return Math.max(0, 100 - (ageInDays * 3)) + (reactionCount * 5) + (commentCount * 10);
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
                    message.reactions.cache.forEach(r => { reactionCount += r.count; });
                    let comments = [];
                    if (message.hasThread) {
                        try {
                            const tMsgs = await message.thread.messages.fetch({ limit: 20 });
                            tMsgs.forEach(tm => { if (!tm.author.bot && tm.content.trim()) comments.push({ author: tm.author.username, text: tm.content, timestamp: tm.createdAt.toISOString() }); });
                        } catch (e) {}
                    }
                    
                    let cleanMsg = message.content.replace(/(https?:\/\/[^\s]+)/g, '').trim();
                    let displayTitle = audioInfo.title;
                    if (['Dropbox Audio', 'Google Drive Audio', 'YouTube Audio', 'SoundCloud Audio'].includes(displayTitle)) {
                        displayTitle = cleanMsg.split('\n')[0].substring(0, 80) || "Nimetön biisi";
                    }

                    allValidSongs.push({
                        song_title: cleanTitle(displayTitle),
                        author: message.author.username,
                        author_avatar: message.author.displayAvatarURL({ size: 128 }),
                        message_text: cleanMsg,
                        audio_type: audioInfo.type,
                        audio_url: audioInfo.url,
                        posted_at: message.createdAt.toISOString(),
                        score: parseFloat(calculateScore(message.createdAt, reactionCount, comments.length).toFixed(1)),
                        stats: { reactions: reactionCount, comments: comments.length },
                        comments: comments
                    });
                }
            }
        } catch (error) {}
    }
    allValidSongs.sort((a, b) => b.score - a.score);
    const top20 = allValidSongs.slice(0, 20).map((s, i) => ({ ...s, rank: i + 1 }));
    fs.writeFileSync('top20_songs.json', JSON.stringify({ last_updated: new Date().toISOString(), top_songs: top20 }, null, 2));
    client.destroy();
});

client.login(TOKEN);
