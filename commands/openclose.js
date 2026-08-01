'use strict';

const { channelInfo } = require('../lib/messageConfig');

async function openGroupCommand(sock, chatId, message) {
    if (!chatId.endsWith('@g.us')) {
        return sock.sendMessage(chatId, {
            text: '❌ Cette commande ne fonctionne que dans les groupes.',
            ...channelInfo
        }, { quoted: message });
    }

    try {
        await sock.groupSettingUpdate(chatId, 'not_announcement');
        const meta = await sock.groupMetadata(chatId);
        await sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗚𝗥𝗢𝗨𝗣𝗘 𝗢𝗨𝗩𝗘𝗥𝗧⌟\n` +
                `┃⌬┃ 🔓 *${meta.subject || 'Groupe'}*\n` +
                `┃⌬┃\n` +
                `┃⌬┃ ✅ Le groupe est maintenant *ouvert*.\n` +
                `┃⌬┃ Tous les membres peuvent écrire. 💬\n` +
                `╰━━━━━━━━━━━━━━━━❍\n` +
                `\n> ©2026 ʋαɾɳσx xᴅ ʋ2`,
            ...channelInfo
        }, { quoted: message });
    } catch (err) {
        console.error('[open] error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ Impossible d\'ouvrir le groupe.',
            ...channelInfo
        }, { quoted: message });
    }
}

async function closeGroupCommand(sock, chatId, message) {
    if (!chatId.endsWith('@g.us')) {
        return sock.sendMessage(chatId, {
            text: '❌ Cette commande ne fonctionne que dans les groupes.',
            ...channelInfo
        }, { quoted: message });
    }

    try {
        await sock.groupSettingUpdate(chatId, 'announcement');
        const meta = await sock.groupMetadata(chatId);
        await sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗚𝗥𝗢𝗨𝗣𝗘 𝗙𝗘𝗥𝗠𝗘⌟\n` +
                `┃⌬┃ 🔒 *${meta.subject || 'Groupe'}*\n` +
                `┃⌬┃\n` +
                `┃⌬┃ ✅ Le groupe est maintenant *fermé*.\n` +
                `┃⌬┃ Seuls les admins peuvent écrire. 🔐\n` +
                `╰━━━━━━━━━━━━━━━━❍\n` +
                `\n> ©2026 ʋαɾɳσx xᴅ ʋ2`,
            ...channelInfo
        }, { quoted: message });
    } catch (err) {
        console.error('[close] error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ Impossible de fermer le groupe.',
            ...channelInfo
        }, { quoted: message });
    }
}

module.exports = { openGroupCommand, closeGroupCommand };
