'use strict';

const fs = require('fs');
const path = require('path');
const { channelInfo } = require('../lib/messageConfig');

const WEBSITE_URL = 'https://varnox-xd-v2.onrender.com';

function repoButtons() {
    return {
        templateButtons: [
            {
                index: 1,
                urlButton: {
                    displayText: '↗️ Ouvrir le site',
                    url: WEBSITE_URL
                }
            }
        ]
    };
}

function repoCaption() {
    return [
        '╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟',
        '┃⌬╭━━━━━━━━━━━━━≽',
        '┃⌬┃ 🤖 *VARNOX XD V2*',
        '╰━━━━━━━━━━━━❍',
        '',
        '✅ *Bot WhatsApp connecté et prêt.*',
        '🌐 *Site officiel*',
        'Clique sur le bouton ci-dessous pour ouvrir le site.',
        '',
        '> ©2026 ʋαɾɳσx xᴅ ʋ2 ᴅҽʋҽʅσρҽԃ Ⴆყ ʋαɾɳσx ᴛᴇᴄʜ'
    ].join('\n');
}

async function repoCommand(sock, chatId, message) {
    try {
        const payload = {
            caption: repoCaption(),
            ...channelInfo,
            ...repoButtons()
        };
        const imgPath = path.join(__dirname, '../assets/bot_image.jpg');

        if (fs.existsSync(imgPath)) {
            payload.image = fs.readFileSync(imgPath);
        } else {
            payload.text = payload.caption;
            delete payload.caption;
        }

        await sock.sendMessage(chatId, payload, { quoted: message });
    } catch (error) {
        console.error('[repo] Erreur :', error.message);
        await sock.sendMessage(chatId, {
            text: '❌ Impossible d’afficher les informations du site.'
        }, { quoted: message });
    }
}

module.exports = repoCommand;
