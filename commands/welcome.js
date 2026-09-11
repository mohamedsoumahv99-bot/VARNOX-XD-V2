'use strict';

const { handleWelcome } = require('../lib/welcome');
const { isWelcomeOn, getWelcome } = require('../lib/index');
const {
    channelInfo,
    ordinal,
    participantJid,
    sendMemberEvent
} = require('../lib/memberEvent');

// ─── Commande .welcome ───────────────────────────────────────────────────────
async function welcomeCommand(sock, chatId, message, match) {
    if (!chatId.endsWith('@g.us')) {
        await sock.sendMessage(chatId, { text: 'Cette commande ne fonctionne que dans les groupes.' });
        return;
    }
    const text      = message.message?.conversation ||
                      message.message?.extendedTextMessage?.text || '';
    const matchText = text.split(' ').slice(1).join(' ');
    await handleWelcome(sock, chatId, message, matchText);
}

// ─── Événement nouveau membre ────────────────────────────────────────────────
async function handleJoinEvent(sock, id, participants) {
    const isWelcomeEnabled = await isWelcomeOn(id);
    if (!isWelcomeEnabled) return;

    const customMessage = await getWelcome(id);

    let groupMetadata;
    try {
        groupMetadata = await sock.groupMetadata(id);
    } catch { return; }

    const groupName   = groupMetadata.subject || 'Groupe';
    const groupDesc   = groupMetadata.desc    || '';
    const memberCount = groupMetadata.participants.length;

    for (const participant of participants) {
        try {
            const jid = participantJid(participant);

            // Vrai numéro WhatsApp du nouveau membre
            const senderNum = jid.split('@')[0];

            // Message configuré par l'admin (variables supportées : {user}, {group}, {description})
            const defaultMessage = 'Bienvenue {user} dans *{group}* ! 🎉';
            let adminMsg = customMessage && customMessage.trim() !== defaultMessage
                ? customMessage
                    .replace(/{user}/gi,        `@${senderNum}`)
                    .replace(/{group}/gi,        groupName)
                    .replace(/{description}/gi,  groupDesc)
                : null;

            const now     = new Date();
            const timeStr = now.toLocaleString('fr-FR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });

            const welcomeMsg =
                `╭─〔 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩𝟮 〕─╮\n` +
                `│ 👋 Welcome @${senderNum}\n` +
                `│\n` +
                `│ You are the *${ordinal(memberCount)}* member to join\n` +
                `│ *${groupName}*\n` +
                `│\n` +
                `│ 📜 *Rules:*\n` +
                `│ • Be respectful\n` +
                `│ • No spam\n` +
                `│ • Follow admin instructions\n` +
                (adminMsg ? `│\n│ 💬 ${adminMsg}\n` : '') +
                `╰──────────────────╯\n` +
                `> POWERED BY VARNOX\n` +
                `> ${timeStr}`;

            await sendMemberEvent(sock, id, jid, welcomeMsg);

        } catch (err) {
            console.error('[welcome] Erreur :', err.message);
            try {
                const jid = participantJid(participant);
                const num = jid.split('@')[0];
                await sock.sendMessage(id, {
                    text:     `🎉 Bienvenue @${num} dans *${groupMetadata?.subject || 'ce groupe'}* ! 👋`,
                    mentions: [jid],
                    ...channelInfo()
                });
            } catch { /* rien */ }
        }
    }
}

module.exports = { welcomeCommand, handleJoinEvent };
