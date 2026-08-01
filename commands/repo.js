'use strict';

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const moment = require('moment-timezone');

const REPO_API    = 'https://api.github.com/repos/mohamedsoumahv99-bot/VARNOX-XD-V2';
const REPO_URL    = 'https://github.com/mohamedsoumahv99-bot/VARNOX-XD-V2';
const WEBSITE_URL = 'https://varnox-xd-v2.onrender.com';

const NEWSLETTER_JID  = '120363424782348922@newsletter';
const NEWSLETTER_NAME = '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2';
const CHANNEL_LINK    = 'https://whatsapp.com/channel/0029Vb7jG2KEawdwHsZiEm1E';

// Format forward depuis la chaîne officielle
const newsletterForward = {
    contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: NEWSLETTER_JID,
            newsletterName: NEWSLETTER_NAME,
            serverMessageId: -1
        }
    }
};

async function repoCommand(sock, chatId, message) {
    try {
        // ── Récupération des infos GitHub ────────────────────────────────
        let repoInfo = null;
        try {
            const res = await axios.get(REPO_API, {
                headers: { 'User-Agent': 'VARNOX-XD-V2-Bot' },
                timeout: 8000
            });
            repoInfo = res.data;
        } catch { /* continue sans les stats */ }

        // ── Texte principal (style forward officiel) ─────────────────────
        const stars   = repoInfo ? repoInfo.stargazers_count  : '—';
        const forks   = repoInfo ? repoInfo.forks_count       : '—';
        const issues  = repoInfo ? repoInfo.open_issues_count : '—';
        const updated = repoInfo
            ? moment(repoInfo.updated_at).locale('fr').format('DD/MM/YYYY à HH:mm')
            : '—';

        const txt =
            `╭━━━━━━⌜ 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2 ⌟━━━━━━╮\n` +
            `┃\n` +
            `┃  🤖 *𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2 — BOT OFFICIEL*\n` +
            `┃  ─────────────────────────────\n` +
            `┃  🌐 *Website* :\n` +
            `┃  ${WEBSITE_URL}\n` +
            `┃\n` +
            `┃  📦 *GitHub* :\n` +
            `┃  ${REPO_URL}\n` +
            `┃\n` +
            `┃  ─────────────────────────────\n` +
            `┃  ⭐ Stars      : *${stars}*\n` +
            `┃  🔀 Forks      : *${forks}*\n` +
            `┃  🐛 Issues     : *${issues}*\n` +
            `┃  🕐 Mis à jour : *${updated}*\n` +
            `┃\n` +
            `┃  ─────────────────────────────\n` +
            `┃  📡 Chaîne officielle :\n` +
            `┃  ${CHANNEL_LINK}\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
            `> ©2026 ᴠᴀʀɴᴏx xᴅ ᴠ2 ᴅᴇᴠ ʙʏ ᴠᴀʀɴᴏx ᴛᴇᴄʜ`;

        // ── Tentative d'envoi avec l'image du bot ───────────────────────
        const imgPath = path.join(__dirname, '../assets/bot_image.jpg');

        if (fs.existsSync(imgPath)) {
            const imgBuffer = fs.readFileSync(imgPath);

            // Message image (style forward) avec bouton PAIR LINK
            await sock.sendMessage(chatId, {
                image:    imgBuffer,
                caption:  txt,
                ...newsletterForward
            }, { quoted: message });
        } else {
            await sock.sendMessage(chatId, {
                text: txt,
                ...newsletterForward
            }, { quoted: message });
        }

        // ── Message séparé : bouton PAIR LINK ────────────────────────────
        // (URL cliquable en texte formaté — compatible tous clients WA)
        await sock.sendMessage(chatId, {
            text:
                `╭━━━━━━⌜ 𝗖𝗢𝗡𝗡𝗘𝗫𝗜𝗢𝗡 ⌟━━━━━━╮\n` +
                `┃\n` +
                `┃  🔗 *PAIR LINK — Connectez votre bot*\n` +
                `┃\n` +
                `┃  👉 ${WEBSITE_URL}\n` +
                `┃\n` +
                `┃  Cliquez sur le lien ci-dessus pour\n` +
                `┃  générer votre code de connexion et\n` +
                `┃  connecter votre numéro WhatsApp.\n` +
                `┃\n` +
                `╰━━━━━━━━━━━━━━━━━━━━━━╯`,
            ...newsletterForward
        });

    } catch (err) {
        console.error('[repo] Erreur :', err.message);
        await sock.sendMessage(chatId, {
            text: '❌ Impossible de récupérer les informations du repo.',
            ...newsletterForward
        }, { quoted: message });
    }
}

module.exports = repoCommand;
