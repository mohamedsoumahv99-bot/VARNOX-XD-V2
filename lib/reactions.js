'use strict';
const fs   = require('fs');
const path = require('path');

// ─── Per-command emoji map ────────────────────────────────────────────────────
// Used when auto-react is ON to give instant visual feedback per command type.
const EMOJI_MAP = {
  // Status / info
  '.ping'        : '🏓',
  '.alive'       : '💚',
  '.help'        : '📖', '.menu'      : '📖', '.bot'      : '📖', '.list'   : '📖',
  '.settings'    : '⚙️',  '.mode'      : '⚙️',
  '.owner'       : '👑',
  '.sudo'        : '🛡️',
  '.update'      : '🔄',
  '.github'      : '💻', '.git'       : '💻', '.sc'       : '💻', '.repo'   : '💻', '.script': '💻',
  '.jid'         : '🔢',
  '.debug'       : '🔍',

  // Group management
  '.tagall'      : '📢',
  '.tag'         : '🏷️',
  '.hidetag'     : '👻',
  '.tagnotadmin' : '📣',
  '.ban'         : '🚫',
  '.unban'       : '✅',
  '.kick'        : '👢',
  '.mute'        : '🔇',
  '.unmute'      : '🔊',
  '.promote'     : '⬆️',
  '.demote'      : '⬇️',
  '.warn'        : '⚠️',
  '.warnings'    : '📋',
  '.clear'       : '🧹',
  '.resetlink'   : '🔗', '.revoke'    : '🔗', '.anularlink': '🔗',
  '.staff'       : '👑', '.admins'    : '👑', '.listadmin' : '👑',
  '.groupinfo'   : '📊', '.infogp'    : '📊', '.infogrupo' : '📊',
  '.setgdesc'    : '📝',
  '.setgname'    : '✏️',
  '.setgpp'      : '🖼️',
  '.welcome'     : '👋',
  '.goodbye'     : '👋',
  '.topmembers'  : '🏆',

  // Moderation toggles
  '.antilink'    : '🔗',
  '.antitag'     : '🔒',
  '.antibot'     : '🤖',
  '.antibadword' : '🔞',
  '.antidelete'  : '🛡️',
  '.anticall'    : '📵',
  '.pmblocker'   : '✉️',
  '.chatbot'     : '💬',
  '.mention'     : '📩',
  '.setmention'  : '📩',

  // Auto features
  '.autostatus'  : '📡',
  '.autotyping'  : '⌨️',
  '.autoread'    : '👁️',
  '.areact'      : '😊', '.autoreact'  : '😊', '.autoreaction': '😊',

  // Media / stickers
  '.sticker'     : '🎨', '.s'          : '🎨',
  '.attp'        : '🎨',
  '.simage'      : '🖼️',
  '.blur'        : '🌫️',
  '.emojimix'    : '😊', '.emix'       : '😊',
  '.crop'        : '✂️',
  '.tg'          : '✈️',  '.stickertelegram': '✈️',
  '.take'        : '🎭', '.steal'      : '🎭',
  '.viewonce'    : '👁️', '.🥷'         : '👁️',
  '.setpp'       : '🖼️',
  '.removebg'    : '✂️', '.rmbg'       : '✂️', '.nobg'      : '✂️',
  '.remini'      : '✨',  '.enhance'   : '✨',  '.upscale'   : '✨',
  '.imagine'     : '🎨', '.flux'       : '🎨', '.dalle'     : '🎨',
  '.img-blur'    : '🌫️',
  '.wasted'      : '💀',
  '.waste'       : '💀',
  '.simp'        : '😳',
  '.stupid'      : '🤦', '.iss'        : '🤦',
  '.ship'        : '💞',
  '.character'   : '🦸',
  '.pies'        : '🏳️',
  '.china'       : '🇨🇳',
  '.japan'       : '🇯🇵',
  '.korea'       : '🇰🇷',
  '.india'       : '🇮🇳',
  '.indonesia'   : '🇮🇩',
  '.malaysia'    : '🇲🇾',
  '.thailand'    : '🇹🇭',

  // Text effects
  '.metallic'    : '🔩', '.ice'        : '🧊', '.snow'      : '❄️',
  '.impressive'  : '💫', '.matrix'     : '🖥️', '.light'     : '💡',
  '.neon'        : '🌈', '.devil'      : '😈', '.purple'    : '💜',
  '.thunder'     : '⚡', '.leaves'     : '🍃', '.1917'      : '🎬',
  '.arena'       : '⚔️',  '.hacker'    : '💻', '.sand'      : '🏜️',
  '.blackpink'   : '🌸', '.glitch'     : '🔮', '.fire'      : '🔥',

  // Downloads
  '.play'        : '🎵', '.mp3'        : '🎵', '.ytmp3'     : '🎵',
  '.song'        : '🎵', '.music'      : '🎵',
  '.video'       : '🎬', '.ytmp4'      : '🎬',
  '.tiktok'      : '🎵', '.tt'         : '🎵',
  '.instagram'   : '📸', '.insta'      : '📸', '.ig'        : '📸',
  '.fb'          : '📘', '.facebook'   : '📘',
  '.spotify'     : '🎧',

  // AI / tools
  '.gpt'         : '🤖', '.gemini'     : '🤖', '.sora'      : '🤖',
  '.ai'          : '🤖',
  '.translate'   : '🌍', '.trt'        : '🌍',
  '.tts'         : '🎙️',
  '.ss'          : '📸', '.ssweb'      : '📸', '.screenshot': '📸',
  '.url'         : '🔗', '.tourl'      : '🔗',
  '.weather'     : '🌤️',
  '.news'        : '📰',
  '.lyrics'      : '🎼',
  '.igs'         : '📸', '.igsc'       : '📸',
  '.anime'       : '🌸',  '.animu'     : '🌸',

  // Fun
  '.joke'        : '😂',
  '.meme'        : '😹',
  '.fact'        : '📚',
  '.quote'       : '💬',
  '.dare'        : '😈',
  '.truth'       : '🤔',
  '.flirt'       : '💕',
  '.compliment'  : '💐',
  '.insult'      : '😤',
  '.8ball'       : '🎱',
  '.goodnight'   : '🌙', '.gn'         : '🌙', '.lovenight' : '🌙',
  '.shayari'     : '✍️',  '.shayri'    : '✍️',
  '.roseday'     : '🌹',
  '.heart'       : '❤️',
  '.nom'         : '😋', '.poke'       : '👉', '.cry'       : '😭',
  '.kiss'        : '💋', '.pat'        : '🤗', '.hug'       : '🤗', '.wink'  : '😉',
  '.facepalm'    : '🤦', '.loli'       : '🌸',

  // Games
  '.ttt'         : '🎮', '.tictactoe'  : '🎮', '.move'      : '🎮',
  '.hangman'     : '🎮', '.guess'      : '🔤',
  '.trivia'      : '❓', '.answer'     : '💡',
  '.surrender'   : '🏳️',

  // Delete / session
  '.delete'      : '🗑️', '.del'        : '🗑️',
  '.cleartmp'    : '🧹',
  '.clearsession': '🔄', '.clearsesi'  : '🔄',

  // Misc
  '.tweet'       : '🐦',
  '.ytcomment'   : '📹',
  '.comrade'     : '👥',  '.gay'       : '🌈', '.glass'     : '🥂',
  '.jail'        : '⛓️', '.passed'     : '✅',  '.triggered' : '😡',
  '.horny'       : '🔞',  '.circle'    : '⭕', '.lgbt'      : '🌈',
  '.lolice'      : '🚓',  '.simpcard'  : '😳', '.tonikawa'  : '💘',
  '.namecard'    : '📛',  '.oogway'    : '🐢',
  '.tourl'       : '🔗',
};

