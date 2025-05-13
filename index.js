// console.log("--- Vercel function entry point executed ---");
require('dotenv').config();
const { Client, GatewayIntentBits, Sticker } = require('discord.js');
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const axios = require('axios');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.login(process.env.DISCORD_TOKEN);

client.on('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder().setName('punch_in').setDescription('Punch in for attendance'),
        new SlashCommandBuilder().setName('punch_out').setDescription('Punch out from attendance'),
        new SlashCommandBuilder().setName('break').setDescription('Take a break'),
        new SlashCommandBuilder().setName('back_to_work').setDescription('Back to work after break'),
        new SlashCommandBuilder()
            .setName('attendance_log')
            .setDescription('View your attendance log')
            .addStringOption(option =>
                option.setName('filter')
                    .setDescription('Optional: month, year, or date (YYYY-MM-DD)')
                    .setRequired(false)
            ),
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    const guildIds = process.env.GUILD_ID.split(',');

    (async () => {
        try {
            for (const guildId of guildIds) {
                await rest.put(
                    Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
                    { body: commands }
                );
                console.log(`Successfully registered commands to guild: ${guildId}`);
            }
        } catch (error) {
            console.error(error);
        }
    })();

});

const allowedChannelIds = process.env.ALLOWED_CHANNEL_ID_FOR_ATTENDANCE_BOT.split(',');

const userVoiceStatus = {};

