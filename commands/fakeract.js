'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSION_DIR = path.resolve(process.env.SESSION_DIR || path.join(__dirname, '../sessions'));
const STATE_DIR = path.join(SESSION_DIR, 'channel-alerts');
const CHANNEL_LINK = new RegExp('^(?:https?://)?(?:www[.]?)?whatsapp[.]com/channel/([^/?# ]+)(?:/([0-9]+))?(?:[/?#].*)?$', 'i');
const PRIMARY_CHANNEL_JID = process.env.PRIMARY_CHANNEL_JID || '120363424782348922@newsletter';
const pendingNotifications = new Set();

function parseChannelLink(value) {
   const match = String(value || '').trim().match(CHANNEL_LINK);
   if (!match) return null;
   return { inviteCode: match[1] };
}

function accountNumber(sock) {
   return String(sock?.user?.id || sock?.user?.jid || '')
   .split(':')[0]
   .split('@')[0]
   .replace(/[^0-9]/g, '');
}

function maskedAccount(sock) {
   const number = accountNumber(sock);
   if (!number) return 'unknown';
   return number.length > 4 ? number.slice(0, 2) + '***' + number.slice(-2) : '***';
}

function accountStatePath(sock) {
   const number = accountNumber(sock);
   if (!number) return null;
   const key = crypto.createHash('sha256').update(number).digest('hex');
   return path.join(STATE_DIR, key + '.json');
}

function readState(sock) {
   const file = accountStatePath(sock);
   if (!file) return {};
   try {
   const value = JSON.parse(fs.readFileSync(file, 'utf8'));
   return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
   } catch (error) {
   if (error.code !== 'ENOENT') {
       console.warn('[channel-alert] state read failed for account=' + maskedAccount(sock) + ': ' + error.message);
   }
   return {};
   }
}

function writeState(sock, state) {
   const file = accountStatePath(sock);
   if (!file) throw new Error('Compte WhatsApp connecté introuvable');
   fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
   const temp = file + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
   fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
   fs.renameSync(temp, file);
}

function ownerJid(sock) {
   const id = String(sock?.user?.id || sock?.user?.jid || '').split(':')[0];
   if (!id) return null;
   return id.includes('@') ? id : id.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
}

async function replyPrivately(sock, text) {
   const jid = ownerJid(sock);
   if (!jid) throw new Error('Chat privé du compte connecté introuvable');
   return sock.sendMessage(jid, { text });
}

async function requestLiveUpdates(sock, newsletterJid) {
   if (typeof sock.subscribeNewsletterUpdates !== 'function') {
   throw new Error('La réception des publications en direct n’est pas prise en charge par Baileys');
   }
   const result = await sock.subscribeNewsletterUpdates(newsletterJid);
   const duration = result?.duration ? ' duration=' + result.duration : '';
   console.info('[channel-alert] live updates subscription returned account=' + maskedAccount(sock) +
   ' channel=' + newsletterJid + duration);
   return result;
}

async function restoreChannelAlerts(sock) {
   const state = readState(sock);
   if (!state.enabled || !state.channelJid) return false;
   state.liveUpdatesState = 'pending';
   writeState(sock, state);
   try {
   await requestLiveUpdates(sock, state.channelJid);
   state.liveUpdatesState = 'active';
   state.lastLiveUpdatesAt = Date.now();
   delete state.liveUpdatesError;
   writeState(sock, state);
   return true;
   } catch (error) {
   state.liveUpdatesState = 'pending';
   state.liveUpdatesError = error.message;
   writeState(sock, state);
   throw error;
   }
}

async function fakeReactCommand(sock, _chatId, _message, rawArgs = '') {
   const owner = ownerJid(sock);
   if (!owner) {
   await replyPrivately(sock, '❌ Compte WhatsApp connecté introuvable.');
   return;
   }

   const value = String(rawArgs || '').trim();
   const command = value.toLowerCase();
   const state = readState(sock);

   if (command === 'off') {
   state.enabled = false;
   state.liveUpdatesState = 'disabled';
   state.disabledAt = Date.now();
   writeState(sock, state);
   await replyPrivately(sock, '✅ Les notifications de chaîne sont désactivées pour ce compte.');
   return;
   }

   if (command === 'status') {
   const status = state.enabled
       ? '📡 Notifications actives pour ' + (state.channelJid || 'la chaîne configurée') +
           '. Réception en direct : ' + (state.liveUpdatesState === 'active' ? 'confirmée.' : 'en attente de confirmation.')
       : 'ℹ️ Aucune notification de chaîne active sur ce compte.';
   await replyPrivately(sock, status);
   return;
   }

   const target = parseChannelLink(value.trim().split(' ')[0]);
   if (!target) {
   await replyPrivately(
       sock,
       'Utilise .channelalert <lien de chaîne WhatsApp> pour activer le suivi sur ce compte.\n' +
       'Alias : .fakeract <lien>\n' +
       'Commandes : .channelalert status | .channelalert off'
   );
   return;
   }

   if (typeof sock.newsletterMetadata !== 'function') {
   await replyPrivately(sock, '❌ Cette version de Baileys ne permet pas de vérifier les chaînes WhatsApp.');
   return;
   }

   try {
   const metadata = await sock.newsletterMetadata('invite', target.inviteCode);
   const newsletterJid = metadata?.id || metadata?.jid;
   if (!newsletterJid || !newsletterJid.endsWith('@newsletter')) throw new Error('Chaîne introuvable ou JID invalide');
   if (typeof sock.newsletterFollow !== 'function') {
       throw new Error('Le suivi des chaînes n’est pas pris en charge par cette version de Baileys');
   }

   await sock.newsletterFollow(newsletterJid);
   const nextState = {
       enabled: true,
       inviteCode: target.inviteCode,
       channelJid: newsletterJid,
       sentPosts: [],
       configuredAt: Date.now(),
       liveUpdatesState: 'pending',
   };
   writeState(sock, nextState);

   try {
       await requestLiveUpdates(sock, newsletterJid);
       nextState.liveUpdatesState = 'active';
       nextState.lastLiveUpdatesAt = Date.now();
       writeState(sock, nextState);
       await replyPrivately(sock, '✅ Chaîne suivie et réception en direct confirmée pour ce compte. Chaque nouvelle publication suivie sera signalée en privé.');
   } catch (error) {
       nextState.liveUpdatesState = 'pending';
       nextState.liveUpdatesError = error.message;
       writeState(sock, nextState);
       console.error('[channel-alert] follow succeeded but live updates were not confirmed account=' + maskedAccount(sock) +
           ' channel=' + newsletterJid + ': ' + error.message);
       await replyPrivately(sock, '✅ Chaîne suivie. ⚠️ Baileys n’a pas confirmé la réception en direct; elle sera réessayée à la prochaine reconnexion. Consulte les journaux si le problème persiste.');
   }
   } catch (error) {
   console.error('[channel-alert] activation failed account=' + maskedAccount(sock) + ': ' + error.message);
   await replyPrivately(sock, '❌ Impossible d’activer le suivi de cette chaîne : ' + error.message);
   }
}

