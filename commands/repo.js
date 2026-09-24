'use strict';

const fs = require('fs');
const path = require('path');
const { channelInfo } = require('../lib/messageConfig');
const { sendInteractiveMessage } = require('../lib/interactiveButtons');

const WEBSITE_URL = 'https://varnox-xd-v2.onrender.com';

function repoCaption() {
    return [
        '╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟',
        '┃⌬╭━━━━━━━━━━━━━≽',
        '┃⌬┃ 🤖 *VARNOX XD V2*',
        '╰━━━━━━━━━━━━❍',
        '',
        '✅ *Website disponible*',
        '🔗 Le lien est disponible avec le bouton ci-dessous.',
        '',
        '> ©2026 ʋαɾɳσx xᴅ ʋ2 ᴅҽʋҽʅσρҽԃ Ⴆყ ʋαɾɳσx ᴛᴇᴄʜ'
    ].join('\n');
}

async function repoCommand(sock, chatId, message) {
    try {
        const imagePath = path.join(__dirname, '../assets/bot_image.jpg');
        const image = fs.existsSync(imagePath) ? fs.readFileSync(imagePath) : null;

        await sendInteractiveMessage(sock, chatId, {
            body: repoCaption(),
            footer: '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
            title: '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
            image,
            contextInfo: channelInfo.contextInfo,
            buttons: [
                {
                    name: 'cta_url',
                    params: {
                        display_text: '↗️ Ouvrir le site',
                        url: WEBSITE_URL,
                        merchant_url: WEBSITE_URL
                    }
                }
            ],
            quoted: message
        });
    } catch (error) {
        console.error('[repo] Erreur :', error.message);
        await sock.sendMessage(chatId, {
            text: '❌ Impossible d’afficher le site pour le moment.'
        }, { quoted: message });
    }
}

module.exports = repoCommand;
