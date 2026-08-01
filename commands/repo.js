'use strict';

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const moment = require('moment-timezone');

const REPO_API    = 'https://api.github.com/repos/mohamedsoumahv99-bot/VARNOX-XD-V2';
const REPO_URL    = 'https://github.com/mohamedsoumahv99-bot/VARNOX-XD-V2';
const WEBSITE_URL = 'https://varnox-xd-v2.onrender.com';

// Forward chaîne officielle + bouton PAIR LINK intégré dans le même contextInfo
const buildContextInfo = () => ({
    contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid:   '120363424782348922@newsletter',
            newsletterName:  '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
            serverMessageId: -1
        },
        externalAdReply: {
            title:                 '🔗 PAIR LINK',
            body:                  'Connecter votre bot WhatsApp',
            sourceUrl:             WEBSITE_URL,
            mediaType:             1,
            renderLargerThumbnail: false,
            showAdAttribution:     false
        }
    }
});

async function repoCommand(sock, chatId, message) {
    try {
        // Récupération stats GitHub
        let repoInfo = null;
        try {
            const res = await axios.get(REPO_API, {
                headers: { 'User-Agent': 'VARNOX-XD-V2-Bot' },
                timeout: 8000
            });
            repoInfo = res.data;
        } catch { /* continue sans stats */ }

        const stars   = repoInfo ? repoInfo.stargazers_count  : '—';
        const forks   = repoInfo ? repoInfo.forks_count       : '—';
        const issues  = repoInfo ? repoInfo.open_issues_count : '—';
        const updated = repoInfo
            ? moment(repoInfo.updated_at).format('DD/MM/YY HH:mm')
            : '—';

        const caption =
            `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
            `┃⌬╭━━━━━━━━━━━━━≽\n` +
            `┃⌬┃ 🤖 *VARNOX XD V2*\n` +
            `╰━━━━━━━━━━━━❍\n` +
            `┃⌬┃ 📦 *GitHub :*\n` +
            `┃⌬┃ ${REPO_URL}\n` +
            `┃⌬┃\n` +
            `┃⌬┃ 🌐 *Website :*\n` +
            `┃⌬┃ ${WEBSITE_URL}\n` +
            `┃⌬┃\n` +
            `┃⌬┃ ⭐ Stars      : *${stars}*\n` +
            `┃⌬┃ 🔀 Forks      : *${forks}*\n` +
            `┃⌬┃ 🐛 Issues     : *${issues}*\n` +
            `┃⌬┃ 🕐 Mis à jour : *${updated}*\n` +
            `┃⌬┃\n` +
            `╰━━━━━━━━━━━━❍\n` +
            `\n` +
            `> ©2026 ʋαɾɳσx xᴅ ʋ2 ᴅҽʋҽʅσρҽԃ Ⴆყ ʋαɾɳσx ᴛᴇᴄʜ`;

        const imgPath = path.join(__dirname, '../assets/bot_image.jpg');

        if (fs.existsSync(imgPath)) {
            const imgBuffer = fs.readFileSync(imgPath);
            await sock.sendMessage(chatId, {
                image:   imgBuffer,
                caption: caption,
                ...buildContextInfo()
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, {
                text: caption,
                ...buildContextInfo()
            }, { quoted: message });
        }

    } catch (err) {
        console.error('[repo] Erreur :', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ Impossible de récupérer les informations du repo.'
        }, { quoted: message });
    }
}

module.exports = repoCommand;
