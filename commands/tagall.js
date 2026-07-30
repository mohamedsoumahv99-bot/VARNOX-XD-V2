'use strict';

async function tagAllCommand(sock, chatId, senderId, message) {
  try {
    if (!chatId.endsWith('@g.us')) {
      await sock.sendMessage(chatId, { text: '❌ Cette commande ne fonctionne que dans les groupes.' }, { quoted: message });
      return;
    }

    const groupMetadata = await sock.groupMetadata(chatId);
    const participants  = groupMetadata.participants;

    if (!participants || participants.length === 0) {
      await sock.sendMessage(chatId, { text: '❌ Aucun participant trouvé.' }, { quoted: message });
      return;
    }

    const groupName   = groupMetadata.subject || 'Groupe';
    const count       = participants.length;
    const senderNum   = senderId.split('@')[0];

    // Build mention list
    const mentions = participants.map(p => p.id);
    const memberList = participants
      .map((p, i) => `  ${i + 1}. @${p.id.split('@')[0]}`)
      .join('\n');

    const tagMessage =
      `╭━━━━ 『 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2 』 ━━━━╮\n` +
      `┃ 📢 *TAG ALL*\n` +
      `┃ 👤 Par : @${senderNum}\n` +
      `┃ 🏷️ Groupe : *${groupName}*\n` +
      `┃ 👥 Membres : *${count}*\n` +
      `╰━━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
      `${memberList}\n\n` +
      `> © 2026 ʋαɾɳσx ❍ғғɪᴄɪᴀʟ`;

    await sock.sendMessage(chatId, {
      text     : tagMessage,
      mentions : mentions,
    }, { quoted: message });

  } catch (err) {
    console.error('[tagall] error:', err.message);
    await sock.sendMessage(chatId, { text: '❌ Impossible de tagger tous les membres.' }, { quoted: message });
  }
}

module.exports = tagAllCommand;
