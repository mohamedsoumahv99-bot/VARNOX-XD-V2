'use strict';

const isAdmin = require('../lib/isAdmin');
const isOwnerOrSudo = require('../lib/isOwner');
const { channelInfo } = require('../lib/messageConfig');
const store = require('../lib/lightweight_store');

/**
 * .deleteall
 * Supprime tous les messages récents du groupe (accessibles par le bot admin).
 */
async function deleteAllCommand(sock, chatId, senderId, message) {
    // Groupe uniquement
    if (!chatId.endsWith('@g.us')) {
        return sock.sendMessage(chatId, {
            text: '❌ Cette commande ne fonctionne que dans les groupes.',
            ...channelInfo
        }, { quoted: message });
    }

    // Le bot doit être admin
    const { isBotAdmin, isSenderAdmin } = await isAdmin(sock, chatId, senderId);
    const isPremium = message.key.fromMe || await isOwnerOrSudo(senderId, sock, chatId);

    if (!isBotAdmin) {
        return sock.sendMessage(chatId, {
            text: '❌ Le bot doit être admin pour utiliser cette commande.',
            ...channelInfo
        }, { quoted: message });
    }

    if (!isSenderAdmin && !isPremium) {
        return sock.sendMessage(chatId, {
            text: '❌ Seuls les admins du groupe ou les utilisateurs premium peuvent utiliser cette commande.',
            ...channelInfo
        }, { quoted: message });
    }

    // Confirmation et lancement
    const confirmMsg = await sock.sendMessage(chatId, {
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
        // Récupérer les messages du store
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
                // Petit délai pour éviter le rate-limit
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
