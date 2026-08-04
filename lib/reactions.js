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
      // Only respect saved state if the user explicitly turned it OFF (false).
      // Any missing/undefined value → ON (fresh deploy / first run).
      if (data.autoReaction === false) return false;
    }
  } catch {}
  return true; // default ON on every fresh deploy
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

// ─── Emojis "toutes réponses" — réaction aux messages normaux ─────────────────
// Utilisés quand l'autoreact ALL est activé (messages non-commande)
const ALL_MSG_EMOJIS = ['❤️', '🔥', '😊', '👍', '✨', '💯', '🫶', '😎', '💪', '🙌'];
let _allMsgIdx = 0;
function nextAllMsgEmoji() {
  const e = ALL_MSG_EMOJIS[_allMsgIdx % ALL_MSG_EMOJIS.length];
  _allMsgIdx++;
  return e;
}

/**
 * Réagit à une commande avec l'emoji approprié.
 * TOUJOURS actif — indépendant de l'état .areact on/off.
 * Le toggle .areact contrôle uniquement la réaction aux messages normaux.
 *
 * @param {object} sock    - Socket Baileys
 * @param {object} message - Message WA
 * @param {string} cmdKey  - Clé de commande ex: '.ping', '.tagall'
 */
async function addCommandReaction(sock, message, cmdKey) {
  try {
    if (!message?.key?.id) return;
    const emoji = cmdKey ? getCommandEmoji(cmdKey) : DEFAULT_EMOJI;
    await sock.sendMessage(message.key.remoteJid, {
      react: { text: emoji, key: message.key }
    });
  } catch (e) {
    // Silencieux — l'échec de réaction ne doit jamais planter une commande
  }
}

/**
 * Réagit à TOUS les messages (groupes ET PV) quand l'autoreact all est activé.
 * Appelé depuis main.js sur les messages non-commande entrants.
 *
 * @param {object} sock    - Socket Baileys
 * @param {object} message - Message WA
 */
async function addAllMessageReaction(sock, message) {
  try {
    if (!isAutoReactionEnabled) return;
    if (!message?.key?.id) return;
    // Ne pas réagir aux messages envoyés par le bot lui-même
    if (message.key.fromMe) return;
    const emoji = nextAllMsgEmoji();
    await sock.sendMessage(message.key.remoteJid, {
      react: { text: emoji, key: message.key }
    });
  } catch (e) {
    // Silencieux
  }
}

/**
 * Gère .areact / .autoreact on|off
 * Quand ON  → réagit à TOUS les messages (groupes + PV) en plus des commandes
 * Quand OFF → réagit uniquement aux commandes (comportement par défaut)
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
        text:
          `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
          `┃⌬┃ ✅ *Autoreact activé !*\n` +
          `┃⌬┃\n` +
          `┃⌬┃ Le bot réagira désormais à\n` +
          `┃⌬┃ *tous* les messages reçus\n` +
          `┃⌬┃ (groupes et PV).\n` +
          `┃⌬┃\n` +
          `┃⌬┃ Les réactions de commandes\n` +
          `┃⌬┃ sont toujours actives.\n` +
          `╰━━━━━━━━━━━━❍`,
      }, { quoted: message });
    } else if (action === 'off') {
      isAutoReactionEnabled = false;
      saveAutoReactionState(false);
      await sock.sendMessage(chatId, {
        text:
          `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
          `┃⌬┃ 🔕 *Autoreact désactivé*\n` +
          `┃⌬┃\n` +
          `┃⌬┃ Le bot ne réagira plus aux\n` +
          `┃⌬┃ messages normaux.\n` +
          `┃⌬┃\n` +
          `┃⌬┃ Les réactions de commandes\n` +
          `┃⌬┃ restent toujours actives.\n` +
          `╰━━━━━━━━━━━━❍`,
      }, { quoted: message });
    } else {
      const state = isAutoReactionEnabled ? '✅ activé' : '🔕 désactivé';
      await sock.sendMessage(chatId, {
        text:
          `╭━━━━⌜𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2⌟\n` +
          `┃⌬┃ 😊 *Autoreact : ${state}*\n` +
          `┃⌬┃\n` +
          `┃⌬┃ *.areact on*  — activer\n` +
          `┃⌬┃ *.areact off* — désactiver\n` +
          `┃⌬┃\n` +
          `┃⌬┃ ℹ️ Les réactions sur commandes\n` +
          `┃⌬┃ sont toujours actives.\n` +
          `╰━━━━━━━━━━━━❍`,
      }, { quoted: message });
    }
  } catch (e) {
    console.error('[reactions] handleAreactCommand error:', e.message);
  }
}

module.exports = { addCommandReaction, addAllMessageReaction, handleAreactCommand, getCommandEmoji };
