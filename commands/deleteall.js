'use strict';

const isOwnerOrSudo = require('../lib/isOwner');
const { channelInfo } = require('../lib/messageConfig');

/**
 * .deleteall
 * Supprime tous les messages récents du groupe (accessibles par le bot).
 */
async function deleteAllCommand(sock, chatId, senderId, message) {
    // Utiliser le store de l'instance courante (défini par botInstance.js)
    const store = sock.store || { messages: {} };
    // Groupe uniquement
    if (!chatId.endsWith('@g.us')) {
        return sock.sendMessage(chatId, {
            text: '❌ Cette commande ne fonctionne que dans les groupes.',
            ...channelInfo
        }, { quoted: message });
    }

    // Confirmation et lancement
    await sock.sendMessage(chatId, {
        text:
            `╭━━━━⌜𝗗𝗘𝗟𝗘𝗧𝗘𝗔𝗟𝗟⌟\n` +
            `┃⌬┃ 🗑️ *Suppression en cours...*\n` +
            `┃⌬┃ Suppression de tous les messages\n` +
            `┃⌬┃ récents du groupe. Patientez...\n` +
            `╰━━━━━━━━━━━━━━━━❍`,
        ...channelInfo
    }, { quoted: message });

    let deletedCount = 0;
    let failedCount = 0;

    try {
        const chatMessages = store.messages?.[chatId] || [];

        if (chatMessages.length === 0) {
            return sock.sendMessage(chatId, {
                text:
                    `╭━━━━⌜𝗗𝗘𝗟𝗘𝗧𝗘𝗔𝗟𝗟⌟\n` +
                    `┃⌬┃ ℹ️ Aucun message en cache.\n` +
                    `┃⌬┃ Le bot ne peut supprimer que les\n` +
                    `┃⌬┃ messages qu'il a vus depuis son\n` +
                    `┃⌬┃ dernier démarrage.\n` +
                    `╰━━━━━━━━━━━━━━━━❍`,
                ...channelInfo
            }, { quoted: message });
        }

        // Supprimer chaque message
        for (const msg of chatMessages) {
            try {
                if (!msg || !msg.key) continue;
                await sock.sendMessage(chatId, { delete: msg.key });
                deletedCount++;
                await new Promise(r => setTimeout(r, 300));
            } catch {
                failedCount++;
            }
        }

        // Vider le store pour ce groupe
        if (store.messages) {
            store.messages[chatId] = [];
        }

        await sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗗𝗘𝗟𝗘𝗧𝗘𝗔𝗟𝗟⌟\n` +
                `┃⌬┃ ✅ *Nettoyage terminé*\n` +
                `┃⌬┃\n` +
                `┃⌬┃ 🗑️ Messages supprimés : *${deletedCount}*\n` +
                `┃⌬┃ ❌ Échecs : *${failedCount}*\n` +
                `╰━━━━━━━━━━━━━━━━❍\n` +
                `\n> ©2026 ʋαɾɳσx xᴅ ʋ2`,
            ...channelInfo
        });

    } catch (err) {
        console.error('[deleteall] error:', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ Erreur lors de la suppression des messages.',
            ...channelInfo
        }, { quoted: message });
    }
}

module.exports = { deleteAllCommand };