/** Default emoji when command has no specific mapping */
const DEFAULT_EMOJI = '⚡';

/** Returns the emoji for a given command (e.g. '.ping') */
function getCommandEmoji(cmdKey) {
  return EMOJI_MAP[cmdKey] || DEFAULT_EMOJI;
}

// ─── Persistent state ─────────────────────────────────────────────────────────
const USER_GROUP_DATA = path.join(__dirname, '../data/userGroupData.json');

function loadAutoReactionState() {
  try {
    if (fs.existsSync(USER_GROUP_DATA)) {
      const data = JSON.parse(fs.readFileSync(USER_GROUP_DATA, 'utf8'));
      return data.autoReaction !== undefined ? data.autoReaction : true; // default ON
    }
  } catch {}
  return true; // default ON
}

function saveAutoReactionState(state) {
  try {
    const data = fs.existsSync(USER_GROUP_DATA)
      ? JSON.parse(fs.readFileSync(USER_GROUP_DATA, 'utf8'))
      : { groups: [], chatbot: {} };
    data.autoReaction = state;
    fs.writeFileSync(USER_GROUP_DATA, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[reactions] saveAutoReactionState error:', e.message);
  }
}

let isAutoReactionEnabled = loadAutoReactionState();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * React to a command message with the appropriate emoji.
 * @param {object} sock   - Baileys socket
 * @param {object} message - WA message object
 * @param {string} cmdKey  - Command key like '.ping', '.tagall', etc.
 */
async function addCommandReaction(sock, message, cmdKey) {
  try {
    if (!isAutoReactionEnabled || !message?.key?.id) return;
    const emoji = cmdKey ? getCommandEmoji(cmdKey) : DEFAULT_EMOJI;
    await sock.sendMessage(message.key.remoteJid, {
      react: { text: emoji, key: message.key }
    });
  } catch (e) {
    // Silent — reaction failure should never crash commands
  }
}

/**
 * Handle .areact / .autoreact on|off command
 */
async function handleAreactCommand(sock, chatId, message, isOwner) {
  try {
    if (!isOwner) {
      await sock.sendMessage(chatId, {
        text: '❌ Commande réservée au propriétaire.',
      }, { quoted: message });
      return;
    }

    const text = (
      message.message?.conversation ||
      message.message?.extendedTextMessage?.text || ''
    ).trim().toLowerCase();

    const action = text.split(/\s+/)[1];

    if (action === 'on') {
      isAutoReactionEnabled = true;
      saveAutoReactionState(true);
      await sock.sendMessage(chatId, {
        text: '✅ Auto-réaction activée — chaque commande réagira avec son emoji.',
      }, { quoted: message });
    } else if (action === 'off') {
      isAutoReactionEnabled = false;
      saveAutoReactionState(false);
      await sock.sendMessage(chatId, {
        text: '🔕 Auto-réaction désactivée.',
      }, { quoted: message });
    } else {
      const state = isAutoReactionEnabled ? '✅ activée' : '🔕 désactivée';
      await sock.sendMessage(chatId, {
        text: `Auto-réaction : ${state}\n\n.areact on  — activer\n.areact off — désactiver`,
      }, { quoted: message });
    }
  } catch (e) {
    console.error('[reactions] handleAreactCommand error:', e.message);
  }
}

module.exports = { addCommandReaction, handleAreactCommand, getCommandEmoji };