async function handleChannelPost(sock, message) {
   const remoteJid = message?.key?.remoteJid;
   if (!remoteJid?.endsWith('@newsletter')) return false;

   const config = readState(sock);
   if (!config.enabled || config.channelJid !== remoteJid) return false;

   const serverMessageId = String(
   message.key.serverMessageId ||
   message.key.serverId ||
   message.key.server_id ||
   message.message?.messageContextInfo?.serverMessageId ||
   message.message?.messageContextInfo?.serverId ||
   message.message?.newsletterMessage?.serverMessageId ||
   (/^[0-9]+$/.test(String(message.key.id || '')) ? message.key.id : '') ||
   ''
   );
   const postKey = serverMessageId || String(message.key.id || '');
   if (!postKey) {
   console.warn('[channel-alert] newsletter post skipped: no usable message id account=' + maskedAccount(sock) + ' channel=' + remoteJid);
   return false;
   }

   const accountKey = crypto.createHash('sha256').update(accountNumber(sock)).digest('hex');
   const eventKey = accountKey + ':' + remoteJid + ':' + postKey;
   const sentPosts = Array.isArray(config.sentPosts) ? config.sentPosts : [];
   if (pendingNotifications.has(eventKey) || sentPosts.includes(postKey)) return false;
   pendingNotifications.add(eventKey);
   try {
   config.sentPosts = [...sentPosts, postKey].slice(-100);
   writeState(sock, config);
   const postUrl = 'https://whatsapp.com/channel/' + config.inviteCode +
       (/^[0-9]+$/.test(serverMessageId) ? '/' + serverMessageId : '');
   try {
       await replyPrivately(sock, '📢 Nouvelle publication sur la chaîne suivie.\n\nOuvrir : ' + postUrl);
   } catch (error) {
       const current = readState(sock);
       current.sentPosts = (Array.isArray(current.sentPosts) ? current.sentPosts : []).filter(id => id !== postKey);
       writeState(sock, current);
       throw error;
   }
   console.info('[channel-alert] private post alert sent account=' + maskedAccount(sock) +
       ' channel=' + remoteJid + ' post=' + postKey);
   return true;
   } finally {
   pendingNotifications.delete(eventKey);
   }
}

async function handleChannelMessages(sock, messages, upsertType) {
   const posts = (Array.isArray(messages) ? messages : [])
   .filter(message => message?.key?.remoteJid?.endsWith('@newsletter'));
   let notified = 0;
   let failed = 0;

   for (const message of posts) {
   const channelJid = message.key.remoteJid;
   const messageId = String(message.key.serverMessageId || message.key.id || 'unknown');
   const state = readState(sock);
   if (channelJid === PRIMARY_CHANNEL_JID || (state.enabled && state.channelJid === channelJid)) {
       console.info('[channel-alert] newsletter post received account=' + maskedAccount(sock) +
           ' channel=' + channelJid + ' post=' + messageId + ' upsert=' + String(upsertType || 'unknown'));
   }
   try {
       if (await handleChannelPost(sock, message)) notified += 1;
   } catch (error) {
       failed += 1;
       console.error('[channel-alert] post handling failed account=' + maskedAccount(sock) +
           ' channel=' + channelJid + ' post=' + messageId + ': ' + error.message);
   }
   }

   return { received: posts.length, notified, failed };
}

module.exports = fakeReactCommand;
module.exports.handleChannelPost = handleChannelPost;
module.exports.handleChannelMessages = handleChannelMessages;
module.exports.restoreChannelAlerts = restoreChannelAlerts;
module.exports.parseChannelLink = parseChannelLink;