client.on('voiceStateUpdate', async (oldState, newState) => {
    const userId = newState.member.user.id;
    const username = newState.member.user.username;
    console.log('yes');
    userVoiceStatus[userId] = {
        channelName: newState.channel?.name || null,
        isStreaming: newState.streaming,
        isCameraOn: newState.selfVideo
    };

    if (oldState.channel && !newState.channel) {
        const userId = oldState.member.user.id;

        try {
            // Call your external API when user leaves
            const response = await axios.post(`${process.env.API_URL}/camera-stream`, {
                discord_id: userId,
                camera: false,
                stream: false,
            });
            const channel = newState.member.guild.channels.cache.get('1365230989642825748');
            if (channel && channel.isTextBased()) {
                channel.send(`📢 <@${userId}>: Left Voice Channel -- Break Started`);
            }

            console.log(`API called for user ${userId} leaving voice channel. Response:`, response.data);
        } catch (error) {
            console.error('Error while calling API when user left voice channel:', error);
        }
    }else{
        try {
            // Call your external API
            const response = await axios.post(`${process.env.API_URL}/camera-stream`, {
                discord_id: userId,
                camera: userVoiceStatus[userId].isCameraOn,
                stream: userVoiceStatus[userId].isStreaming,
            });
            if (response.status === 200 || response.status === 201) {
                const serverMessage = response.data.message;
                const channel = newState.member.guild.channels.cache.get('1365230989642825748');
                if (serverMessage) {
                    if (channel && channel.isTextBased()) {
                        if(serverMessage != 'Camera or Stream State Updated'){
                            channel.send(`📢 <@${userId}>: ${serverMessage}`);
                        }
                    }
                }
            }
    
        } catch (error) {
            console.error('Failed to call API on voiceStateUpdate:', error);
        }
    }


});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;
    if (interaction.user.bot) return;
    if (!allowedChannelIds.includes(interaction.channel.id)) {
        await interaction.reply({ content: `🚫 You can't use this command here. Please use it in proper channel.` });
        return;
    }

    const content = commandName.toLowerCase();
    const discordId = interaction.user.id;

    const restrictedCommands = ['punch_in', 'punch_out', 'break', 'back_to_work'];

    const voiceData = userVoiceStatus[discordId];
    if (restrictedCommands.includes(content)) {
        if (!voiceData) {
            try {
                const voiceState = await interaction.guild.voiceStates.fetch(discordId);

                if (!voiceState?.channel) {
                    return interaction.reply({ content: "🚫 You must be connected to a voice channel named **General** and have **stream** and **camera** on before running this command." });
                }
                if (voiceState.channel.name !== "General") {
                    return interaction.reply({ content: "🚫 You must join the **General** voice channel before running this command." });
                }
                const isStreaming = voiceState.streaming;
                const isCameraOn = voiceState.selfVideo;

                if (!isStreaming || !isCameraOn) {
                    return interaction.reply({ content: "🚫 You must have both **stream** and **camera** on to run this command." });
                }
            } catch (error) {
                return interaction.reply({ content: "🚫 You must be connected to a voice channel named **General** and have **stream** and **camera** on before running this command." });
            }



        }

        if (!voiceData) {
            return interaction.reply({
                content: "⚠️ Please switch off and then switch on your **camera or stream** to make the session active again."
            });
        }
        if (voiceData.channelName !== "General") {
            return interaction.reply({ content: "🚫 You must join the **General** voice channel before running this command." });
        }

        if (!voiceData.isStreaming || !voiceData.isCameraOn) {
            return interaction.reply({ content: "🚫 You must have both **stream** and **camera** on to run this command." });
        }
    }

    let action = '';
    if (content === 'punch_in') action = 'punch_in';
    else if (content === 'break') action = 'break';
    else if (content === 'back_to_work') action = 'back';
    else if (content === 'punch_out') action = 'punch_out';

    if (action) {
        try {
            const response = await axios.post(`${process.env.API_URL}/attendance`, {
                discord_id: discordId,
                action: action
            });

            if (response.status === 200 || response.status === 201) {
                const serverMessage = response.data.message || "✅ Log recorded.";
                const channel = interaction.channel;
                if (action == 'break') {
                    await channel.send({
                        stickers: ['1369888618939945010']
                    });
                } else if (action == 'back') {
                    await channel.send({
                        stickers: ['1369888951908958208']
                    });
                } else if (action == 'punch_out') {
                    await channel.send({
                        stickers: ['1369887941614370816']
                    });

                } else if (action == 'punch_in') {
                    await channel.send({
                        stickers: ['1369890109465432147']
                    });
                }

                interaction.reply({ content: `📝 ${serverMessage}` });
            } else {
                interaction.reply({ content: "⚠️ Something went wrong while recording attendance." });
            }
        } catch (err) {
            if (err.response) {
                interaction.reply({ content: `❌ Error: ${err.response.data.message || 'Failed to record attendance.'}` });
            } else if (err.request) {
                interaction.reply({ content: "🌐 Could not reach the attendance server. Please try again later." });
            } else {
                interaction.reply({ content: "⚠️ An unexpected error occurred." });
            }
        }
    }

    if (content.startsWith('attendance_log')) {
        try {
            let url = `${process.env.API_URL}/attendance/${discordId}`;

            // Check if user gave a filter after "attendance log"
            // const parts = content.split(' ').slice(2).join(' ').trim(); // Skip "attendance" and "log"
            const parts = interaction.options.getString('filter');

            if (parts) {
                parts = parts.trim();
                // If extra words are there after 'attendance log' (like date or month)
                url += `?filter=${encodeURIComponent(parts)}`;
            }

            const res = await axios.get(url);
            const logs = res.data;


            if (!logs.length) return interaction.reply({ content: "📭 No logs found." });

            // Group logs by date
            const groupedLogs = {};

            logs.forEach(log => {
                let date = new Date(log.timestamp).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }).split(',')[0];
                const [month, day, year] = date.split('/'); // 'MM/DD/YYYY' format from `toLocaleString`
                date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                if (!groupedLogs[date]) groupedLogs[date] = [];

                let actionFormatted = '';
                actionFormatted = `${log.action.replace('_', ' ').toUpperCase()} at ${new Date(log.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;

                groupedLogs[date].push({
                    action: actionFormatted,
                    late: log.late ?? null   // If late is not available, set null
                });

            });

            function parseTime(date, timeString) {
                // Convert "12:35 PM" into a Date object properly
                const [time, modifier] = timeString.split(' ');
                let [hours, minutes] = time.split(':').map(Number);

                if (modifier === 'PM' && hours !== 12) {
                    hours += 12;
                }
                if (modifier === 'AM' && hours === 12) {
                    hours = 0;
                }

                // Return Date with correct hours and minutes
                const [year, month, day] = date.split('-').map(Number);
                return new Date(year, month - 1, day, hours, minutes);
            }

            let logText = 'Date       |  Total Time   | Log\n';
            logText += '-----------|---------------|--------------------------\n';

            for (const [date, actions] of Object.entries(groupedLogs)) {
                let punchInTime = null;
                let punchOutTime = null;
                const breaks = [];

                // Extract times from actions
                for (const action of actions) {
                    if (action.action.startsWith('PUNCH IN at')) {
                        punchInTime = parseTime(date, action.action.split('at ')[1]);
                    } else if (action.action.startsWith('PUNCH OUT at')) {
                        punchOutTime = parseTime(date, action.action.split('at ')[1]);
                    } else if (action.action.startsWith('BREAK at')) {
                        breaks.push({ type: 'break', time: parseTime(date, action.action.split('at ')[1]) });
                    } else if (action.action.startsWith('BACK at')) {
                        breaks.push({ type: 'back', time: parseTime(date, action.action.split('at ')[1]) });
                    }

                }

                let totalBreakMilliseconds = 0;
                for (let i = 0; i < breaks.length; i += 2) {
                    if (breaks[i] && breaks[i + 1]) {
                        const breakStart = breaks[i].time;
                        const backTime = breaks[i + 1].time;
                        totalBreakMilliseconds += backTime - breakStart;
                    } else if (breaks[i] && !breaks[i + 1]) {
                        const breakStart = breaks[i].time;
                        const backTime = new Date();
                        totalBreakMilliseconds += backTime - breakStart;
                    }
                }

                let totalWorkTime = 0;
                if (punchInTime && punchOutTime) {
                    effectiveWorkTime = punchOutTime - punchInTime - totalBreakMilliseconds;
                    totalWorkTime = punchOutTime - punchInTime
                } else if (punchInTime && !punchOutTime) {
                    const currentTime = new Date();
                    effectiveWorkTime = currentTime - punchInTime - totalBreakMilliseconds;
                    totalWorkTime = 0
                }

                let hours = Math.floor(totalWorkTime / (1000 * 60 * 60));
                let minutes = Math.floor((totalWorkTime % (1000 * 60 * 60)) / (1000 * 60));

                let hours2 = Math.floor(effectiveWorkTime / (1000 * 60 * 60));
                let minutes2 = Math.floor((effectiveWorkTime % (1000 * 60 * 60)) / (1000 * 60));

                if (hours < 0) {
                    hours += 24;
                }
                if (minutes < 0) {
                    minutes += 60;
                }
                if (hours2 < 0) {
                    hours2 += 24;
                }
                if (minutes2 < 0) {
                    minutes2 += 60;
                }
                const totalTimeFormatted = `${hours2}h ${minutes2}m/${hours}h ${minutes}m`;

                // --- Now printing the table
                logText += `${date.padEnd(11)}| ${totalTimeFormatted.padEnd(13)} | ${actions[0].action}\n`;

                for (let i = 1; i < actions.length; i++) {
                    const lateBy = `${actions[i - 1].late} mins late`
                    if (i == 1) {
                        logText += `           | ${lateBy.padEnd(13)} | ${actions[i].action}\n`;
                    } else {
                        logText += `           |               | ${actions[i].action}\n`;
                    }
                }
                logText += '-----------|---------------|--------------------------\n';
            }


            // Finally reply
            interaction.reply({ content: `📋 **Your Attendance Log:**\n\`\`\`\n${logText}\n\`\`\`` });
            const channel = interaction.channel;
            await channel.send("Have a great day! <:DeveloperAayush:1365776376388386967>");


        } catch (err) {
            console.error(err);
            interaction.reply({ content: "⚠️ Failed to fetch log." });
        }
    }
});



