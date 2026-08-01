const isAdmin = require('../lib/isAdmin');

async function kickCommand(sock, chatId, senderId, mentionedJids, message) {
    let usersToKick = [];

    if (mentionedJids && mentionedJids.length > 0) {
        usersToKick = mentionedJids;
    }
    else if (message.message?.extendedTextMessage?.contextInfo?.participant) {
        usersToKick = [message.message.extendedTextMessage.contextInfo.participant];
    }

    if (usersToKick.length === 0) {
        await sock.sendMessage(chatId, {
            text: 'Please mention the user or reply to their message to kick!'
        }, { quoted: message });
        return;
    }

    const botId = sock.user?.id || '';
    const botLid = sock.user?.lid || '';
    const botPhoneNumber = botId.includes(':') ? botId.split(':')[0] : (botId.includes('@') ? botId.split('@')[0] : botId);
    const botIdFormatted = botPhoneNumber + '@s.whatsapp.net';

    const botLidNumeric = botLid.includes(':') ? botLid.split(':')[0] : (botLid.includes('@') ? botLid.split('@')[0] : botLid);
    const botLidWithoutSuffix = botLid.includes('@') ? botLid.split('@')[0] : botLid;

    const metadata = await sock.groupMetadata(chatId);
    const participants = metadata.participants || [];

    const isTryingToKickBot = usersToKick.some(userId => {
        const userPhoneNumber = userId.includes(':') ? userId.split(':')[0] : (userId.includes('@') ? userId.split('@')[0] : userId);
        const userLidNumeric = userId.includes('@lid') ? userId.split('@')[0].split(':')[0] : '';

        const directMatch = (
            userId === botId ||
            userId === botLid ||
            userId === botIdFormatted ||
            userPhoneNumber === botPhoneNumber ||
            (userLidNumeric && botLidNumeric && userLidNumeric === botLidNumeric)
        );

        if (directMatch) return true;

        return participants.some(p => {
            const pPhoneNumber = p.phoneNumber ? p.phoneNumber.split('@')[0] : '';
            const pId = p.id ? p.id.split('@')[0] : '';
            const pLid = p.lid ? p.lid.split('@')[0] : '';
            const pFullId = p.id || '';
            const pFullLid = p.lid || '';
            const pLidNumeric = pLid.includes(':') ? pLid.split(':')[0] : pLid;

            const isThisParticipantBot = (
                pFullId === botId || pFullLid === botLid ||
                pLidNumeric === botLidNumeric || pPhoneNumber === botPhoneNumber ||
                pId === botPhoneNumber || p.phoneNumber === botIdFormatted ||
                (botLid && pLid && botLidWithoutSuffix === pLid)
            );

            if (isThisParticipantBot) {
                return (
                    userId === pFullId || userId === pFullLid ||
                    userPhoneNumber === pPhoneNumber || userPhoneNumber === pId ||
                    userId === p.phoneNumber
                );
            }
            return false;
        });
    });

    if (isTryingToKickBot) {
        await sock.sendMessage(chatId, {
            text: 'I cannot kick myself from the group!'
        }, { quoted: message });
        return;
    }

    try {
        await sock.groupParticipantsUpdate(chatId, usersToKick, 'remove');
        const usernames = usersToKick.map(jid => `@${jid.split('@')[0]}`);
        await sock.sendMessage(chatId, {
            text: `Successfully kicked: ${usernames.join(', ')}`,
            mentions: usersToKick
        }, { quoted: message });
    } catch (error) {
        console.error('Error in kick command:', error);
        await sock.sendMessage(chatId, {
            text: 'Failed to kick user(s). Please try again.'
        }, { quoted: message });
    }
}

module.exports = kickCommand;
