'use strict';

const { handleWelcome } = require('../lib/welcome');
const { isWelcomeOn } = require('../lib/index');
const {
    buildWelcomeMessage,
    channelInfo,
    getMemberCount,
    participantJid,
    participantNumber,
    sendMemberEvent
} = require('../lib/memberEvent');

function commandArgs(text, command) {
    return text.replace(new RegExp('^\\s*\\.' + command + '\\b', 'i'), '').trim();
}

async function welcomeCommand(sock, chatId, message) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'Cette commande ne fonctionne que dans les groupes.' });
        return;
    }
    const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    await handleWelcome(sock, chatId, message, commandArgs(text, 'welcome'));
}

async function handleJoinEvent(sock, id, participants) {
    if (!(await isWelcomeOn(id))) return;

    let groupMetadata = null;
    try {
        groupMetadata = await sock.groupMetadata(id);
    } catch (error) {
        console.error('[welcome] groupe inaccessible pour le comptage :', error.message);
    }
    const groupName = groupMetadata?.subject || 'Groupe';

    for (const participant of participants || []) {
        try {
            const jid = participantJid(participant);
            const senderNum = participantNumber(participant);
            if (!jid || !senderNum) continue;
            let memberCount = 'indisponible';
            try {
                const count = await getMemberCount(sock, id, participants, 'add', groupMetadata);
                if (Number.isInteger(count)) memberCount = count;
            } catch (error) {
                console.warn('[welcome] nombre de membres indisponible :', error.message);
            }
            const welcomeMsg = buildWelcomeMessage({ senderNum, groupName, memberCount, date: new Date() });
            await sendMemberEvent(sock, id, jid, welcomeMsg);
        } catch (error) {
            console.error('[welcome] Erreur :', error.message);
            try {
                const jid = participantJid(participant);
                const senderNum = participantNumber(participant);
                if (!jid || !senderNum) continue;
                await sock.sendMessage(id, {
                    text: buildWelcomeMessage({
                        senderNum,
                        groupName,
                        memberCount: 'indisponible',
                        date: new Date()
                    }),
                    mentions: [jid],
                    ...channelInfo()
                });
            } catch (fallbackError) {
                console.error('[welcome] fallback message failed:', fallbackError.message);
            }
        }
    }
}

module.exports = { welcomeCommand, handleJoinEvent };