// client.on('messageCreate', async (message) => {
//     if (message.author.bot) return;
//     if (!allowedChannelIds.includes(message.channel.id)) {
//         message.reply(`🚫 You can't use this command here. Please use it in proper channel.`);
//         return;
//     }

//     const content = message.content.toLowerCase();
//     const discordId = message.author.id;


//     Commands that need voice checks
//     const restrictedCommands = ['punch in', 'punch out', 'break', 'back to work'];

//     if (restrictedCommands.includes(content)) {
//         const voiceData = userVoiceStatus[discordId];
//         if (!voiceData) {
//             const voiceState = await message.guild.voiceStates.fetch(discordId);
//             if (!voiceState?.channel) {
//                 return message.reply("🚫 You must be connected to a voice channel named **General** and have **stream** and **camera** on before running this command.");
//             }

//             if (voiceState.channel.name !== "General") {
//                 return message.reply("🚫 You must join the **General** voice channel before running this command.");
//             }

//             const isStreaming = voiceState.streaming;
//             const isCameraOn = voiceState.selfVideo;

//             if (!isStreaming || !isCameraOn) {
//                 return message.reply("🚫 You must have both **stream** and **camera** on to run this command.");
//             }
//         }

//         if (voiceData.channelName !== "General") {
//             return message.reply("🚫 You must join the **General** voice channel before running this command.");
//         }

//         if (!voiceData.isStreaming || !voiceData.isCameraOn) {
//             return message.reply("🚫 You must have both **stream** and **camera** on to run this command.");
//         }
//     }

//     let action = '';
//     if (content === 'punch in') action = 'punch_in';
//     else if (content === 'break') action = 'break';
//     else if (content === 'back to work') action = 'back';
//     else if (content === 'punch out') action = 'punch_out';

//     if (action) {
//         try {
//             const response = await axios.post(`${process.env.API_URL}/attendance`, {
//                 discord_id: discordId,
//                 action: action
//             });

//             if (response.status === 200 || response.status === 201) {
//                 const serverMessage = response.data.message || "✅ Attendance recorded.";

//                 message.reply(`📝 ${serverMessage}`);
//             } else {
//                 message.reply("⚠️ Something went wrong while recording attendance.");
//             }
//         } catch (err) {
//             if (err.response) {
//                 message.reply(`❌ Error: ${err.response.data.message || 'Failed to record attendance.'}`);
//             } else if (err.request) {
//                 message.reply("🌐 Could not reach the attendance server. Please try again later.");
//             } else {
//                 message.reply("⚠️ An unexpected error occurred.");
//             }
//         }
//     }

//     if (content.startsWith('attendance log')) {
//         try {
//             let url = `${process.env.API_URL}/attendance/${discordId}`;

//             // Check if user gave a filter after "attendance log"
//             const parts = content.split(' ').slice(2).join(' ').trim(); // Skip "attendance" and "log"

