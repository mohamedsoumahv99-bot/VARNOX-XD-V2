'use strict';

const { bots }                                      = require('../lib/antilink');
const { setAntilink, getAntilink, removeAntilink }  = require('../lib/index');
const isAdmin                                       = require('../lib/isAdmin');

// ─── Commande .antilink ───────────────────────────────────────────────────────
async function handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message) {
    try {
        if (!isSenderAdmin) {
            await sock.sendMessage(chatId, { text: '```For Group Admins Only!```' }, { quoted: message });
            return;
        }

        const prefix = '.';
        const args   = userMessage.slice(9).toLowerCase().trim().split(' ');
        const action = args[0];

        if (!action) {
            const usage =
                `\`\`\`ANTILINK SETUP\n\n` +
                `${prefix}antilink on\n` +
                `${prefix}antilink set delete | kick | warn\n` +
                `${prefix}antilink off\`\`\``;
            await sock.sendMessage(chatId, { text: usage }, { quoted: message });
            return;
        }

        switch (action) {
            case 'on': {
                const existingConfig = await getAntilink(chatId, 'on');
                // FIX: la DB stocke `.enabled`, pas `.activé`
                if (existingConfig?.enabled) {
                    await sock.sendMessage(chatId, { text: '*_Antilink is already on_*' }, { quoted: message });
                    return;
                }
                const result = await setAntilink(chatId, 'on', 'delete');
                await sock.sendMessage(chatId, {
                    text: result ? '*_Antilink has been turned ON_*' : '*_Failed to turn on Antilink_*'
                }, { quoted: message });
                break;
            }

            case 'off':
                await removeAntilink(chatId, 'on');
                await sock.sendMessage(chatId, { text: '*_Antilink has been turned OFF_*' }, { quoted: message });
                break;

            case 'set': {
                if (args.length < 2) {
                    await sock.sendMessage(chatId, {
                        text: `*_Please specify an action: ${prefix}antilink set delete | kick | warn_*`
                    }, { quoted: message });
                    return;
                }
                const setAction = args[1];
                if (!['delete', 'kick', 'warn'].includes(setAction)) {
                    await sock.sendMessage(chatId, {
                        text: '*_Invalid action. Choose delete, kick, or warn._*'
                    }, { quoted: message });
                    return;
                }
                const setResult = await setAntilink(chatId, 'on', setAction);
                await sock.sendMessage(chatId, {
                    text: setResult ? `*_Antilink action set to ${setAction}_*` : '*_Failed to set Antilink action_*'
                }, { quoted: message });
                break;
            }

            case 'get': {
                const status = await getAntilink(chatId, 'on');
                await sock.sendMessage(chatId, {
                    text:
                        `*_Antilink Configuration:_*\n` +
                        `Status: ${status?.enabled ? 'ON ✅' : 'OFF ❌'}\n` +
                        `Action: ${status?.action || 'Non défini'}`
                }, { quoted: message });
                break;
            }

            default:
                await sock.sendMessage(chatId, {
                    text: `*_Use ${prefix}antilink for usage._*`
                }, { quoted: message });
        }
    } catch (error) {
        console.error('[antilink] Erreur commande:', error.message);
        await sock.sendMessage(chatId, { text: '*_Error processing antilink command_*' }, { quoted: message });
    }
}

// ─── Détection de liens (fonction legacy, la détection principale est dans lib/antilink.js) ──
async function handleLinkDetection(sock, chatId, message, userMessage, senderId) {
    // La détection réelle est gérée par lib/antilink.js (Antilink) appelé dans main.js
    // Cette fonction est conservée pour compatibilité
}

module.exports = { handleAntilinkCommand, handleLinkDetection };
