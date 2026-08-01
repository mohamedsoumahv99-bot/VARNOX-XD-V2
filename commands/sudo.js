'use strict';

const settings = require('../settings');
const { addSudo, removeSudo, getSudoList } = require('../lib/index');
const isOwnerOrSudo = require('../lib/isOwner');
const { channelInfo } = require('../lib/messageConfig');

function extractMentionedJid(message) {
    const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentioned.length > 0) return mentioned[0];
    // Quoted participant
    const quoted = message.message?.extendedTextMessage?.contextInfo?.participant;
    if (quoted) return quoted;
    const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    const match = text.match(/\b(\d{7,15})\b/);
    if (match) return match[1] + '@s.whatsapp.net';
    return null;
}

async function sudoCommand(sock, chatId, message) {
    const senderJid = message.key.participant || message.key.remoteJid;
    const isOwner = message.key.fromMe || await isOwnerOrSudo(senderJid, sock, chatId);

    const rawText = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    const args = rawText.trim().split(/\s+/).slice(1);
    const sub = (args[0] || '').toLowerCase();

    // ── Usage menu ──────────────────────────────────────────────────────────
    if (!sub || !['add', 'del', 'remove', 'list'].includes(sub)) {
        return sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗦𝗨𝗗𝗢⌟\n` +
                `┃⌬┃ 👑 *Gestion des utilisateurs premium*\n` +
                `┃⌬┃\n` +
                `┃⌬┃ ➕ *.sudo add @user* — Ajouter un premium\n` +
                `┃⌬┃ ➖ *.sudo del @user* — Retirer un premium\n` +
                `┃⌬┃ 📋 *.sudo list* — Voir la liste\n` +
                `╰━━━━━━━━━━━━━━━━❍\n` +
                `\n> ©2026 ʋαɾɳσx xᴅ ʋ2`,
            ...channelInfo
        }, { quoted: message });
    }

    // ── List ────────────────────────────────────────────────────────────────
    if (sub === 'list') {
        const list = await getSudoList();
        if (list.length === 0) {
            return sock.sendMessage(chatId, {
                text:
                    `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗦𝗨𝗗𝗢⌟\n` +
                    `┃⌬┃ 📋 *Liste Premium*\n` +
                    `┃⌬┃\n` +
                    `┃⌬┃ ❌ Aucun utilisateur premium\n` +
                    `╰━━━━━━━━━━━━━━━━❍`,
                ...channelInfo
            }, { quoted: message });
        }
        const mentions = list.filter(j => j.endsWith('@s.whatsapp.net'));
        const entries = list.map((j, i) => {
            const num = j.split('@')[0];
            return `┃⌬┃ ${i + 1}. ⭐ @${num}`;
        }).join('\n');
        return sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗦𝗨𝗗𝗢⌟\n` +
                `┃⌬┃ 📋 *Utilisateurs Premium (${list.length})*\n` +
                `┃⌬┃\n` +
                `${entries}\n` +
                `╰━━━━━━━━━━━━━━━━❍\n` +
                `\n> ©2026 ʋαɾɳσx xᴅ ʋ2`,
            mentions,
            ...channelInfo
        }, { quoted: message });
    }

    // ── Add / Remove : owner only ───────────────────────────────────────────
    if (!isOwner) {
        return sock.sendMessage(chatId, {
            text: '❌ Seul le propriétaire peut ajouter/retirer des utilisateurs premium.',
            ...channelInfo
        }, { quoted: message });
    }

    const targetJid = extractMentionedJid(message);
    if (!targetJid) {
        return sock.sendMessage(chatId, {
            text: '⚠️ Mentionne un utilisateur ou donne son numéro.',
            ...channelInfo
        }, { quoted: message });
    }

    const targetNum = targetJid.split('@')[0];

    if (sub === 'add') {
        const ok = await addSudo(targetJid);
        if (!ok) {
            return sock.sendMessage(chatId, {
                text: '❌ Impossible d\'ajouter cet utilisateur.',
                ...channelInfo
            }, { quoted: message });
        }
        return sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗣𝗥𝗘𝗠𝗜𝗨𝗠⌟\n` +
                `┃⌬┃ ⭐ *Nouveau Utilisateur Premium*\n` +
                `┃⌬┃\n` +
                `┃⌬┃ 👤 @${targetNum}\n` +
                `┃⌬┃\n` +
                `┃⌬┃ ✅ Cet utilisateur est ajouté en tant\n` +
                `┃⌬┃    qu'utilisateur premium.\n` +
                `┃⌬┃ Il peut désormais utiliser toutes les\n` +
                `┃⌬┃ commandes avancées du bot 🚀\n` +
                `╰━━━━━━━━━━━━━━━━❍\n` +
                `\n> ©2026 ʋαɾɳσx xᴅ ʋ2`,
            mentions: [targetJid],
            ...channelInfo
        }, { quoted: message });
    }

    if (sub === 'del' || sub === 'remove') {
        const ownerJid = settings.ownerNumber + '@s.whatsapp.net';
        if (targetJid === ownerJid) {
            return sock.sendMessage(chatId, {
                text: '⚠️ Impossible de retirer le propriétaire.',
                ...channelInfo
            }, { quoted: message });
        }
        const ok = await removeSudo(targetJid);
        if (!ok) {
            return sock.sendMessage(chatId, {
                text: '❌ Impossible de retirer cet utilisateur.',
                ...channelInfo
            }, { quoted: message });
        }
        return sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗣𝗥𝗘𝗠𝗜𝗨𝗠⌟\n` +
                `┃⌬┃ ❌ *Utilisateur Premium Retiré*\n` +
                `┃⌬┃\n` +
                `┃⌬┃ 👤 @${targetNum}\n` +
                `┃⌬┃\n` +
                `┃⌬┃ Cet utilisateur n'est plus premium.\n` +
                `╰━━━━━━━━━━━━━━━━❍`,
            mentions: [targetJid],
            ...channelInfo
        }, { quoted: message });
    }
}

module.exports = sudoCommand;
