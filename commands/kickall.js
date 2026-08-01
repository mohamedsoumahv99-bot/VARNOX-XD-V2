'use strict';

const isOwnerOrSudo = require('../lib/isOwner');
const { channelInfo } = require('../lib/messageConfig');

/**
 * .kickall
 * Expulse tous les membres non-admins du groupe d'un seul coup.
 */
async function kickAllCommand(sock, chatId, senderId, message) {
    if (!chatId.endsWith('@g.us')) {
        return sock.sendMessage(chatId, {
            text: '❌ Cette commande ne fonctionne que dans les groupes.',
            ...channelInfo
        }, { quoted: message });
    }

    try {
        const meta    = await sock.groupMetadata(chatId);
        const botRaw  = (sock.user?.id || '').split(':')[0].split('@')[0];

        // Construire la liste des membres à expulser (non-admin, non-bot)
        const toKick = meta.participants.filter(p => {
            const pNum    = (p.id  || '').split(':')[0].split('@')[0];
            const pLidNum = (p.lid || '').split(':')[0].split('@')[0];
            const isAdm   = p.admin === 'admin' || p.admin === 'superadmin';
            const isBot   = pNum === botRaw || pLidNum === botRaw;
            return !isAdm && !isBot;
        });

        if (toKick.length === 0) {
            return sock.sendMessage(chatId, {
                text:
                    `╭━━━━⌜𝗞𝗜𝗖𝗞𝗔𝗟𝗟⌟\n` +
                    `┃⌬┃ ℹ️ Aucun membre à expulser.\n` +
                    `┃⌬┃ Tous les membres sont admins.\n` +
                    `╰━━━━━━━━━━━━━━━━❍`,
                ...channelInfo
            }, { quoted: message });
        }

        // Annonce du lancement
        await sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗞𝗜𝗖𝗞𝗔𝗟𝗟⌟\n` +
                `┃⌬┃ 🚫 *Expulsion en masse…*\n` +
                `┃⌬┃\n` +
                `┃⌬┃ 👥 *${toKick.length}* membre(s) ciblé(s).\n` +
                `┃⌬┃ Veuillez patienter... ⏳\n` +
                `╰━━━━━━━━━━━━━━━━❍`,
            ...channelInfo
        }, { quoted: message });

        let kicked = 0;
        let failed = 0;

        for (const p of toKick) {
            try {
                await sock.groupParticipantsUpdate(chatId, [p.id], 'remove');
                kicked++;
                await new Promise(r => setTimeout(r, 600));
            } catch {
                failed++;
            }
        }

        await sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗞𝗜𝗖𝗞𝗔𝗟𝗟⌟\n` +
                `┃⌬┃ ✅ *Expulsion terminée !*\n` +
                `┃⌬┃\n` +
                `┃⌬┃ 🚫 Expulsés   : *${kicked}*\n` +
                `┃⌬┃ ❌ Échecs     : *${failed}*\n` +
                `╰━━━━━━━━━━━━━━━━❍\n` +
                `\n> ©2026 ʋαɾɳσx xᴅ ʋ2`,
            ...channelInfo
        });

    } catch (err) {
        console.error('[kickall] error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ Erreur lors de l\'expulsion en masse.',
            ...channelInfo
        }, { quoted: message });
    }
}

module.exports = { kickAllCommand };
