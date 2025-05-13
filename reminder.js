const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
require('dotenv').config(); // If you're using a .env file
const axios = require('axios');
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers,],
});

client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    startReminders();
});

async function isUserPunchedInToday(userId) {
    const today = new Date().toISOString().split('T')[0];
    const res = await axios.get(`${process.env.API_URL}/attendance/${userId}?filter=${today}`);
    const log = res.data;
    return log.some(entry => entry.action === 'punch_in');
}

function parseTime(date, timeString) {
    // Convert "12:35 PM" into a Date object properly
    timeString = new Date(timeString).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
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
    const parsedata = new Date(year, month - 1, day, hours, minutes)
    return parsedata;
}

async function getEffectiveWorkingHours(userId) {
    const today = new Date().toISOString().split('T')[0];
    const res = await axios.get(`${process.env.API_URL}/attendance/${userId}?filter=${today}`);
    const logs = res.data;// Fetch the user's attendance logs for today



    // Loop through logs to calculate the working hours
    let punchInTime = null;
    let punchOutTime = null;
    breaks = [];
    for (let i = 0; i < logs.length; i++) {
        const log = logs[i];
        if (log.action === 'punch_in') {
            punchInTime = parseTime(today, log.timestamp);
        } else if (log.action === 'punch_out') {
            punchOutTime = parseTime(today, log.timestamp);
        } else if (log.action === 'break') {
            breaks.push({ type: 'break', time: parseTime(today, log.timestamp) })
        } else if (log.action === 'back') {
            breaks.push({ type: 'back', time: parseTime(today, log.timestamp) })
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
    let WorkingHours = null;
    if (punchInTime && punchOutTime) {
        WorkingHours = punchOutTime - punchInTime - totalBreakMilliseconds;
    } else if (punchInTime && !punchOutTime) {
        const currentTime = new Date();
        WorkingHours = currentTime - punchInTime - totalBreakMilliseconds;
    }
    const totalWorkingHours = Math.floor(WorkingHours / (1000 * 60 * 60));
    return totalWorkingHours;
}

function startReminders() {

    cron.schedule('55 9 * * 1-5', () => {
        sendReminder("Good morning! ☀️ It's 09:55 AM, time to get started with your tasks. Let's have a productive day!", '1365885847169400962');
    }, {
        timezone: 'Asia/Kolkata'
    });

    // 10:00 AM Reminder
    cron.schedule('0 10 * * 1-5', async () => {
        const guild = client.guilds.cache.get('1055415419663560784');
        const channel = client.channels.cache.get('1365885847169400962');

        if (!guild || !channel) return console.error('Guild or channel not found');
        try {

            const members = await guild.members.fetch();
            // Filter only real users (exclude bots)
            const realUsers = members.filter(member => !member.user.bot);

            // Now, you should already have a database or storage where punch-in records are stored.
            // Let's assume you can check like isUserPunchedInToday(member.id)

            for (const [id, member] of realUsers) {
                const hasPunchedIn = await isUserPunchedInToday(id);

                if (!hasPunchedIn) {
                    await channel.send(`🔔 Hey ${member}, don't forget to **Punch In** for today!`);
                }
            }
        } catch (error) {
            console.error('Error fetching members or sending messages:', error);
        }

    }, {
        timezone: 'Asia/Kolkata'
    });

    // 1:00 PM Lunch Reminder
    cron.schedule('0 13 * * 1-5', () => {
        sendReminder('🍽️ It\'s lunch time! Take a break.', '1365885847169400962');
    }, {
        timezone: 'Asia/Kolkata'
    });

    // 2:00 PM Back to work Reminder
    cron.schedule('0 14 * * 1-5', () => {
        sendReminder('🔔 Break over! Let\'s get back to work.', '1365885847169400962');
    }, {
        timezone: 'Asia/Kolkata'
    });

    cron.schedule('0-59/10 19 * * *', async () => {
        const guild = client.guilds.cache.get('1055415419663560784');
        const channel = client.channels.cache.get('1365885847169400962');

        if (!guild || !channel) return console.error('Guild or channel not found');
        try {

            const members = await guild.members.fetch();
            // Filter only real users (exclude bots)
            const realUsers = members.filter(member => !member.user.bot);

            // Now, you should already have a database or storage where punch-in records are stored.
            // Let's assume you can check like isUserPunchedInToday(member.id)

            for (const [id, member] of realUsers) {
                const effectiveWorkingHours = await getEffectiveWorkingHours(id);

                if (effectiveWorkingHours > 8) {
                    await channel.send(`🎉 Hurray! ${member} have completed 8 hours of effective work today! 🎉'`);
                }
            }
        } catch (error) {
            console.error('Error fetching members or sending messages:', error);
        }
    });

    // 7:00 PM End of Day Reminder
    cron.schedule('0 19 * * 1-5', () => {
        sendReminder('🎯 Workday over! Don\'t forget to punch out when you leave.', '1365885847169400962');
    }, {
        timezone: 'Asia/Kolkata'
    });
}

async function sendReminder(message, channelId) {
    const channel = await client.channels.fetch(channelId);
    if (channel) {
        channel.send(message);
    }
}

client.login(process.env.DISCORD_TOKEN);
module.exports = (req, res) => {
    res.status(200).send('Reminder service is running!');
};