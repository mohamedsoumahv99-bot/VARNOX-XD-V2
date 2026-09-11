'use strict';

const { handleGoodbye } = require('../lib/welcome');
const { isGoodByeOn, getGoodbye } = require('../lib/index');
const {
    channelInfo,
    memberCountAfterLeave,
    participantJid,
    sendMemberEvent
} = require('../lib/memberEvent');

// ─── Commande .goodbye ───────────────────────────────────────────────────────
async function goodbyeCommand(sock, chatId, message, match) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'Cette commande ne fonctionne que dans les groupes.' });
        return;
    }
    const text      = message.message?.conversation ||
                      message.message?.extendedTextMessage?.text || '';
    const matchText = text.split(' ').slice(1).join(' ');
    await handleGoodbye(sock, chatId, message, matchText);
}

// ─── Événement départ d'un membre ────────────────────────────────────────────
async function handleLeaveEvent(sock, id, participants) {
    const isGoodbyeEnabled = await isGoodByeOn(id);
    if (!isGoodbyeEnabled) return;

    const customMessage = await getGoodbye(id);

    let groupMetadata;
    try {
        groupMetadata = await sock.groupMetadata(id);
    } catch { return; }

    const groupName   = groupMetadata.subject || 'Groupe';
    const memberCount = groupMetadata.participants.length;

    for (const participant of participants) {
        try {
            const jid = participantJid(participant);

            // Vrai numéro WhatsApp du membre qui part
            const senderNum = jid.split('@')[0];

            const defaultMessage = 'Au revoir {user} 👋';
            let adminMsg = customMessage && customMessage.trim() !== defaultMessage
                ? customMessage
                    .replace(/{user}/gi,  `@${senderNum}`)
                    .replace(/{group}/gi, groupName)
                : null;

            const now     = new Date();
            const timeStr = now.toLocaleString('fr-FR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });

            const currentMemberCount = memberCountAfterLeave(
                groupMetadata.participants,
                jid
            );
            const goodbyeMsg =
                `╭─〔 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩𝟮 〕─╮\n` +
                `│ 👋 Goodbye @${senderNum}\n` +
                `│\n` +
                `│ Thank you for being part of\n` +
                `│ *${groupName}*\n` +
                `│\n` +
                `│ 👥 The group now has *${currentMemberCount}* member${currentMemberCount === 1 ? '' : 's'}\n` +
                `│ 📜 *Remember:*\n` +
                `│ • Be respectful\n` +
                `│ • No spam\n` +
                `│ • Follow admin instructions\n` +
                (adminMsg ? `│\n│ 💬 ${adminMsg}\n` : '') +
                `╰──────────────────╯\n` +
                `> POWERED BY VARNOX\n` +
                `> ${timeStr}`;

            await sendMemberEvent(sock, id, jid, goodbyeMsg);

        } catch (err) {
            console.error('[goodbye] Erreur :', err.message);
            try {
                const jid = participantJid(participant);
                const num = jid.split('@')[0];
                await sock.sendMessage(id, {
                    text:     `👋 Au revoir @${num} ! Tu vas nous manquer...`,
                    mentions: [jid],
                    ...channelInfo()
                });
            } catch { /* rien */ }
        }
    }
}

module.exports = { goodbyeCommand, handleLeaveEvent };
