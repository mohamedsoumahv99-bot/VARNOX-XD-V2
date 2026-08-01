'use strict';

// Newsletter VARNOX XD V2
const NEWSLETTER_JID  = '120363424782348922@newsletter';
const NEWSLETTER_NAME = '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2';
const CHANNEL_LINK    = 'https://whatsapp.com/channel/0029Vb7jG2KEawdwHsZiEm1E';

const newsletterForward = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: NEWSLETTER_JID,
            newsletterName: NEWSLETTER_NAME,
            serverMessageId: -1
        }
    }
};

async function tagAllCommand(sock, chatId, senderId, message) {
    try {
        if (!chatId.endsWith('@g.us')) {
            await sock.sendMessage(
                chatId,
                { text: '❌ Cette commande ne fonctionne que dans les groupes.', ...newsletterForward },
                { quoted: message }
            );
            return;
        }

        const groupMetadata = await sock.groupMetadata(chatId);
        const participants  = groupMetadata.participants;

        if (!participants || participants.length === 0) {
            await sock.sendMessage(
                chatId,
                { text: '❌ Aucun participant trouvé.', ...newsletterForward },
                { quoted: message }
            );
            return;
        }

        const groupName  = groupMetadata.subject || 'Groupe';
        const count      = participants.length;
        const senderNum  = senderId.split('@')[0];
        const mentions   = participants.map(p => p.id);

        const memberList = participants
            .map((p, i) => `┃  ${i + 1 < 10 ? '0' : ''}${i + 1}. @${p.id.split('@')[0]}`)
            .join('\n');

        const tagMessage =
            `╭━━━━━━⌜ 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2 ⌟━━━━━━╮\n` +
            `┃\n` +
            `┃  📢 *𝗔𝗡𝗡𝗢𝗡𝗖𝗘 𝗢𝗙𝗙𝗜𝗖𝗜𝗘𝗟𝗟𝗘*\n` +
            `┃  ─────────────────────────\n` +
            `┃  👤 Envoyé par : @${senderNum}\n` +
            `┃  🏷️ Groupe     : *${groupName}*\n` +
            `┃  👥 Membres    : *${count} tagués*\n` +
            `┃\n` +
            `┃  ─────────────────────────\n` +
            `${memberList}\n` +
            `┃  ─────────────────────────\n` +
            `┃\n` +
            `┃  🔔 *ATTENTION TOUT LE MONDE !*\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
            `> ©2026 ᴠᴀʀɴᴏx xᴅ ᴠ2 ᴅᴇᴠ ʙʏ ᴠᴀʀɴᴏx ᴛᴇᴄʜ`;

        // ── 1. Message principal avec tag de tous les membres ───────────
        await sock.sendMessage(chatId, {
            text:     tagMessage,
            mentions: mentions,
            ...newsletterForward
        }, { quoted: message });

        // ── 2. Forward de la chaîne VARNOX XD V2 ────────────────────────
        await sock.sendMessage(chatId, {
            text:
                `╭━━━━━━⌜ 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2 ⌟━━━━━━╮\n` +
                `┃\n` +
                `┃  📡 *𝗥𝗘𝗝𝗢𝗜𝗡𝗗𝗥𝗘 𝗟𝗔 𝗖𝗛𝗔Î𝗡𝗘 𝗢𝗙𝗙𝗜𝗖𝗜𝗘𝗟𝗟𝗘*\n` +
                `┃\n` +
                `┃  🔗 ${CHANNEL_LINK}\n` +
                `┃\n` +
                `┃  ✅ Restez informés des mises à\n` +
                `┃     jour, nouvelles fonctionnalités\n` +
                `┃     et annonces officielles.\n` +
                `┃\n` +
                `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━╯`,
            ...newsletterForward
        });

    } catch (err) {
        console.error('[tagall] error:', err.message);
        await sock.sendMessage(
            chatId,
            { text: '❌ Impossible de tagger tous les membres.' },
            { quoted: message }
        );
    }
}

module.exports = tagAllCommand;
