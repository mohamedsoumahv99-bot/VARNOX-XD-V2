const { channelInfo } = require('./messageConfig');

function sendAntiMessage(sock, chatId, content, options) {
    const forwarded = content && (content.text || content.caption || content.image || content.video || content.audio || content.sticker || content.document)
        ? { ...content, ...channelInfo }
        : content;
    return sock.sendMessage(chatId, forwarded, options);
}

const { isJidGroup } = require('@whiskeysockets/baileys');
const { getAntilink, incrementWarningCount, resetWarningCount, isSudo } = require('../lib/index');
const isAdmin = require('../lib/isAdmin');
const config = require('../config');

const WARN_COUNT = config.WARN_COUNT || 3;
const DOWNLOAD_COMMANDS = new Set([
    'play', 'music', 'song', 'mp3', 'ytmp3', 'video', 'ytmp4',
    'tiktok', 'tt', 'instagram', 'insta', 'ig', 'igsc', 'igs',
    'facebook', 'fb', 'spotify', 'url', 'tourl', 'ss', 'ssweb',
    'screenshot'
]);

function isDownloadCommand(text) {
    const firstToken = String(text || '').trim().split(/\s+/)[0];
    const command = firstToken.replace(/^[^a-z0-9]+/i, '').toLowerCase();
    return DOWNLOAD_COMMANDS.has(command);
}

/**
 * Checks if a string contains a URL.
 *
 * @param {string} str - The string to check.
 * @returns {boolean} - True if the string contains a URL, otherwise false.
 */
function containsURL(str) {
	const urlRegex = /(?:https?:\/\/|www\.)[^\s]+|(?:chat\.whatsapp\.com|t\.me|wa\.me)\/[^\s]+|(?<!@)\b[a-z0-9-]+\.(?:com|net|org|io|ly|me|co|xyz|app|dev|pw|info)(?:\/[^\s]*)?/i;
	return urlRegex.test(str);
}

/**
 * Handles the Antilink functionality for group chats.
 *
 * @param {object} msg - The message object to process.
 * @param {object} sock - The socket object to use for sending messages.
 */
async function Antilink(msg, sock) {
    const jid = msg.key.remoteJid;
    if (!jid || !jid.endsWith('@g.us')) return;

    const content = msg.message || {};
    const SenderMessage = content.conversation ||
        content.extendedTextMessage?.text ||
        content.imageMessage?.caption ||
        content.videoMessage?.caption ||
        content.documentMessage?.caption ||
        content.ephemeralMessage?.message?.conversation ||
        content.ephemeralMessage?.message?.extendedTextMessage?.text ||
        content.viewOnceMessage?.message?.conversation ||
        content.viewOnceMessage?.message?.extendedTextMessage?.text || '';
    if (!SenderMessage || typeof SenderMessage !== 'string') return;
    // Commands such as .video <url> need their URL to reach the downloader.
    if (isDownloadCommand(SenderMessage)) return;

    const sender = msg.key.participant || msg.key.participantAlt || msg.key.remoteJid;
    if (!sender) return;
	
	// Skip if sender is group admin or sudo
	try {
		const { isSenderAdmin } = await isAdmin(sock, jid, sender);
		if (isSenderAdmin) return;
	} catch (_) {}
	const senderIsSudo = await isSudo(sender);
	if (senderIsSudo) return;

	if (!containsURL(SenderMessage.trim())) return;
	
    const antilinkConfig = await getAntilink(jid, 'on');
    if (!antilinkConfig?.enabled) return;

    const action = ['delete', 'kick', 'warn'].includes(antilinkConfig.action)
        ? antilinkConfig.action
        : 'delete';
	
	try {
		// Delete message first
		await sendAntiMessage(sock, jid, { delete: msg.key });

		switch (action) {
			case 'delete':
				await sendAntiMessage(sock, jid, { 
					text: `╭──⟪𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞⟫──╮\n┃⌬┃ @${sender.split('@')[0]} : les liens sont interdits ici.\n┃⌬┃ Action : message supprimé.\n╰━━━━━━━━━━━━❍`,
					mentions: [sender] 
				});
				break;

			case 'kick':
				await sock.groupParticipantsUpdate(jid, [sender], 'remove');
				await sendAntiMessage(sock, jid, {
					text: `╭──⟪𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞⟫──╮\n┃⌬┃ @${sender.split('@')[0]} a été retiré pour partage de lien.\n╰━━━━━━━━━━━━❍`,
					mentions: [sender]
				});
				break;

			case 'warn':
				const warningCount = await incrementWarningCount(jid, sender);
				if (warningCount >= WARN_COUNT) {
					await sock.groupParticipantsUpdate(jid, [sender], 'remove');
					await resetWarningCount(jid, sender);
					await sendAntiMessage(sock, jid, {
						text: `╭──⟪𝗔𝗡𝗧𝗜𝗟𝗜𝗡𝗞⟫──╮\n┃⌬┃ @${sender.split('@')[0]} a été retiré après ${WARN_COUNT} avertissements.\n╰━━━━━━━━━━━━❍`,
						mentions: [sender]
					});
				} else {
					await sendAntiMessage(sock, jid, {
						text: `🛡️ @${sender.split('@')[0]} : lien supprimé. Avertissement ${warningCount}/${WARN_COUNT}.`,
						mentions: [sender]
					});
				}
				break;
		}
	} catch (error) {
		console.error('Error in Antilink:', error);
	}
}

module.exports = { Antilink };