//             if (parts) {
//                 // If extra words are there after 'attendance log' (like date or month)
//                 url += `?filter=${encodeURIComponent(parts)}`;
//             }

//             const res = await axios.get(url);
//             const logs = res.data;


//             if (!logs.length) return message.reply("📭 No logs found.");

//             // Group logs by date
//             const groupedLogs = {};

//             logs.forEach(log => {
//                 const date = new Date(log.timestamp).toISOString().split('T')[0];
//                 if (!groupedLogs[date]) groupedLogs[date] = [];

//                 let actionFormatted = '';

//                 if (log.action === 'i_am_back') {
//                     actionFormatted = `BACK at ${new Date(log.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
//                 } else {
//                     actionFormatted = `${log.action.replace('_', ' ').toUpperCase()} at ${new Date(log.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
//                 }

//                 groupedLogs[date].push({
//                     action: actionFormatted,
//                     late: log.late ?? null   // If late is not available, set null
//                 });

//             });

//             function parseTime(date, timeString) {
//                 // Convert "12:35 PM" into a Date object properly
//                 const [time, modifier] = timeString.split(' ');
//                 let [hours, minutes] = time.split(':').map(Number);

//                 if (modifier === 'PM' && hours !== 12) {
//                     hours += 12;
//                 }
//                 if (modifier === 'AM' && hours === 12) {
//                     hours = 0;
//                 }

//                 // Return Date with correct hours and minutes
//                 const [year, month, day] = date.split('-').map(Number);
//                 return new Date(year, month - 1, day, hours, minutes);
//             }

//             let logText = 'Date       |  Total Time   | Log\n';
//             logText += '-----------|---------------|--------------------------\n';

//             for (const [date, actions] of Object.entries(groupedLogs)) {
//                 let punchInTime = null;
//                 let punchOutTime = null;
//                 const breaks = [];

//                 // Extract times from actions
//                 for (const action of actions) {
//                     if (action.action.startsWith('PUNCH IN at')) {
//                         punchInTime = parseTime(date, action.action.split('at ')[1]);
//                     } else if (action.action.startsWith('PUNCH OUT at')) {
//                         punchOutTime = parseTime(date, action.action.split('at ')[1]);
//                     } else if (action.action.startsWith('BREAK at')) {
//                         breaks.push({ type: 'break', time: parseTime(date, action.action.split('at ')[1]) });
//                     } else if (action.action.startsWith('BACK at')) {
//                         breaks.push({ type: 'back', time: parseTime(date, action.action.split('at ')[1]) });
//                     }

//                 }

//                 let totalBreakMilliseconds = 0;
//                 for (let i = 0; i < breaks.length; i += 2) {
//                     if (breaks[i] && breaks[i + 1]) {
//                         const breakStart = breaks[i].time;
//                         const backTime = breaks[i + 1].time;
//                         totalBreakMilliseconds += backTime - breakStart;
//                     }
//                 }

//                 let totalWorkTime = 0;
//                 if (punchInTime && punchOutTime) {
//                     effectiveWorkTime = punchOutTime - punchInTime - totalBreakMilliseconds;
//                     totalWorkTime = punchOutTime - punchInTime
//                 }

//                 const hours = Math.floor(totalWorkTime / (1000 * 60 * 60));
//                 const minutes = Math.floor((totalWorkTime % (1000 * 60 * 60)) / (1000 * 60));

//                 const hours2 = Math.floor(effectiveWorkTime / (1000 * 60 * 60));
//                 const minutes2 = Math.floor((effectiveWorkTime % (1000 * 60 * 60)) / (1000 * 60));


//                 const totalTimeFormatted = `${hours2}h ${minutes2}m/${hours}h ${minutes}m`;

//                 // --- Now printing the table
//                 logText += `${date.padEnd(11)}| ${totalTimeFormatted.padEnd(13)} | ${actions[0].action}\n`;

//                 for (let i = 1; i < actions.length; i++) {
//                     const lateBy = `${actions[i - 1].late} mins late`
//                     if (i == 1) {
//                         logText += `           | ${lateBy.padEnd(13)} | ${actions[i].action}\n`;
//                     } else {
//                         logText += `           |               | ${actions[i].action}\n`;
//                     }
//                 }
//                 logText += '-----------|---------------|--------------------------\n';
//             }


//             // Finally reply
//             message.reply(`📋 **Your Attendance Log:**\n\`\`\`\n${logText}\n\`\`\``);

//         } catch (err) {
//             console.error(err);
//             message.reply("⚠️ Failed to fetch log.");
//         }
//     }
// });

// module.exports = (req, res) => {
//     if (req.method === 'POST') {
//         const signature = req.headers['x-signature-ed25519'];
//         const timestamp = req.headers['x-signature-timestamp'];
//         const rawBody = JSON.stringify(req.body);

//         const isVerified = nacl.sign.detached.verify(
//             Buffer.from(timestamp + rawBody),
//             Buffer.from(signature, 'hex'),
//             Buffer.from(DISCORD_PUBLIC_KEY, 'hex')
//         );

