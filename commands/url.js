'use strict';

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const { UploadFileUgu, TelegraPh } = require('../lib/uploader');
const { sendInteractiveMessage } = require('../lib/interactiveButtons');

async function getMediaBufferAndExt(message) {
    const m = message.message || {};
    const mediaTypes = [
        ['imageMessage', 'image', '.jpg'],
        ['videoMessage', 'video', '.mp4'],
        ['audioMessage', 'audio', '.mp3'],
        ['documentMessage', 'document', null],
        ['stickerMessage', 'sticker', '.webp']
    ];

    for (const [key, type, defaultExt] of mediaTypes) {
        if (!m[key]) continue;
        const stream = await downloadContentFromMessage(m[key], type);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const fileName = m[key].fileName || '';
        return {
            buffer: Buffer.concat(chunks),
            ext: defaultExt || path.extname(fileName) || '.bin'
        };
    }
    return null;
}

async function getQuotedMediaBufferAndExt(message) {
    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
    return quoted ? getMediaBufferAndExt({ message: quoted }) : null;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function encodeButtonValue(value) {
    return Buffer.from(String(value), 'utf8').toString('base64url');
}

function uploadButtons(url) {
    return [
        {
            name: 'cta_url',
            params: {
                display_text: '↗️ Open Link',
                url,
                merchant_url: url
            }
        },
        {
            name: 'copy_code',
            params: {
                display_text: '📋 Copy Link',
                copy_code: url
            }
        }
    ];
}

async function urlCommand(sock, chatId, message) {
    let tempPath = '';
    try {
        let media = await getMediaBufferAndExt(message);
        if (!media) media = await getQuotedMediaBufferAndExt(message);

        if (!media) {
            await sock.sendMessage(chatId, {
                text: '📎 Envoie ou réponds à une image, vidéo, audio, sticker ou document pour générer son lien.'
            }, { quoted: message });
            return;
        }

        const tempDir = path.join(__dirname, '../temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        tempPath = path.join(tempDir, Date.now() + media.ext);
        fs.writeFileSync(tempPath, media.buffer);

        let url = '';
        try {
            if (['.jpg', '.png', '.webp'].includes(media.ext.toLowerCase())) {
                try {
                    url = await TelegraPh(tempPath);
                } catch {
                    const result = await UploadFileUgu(tempPath);
                    url = typeof result === 'string'
                        ? result
                        : (result.url || result.url_full || '');
                }
            } else {
                const result = await UploadFileUgu(tempPath);
                url = typeof result === 'string'
                    ? result
                    : (result.url || result.url_full || '');
            }
        } finally {
            try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
            tempPath = '';
        }

        url = String(url || '').trim();
        if (!url) throw new Error('Le service d’upload n’a renvoyé aucun lien.');
        try { new URL(url); } catch { throw new Error('Le lien généré est invalide.'); }

        const caption = [
            'Media Uploaded Successfully',
            '✅',
            '',
            'Media Link:',
            url,
            '',
            '💾 Size: ' + formatBytes(media.buffer.length),
            '',
            '│ POWERED BY VARNOX-XD©'
        ].join('\n');

        await sendInteractiveMessage(sock, chatId, {
            body: caption,
            footer: '│ POWERED BY VARNOX-XD©',
            buttons: uploadButtons(url),
            quoted: message
        });
    } catch (error) {
        if (tempPath) {
            try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
        }
        console.error('[URL] error:', error?.message || error);
        await sock.sendMessage(chatId, {
            text: '❌ Impossible de générer le lien du média : ' + (error?.message || 'erreur inconnue')
        }, { quoted: message });
    }
}

module.exports = urlCommand;
