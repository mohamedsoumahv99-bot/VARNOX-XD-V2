'use strict';
const fs = require('fs');
const { channelInfo } = require('../lib/messageConfig');

const DATA_FILE      = './data/antidm.json';
const WHITELIST_FILE = './data/antidm_whitelist.json';

function readState() {
    try {
        if (!fs.existsSync(DATA_FILE)) return { enabled: false };
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || { enabled: false };
    } catch { return { enabled: false }; }
}

function writeState(state) {
    try {
        if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
    } catch {}
}

function readWhitelist() {
    try {
        if (!fs.existsSync(WHITELIST_FILE)) return [];
        return JSON.parse(fs.readFileSync(WHITELIST_FILE, 'utf8')) || [];
    } catch { return []; }
}

function addToWhitelist(number) {
    try {
        const list = readWhitelist();
        const clean = number.split('@')[0].split(':')[0];
        if (!list.includes(clean)) {
            list.push(clean);
            if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
            fs.writeFileSync(WHITELIST_FILE, JSON.stringify(list, null, 2));
        }
    } catch {}
}

function isWhitelisted(jid) {
    const list = readWhitelist();
    const num  = (jid || '').split('@')[0].split(':')[0];
    return list.includes(num);
}

async function antiDmCommand(sock, chatId, senderId, message, args) {
    const sub   = (args || '').trim().toLowerCase();
    const state = readState();

    if (sub === 'on') {
        state.enabled = true;
        writeState(state);
        return sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
                `┃⌬╭━━━━━━━━━━━━━≽\n` +
                `┃⌬┃ 🚫 *ANTIDM*\n` +
                `╰━━━━━━━━━━━━❍\n` +
                `    📢𝗔𝗡𝗡𝗢𝗡𝗖𝗘 ❍𝗙𝗙𝗜𝗖𝗜𝗔𝗟\n` +
                `┃⌬┃ ✅ Activé ! Tout inconnu\n` +
                `┃⌬┃ qui écrit en PV sera\n` +
                `┃⌬┃ bloqué automatiquement.\n` +
                `╰━━━━━━━━━━━━❍\n` +
                `\n> ©2026 ʋαɾɳσx xᴅ ʋ2 ᴅҽʋҽʅσρҽԃ Ⴆყ ʋαɾɳσx ᴛᴇᴄʜ`,
            ...channelInfo
        }, { quoted: message });

    } else if (sub === 'off') {
        state.enabled = false;
        writeState(state);
        return sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
                `┃⌬┃ 🚫 *ANTIDM*\n` +
                `┃⌬┃ ❌ Désactivé.\n` +
                `╰━━━━━━━━━━━━❍\n` +
                `\n> ©2026 ʋαɾɳσx xᴅ ʋ2 ᴅҽʋҽʅσρҽԃ Ⴆყ ʋαɾɳσx ᴛᴇᴄʜ`,
            ...channelInfo
        }, { quoted: message });

    } else if (sub === 'whitelist') {
        const mentions = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const replied  = message.message?.extendedTextMessage?.contextInfo?.participant;
        const toAdd    = mentions.length > 0 ? mentions : (replied ? [replied] : []);
        if (toAdd.length === 0) {
            return sock.sendMessage(chatId, {
                text:
                    `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
                    `┃⌬┃ ❌ Mentionne ou réponds\n` +
                    `┃⌬┃ à un contact à ajouter.\n` +
                    `╰━━━━━━━━━━━━❍`,
                ...channelInfo
            }, { quoted: message });
        }
        for (const jid of toAdd) addToWhitelist(jid);
        return sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
                `┃⌬┃ ✅ Contact(s) ajouté(s)\n` +
                `┃⌬┃ à la whitelist antidm.\n` +
                `╰━━━━━━━━━━━━❍`,
            ...channelInfo
        }, { quoted: message });

    } else {
        const enabled = state.enabled;
        return sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
                `┃⌬╭━━━━━━━━━━━━━≽\n` +
                `┃⌬┃ 🚫 *ANTIDM*\n` +
                `╰━━━━━━━━━━━━❍\n` +
                `┃⌬┃ Statut : *${enabled ? '✅ Activé' : '❌ Désactivé'}*\n` +
                `┃⌬┃\n` +
                `┃⌬┃ Usage :\n` +
                `┃⌬┃ .antidm on        — activer\n` +
                `┃⌬┃ .antidm off       — désactiver\n` +
                `┃⌬┃ .antidm whitelist — ajouter contact\n` +
                `╰━━━━━━━━━━━━❍\n` +
                `\n> ©2026 ʋαɾɳσx xᴅ ʋ2 ᴅҽʋҽʅσρҽԃ Ⴆყ ʋαɾɳσx ᴛᴇᴄʜ`,
            ...channelInfo
        }, { quoted: message });
    }
}

/**
 * Appelé pour chaque message privé reçu.
 * Si antidm est actif et que l'expéditeur n'est pas en whitelist → bloquer.
 */
async function handleAntiDm(sock, chatId, message, senderId, ownerNumber) {
    const state = readState();
    if (!state.enabled) return;

    // Uniquement les DM (pas les groupes)
    if (chatId.endsWith('@g.us') || chatId.endsWith('@broadcast')) return;
    if (message.key.fromMe) return;

    const ownerJid = (ownerNumber || '') + '@s.whatsapp.net';
    if (senderId === ownerJid || chatId === ownerJid) return;

    // Whitelist check
    if (isWhitelisted(senderId)) return;

    try {
        await sock.sendMessage(chatId, {
            text:
                `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
                `┃⌬┃ 🚫 *ANTIDM ACTIF*\n` +
                `┃⌬┃ Les DM sont désactivés.\n` +
                `┃⌬┃ Vous allez être bloqué.\n` +
                `╰━━━━━━━━━━━━❍\n` +
                `\n> ©2026 ʋαɾɳσx xᴅ ʋ2 ᴅҽʋҽʅσρҽԃ Ⴆყ ʋαɾɳσx ᴛᴇᴄʜ`,
            ...channelInfo
        });
        await new Promise(r => setTimeout(r, 1200));
        await sock.updateBlockStatus(chatId, 'block');
    } catch (err) {
        console.error('[antidm] error:', err.message);
    }
}

module.exports = { antiDmCommand, handleAntiDm, addToWhitelist, readState };
