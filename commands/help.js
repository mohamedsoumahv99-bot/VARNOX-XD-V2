'use strict';

const fs = require('fs');
const path = require('path');
const settings = require('../settings');

const CHANNEL_LINK = 'https://whatsapp.com/channel/0029Vb7jG2KEawdwHsZiEm1E';
const SUPPORT_LINK = 'https://chat.whatsapp.com/K64io2FT8zj6i7aRUJITAj';
const MENU_IMAGE = path.join(__dirname, '../assets/menu-style.jpg');

const channelInfo = {
  contextInfo: {
    forwardingScore: 1,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
      newsletterJid: '120363424782348922@newsletter',
      newsletterName: '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
      serverMessageId: -1
    }
  }
};

// These are the commands exposed by the current VARNOX command router.
// Keeping them here makes the menu searchable without changing command behavior.
const categories = [
  {
    key: 'confidentialite',
    title: 'ᴄᴏɴғɪᴅᴇɴᴛɪᴀʟɪᴛé',
    icon: '🔐',
    aliases: ['privacy', 'securite'],
    commands: ['antidelete', 'antidm', 'pmblocker', 'anticall', 'antibot', 'antilink']
  },
  {
    key: 'conversion',
    title: 'ᴄᴏɴᴠᴇʀsɪᴏɴ',
    icon: '🔄',
    commands: ['sticker', 'simage', 'stickertelegram', 'emojimix', 'translate', 'tts', 'attp']
  },
  {
    key: 'fun',
    title: 'ғᴜɴ',
    icon: '🎭',
    commands: ['joke', 'quote', 'fact', 'compliment', 'insult', 'flirt', 'truth', 'dare', 'ship', 'character']
  },
  {
    key: 'fx_audio',
    title: 'ғx_ᴀᴜᴅɪᴏ',
    icon: '🎧',
    aliases: ['audio', 'music'],
    commands: ['play', 'song', 'spotify', 'lyrics', 'tts', 'attp', 'wasted']
  },
  {
    key: 'groupe',
    title: 'ɢʀᴏᴜᴘᴇ',
    icon: '🛡️',
    aliases: ['group', 'groupes'],
    commands: [
      'groupinfo', 'staff', 'tagall', 'tag', 'hidetag', 'tagnotadmin',
      'kick', 'kickall', 'promote', 'demote', 'warn', 'warnings',
      'mute', 'unmute', 'open', 'close', 'antilink', 'antitag',
      'antibadword', 'antibot', 'welcome', 'goodbye', 'setgname',
      'setgdesc', 'setgpp', 'resetlink', 'delete', 'clear', 'deleteall'
    ]
  },
  {
    key: 'ia',
    title: 'ɪɴᴛᴇʟʟɪɢᴇɴᴄᴇ ᴀʀᴛɪғɪᴄɪᴇʟʟᴇ',
    icon: '🧠',
    aliases: ['ai', 'intelligenceartificielle'],
    commands: ['ai', 'chatbot', 'imagine', 'sora', 'anime']
  },
  {
    key: 'image_edits',
    title: 'ɪᴍᴀɢᴇ_ᴇᴅɪᴛs',
    icon: '🖼️',
    aliases: ['images', 'photo', 'photoedit'],
    commands: ['blur', 'removebg', 'remini', 'crop', 'sticker', 'simage', 'meme', 'take']
  },
  {
    key: 'logo',
    title: 'ʟᴏɢᴏ & ᴛᴇxᴛᴇ',
    icon: '✨',
    aliases: ['logos', 'text'],
    commands: ['textmaker', 'neon', 'glitch', 'fire', 'ice', 'snow', 'matrix', 'hacker', 'devil', 'sand', 'blackpink', 'thunder', 'arena']
  },
  {
    key: 'outils',
    title: 'ᴏᴜᴛɪʟs',
    icon: '🧰',
    aliases: ['tools', 'utilitaires'],
    commands: ['ping', 'alive', 'owner', 'jid', 'url', 'ss', 'settings', 'groupinfo', 'menu', 'allmenu']
  },
  {
    key: 'owner',
    title: 'ᴏᴡɴᴇʀ',
    icon: '👑',
    aliases: ['proprietaire', 'propriétaire'],
    commands: ['mode', 'clearsession', 'cleartmp', 'update', 'settings', 'autostatus', 'autoread', 'autotyping', 'anticall', 'pmblocker', 'setpp', 'areact', 'sudo']
  },
  {
    key: 'reactions',
    title: 'ʀéᴀᴄᴛɪᴏɴs',
    icon: '💫',
    aliases: ['reaction', 'react'],
    commands: ['areact', 'autoreact', 'mention', 'setmention', 'heart']
  },
  {
    key: 'recherche',
    title: 'sᴇᴀʀᴄʜ',
    icon: '🔎',
    aliases: ['search', 'recherche'],
    commands: ['weather', 'news', 'github', 'repo', 'url', 'lyrics']
  },
  {
    key: 'statut',
    title: 'sᴛᴀᴛᴜs',
    icon: '📡',
    aliases: ['status'],
    commands: ['alive', 'ping', 'autostatus', 'autoread', 'autotyping']
  },
  {
    key: 'systeme',
    title: 'sʏsᴛèᴍᴇ',
    icon: '⚙️',
    aliases: ['system', 'config'],
    commands: ['menu', 'allmenu', 'settings', 'update', 'clearsession', 'cleartmp']
  },
  {
    key: 'telechargement',
    title: 'ᴛéʟéᴄʜᴀʀɢᴇᴍᴇɴᴛ',
    icon: '📥',
    aliases: ['download', 'downloads', 'telechargements'],
    commands: ['play', 'song', 'video', 'instagram', 'facebook', 'tiktok', 'spotify']
  },
  {
    key: 'jeux',
    title: 'ᴏᴠʟ-ɢᴀᴍᴇs',
    icon: '🎮',
    aliases: ['games', 'game', 'jeu'],
    commands: ['tictactoe', 'hangman', 'trivia', '8ball', 'truth', 'dare']
  },
  {
    key: 'medias',
    title: 'ᴍéᴅɪᴀs',
    icon: '🎨',
    aliases: ['media', 'sticker'],
    commands: ['sticker', 'simage', 'stickertelegram', 'stickercrop', 'gif', 'meme', 'take', 'vv', 'vv2']
  }
];