//         if (!isVerified) {
//             return res.status(401).send('Invalid request signature');
//         }

//         if (req.body.type === 1) { // PING Interaction
//             return res.status(200).json({ type: 1 }); // PONG
//         }

//         // If it's a valid interaction, you might need to process it here
//         // or trigger your bot's interactionCreate event handler.
//         // For now, let's just log that we received an interaction.
//         console.log("Received a valid interaction:", req.body);
//         // You'll likely need to find a way to connect this request
//         // to your existing interactionCreate event handler logic.
//         // One way could be to parse the body and manually emit
//         // an 'interactionCreate' event on your client.
//         // However, this can get complex.

//         // For a basic acknowledgement (without immediate response):
//         return res.status(200).json({ type: 5 }); // ACKNOWLEDGE
//     } else {
//         // Handle GET requests (e.g., for a simple "bot is running" check)
//         res.status(200).send('Bot endpoint is alive!');
//     }
// };

// console.log("--- Vercel function entry point executed --- (index.js)");
// require('dotenv').config();
// const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
// const nacl = require('tweetnacl');
// const axios = require('axios');
// const { EventEmitter } = require('events');

// // --- Environment Variables ---
// const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
// const CLIENT_ID = process.env.CLIENT_ID;
// const GUILD_ID = process.env.GUILD_ID;
// const ALLOWED_CHANNEL_ID_FOR_ATTENDANCE_BOT = process.env.ALLOWED_CHANNEL_ID_FOR_ATTENDANCE_BOT;
// const API_URL = process.env.API_URL;
// const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

// if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID || !ALLOWED_CHANNEL_ID_FOR_ATTENDANCE_BOT || !API_URL || !DISCORD_PUBLIC_KEY) {
//     console.error("Missing required environment variables.  Check your Vercel configuration.");
//     //  Don't throw here, let Vercel handle the error.  process.exit(1);
// }

// // --- Global Event Emitter ---
// const interactionEmitter = new EventEmitter();

// // --- Discord Client Initialization (OUTSIDE module.exports) ---
// const client = new Client({
//     intents: [
//         GatewayIntentBits.Guilds,
//         GatewayIntentBits.GuildVoiceStates,
//         GatewayIntentBits.GuildMessages,
//         GatewayIntentBits.MessageContent,
//     ],
// });

// client.login(DISCORD_TOKEN).catch(error => {
//     console.error("Discord login failed:", error);
//     //  Don't throw here, let Vercel handle.  process.exit(1);
// });

// client.on('ready', () => {
//     console.log(`✅ Logged in as ${client.user.tag}`);

//     const commands = [
//         {
//             name: 'punch_in',
//             description: 'Punch in for attendance',
//         },
//         {
//             name: 'punch_out',
//             description: 'Punch out from attendance',
//         },
//         {
//             name: 'break',
//             description: 'Take a break',
//         },
//         {
//             name: 'back_to_work',
//             description: 'Back to work after break',
//         },
//         {
//             name: 'attendance_log',
//             description: 'View your attendance log',
//             options: [
//                 {
//                     name: 'filter',
//                     type: 3, // STRING
//                     description: 'Optional: month, year, or date (YYYY-MM-DD)',
//                     required: false,
//                 },
//             ],
//         },
//     ];

//     const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
//     const guildIds = GUILD_ID.split(',');

//     (async () => {
//         try {
//             for (const guildId of guildIds) {
//                 await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), {
//                     body: commands,
//                 });
//                 console.log(`Successfully registered commands to guild: ${guildId}`);
//             }
//         } catch (error) {
//             console.error("Failed to register commands:", error);
//             //  Don't throw here, let Vercel handle.
//         }
//     })();
// });

// // --- voiceStateUpdate Event Handler ---
// const allowedChannelIds = ALLOWED_CHANNEL_ID_FOR_ATTENDANCE_BOT.split(',');
// const userVoiceStatus = {};

// client.on('voiceStateUpdate', (oldState, newState) => {
//     const userId = newState.member.user.id;
//     userVoiceStatus[userId] = {
//         channelName: newState.channel?.name || null,
//         isStreaming: newState.streaming,
//         isCameraOn: newState.selfVideo,
//     };
// });

// // --- interactionCreate Event Handler (OUTSIDE module.exports) ---
// client.on('interactionCreate', async (interaction) => {
//     if (!interaction.isCommand()) return;

//     const { commandName } = interaction;
//     if (interaction.user.bot) return;
//     if (!allowedChannelIds.includes(interaction.channel.id)) {
//         await interaction.reply({
//             content: `🚫 You can't use this command here. Please use it in the proper channel.`,
//         });
//         return;
//     }

//     const discordId = interaction.user.id;

//     const voiceData = userVoiceStatus[discordId];
//     const restrictedCommands = ['punch_in', 'punch_out', 'break', 'back_to_work'];

