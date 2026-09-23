'use strict';

const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const STORE_FILE = path.join(__dirname, '../data/sticker-commands.json');

function ensureStore() {
    const dir = path.dirname(STORE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(STORE_FILE)) fs.writeFileSync(STORE_FILE, '{}');
}

function readStore() {
    ensureStore();
    try {
        const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
        return data && typeof data === 'object' ? data : {};
    } catch {
        return {};
    }
}

function writeStore(data) {
    ensureStore();
    const temp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, STORE_FILE);
}

function unwrapQuotedMessage(value) {
    if (!value || typeof value !== 'object') return value;
    if (value.ephemeralMessage?.message) return unwrapQuotedMessage(value.ephemeralMessage.message);
    if (value.viewOnceMessage?.message) return unwrapQuotedMessage(value.viewOnceMessage.message);
    if (value.viewOnceMessageV2?.message) return unwrapQuotedMessage(value.viewOnceMessageV2.message);
    if (value.documentWithCaptionMessage?.message) return unwrapQuotedMessage(value.documentWithCaptionMessage.message);
    return value;
}

function getQuotedMessage(message) {
    const source = message?.message || {};
    const context = source.extendedTextMessage?.contextInfo ||
        source.imageMessage?.contextInfo ||
        source.videoMessage?.contextInfo ||
        source.documentMessage?.contextInfo || {};
    return unwrapQuotedMessage(context.quotedMessage || null);
}

function commandName(value) {
    return String(value || '')
        .trim()
        .replace(/^[.!#@]/, '')
        .toLowerCase();
}

async function readStickerBuffer(stickerMessage) {
    if (!stickerMessage || typeof stickerMessage !== 'object') {
        throw new Error('Sticker introuvable.');
    }
    const stream = await downloadContentFromMessage(stickerMessage, 'sticker');
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

async function setCmdCommand(sock, chatId, message, args) {
    const name = commandName(Array.isArray(args) ? args[0] : args);
    if (!/^[a-z0-9_-]{2,32}$/.test(name)) {
        await sock.sendMessage(chatId, {
            text: '❌ Utilise `.setcmd nomcommande` en répondant à un sticker.'
        }, { quoted: message });
        return;
    }

    const quoted = getQuotedMessage(message);
    const sticker = quoted?.stickerMessage;
    if (!sticker) {
        await sock.sendMessage(chatId, {
            text: '❌ Réponds à un sticker avec `.setcmd nomcommande`.'
        }, { quoted: message });
        return;
    }

    const buffer = await readStickerBuffer(sticker);
    if (!buffer.length || buffer.length > 2 * 1024 * 1024) {
        throw new Error('Le sticker est vide ou trop volumineux.');
    }

    const store = readStore();
    store[name] = {
        type: 'sticker',
        data: buffer.toString('base64'),
        mimetype: sticker.mimetype || 'image/webp',
        updatedAt: new Date().toISOString(),
        createdBy: message.key.participant || message.key.remoteJid
    };
    writeStore(store);

    await sock.sendMessage(chatId, {
        text: `✅ Commande créée : *.${name}*\nRéponds avec ce nom pour envoyer le sticker.`
    }, { quoted: message });
}

async function dispatchCustomCommand(sock, chatId, message, command) {
    const name = commandName(command);
    if (!name || name === 'setcmd') return false;
    const entry = readStore()[name];
    if (!entry || entry.type !== 'sticker' || !entry.data) return false;

    await sock.sendMessage(chatId, {
        sticker: Buffer.from(entry.data, 'base64'),
        mimetype: entry.mimetype || 'image/webp'
    }, { quoted: message });
    return true;
}

module.exports = {
    setCmdCommand,
    dispatchCustomCommand
};