const commandCount = new Set(categories.flatMap(category => category.commands)).size;

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function nowInfo() {
  const now = new Date();
  return {
    date: now.toLocaleDateString('fr-FR', { timeZone: 'Africa/Conakry' }),
    time: now.toLocaleTimeString('fr-FR', { timeZone: 'Africa/Conakry', hour12: false }),
    runtime: (() => {
      const seconds = Math.floor(process.uptime());
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
    })()
  };
}

function menuHeader(senderNum) {
  const info = nowInfo();
  return (
    `╭──⟪ 🤖 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩𝟮 ⟫──╮\n` +
    `├ ߷ ᴘʀéғɪxᴇ       : .\n` +
    `├ ߷ ᴏᴡɴᴇʀ         : ${settings.botOwner || settings.author || 'VARNOX'}\n` +
    `├ ߷ ᴄᴏᴍᴍᴀɴᴅᴇs     : ${commandCount}\n` +
    `├ ߷ ᴜᴘᴛɪᴍᴇ        : ${info.runtime}\n` +
    `├ ߷ ᴅᴀᴛᴇ          : ${info.date}\n` +
    `├ ߷ ʜᴇᴜʀᴇ         : ${info.time}\n` +
    `├ ߷ ᴘʟᴀᴛᴇғᴏʀᴍᴇ    : ʟɪɴᴜx\n` +
    `├ ߷ ᴅéᴠᴇʟᴏᴘᴘᴇᴜʀ   : ${settings.author || 'ʋαɾɳσx'}\n` +
    `├ ߷ ᴠᴇʀsɪᴏɴ       : ${settings.version || '2.0.0'}\n` +
    `├ ߷ ᴜsᴇʀ          : @${senderNum}\n` +
    `╰──────────────────╯`
  );
}

function categoryBox(category) {
  return (
    `╭───⟪ ${category.icon} ${category.key === 'groupe' ? 'ɢʀᴏᴜᴘᴇ' : category.title} ⟫───╮\n` +
    category.commands.map((command, index) =>
      `├ ߷ ${String(index + 1).padStart(2, '0')} • .${command}`
    ).join('\n') +
    `\n╰───────────────────╯`
  );
}

function categoryIndex(query) {
  const normalized = normalize(query);
  if (/^\d+$/.test(String(query).trim())) {
    const index = Number(query) - 1;
    return categories[index] ? index : -1;
  }
  return categories.findIndex(category => (
    normalize(category.key) === normalized ||
    normalize(category.title) === normalized ||
    (category.aliases || []).some(alias => normalize(alias) === normalized)
  ));
}

