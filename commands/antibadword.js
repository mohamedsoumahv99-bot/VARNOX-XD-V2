const { handleAntiBadwordCommand } = require('../lib/antibadword');
const isAdminHelper = require('../lib/isAdmin');
const { channelInfo } = require('../lib/messageConfig');

async function antibadwordCommand(sock, chatId, message, senderId, isSenderAdmin) {
    try {
        if (!isSenderAdmin) {
            await sock.sendMessage(chatId, {
                text: '❌ Cette commande est réservée aux administrateurs du groupe.',
                ...channelInfo
            }, { quoted: message });
            return;
        }

        // Extract match from message
        const text = message.message?.conversation || 
                    message.message?.extendedTextMessage?.text || '';
        const match = text.split(' ').slice(1).join(' ');

        await handleAntiBadwordCommand(sock, chatId, message, match);
    } catch (error) {
        console.error('Error in antibadword command:', error);
        await sock.sendMessage(chatId, {
            text: '❌ Une erreur a empêché VARNOX de traiter antibadword.',
            ...channelInfo
        }, { quoted: message });
    }
}

module.exports = antibadwordCommand; 