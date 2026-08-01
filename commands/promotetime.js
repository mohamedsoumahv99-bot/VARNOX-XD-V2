'use strict';

const isAdmin = require('../lib/isAdmin');
const isOwnerOrSudo = require('../lib/isOwner');
const { channelInfo } = require('../lib/messageConfig');

/**
 * .promotetime @user <minutes>
 * Promeut un utilisateur en admin pendant X minutes puis le rétrograde automatiquement.
 * Réservé aux utilisateurs premium (sudo/owner).
 */
async function promoteTimeCommand(sock, chatId, senderId, message) {
    // Groupe uniquement
    if (!chatId.endsWith('@g.us')) {
        return sock.sendMessage(chatId, {
            text: '❌ Cette commande ne fonctionne que dans les groupes.',
            ...channelInfo
        }, { quoted: message });
    }

    // Réservé aux premium / owner
    const isPremium = message.key.fromMe || await isOwnerOrSudo(senderId, sock, chatId);
    if (!isPremium) {
        return sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗣𝗥𝗘𝗠𝗜𝗨𝗠⌟\n` +
                `┃⌬┃ ⭐ Cette commande est réservée\n` +
                `┃⌬┃    aux utilisateurs *premium*.\n` +
                `┃⌬┃ Contactez le propriétaire du bot.\n` +
                `╰━━━━━━━━━━━━━━━━❍`,
            ...channelInfo
        }, { quoted: message });
    }

    // Extraire le JID cible et la durée
    const rawText = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    const parts = rawText.trim().split(/\s+/);
    const durationStr = parts[parts.length - 1];
    const durationMin = parseInt(durationStr, 10);

    const mentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
        || message.message?.extendedTextMessage?.contextInfo?.participant;

    if (!mentionedJid) {
        return sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗣𝗥𝗢𝗠𝗢𝗧𝗘𝗧𝗜𝗠𝗘⌟\n` +
                `┃⌬┃ 📌 Usage : *.promotetime @user <minutes>*\n` +
                `┃⌬┃ Ex : .promotetime @user 30\n` +
                `╰━━━━━━━━━━━━━━━━❍`,
            ...channelInfo
        }, { quoted: message });
    }

    if (isNaN(durationMin) || durationMin <= 0) {
        return sock.sendMessage(chatId, {
            text: '⚠️ Donne une durée valide en minutes. Ex: `.promotetime @user 30`',
            ...channelInfo
        }, { quoted: message });
    }

    const targetNum = mentionedJid.split('@')[0];
    const durationMs = durationMin * 60 * 1000;

    try {
        // Promouvoir
        await sock.groupParticipantsUpdate(chatId, [mentionedJid], 'promote');

        await sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗣𝗥𝗢𝗠𝗢𝗧𝗘𝗧𝗜𝗠𝗘⌟\n` +
                `┃⌬┃ 👑 *Promotion temporaire*\n` +
                `┃⌬┃\n` +
                `┃⌬┃ 👤 @${targetNum}\n` +
                `┃⌬┃ ⏱️ Durée : *${durationMin} minute(s)*\n` +
                `┃⌬┃\n` +
                `┃⌬┃ ✅ Utilisateur promu en admin.\n` +
                `┃⌬┃ ⏳ Rétrogradation automatique dans\n` +
                `┃⌬┃    *${durationMin} min*.\n` +
                `╰━━━━━━━━━━━━━━━━❍\n` +
                `\n> ©2026 ʋαɾɳσx xᴅ ʋ2`,
            mentions: [mentionedJid],
            ...channelInfo
        }, { quoted: message });

        // Rétrograder automatiquement après la durée
        setTimeout(async () => {
            try {
                await sock.groupParticipantsUpdate(chatId, [mentionedJid], 'demote');
                await sock.sendMessage(chatId, {
                    text:
                        `╭━━━━⌜𝗣𝗥𝗢𝗠𝗢𝗧𝗘𝗧𝗜𝗠𝗘⌟\n` +
                        `┃⌬┃ ⏰ *Promotion expirée*\n` +
                        `┃⌬┃\n` +
                        `┃⌬┃ 👤 @${targetNum}\n` +
                        `┃⌬┃ La promotion de ${durationMin} min est terminée.\n` +
                        `┃⌬┃ L'utilisateur a été rétrogradé. ✅\n` +
                        `╰━━━━━━━━━━━━━━━━❍`,
                    mentions: [mentionedJid],
                    ...channelInfo
                });
            } catch (e) {
                console.error('[promotetime] auto-demote error:', e.message);
            }
        }, durationMs);

    } catch (err) {
        console.error('[promotetime] error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ Impossible de promouvoir cet utilisateur.',
            ...channelInfo
        }, { quoted: message });
    }
}

module.exports = { promoteTimeCommand };
