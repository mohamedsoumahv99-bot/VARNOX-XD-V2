'use strict';

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const webp = require('node-webpmux');
const settings = require('../settings');

const execFileAsync = promisify(execFile);
const TELEGRAM_URL = 'https://api.telegram.org';
const MAX_STICKERS = 120;

function getTelegramPackName(text) {
    const value = String(text || '').trim();
    const match = value.match(
        /(?:https?:\/\/)?t\.me\/addstickers\/([A-Za-z0-9_]+)|tg:\/\/addstickers\?set=([A-Za-z0-9_]+)/i
    );
    return match ? (match[1] || match[2]) : '';
}

function getCommandText(message) {
    return (
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        message.message?.imageMessage?.caption ||
        ''
    ).trim();
}

async function fetchJson(url, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            headers: { accept: 'application/json' },
            signal: controller.signal
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.ok) {
            throw new Error(body?.description || `HTTP ${response.status}`);
        }
        return body.result;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchBuffer(url, timeoutMs = 60000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            headers: { accept: '*/*' },
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.buffer();
    } finally {
        clearTimeout(timer);
    }
}

async function addStickerMetadata(buffer, emoji) {
    const image = new webp.Image();
    await image.load(buffer);
    const metadata = {
        'sticker-pack-id': `https://github.com/mohamedsoumahv99-bot/VARNOX-XD-V2`,
        'sticker-pack-name': settings.packname || 'VARNOX XD V2',
        'sticker-pack-publisher': settings.author || settings.developer || 'VARNOX',
        emojis: emoji ? [emoji] : ['🤖']
    };
    const exifHeader = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x16, 0x00, 0x00, 0x00
    ]);
    const json = Buffer.from(JSON.stringify(metadata), 'utf8');
    const exif = Buffer.concat([exifHeader, json]);
    exif.writeUIntLE(json.length, 14, 4);
    image.exif = exif;
    return image.save(null);
}

async function convertToWebp(inputBuffer, filePath, animated) {
    const inputPath = path.join(filePath, `source_${crypto.randomUUID()}`);
    const outputPath = path.join(filePath, `sticker_${crypto.randomUUID()}.webp`);
    fs.writeFileSync(inputPath, inputBuffer);

    try {
        const filter = 'scale=512:512:force_original_aspect_ratio=decrease,' +
            'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0';
        const args = animated
            ? ['-y', '-i', inputPath, '-vf', `${filter},fps=15`, '-c:v', 'libwebp',
                '-loop', '0', '-an', '-vsync', '0', outputPath]
            : ['-y', '-i', inputPath, '-vf', filter, '-frames:v', '1',
                '-c:v', 'libwebp', '-lossless', '1', outputPath];
        await execFileAsync('ffmpeg', args, { timeout: 90000 });
        return fs.readFileSync(outputPath);
    } finally {
        for (const file of [inputPath, outputPath]) {
            try { fs.unlinkSync(file); } catch {}
        }
    }
}

async function stickerTelegramCommand(sock, chatId, message) {
    const text = getCommandText(message);
    const packName = getTelegramPackName(text.replace(/^\S+\s*/, ''));
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!packName) {
        await sock.sendMessage(chatId, {
            text: '⚠️ Utilise .tg https://t.me/addstickers/NOM_DU_PACK'
        }, { quoted: message });
        return;
    }
    if (!botToken) {
        await sock.sendMessage(chatId, {
            text: '❌ TELEGRAM_BOT_TOKEN n’est pas configuré. Ajoute le token Telegram du bot dans les Secrets Replit.'
        }, { quoted: message });
        return;
    }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'varnox-tg-'));
    try {
        const api = endpoint => `${TELEGRAM_URL}/bot${botToken}/${endpoint}`;
        const stickerSet = await fetchJson(
            `${api('getStickerSet')}?name=${encodeURIComponent(packName)}`
        );
        const stickers = (stickerSet.stickers || []).slice(0, MAX_STICKERS);
        if (!stickers.length) throw new Error('Le pack Telegram est vide.');

        await sock.sendMessage(chatId, {
            text: `📦 Pack trouvé : ${packName}\n🔄 Conversion de ${stickers.length} sticker(s) avec le pack VARNOX...`
        }, { quoted: message });

        let successCount = 0;
        for (const sticker of stickers) {
            try {
                const file = await fetchJson(
                    `${api('getFile')}?file_id=${encodeURIComponent(sticker.file_id)}`
                );
                if (!file?.file_path) continue;

                const source = await fetchBuffer(
                    `${TELEGRAM_URL}/file/bot${botToken}/${file.file_path}`
                );
                const isAnimated = Boolean(sticker.is_animated || sticker.is_video);

                // .tgs est une animation Lottie gzip, pas un format que ffmpeg
                // peut convertir directement. Les stickers statiques et .webm
                // sont convertis ici; les .tgs sont ignorés proprement.
                if (file.file_path.endsWith('.tgs')) {
                    console.warn(`[stickertelegram] .tgs ignoré: ${file.file_path}`);
                    continue;
                }

                const webpBuffer = await convertToWebp(source, workDir, isAnimated);
                const finalBuffer = await addStickerMetadata(webpBuffer, sticker.emoji);
                await sock.sendMessage(chatId, { sticker: finalBuffer });
                successCount++;
            } catch (error) {
                console.error(`[stickertelegram] sticker ignoré: ${error.message}`);
            }
        }

        await sock.sendMessage(chatId, {
            text: successCount
                ? `✅ Conversion terminée : ${successCount}/${stickers.length} sticker(s).\n📦 Pack : ${settings.packname || 'VARNOX XD V2'}\n✍️ Auteur : ${settings.author || settings.developer || 'VARNOX'}`
                : '❌ Aucun sticker compatible n’a pu être converti.'
        }, { quoted: message });
    } catch (error) {
        console.error('[stickertelegram] erreur:', error);
        await sock.sendMessage(chatId, {
            text: `❌ Impossible de convertir ce pack Telegram : ${error.message}`
        }, { quoted: message });
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

module.exports = stickerTelegramCommand;