//     if (restrictedCommands.includes(commandName)) {
//         if (!voiceData) {
//             try {
//                 const voiceState = await interaction.guild.voiceStates.fetch(discordId);
//                 if (!voiceState?.channel) {
//                     return interaction.reply({
//                         content:
//                             "🚫 You must be connected to a voice channel named **General** and have **stream** and **camera** on before running this command.",
//                     });
//                 }
//                 if (voiceState.channel.name !== "General") {
//                     return interaction.reply({
//                         content:
//                             "🚫 You must join the **General** voice channel before running this command.",
//                     });
//                 }
//                 const isStreaming = voiceState.streaming;
//                 const isCameraOn = voiceState.selfVideo;

//                 if (!isStreaming || !isCameraOn) {
//                     return interaction.reply({
//                         content:
//                             "🚫 You must have both **stream** and **camera** on to run this command.",
//                     });
//                 }
//             } catch (error) {
//                 return interaction.reply({
//                     content:
//                         "🚫 You must be connected to a voice channel named **General** and have **stream** and **camera** on before running this command.",
//                 });
//             }
//         }

//         if (voiceData.channelName !== "General") {
//             return interaction.reply({
//                 content:
//                     "🚫 You must join the **General** voice channel before running this command.",
//             });
//         }

//         if (!voiceData.isStreaming || !voiceData.isCameraOn) {
//             return interaction.reply({
//                 content:
//                     "🚫 You must have both **stream** and **camera** on to run this command.",
//             });
//         }
//     }

//     let action = '';
//     if (commandName === 'punch_in') action = 'punch_in';
//     else if (commandName === 'break') action = 'break';
//     else if (commandName === 'back_to_work') action = 'back';
//     else if (commandName === 'punch_out') action = 'punch_out';

//     if (action) {
//         try {
//             const response = await axios.post(`${API_URL}/attendance`, {
//                 discord_id: discordId,
//                 action: action,
//             });

//             if (response.status === 200 || response.status === 201) {
//                 const serverMessage = response.data.message || "✅ Log recorded.";
//                 const channel = interaction.channel;

//                 if (action === 'break') {
//                     await channel.send({
//                         embeds: [
//                             {
//                                 image: {
//                                     url:
//                                         "https://cdn.discordapp.com/emojis/1365782505843593339.png?size=100",
//                                 },
//                             },
//                         ],
//                     });
//                 } else if (action === 'back') {
//                     await channel.send({
//                         embeds: [
//                             {
//                                 image: {
//                                     url:
//                                         "https://cdn.discordapp.com/emojis/1365790294829830144.png?size=100",
//                                 },
//                             },
//                         ],
//                     });
//                 } else if (action === 'punch_out') {
//                     await channel.send({
//                         stickers: ['1365802015015436378'],
//                     });
//                 }

//                 interaction.reply({ content: `📝 ${serverMessage}` });
//             } else {
//                 interaction.reply({
//                     content: "⚠️ Something went wrong while recording attendance.",
//                 });
//             }
//         } catch (err) {
//             if (err.response) {
//                 interaction.reply({
//                     content: `❌ Error: ${err.response.data.message ||
//                         'Failed to record attendance.'}`,
//                 });
//             } else if (err.request) {
//                 interaction.reply({
//                     content:
//                         "🌐 Could not reach the attendance server. Please try again later.",
//                 });
//             } else {
//                 interaction.reply({ content: "⚠️ An unexpected error occurred." });
//             }
//         }
//     }

//     if (commandName === 'attendance_log') {
//         try {
//             let url = `${API_URL}/attendance/${discordId}`;
//             const filter = interaction.options.getString('filter');

//             if (filter) {
//                 url += `?filter=${encodeURIComponent(filter)}`;
//             }

//             const res = await axios.get(url);
//             const logs = res.data;

//             if (!logs.length)
//                 return interaction.reply({ content: "📭 No logs found." });

//             const groupedLogs = {};
//             logs.forEach((log) => {
//                 const date = new Date(log.timestamp)
//                     .toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
//                     .split(',')[0];
//                 const [month, day, year] = date.split('/');
//                 const formattedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

//                 if (!groupedLogs[formattedDate]) groupedLogs[formattedDate] = [];

//                 const actionFormatted = `${log.action
//                     .replace('_', ' ')
//                     .toUpperCase()} at ${new Date(log.timestamp).toLocaleTimeString(
//                         'en-US',
//                         { hour: '2-digit', minute: '2-digit' }
//                     )}`;

//                 groupedLogs[formattedDate].push({
//                     action: actionFormatted,
//                     late: log.late ?? null,
//                 });
//             });

//             function parseTime(date, timeString) {
//                 const [time, modifier] = timeString.split(' ');
//                 let [hours, minutes] = time.split(':').map(Number);

//                 if (modifier === 'PM' && hours !== 12) {
//                     hours += 12;
//                 }
//                 if (modifier === 'AM' && hours === 12) {
//                     hours = 0;
//                 }
//                 const [year, month, day] = date.split('-').map(Number);
//                 return new Date(year, month - 1, day, hours, minutes);
//             }

