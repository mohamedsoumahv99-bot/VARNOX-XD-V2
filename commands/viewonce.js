'use strict';
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const settings = require('../settings');
const { channelInfo } = require('../lib/messageConfig');

/**
 * vvCommand — ouvre un média vue-unique
 * @param {boolean} sendToPv
 *   false (défaut) → envoie au PV du propriétaire  (.vv)
 *   true           → envoie au PV de l'expéditeur   (.vv2)
 */
async function vvCommand(sock, chatId, message, sendToPv = false) {
    const ownerJid  = settings.ownerNumber + '@s.whatsapp.net';
    const senderJid = message.key.participant || message.key.remoteJid;
    const targetJid = sendToPv ? senderJid : ownerJid;

    // Chercher le message cité (vue-unique ou normal)
    const ctx    = message.message?.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;

    const quotedImage =
        quoted?.imageMessage ||
        quoted?.viewOnceMessage?.message?.imageMessage ||
        quoted?.viewOnceMessageV2?.message?.imageMessage ||
        quoted?.viewOnceMessageV2Extension?.message?.imageMessage;

    const quotedVideo =
        quoted?.videoMessage ||
        quoted?.viewOnceMessage?.message?.videoMessage ||
        quoted?.viewOnceMessageV2?.message?.videoMessage ||
        quoted?.viewOnceMessageV2Extension?.message?.videoMessage;

    if (!quotedImage && !quotedVideo) {
        await sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
                `┃⌬╭━━━━━━━━━━━━━≽\n` +
                `┃⌬┃ ❌ Réponds à un média\n` +
                `┃⌬┃ vue-unique (image/vidéo).\n` +
                `╰━━━━━━━━━━━━❍\n` +
                `\n> ©2026 ʋαɾɳσx xᴅ ʋ2 ᴅҽʋҽʅσρҽԃ Ⴆყ ʋαɾɳσx ᴛᴇᴄʜ`,
            ...channelInfo
        }, { quoted: message });
        return;
    }

    try {
        const senderNum = (senderJid || '').split('@')[0];
        const location  = chatId.endsWith('@g.us') ? chatId : 'Privé';

        const caption =
            `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
            `┃⌬╭━━━━━━━━━━━━━≽\n` +
            `┃⌬┃ 📩 *Vue unique reçue*\n` +
            `╰━━━━━━━━━━━━❍\n` +
            `┃⌬┃ 👤 De : @${senderNum}\n` +
            `┃⌬┃ 💬 Groupe : ${location}\n` +
            `╰━━━━━━━━━━━━❍\n` +
            `\n> ©2026 ʋαɾɳσx xᴅ ʋ2 ᴅҽʋҽʅσρҽԃ Ⴆყ ʋαɾɳσx ᴛᴇᴄʜ`;

        if (quotedImage) {
            const stream = await downloadContentFromMessage(quotedImage, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await sock.sendMessage(targetJid, { image: buffer, caption, ...channelInfo });
        } else {
            const stream = await downloadContentFromMessage(quotedVideo, 'video');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
            await sock.sendMessage(targetJid, { video: buffer, caption, ...channelInfo });
        }

        // Confirmer dans le chat si vv2 (envoi en PV de l'expéditeur)
        if (sendToPv && targetJid !== chatId) {
            await sock.sendMessage(chatId, {
                text:
                    `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
                    `┃⌬┃ ✅ Média envoyé en PV !\n` +
                    `┃⌬┃ Consulte tes messages privés.\n` +
                    `╰━━━━━━━━━━━━❍`,
                ...channelInfo
            }, { quoted: message });
        }

    } catch (error) {
        console.error('[vv/vv2] error:', error.message);
        await sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
                `┃⌬┃ ❌ Impossible de récupérer\n` +
                `┃⌬┃ le média.\n` +
                `╰━━━━━━━━━━━━❍`,
            ...channelInfo
        }, { quoted: message });
    }
}

module.exports = vvCommand;