function overview(senderNum, notice = '') {
  const categoryLines = categories.map((category, index) =>
    `├ ߷ ${String(index + 1).padStart(2, '0')} • ${category.icon} ${category.title}`
  ).join('\n');

  return (
    `${notice ? `${notice}\n\n` : ''}` +
    `${menuHeader(senderNum)}\n\n` +
    `╭───⟪ ᴄᴀᴛéɢᴏʀɪᴇs ⟫───╮\n` +
    `${categoryLines}\n` +
    `╰───────────────────╯\n\n` +
    `💡 ᴛᴀᴘᴇ *ᴍᴇɴᴜ <ɴᴜᴍéʀᴏ>* ᴏᴜ *ᴍᴇɴᴜ <ɴᴏᴍ>* ᴘᴏᴜʀ ᴠᴏɪʀ ᴜɴᴇ ᴄᴀᴛéɢᴏʀɪᴇ.\n` +
    `💡 ᴛᴀᴘᴇ *ᴀʟʟᴍᴇɴᴜ* ᴘᴏᴜʀ ᴛᴏᴜᴛ ᴀғғɪᴄʜᴇʀ.\n` +
    `📌 ᴇxᴇᴍᴘʟᴇs : *ᴍᴇɴᴜ 5* • *ᴍᴇɴᴜ ɢʀᴏᴜᴘᴇ*\n\n` +
    `🔗 sᴜᴘᴘᴏʀᴛ : ${SUPPORT_LINK}\n` +
    `📢 ᴄʜᴀîɴᴇ : ${CHANNEL_LINK}\n\n` +
    `> 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩𝟮 • ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴠᴀʀɴᴏx`
  );
}

function allMenu(senderNum) {
  return (
    `${menuHeader(senderNum)}\n\n` +
    categories.map(category => categoryBox(category)).join('\n\n') +
    `\n\n🔗 sᴜᴘᴘᴏʀ : ${SUPPORT_LINK}\n` +
    `📢 ᴄʜᴀîɴᴇ : ${CHANNEL_LINK}\n\n` +
    `> 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩𝟮 • ᴛᴏᴜᴛᴇs ʟᴇs ᴄᴏᴍᴍᴀɴᴅᴇs`
  );
}

async function sendMenu(sock, chatId, message, text, senderId, withImage) {
  const payload = {
    caption: text,
    mentions: [senderId],
    ...channelInfo
  };

  if (withImage) {
    try {
      await sock.sendMessage(chatId, {
        image: fs.readFileSync(MENU_IMAGE),
        ...payload
      }, { quoted: message });
      return;
    } catch (error) {
      console.error('[menu] image failed, sending text:', error.message);
    }
  }

  await sock.sendMessage(chatId, {
    text,
    mentions: [senderId],
    ...channelInfo
  }, { quoted: message });
}

async function helpCommand(sock, chatId, message, query = '') {
  const senderId = message.key.participant || message.key.remoteJid || '';
  const senderNum = senderId.split('@')[0] || '?';
  const normalizedQuery = String(query || '').trim();

  if (!normalizedQuery || ['menu', 'categories', 'category'].includes(normalize(normalizedQuery))) {
    await sendMenu(sock, chatId, message, overview(senderNum), senderId, true);
    return;
  }

  if (['all', 'allmenu', 'full', 'tout'].includes(normalize(normalizedQuery))) {
    await sendMenu(sock, chatId, message, allMenu(senderNum), senderId, false);
    return;
  }

  const index = categoryIndex(normalizedQuery);
  if (index < 0) {
    await sendMenu(
      sock,
      chatId,
      message,
      overview(senderNum, `⚠️ ᴄᴀᴛéɢᴏʀɪᴇ ɪɴᴄᴏɴɴᴜᴇ : *${normalizedQuery}*`),
      senderId,
      true
    );
    return;
  }

  const category = categories[index];
  await sendMenu(
    sock,
    chatId,
    message,
    `${menuHeader(senderNum)}\n\n${categoryBox(category)}\n\n` +
    `💡 ᴜᴛɪʟɪsᴇ *ᴍᴇɴᴜ* ᴘᴏᴜʀ ʀᴇᴠᴇɴɪʀ ᴀᴜx ᴄᴀᴛéɢᴏʀɪᴇs.\n` +
    `🔗 sᴜᴘᴘᴏʀᴛ : ${SUPPORT_LINK}\n\n` +
    `> 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩𝟮 • ᴄᴀᴛéɢᴏʀɪᴇ ${index + 1}`,
    senderId,
    false
  );
}

module.exports = helpCommand;