'use strict';

const { handleGoodbye } = require('../lib/welcome');
const { isGoodByeOn } = require('../lib/index');
const {
    buildGoodbyeMessage,
    channelInfo,
    getMemberCount,
    participantJid,
    participantNumber,
    sendMemberEvent
} = require('../lib/memberEvent');

function commandArgs(text, command) {
    return text.replace(new RegExp('^\\s*\\.' + command + '\\b', 'i'), '').trim();
}

async function goodbyeCommand(sock, chatId, message) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'Cette commande ne fonctionne que dans les groupes.' });
        return;
    }
    const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    await handleGoodbye(sock, chatId, message, commandArgs(text, 'goodbye'));
}

async function handleLeaveEvent(sock, id, participants) {
    if (!(await isGoodByeOn(id))) return;

    let groupMetadata = null;
    try {
        groupMetadata = await sock.groupMetadata(id);
    } catch (error) {
        console.error('[goodbye] groupe inaccessible pour le comptage :', error.message);
    }
    const groupName = groupMetadata?.subject || 'Groupe';

    for (const participant of participants || []) {
        try {
            const jid = participantJid(participant);
            const senderNum = participantNumber(participant);
            if (!jid || !senderNum) continue;
            let memberCount = 'indisponible';
            try {
                const count = await getMemberCount(sock, id, participants, 'remove', groupMetadata);
                if (Number.isInteger(count)) memberCount = count;
            } catch (error) {
                console.warn('[goodbye] nombre de membres indisponible :', error.message);
            }
            const goodbyeMsg = buildGoodbyeMessage({ senderNum, groupName, memberCount, date: new Date() });
            await sendMemberEvent(sock, id, jid, goodbyeMsg);
        } catch (error) {
            console.error('[goodbye] Erreur :', error.message);
            try {
                const jid = participantJid(participant);
                const senderNum = participantNumber(participant);
                if (!jid || !senderNum) continue;
                await sock.sendMessage(id, {
                    text: buildGoodbyeMessage({
                        senderNum,
                        groupName,
                        memberCount: 'indisponible',
                        date: new Date()
                    }),
                    mentions: [jid],
                    ...channelInfo()
                });
            } catch (fallbackError) {
                console.error('[goodbye] fallback message failed:', fallbackError.message);
            }
        }
    }
}

module.exports = { goodbyeCommand, handleLeaveEvent };
