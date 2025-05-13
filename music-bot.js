require('dotenv').config(); // Load environment variables from .env file
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const play = require('play-dl');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const BOT_TOKEN = 'YOUR_BOT_TOKEN'; // Replace with your bot's token
const queue = new Map();

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const guildId = message.guild.id;

    let guildQueue = queue.get(guildId);

    switch (command) {
        case 'play':
            await handlePlayCommand(message, args, guildId, guildQueue);
            break;
        case 'skip':
            handleSkipCommand(message, guildId, guildQueue);
            break;
        case 'queue':
            handleQueueCommand(message, guildId, guildQueue);
            break;
        case 'stop':
            handleStopCommand(message, guildId, guildQueue);
            break;
        default:
            message.channel.send('Invalid command. Use !play, !skip, !queue, or !stop.');
    }
});

async function handlePlayCommand(message, args, guildId, guildQueue) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        return message.channel.send('You need to be in a voice channel to play music!');
    }

    if (!args.length) {
        return message.channel.send('Please provide a song name or URL.');
    }

    const songName = args.join(' ');
    let song;

    try {
        const searchResult = await play.search(songName, { limit: 5 });
        if (!searchResult || searchResult.length === 0) {
            return message.channel.send('No matching songs found.');
        }

        if (searchResult.length > 1) {
            let response = `Please select the song you want to play:\n`;
            searchResult.forEach((item, index) => {
                response += `${index + 1}. ${item.title} - ${item.durationRaw}\n`;
            });

            const filter = (m) => !isNaN(m.content) && parseInt(m.content) > 0 && parseInt(m.content) <= searchResult.length;

            await message.channel.send(response);
            const collected = await message.channel.awaitMessages({ filter, max: 1, time: 15000 });

            if (!collected.size) {
                return message.channel.send('You did not select a song in time.');
            }

            const selection = parseInt(collected.first().content) - 1;
            song = searchResult[selection];

        } else {
            song = searchResult[0];
        }

        if (!guildQueue) {
            guildQueue = {
                connection: null,
                player: null,
                songs: [],
                voiceChannel: voiceChannel,
            };
            queue.set(guildId, guildQueue);
        }

        guildQueue.songs.push(song);
        message.channel.send(`Added ${song.title} to the queue.`);

        // Join the voice channel and create the player if they don't exist
        if (!guildQueue.connection || guildQueue.connection.status === 'disconnected') {
            await connectToVoiceChannel(message, guildId, guildQueue);
        }
        if (!guildQueue.player) {
            guildQueue.player = createAudioPlayer();
            guildQueue.connection.subscribe(guildQueue.player);
            guildQueue.player.on('stateChange', (oldState, newState) => {
                if (newState.status === AudioPlayerStatus.Idle) {
                    guildQueue.songs.shift();
                    playSong(guildId, guildQueue, message); // Pass message
                }
            });
        }

        // Play the song
        playSong(guildId, guildQueue, message); // Pass message

    } catch (error) {
        console.error(error);
        message.channel.send(`Error playing song: ${error.message}`);
    }
}

async function connectToVoiceChannel(message, guildId, guildQueue) {
    try {
        const connection = joinVoiceChannel({
            channelId: guildQueue.voiceChannel.id,
            guildId: guildId,
            adapterCreator: message.guild.voiceAdapterCreator,
        });
        guildQueue.connection = connection;
        connection.on('disconnect', () => {
            queue.delete(guildId);
            console.log(`Disconnected from voice channel in guild ${guildId}`);
        });
    } catch (error) {
        console.error("Failed to join voice channel:", error);
        message.channel.send("Failed to join voice channel. Please check permissions and try again.");
        queue.delete(guildId);
        return;
    }
}

async function playSong(guildId, guildQueue, message) { // Add message parameter
    if (!guildQueue || guildQueue.songs.length === 0) {
        if (guildQueue && guildQueue.connection) {
            guildQueue.connection.destroy();
        }
        queue.delete(guildId);
        return;
    }

    const song = guildQueue.songs[0];
    console.log(`Playing ${song.title} in guild ${guildId}`);

    try {
        const stream = await play.stream(song.url);
        const resource = createAudioResource(stream.stream, {
            inputType: stream.type,
            inlineVolume: true,
        });

        guildQueue.player.play(resource);

    } catch (error) {
        console.error("Error playing audio:", error);
        if (message) {
            message.channel.send(`Error playing ${song.title}: ${error.message}`);
        }
        guildQueue.songs.shift();
        playSong(guildId, guildQueue, message); // Pass message
    }
}

function handleSkipCommand(message, guildId, guildQueue) {
    if (!guildQueue || guildQueue.songs.length === 0) {
        return message.channel.send('There is nothing to skip!');
    }
    guildQueue.player.stop();
    message.channel.send('Skipping current song.');
}

function handleQueueCommand(message, guildId, guildQueue) {
    if (!guildQueue || guildQueue.songs.length === 0) {
        return message.channel.send('The queue is empty.');
    }

    let response = 'Current Queue:\n';
    guildQueue.songs.forEach((song, index) => {
        response += `${index + 1}. ${song.title} - ${song.durationRaw}\n`;
    });

    message.channel.send(response);
}

function handleStopCommand(message, guildId, guildQueue) {
    if (!guildQueue) {
        return message.channel.send('There is nothing to stop!');
    }

    if (guildQueue.player) {
        guildQueue.player.stop(true);
    }
    guildQueue.songs = [];
    if (guildQueue.connection) {
        guildQueue.connection.destroy();
    }
    queue.delete(guildId);
    message.channel.send('Stopped playing and cleared the queue.');
}

client.login(process.env.DISCORD_TOKEN_MUSIC);