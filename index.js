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

// UUSI SULAMISLOGIIKKA (Gravity Model)
function calculateScore(postedAt, reactionCount, commentCount) {
    const now = new Date();
    const ageInDays = (now - postedAt) / (1000 * 60 * 60 * 24);
    
    const baseScore = 100;
    const activityScore = (reactionCount * 5) + (commentCount * 10);
    const agePenalty = ageInDays * 5; // Kaikki pisteet sulavat 5 pistettä päivässä!
    
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
                        reactionsList.push({
                            name: r.emoji.name,
                            url: r.emoji.url,
                            count: r.count
                        });
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
    fs.writeFileSync('top20_songs.json', JSON.stringify({ last_updated: new Date().toISOString(), top_songs: top20 }, null, 2));
    console.log('Lista päivitetty onnistuneesti!');
    client.destroy();
});

client.login(TOKEN);
