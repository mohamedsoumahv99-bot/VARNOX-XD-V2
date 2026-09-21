'use strict';

const { handleGoodbye } = require('../lib/welcome');
const { isGoodByeOn } = require('../lib/index');
const { channelInfo, participantJid, sendMemberEvent } = require('../lib/memberEvent');

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

    for (const participant of participants || []) {
        try {
            const jid = participantJid(participant);
            const senderNum = jid.split('@')[0];
            const goodbyeMsg = `👋 Au revoir @${senderNum}.`;

            await sendMemberEvent(sock, id, jid, goodbyeMsg);
        } catch (err) {
            console.error('[goodbye] Erreur :', err.message);
            try {
                const jid = participantJid(participant);
                const num = jid.split('@')[0];
                await sock.sendMessage(id, {
                    text: '👋 Au revoir @' + num + ' ! Tu vas nous manquer...',
                    mentions: [jid],
                    ...channelInfo()
                });
            } catch { /* rien */ }
        }
    }
}

module.exports = { goodbyeCommand, handleLeaveEvent };
