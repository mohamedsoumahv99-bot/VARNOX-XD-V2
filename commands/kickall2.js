'use strict';
const {channelInfo} = require('../lib/messageConfig');
async function kickAll2Command(sock, chatId, senderId, message) {
    if (!chatId.endsWith('@g.us')) return sock.sendMessage(chatId, Object.assign({text:'❌ Cette commande fonctionne uniquement dans les groupes.'}, channelInfo), {quoted:message});
    try {
        const meta = await sock.groupMetadata(chatId);
        const botId = (sock.user?.id || '').split(':')[0].split('@')[0];
        const targets = meta.participants.filter(p => {
            const number = (p.id || '').split(':')[0].split('@')[0]; const lid = (p.lid || '').split(':')[0].split('@')[0];
            return p.admin !== 'admin' && p.admin !== 'superadmin' && number !== botId && lid !== botId;
        }).map(p => p.id);
        if (!targets.length) return sock.sendMessage(chatId, Object.assign({text:'ℹ️ Aucun membre non-administrateur à expulser.'}, channelInfo), {quoted:message});
        await sock.sendMessage(chatId, Object.assign({text:'╭───⟪𝗞𝗜𝗖𝗞𝗔𝗟𝗟𝟮⟫───╮\n┃⌬┃ Expulsion en une seule opération de ' + targets.length + ' membre(s)…\n╰━━━━━━━━━━━━❍'}, channelInfo), {quoted:message});
        await sock.groupParticipantsUpdate(chatId, targets, 'remove');
        await sock.sendMessage(chatId, Object.assign({text:'✅ Kickall2 terminé : ' + targets.length + ' membre(s) traité(s).\n\n> 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩𝟮'}, channelInfo));
    } catch (error) {
        console.error('[kickall2] error:', error.message);
        await sock.sendMessage(chatId, Object.assign({text:'❌ Kickall2 a échoué. Vérifie les droits admin et les limites WhatsApp.'}, channelInfo), {quoted:message});
    }
}
module.exports = {kickAll2Command};
