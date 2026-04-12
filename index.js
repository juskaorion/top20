// Ladataan tarvittavat kirjastot
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');

// Alustetaan Discord-botti
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent // Tärkeä, jotta botti näkee linkit ja tekstit
    ]
});

// Asetukset .env -tiedostosta
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
    const dropboxMatch = text.match(/(https?:\/\/www\.dropbox\.com\/scl\/fi\/[^\s]+)/i);
    if (dropboxMatch) {
        // Muutetaan url muotoon dl=1, jotta se soi suoraan
        let url = dropboxMatch[1];
        url = url.replace('?dl=0', '').split('?')[0] + '?dl=1'; 
        return { type: 'dropbox_link', url: url, title: 'Dropbox Audio' };
    }

    // 3. Tarkistetaan Google Drive (vain suorat tiedostot, ei kansiot)
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

    return null; // Ei kelvollista biisiä löydetty
}

// Apufunktio: Sijoitusalgoritmi
function calculateScore(postedAt, reactionCount, commentCount) {
    const now = new Date();
    const ageInMs = now - postedAt;
    const ageInDays = ageInMs / (1000 * 60 * 60 * 24);

    // Uutuusarvo: Maksimi 100 pistettä. Putoaa nollaan noin 33 päivässä (-3 pistettä/päivä).
    const freshnessScore = Math.max(0, 100 - (ageInDays * 3));
    
    // Aktiivisuuspisteet: Jokainen reaktio on 5 pistettä, jokainen kommentti on 10 pistettä
    const activityScore = (reactionCount * 5) + (commentCount * 10);

    return freshnessScore + activityScore;
}

client.once('clientReady', async () => {
    console.log(`🤖 Botti kirjautunut sisään nimellä ${client.user.tag}`);
    console.log('Aloitetaan biisien haravointi...');

    let allValidSongs = [];

    // Käydään läpi molemmat kanavat
    for (const channelId of CHANNELS) {
        if (!channelId) continue;
        
        try {
            const channel = await client.channels.fetch(channelId);
            console.log(`Luetaan kanavaa: ${channel.name}...`);
            
            // Haetaan kanavan 100 viimeisintä viestiä
            const messages = await channel.messages.fetch({ limit: 100 });

            for (const [id, message] of messages) {
                const audioInfo = extractAudioInfo(message);
                
                // Jos viestissä on kelvollinen biisi
                if (audioInfo) {
                    // Laske reaktiot
                    let reactionCount = 0;
                    message.reactions.cache.forEach(reaction => {
                        reactionCount += reaction.count;
                    });

                    // Haetaan ketjun (thread) kommentit, jos sellainen on
                    let comments = [];
                    let commentCount = 0;
                    if (message.hasThread) {
                        const threadMessages = await message.thread.messages.fetch({ limit: 20 });
                        threadMessages.forEach(tm => {
                            if (!tm.author.bot) { // Ei lasketa botin omia viestejä
                                comments.push({
                                    author: tm.author.username,
                                    text: tm.content,
                                    timestamp: tm.createdAt.toISOString()
                                });
                                commentCount++;
                            }
                        });
                    }

                    // Laske sijoituspisteet
                    const score = calculateScore(message.createdAt, reactionCount, commentCount);

                    // Puhdistetaan message_text (katkaistaan rivinvaihdoista jos todella pitkä, 
                    // mutta UI hoitaa varsinaisen typistyksen. Poistetaan linkit tekstistä puhtauden vuoksi.)
                    let cleanText = message.content.replace(/(https?:\/\/[^\s]+)/g, '').trim();

                    // Rakennetaan biisi-objekti datamallin mukaisesti
                    const songData = {
                        song_title: audioInfo.title !== 'Dropbox Audio' && audioInfo.title !== 'Google Drive Audio' && audioInfo.title !== 'SoundCloud Audio' && audioInfo.title !== 'YouTube Audio' ? audioInfo.title : cleanText.substring(0, 30) || "Nimetön biisi",
                        author: message.author.username,
                        author_avatar: message.author.displayAvatarURL({ dynamic: true, size: 128 }),
                        message_text: cleanText,
                        audio_type: audioInfo.type,
                        audio_url: audioInfo.url,
                        posted_at: message.createdAt.toISOString(),
                        score: parseFloat(score.toFixed(2)),
                        stats: {
                            reactions: reactionCount,
                            comments: commentCount
                        },
                        comments: comments
                    };

                    allValidSongs.push(songData);
                }
            }
        } catch (error) {
            console.error(`Virhe luettaessa kanavaa ${channelId}:`, error);
        }
    }

    console.log(`Löydettiin yhteensä ${allValidSongs.length} kelvollista biisiä.`);

    // Järjestetään pisteiden mukaan laskevasti (suurin pistemäärä ensin)
    allValidSongs.sort((a, b) => b.score - a.score);

    // Otetaan TOP 20
    const top20 = allValidSongs.slice(0, 20);

    // Lisätään sijoitukset (rank)
    top20.forEach((song, index) => {
        song.rank = index + 1;
    });

    // Muotoillaan lopullinen JSON
    const outputJson = {
        last_updated: new Date().toISOString(),
        top_songs: top20
    };

    // Tallennetaan tiedostoon
    fs.writeFileSync('top20_songs.json', JSON.stringify(outputJson, null, 2));
    
    console.log('✅ Valmista! Data tallennettu tiedostoon: top20_songs.json');
    
    // Suljetaan botti
    client.destroy();
});

// Käynnistetään botti
client.login(TOKEN);