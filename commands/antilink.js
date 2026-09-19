'use strict';

const { bots }                                      = require('../lib/antilink');
const { setAntilink, getAntilink, removeAntilink }  = require('../lib/index');
const isAdmin                                       = require('../lib/isAdmin');
const { channelInfo }                               = require('../lib/messageConfig');

// ─── Commande .antilink ───────────────────────────────────────────────────────
async function handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message) {
    try {
        if (!isSenderAdmin) {
            await sock.sendMessage(chatId, {
                text: '❌ Cette commande est réservée aux administrateurs du groupe.'
            }, { quoted: message });
            return;
        }

        const prefix = '.';
        const args   = userMessage.slice(9).toLowerCase().trim().split(' ');
        const action = args[0];

        if (!action) {
            const usage =
                `╭──⟪𝗩𝗔𝗥𝗡𝗢𝗫 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞⟫──╮\n` +
                `┃⌬┃ Statut : consulte avec .antilink get\n` +
                `┃⌬┃ .antilink on\n` +
                `┃⌬┃ .antilink set delete | kick | warn\n` +
                `┃⌬┃ .antilink off\n` +
                `╰━━━━━━━━━━━━❍`;
            await sock.sendMessage(chatId, { text: usage, ...channelInfo }, { quoted: message });
            return;
        }

        switch (action) {
            case 'on': {
                const existingConfig = await getAntilink(chatId, 'on');
                // FIX: la DB stocke `.enabled`, pas `.activé`
                if (existingConfig?.enabled) {
                    await sock.sendMessage(chatId, { text: '⚠️ VARNOX antilink est déjà activé.', ...channelInfo }, { quoted: message });
                    return;
                }
                const result = await setAntilink(chatId, 'on', 'delete');
                await sock.sendMessage(chatId, {
                    text: result ? '╭──⟪𝗩𝗔𝗥𝗡𝗢𝗫 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞⟫──╮\n┃⌬┃ ✅ Protection activée.\n┃⌬┃ Action actuelle : suppression.\n╰━━━━━━━━━━━━❍' : '❌ Impossible d’activer antilink.',
                    ...channelInfo
                }, { quoted: message });
                break;
            }

            case 'off':
                await removeAntilink(chatId, 'on');
                await sock.sendMessage(chatId, { text: '╭──⟪𝗩𝗔𝗥𝗡𝗢𝗫 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞⟫──╮\n┃⌬┃ 🔕 Protection désactivée.\n╰━━━━━━━━━━━━❍', ...channelInfo }, { quoted: message });
                break;

            case 'set': {
                if (args.length < 2) {
                    await sock.sendMessage(chatId, {
                        text: `❌ Choisis une action : ${prefix}antilink set delete | kick | warn`,
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
                const setAction = args[1];
                if (!['delete', 'kick', 'warn'].includes(setAction)) {
                    await sock.sendMessage(chatId, {
                        text: '❌ Action invalide. Choisis delete, kick ou warn.',
                        ...channelInfo
                    }, { quoted: message });
                    return;
                }
                const setResult = await setAntilink(chatId, 'on', setAction);
                await sock.sendMessage(chatId, {
                    text: setResult ? `✅ VARNOX antilink configuré sur : ${setAction}.` : '❌ Impossible de modifier l’action antilink.',
                    ...channelInfo
                }, { quoted: message });
                break;
            }

            case 'get': {
                const status = await getAntilink(chatId, 'on');
                await sock.sendMessage(chatId, {
                    text:
                        `╭──⟪𝗩𝗔𝗥𝗡𝗢𝗫 𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞⟫──╮\n` +
                        `┃⌬┃ Statut : ${status?.enabled ? '✅ Activé' : '❌ Désactivé'}\n` +
                        `┃⌬┃ Action : ${status?.action || 'delete'}\n` +
                        `╰━━━━━━━━━━━━❍`,
                    ...channelInfo
                }, { quoted: message });
                break;
            }

            default:
                await sock.sendMessage(chatId, {
                    text: `❌ Option invalide. Utilise ${prefix}antilink pour l’aide.`,
                    ...channelInfo
                }, { quoted: message });
        }
    } catch (error) {
        console.error('[antilink] Erreur commande:', error.message);
        await sock.sendMessage(chatId, { text: '❌ Une erreur a empêché VARNOX de traiter antilink.', ...channelInfo }, { quoted: message });
    }
}

// ─── Détection de liens (fonction legacy, la détection principale est dans lib/antilink.js) ──
async function handleLinkDetection(sock, chatId, message, userMessage, senderId) {
    // La détection réelle est gérée par lib/antilink.js (Antilink) appelé dans main.js
    // Cette fonction est conservée pour compatibilité
}

module.exports = { handleAntilinkCommand, handleLinkDetection };