//             let logText = 'Date       |  Total Time   | Log\n';
//             logText += '-----------|---------------|--------------------------\n';

//             for (const [date, actions] of Object.entries(groupedLogs)) {
//                 let punchInTime = null;
//                 let punchOutTime = null;
//                 const breaks = [];

//                 for (const action of actions) {
//                     if (action.action.startsWith('PUNCH IN at')) {
//                         punchInTime = parseTime(date, action.action.split('at ')[1]);
//                     } else if (action.action.startsWith('PUNCH OUT at')) {
//                         punchOutTime = parseTime(date, action.action.split('at ')[1]);
//                     } else if (action.action.startsWith('BREAK at')) {
//                         breaks.push({
//                             type: 'break',
//                             time: parseTime(date, action.action.split('at ')[1]),
//                         });
//                     } else if (action.action.startsWith('BACK at')) {
//                         breaks.push({
//                             type: 'back',
//                             time: parseTime(date, action.action.split('at ')[1]),
//                         });
//                     }
//                 }

//                 let totalBreakMilliseconds = 0;
//                 for (let i = 0; i < breaks.length; i += 2) {
//                     if (breaks[i] && breaks[i + 1]) {
//                         const breakStart = breaks[i].time;
//                         const backTime = breaks[i + 1].time;
//                         totalBreakMilliseconds += backTime - breakStart;
//                     } else if (breaks[i] && !breaks[i + 1]) {
//                         const breakStart = breaks[i].time;
//                         const backTime = new Date();
//                         totalBreakMilliseconds += backTime - breakStart;
//                     }
//                 }

//                 let totalWorkTime = 0;
//                 let effectiveWorkTime = 0;
//                 if (punchInTime && punchOutTime) {
//                     effectiveWorkTime = punchOutTime - punchInTime - totalBreakMilliseconds;
//                     totalWorkTime = punchOutTime - punchInTime;
//                 } else if (punchInTime && !punchOutTime) {
//                     const currentTime = new Date();
//                     effectiveWorkTime = currentTime - punchInTime - totalBreakMilliseconds;
//                     totalWorkTime = 0;
//                 }

//                 let hours = Math.floor(totalWorkTime / (1000 * 60 * 60));
//                 let minutes = Math.floor(
//                     (totalWorkTime % (1000 * 60 * 60)) / (1000 * 60)
//                 );
//                 let hours2 = Math.floor(effectiveWorkTime / (1000 * 60 * 60));
//                 let minutes2 = Math.floor(
//                     (effectiveWorkTime % (1000 * 60 * 60)) / (1000 * 60)
//                 );

//                 if (hours < 0) hours += 24;
//                 if (minutes < 0) minutes += 60;
//                 if (hours2 < 0) hours2 += 24;
//                 if (minutes2 < 0) minutes2 += 60;

//                 const totalTimeFormatted = `${hours2}h ${minutes2}m/${hours}h ${minutes}m`;

//                 logText += `${date.padEnd(11)}| ${totalTimeFormatted.padEnd(
//                     13
//                 )} | ${actions[0].action}\n`;

//                 for (let i = 1; i < actions.length; i++) {
//                     const lateBy = `${actions[i - 1].late} mins late`;
//                     logText +=
//                         i === 1
//                             ? `           | ${lateBy.padEnd(13)} | ${actions[i].action}\n`
//                             : `           |               | ${actions[i].action}\n`;
//                 }
//                 logText += '-----------|---------------|--------------------------\n';
//             }

//             interaction.reply({
//                 content: `📋 **Your Attendance Log:**\n\`\`\`\n${logText}\n\`\`\``,
//             });
//             const channel = interaction.channel;
//             await channel.send(
//                 "Have a great day! <:DeveloperAayush:1365776376388386967>"
//             );
//         } catch (err) {
//             console.error(err);
//             interaction.reply({ content: "⚠️ Failed to fetch log." });
//         }
//     }
// });

// // --- Vercel Function Handler (module.exports) ---
// module.exports = async (req, res) => {
//     if (req.method === 'POST') {
//         const signature = req.headers['x-signature-ed25519'];
//         const timestamp = req.headers['x-signature-timestamp'];
//         const rawBody = JSON.stringify(req.body);

//         if (!signature || !timestamp || !rawBody) {
//             return res.status(400).send('Missing signature, timestamp, or body');
//         }

//         try {
//             const isVerified = nacl.sign.detached.verify(
//                 Buffer.from(timestamp + rawBody),
//                 Buffer.from(signature, 'hex'),
//                 Buffer.from(DISCORD_PUBLIC_KEY, 'hex')
//             );

//             if (!isVerified) {
//                 console.error('Signature verification failed');
//                 return res.status(401).send('Invalid request signature');
//             }

//             if (req.body.type === 1) {
//                 // PING Interaction
//                 return res.status(200).json({ type: 1 }); // PONG
//             }

