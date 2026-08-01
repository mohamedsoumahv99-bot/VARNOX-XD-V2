const fs = require('fs');
const { channelInfo } = require('../lib/messageConfig');

async function banCommand(sock, chatId, message) {
    let userToBan;

    // Check for mentioned users
    if (message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
        userToBan = message.message.extendedTextMessage.contextInfo.mentionedJid[0];
    }
    // Check for replied message
    else if (message.message?.extendedTextMessage?.contextInfo?.participant) {
        userToBan = message.message.extendedTextMessage.contextInfo.participant;
    }

    if (!userToBan) {
        await sock.sendMessage(chatId, {
            text: 'Please mention the user or reply to their message to ban!',
            ...channelInfo
        });
        return;
    }

    // Prevent banning the bot itself
    try {
        const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        if (userToBan === botId || userToBan === botId.replace('@s.whatsapp.net', '@lid')) {
            await sock.sendMessage(chatId, { text: 'You cannot ban the bot account.', ...channelInfo }, { quoted: message });
            return;
        }
    } catch {}

    try {
        // Add user to banned list
        const bannedUsers = JSON.parse(fs.readFileSync('./data/banned.json'));
        if (!bannedUsers.includes(userToBan)) {
            bannedUsers.push(userToBan);
            fs.writeFileSync('./data/banned.json', JSON.stringify(bannedUsers, null, 2));

            await sock.sendMessage(chatId, {
                text: `Banni avec succès @${userToBan.split('@')[0]}!`,
                mentions: [userToBan],
                ...channelInfo
            });
        } else {
            await sock.sendMessage(chatId, {
                text: `${userToBan.split('@')[0]} est déjà banni !`,
                mentions: [userToBan],
                ...channelInfo
            });
        }
    } catch (error) {
        console.error('Error in ban command:', error);
        await sock.sendMessage(chatId, { text: 'Échec du bannissement !', ...channelInfo });
    }
}

module.exports = banCommand;
