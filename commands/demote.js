const isAdmin = require('../lib/isAdmin');

async function demoteCommand(sock, chatId, mentionedJids, message) {
    try {
        // First check if it's a group
        if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(chatId, {
                text: 'Cette commande ne fonctionne que dans les groupes !'
            });
            return;
        }

        let userToDemote = [];

        // Check for mentioned users
        if (mentionedJids && mentionedJids.length > 0) {
            userToDemote = mentionedJids;
        }
        // Check for replied message
        else if (message.message?.extendedTextMessage?.contextInfo?.participant) {
            userToDemote = [message.message.extendedTextMessage.contextInfo.participant];
        }

        // If no user found through either method
        if (userToDemote.length === 0) {
            await sock.sendMessage(chatId, {
                text: '❌ Error: Please mention the user or reply to their message to demote!'
            });
            return;
        }

        const metadata = await sock.groupMetadata(chatId);
        const participants = metadata.participants || [];
        const botJid = sock.decodeJid ? sock.decodeJid(sock.user?.id) : sock.user?.id;
        const botParticipant = participants.find(p => p.id === botJid || p.lid === botJid);
        if (!botParticipant || !['admin', 'superadmin'].includes(botParticipant.admin)) {
            await sock.sendMessage(chatId, {
                text: '❌ WhatsApp refuse cette action : le bot doit être administrateur du groupe. Aucun bot ne peut contourner cette règle.'
            }, { quoted: message });
            return;
        }

        const validTargets = userToDemote.filter(jid => {
            const participant = participants.find(p => p.id === jid || p.lid === jid);
            return participant && (participant.admin === 'admin' || participant.admin === 'superadmin');
        });
        if (!validTargets.length) {
            await sock.sendMessage(chatId, { text: 'ℹ️ Les membres indiqués ne sont pas administrateurs.' }, { quoted: message });
            return;
        }

        await sock.groupParticipantsUpdate(chatId, validTargets, "demote");

        // Get usernames for each demoted user
        const usernames = await Promise.all(validTargets.map(async jid => {
            return `@${jid.split('@')[0]}`;
        }));

        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

        const demotionMessage = `*『 GROUP DEMOTION 』*\n\n` +
            `👤 *Demoted User${validTargets.length > 1 ? 's' : ''}:*\n` +
            `${usernames.map(name => `• ${name}`).join('\n')}\n\n` +
            `👑 *Demoted By:* @${message.key.participant ? message.key.participant.split('@')[0] : message.key.remoteJid.split('@')[0]}\n\n` +
            `📅 *Date:* ${new Date().toLocaleString()}`;

        await sock.sendMessage(chatId, {
            text: demotionMessage,
            mentions: [...validTargets, message.key.participant || message.key.remoteJid]
        });
    } catch (error) {
        console.error('Error in demote command:', error);
        if (error.data === 429) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
                await sock.sendMessage(chatId, {
                    text: '❌ Rate limit reached. Veuillez réessayer in a few seconds.'
                });
            } catch (retryError) {
                console.error('Error sending retry message:', retryError);
            }
        } else {
            try {
                await sock.sendMessage(chatId, {
                    text: '❌ Failed to demote user(s). Make sure the bot has sufficient permissions.'
                });
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
        }
    }
}

module.exports = demoteCommand;