//             // --- Emit the interaction data to be handled by the bot ---
//             interactionEmitter.emit('interaction', req.body); // Emit the raw body
//             // Acknowledge the interaction (type 5):
//             return res.status(200).json({ type: 5 });
//         } catch (error) {
//             console.error('Verification error:', error);
//             return res.status(500).send('Internal Server Error during verification');
//         }
//     } else {
//         // Handle GET requests (e.g., for a simple "bot is running" check)
//         res.status(200).send('Bot endpoint is alive!');
//     }
// };

// // --- Listen for the 'interaction' event and pass it to the client ---
// interactionEmitter.on('interaction', (interactionData) => {
//     //  console.log("Emitting interaction data to client:", interactionData);
//     //  The 'interactionCreate' event handler expects an Interaction object.
//     //  You might need to construct a minimal Interaction object here,
//     //  depending on how your handler uses it.  For simple commands,
//     //  you might get away with passing the raw data, but for more
//     //  complex interactions (buttons, selects), you'll need to
//     //  create a more complete object.
//     //  client.emit('interactionCreate', interactionData); //  TRYING THIS
//     //  Wrap it in a minimal Interaction object.  This is VERY important.
//     const minimalInteraction = {
//         type: interactionData.type,
//         id: interactionData.id,
//         token: interactionData.token,
//         application_id: interactionData.application_id,
//         channel_id: interactionData.channel_id,
//         guild_id: interactionData.guild_id,
//         member: interactionData.member,  //  Adapt as necessary
//         user: interactionData.user || (interactionData.member ? interactionData.member.user : null),
//         commandName: interactionData.data?.name, //  Adapt as necessary.
//         data: interactionData.data,
//         options: interactionData.data?.options || [], // Adapt this
//         // Add more properties as needed for your command handler
//         isCommand: () => interactionData.type === 2, // Application Command
//         isButton: () => interactionData.type === 3,    // Message Component
//         isSelectMenu: () => interactionData.type === 3,  // Message Component
//         reply: async (content) => {  /* VERY BASIC REPLY */
//             if (!interactionData.token) {
//                 console.warn("Cannot reply to interaction: No token available.");
//                 return;
//             }
//             try {
//                 const replyData = {
//                     method: 'POST',
//                     url: `https://discord.com/api/v10/interactions/${interactionData.id}/${interactionData.token}/callback`,
//                     headers: {
//                         'Content-Type': 'application/json',
//                         'Authorization': `Bot ${DISCORD_TOKEN}` //  IMPORTANT:  Include bot token!
//                     },
//                     data: {
//                         type: 4, //  CHANNEL_MESSAGE WITH SOURCE
//                         data: typeof content === 'string' ? { content: content } : content, //  Handle string or object
//                     },
//                 };
//                 const response = await axios(replyData);
//                 if (response.status !== 200) {
//                     console.error("Failed to send reply:", response.status, response.data);
//                 }
//             } catch (error) {
//                 console.error("Error sending reply:", error);
//             }
//         },
//         followUp: async (content) => {  /* VERY BASIC FOLLOWUP */
//              if (!interactionData.token) {
//                 console.warn("Cannot followUp interaction: No token available.");
//                 return;
//             }
//             try {
//                 const followUpData = {
//                     method: 'POST',
//                     url: `https://discord.com/api/v10/webhooks/${CLIENT_ID}/${interactionData.token}`,
//                     headers: {
//                         'Content-Type': 'application/json',
//                         'Authorization': `Bot ${DISCORD_TOKEN}` //  Include bot token!
//                     },
//                     data: typeof content === 'string' ? { content: content } : content
//                 };
//                 const response = await axios(followUpData);
//                 if (response.status !== 200) {
//                       console.error("Failed to send followUp:", response.status, response.data);
//                 }
//             } catch(error){
//                  console.error("Error sending followUp:", error);
//             }
//         },
//         deferReply: async () => { /* VERY BASIC DEFERREPLY */
//             if (!interactionData.token) {
//                 console.warn("Cannot deferReply interaction: No token available.");
//                 return;
//             }
//              try {
//                 const deferData = {
//                     method: 'POST',
//                     url: `https://discord.com/api/v10/interactions/${interactionData.id}/${interactionData.token}/callback`,
//                     headers: {
//                         'Content-Type': 'application/json',
//                         'Authorization': `Bot ${DISCORD_TOKEN}` //  Include bot token!
//                     },
//                     data: {
//                         type: 5, //  DEFERRED_CHANNEL_MESSAGE WITH SOURCE
//                     },
//                 };
//                 const response = await axios(deferData);
//                 if (response.status !== 200) {
//                     console.error("Failed to send deferReply:", response.status, response.data);
//                 }
//             } catch (error) {
//                 console.error("Error sending deferReply", error)
//             }
//         },
//         replied: false,
//         deferred: false,
//     };

//     client.emit('interactionCreate', minimalInteraction);
// });

